// Journey engine + transaction gateway.
// The server keeps the authoritative journey state, so a client cannot skip validation or review.
const store = require('./store');
const resolver = require('./resolver');
const { adapter, CanonicalError } = require('./adapters/mockCore');

function startInstance(customer, journeyId) {
  const db = store.get();
  const j = resolver.resolveJourney(journeyId, customer);
  if (!j) throw new CanonicalError('NOT_ENTITLED', 'This service is not available for your account.');
  const inst = { id: store.id('J'), journey: j.id, version: j.version, customerId: customer.id, json: j, state: {}, current: j.start, history: [j.start], status: 'ACTIVE', startedAt: new Date().toISOString(), results: {} };
  db.journeyInstances[inst.id] = inst;
  store.save();
  store.recordEvent({ type: 'JOURNEY_STARTED', customerId: customer.id, source: 'server', journey: { id: j.id, version: j.version, instance: inst.id } });
  return inst;
}

// Server-side check: a task may only run when the journey definition says the previous screen leads to it.
// Reachable = following screen 'next' edges from any step the server has seen, stopping at tasks.
function assertReachable(inst, taskStep) {
  const steps = inst.json.steps;
  const seen = new Set();
  const walk = (name) => {
    if (!name || seen.has(name) || !steps[name]) return;
    seen.add(name);
    if (steps[name].screen && !steps[name].terminal) walk(steps[name].next);
  };
  inst.history.forEach(h => { if (steps[h] && steps[h].screen) walk(h); });
  if (!seen.has(taskStep)) throw new CanonicalError('JOURNEY_ORDER', 'This step is not allowed yet.');
}

const daySpent = (customerId, type) => {
  const today = new Date().toISOString().slice(0, 10);
  return store.get().transactions.filter(t => t.customerId === customerId && t.type === type && t.status === 'SUCCEEDED' && t.createdAt.startsWith(today)).reduce((s, t) => s + t.amount, 0);
};

const tasks = {
  async 'transfer.validate'(customer, inst, state) {
    const amount = Number(state.amount);
    if (!state.from) throw new CanonicalError('ACCOUNT_INVALID', 'Choose the account to pay from.');
    if (!state.to) throw new CanonicalError('BENEFICIARY_INVALID', 'Choose who to pay.');
    if (!(amount > 0)) throw new CanonicalError('AMOUNT_INVALID', 'Enter an amount greater than zero.');
    const ent = resolver.resolveEntitlements(customer)['TXN.TRANSFER.OWN'];
    if (!ent) throw new CanonicalError('NOT_ENTITLED', 'Transfers are not enabled for your account.');
    if (ent.perTxnLimit && amount > ent.perTxnLimit) throw new CanonicalError('LIMIT_EXCEEDED', `The limit per transfer is ${ent.perTxnLimit} ${ent.currency}.`);
    if (ent.dailyLimit && daySpent(customer.id, 'TRANSFER.OWN') + amount > ent.dailyLimit) throw new CanonicalError('LIMIT_EXCEEDED', `This would exceed your daily limit of ${ent.dailyLimit} ${ent.currency}.`);
    const accs = await adapter.accountsList(customer);
    const acc = accs.find(a => a.id === state.from);
    if (!acc) throw new CanonicalError('ACCOUNT_INVALID', 'Choose the account to pay from.');
    if (amount > acc.balance) throw new CanonicalError('INSUFFICIENT_FUNDS', `Available balance is ${acc.balance} ${acc.currency}.`);
    const fee = customer.segment === 'PREMIER' ? 0 : 0.25;
    inst.validated = { amount, from: state.from, to: state.to };
    return { fee, total: Math.round((amount + fee) * 1000) / 1000, fromLabel: state.fromLabel || acc.name, validated: true };
  },

  async 'transfer.submit'(customer, inst, state, idem) {
    const db = store.get();
    const v = inst.validated;
    if (!v || v.amount !== Number(state.amount) || v.from !== state.from || v.to !== state.to) throw new CanonicalError('JOURNEY_ORDER', 'Details changed after review. Please review the transfer again.');
    const existing = db.transactions.find(t => t.idempotencyKey === idem);
    if (existing) return { reference: existing.downstreamRef, replayed: true };
    const txn = { id: store.id('TX'), idempotencyKey: idem, customerId: customer.id, type: 'TRANSFER.OWN', amount: Number(state.amount), currency: 'KWD', from: state.from, to: state.to, toLabel: state.toLabel, status: 'SUBMITTED', journeyInstance: inst.id, createdAt: new Date().toISOString() };
    db.transactions.push(txn);
    store.recordEvent({ type: 'TXN_SUBMITTED', customerId: customer.id, source: 'server', journey: { id: inst.journey, instance: inst.id }, payload: { txnId: txn.id, txnType: txn.type, amount: txn.amount, currency: txn.currency, to: txn.toLabel } });
    try {
      const res = await adapter.transferSubmit(customer, state);
      Object.assign(txn, { status: 'SUCCEEDED', downstreamRef: res.reference, completedAt: new Date().toISOString() });
      store.recordEvent({ type: 'TXN_SUCCEEDED', customerId: customer.id, source: 'server', journey: { id: inst.journey, instance: inst.id }, payload: { txnId: txn.id, txnType: txn.type, amount: txn.amount, currency: txn.currency, reference: res.reference } });
      return { reference: res.reference };
    } catch (e) {
      Object.assign(txn, { status: 'FAILED', errorCode: e.code || 'DOWNSTREAM_ERROR', completedAt: new Date().toISOString() });
      store.recordEvent({ type: 'TXN_FAILED', customerId: customer.id, source: 'server', journey: { id: inst.journey, instance: inst.id }, payload: { txnId: txn.id, txnType: txn.type, amount: txn.amount, errorCode: txn.errorCode } });
      throw e;
    } finally { store.save(); }
  },

  async 'card.freeze'(customer, inst, state) {
    const cards = await adapter.cardsList(customer);
    const card = cards.find(k => k.id === state.card);
    const res = await adapter.cardBlock(customer, { cardId: state.card });
    store.recordEvent({ type: 'SERVICE_REQUEST', customerId: customer.id, source: 'server', journey: { id: inst.journey, instance: inst.id }, payload: { request: 'CARD.FREEZE', card: card && card.number, reference: res.reference } });
    return { reference: res.reference, cardLabel: `${card.name} ${card.number}` };
  },
};

async function runTask(customer, instanceId, taskName, clientState, idem) {
  const db = store.get();
  const inst = db.journeyInstances[instanceId];
  if (!inst || inst.customerId !== customer.id) throw new CanonicalError('JOURNEY_NOT_FOUND', 'This session has expired. Please start again.');
  const [stepName, step] = Object.entries(inst.json.steps).find(([, s]) => s.task === taskName) || [];
  if (!step) throw new CanonicalError('TASK_UNKNOWN', 'Unknown step.');
  if (inst.status !== 'ACTIVE') throw new CanonicalError('JOURNEY_CLOSED', 'This journey has ended. Please start again.');
  // Merge client inputs, but never let the client overwrite server-produced results.
  const serverKeys = Object.values(inst.results).flatMap(r => Object.keys(r));
  const merged = { ...inst.state };
  for (const [k, v] of Object.entries(clientState || {})) if (!serverKeys.includes(k)) merged[k] = v;
  inst.state = merged;
  try {
    assertReachable(inst, stepName);
    const handler = tasks[taskName];
    if (!handler) throw new CanonicalError('TASK_UNKNOWN', 'Unknown step.');
    const data = await handler(customer, inst, merged, idem || `${instanceId}:${stepName}`);
    inst.results[taskName] = data;
    inst.state = { ...merged, ...data }; delete inst.state.errorMessage; delete inst.state.errorCode;
    inst.current = step.onSuccess;
    inst.history.push(stepName, step.onSuccess);
    if (inst.json.steps[step.onSuccess] && inst.json.steps[step.onSuccess].terminal) { inst.status = 'COMPLETED'; store.recordEvent({ type: 'JOURNEY_COMPLETED', customerId: customer.id, source: 'server', journey: { id: inst.journey, version: inst.version, instance: inst.id }, payload: { outcome: step.onSuccess } }); }
    store.save();
    return { ok: true, data, state: inst.state, next: step.onSuccess };
  } catch (e) {
    const err = { code: e.code || 'INTERNAL', message: e.code ? e.message : 'Something went wrong. Please try again.' };
    if (!e.code) console.error(e);
    inst.state = { ...merged, errorMessage: err.message, errorCode: err.code };
    inst.current = step.onError;
    inst.history.push(step.onError);
    if (inst.json.steps[step.onError] && inst.json.steps[step.onError].terminal) inst.status = 'FAILED';
    store.save();
    return { ok: false, error: err, state: inst.state, next: step.onError };
  }
}

module.exports = { startInstance, runTask, CanonicalError };
