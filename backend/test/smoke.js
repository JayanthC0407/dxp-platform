// End-to-end smoke test: app login -> live channel -> console edit -> maker/checker release -> app receives config.published
// -> manifest/screen reflect the change -> transfer journey -> Customer 360 shows the transaction.
const BASE = process.env.BASE || 'http://localhost:8090';
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok -', m); };
const j = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
(async () => {
  const app = (await j('/api/app/v1/auth/login', { method: 'POST', body: { username: 'aisha', password: '1234', deviceId: 'SMOKE-1', platform: 'test', runtime: '1.0.0' } })).body.accessToken;
  assert(app, 'customer login');
  const m1 = (await j('/api/app/v1/manifest', { token: app })).body;
  assert(m1.segment === 'RETAIL' && m1.theme.id === 'default', 'manifest resolves RETAIL segment + default theme');
  const home1 = (await j('/api/app/v1/screens/home', { token: app })).body;
  assert(!JSON.stringify(home1).includes('Premier FX'), 'premier-only banner filtered out for retail');

  // live channel
  const ctrl = new AbortController();
  const events = [];
  const sse = fetch(BASE + '/api/app/v1/live?token=' + app, { signal: ctrl.signal }).then(async r => { const rd = r.body.getReader(); const dec = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; events.push(dec.decode(value)); } }).catch(() => {});
  await new Promise(r => setTimeout(r, 300));
  assert(events.join('').includes('event: hello'), 'SSE hello received');

  const maker = (await j('/api/console/v1/auth/login', { method: 'POST', body: { username: 'maker', password: 'maker123' } })).body.token;
  const checker = (await j('/api/console/v1/auth/login', { method: 'POST', body: { username: 'checker', password: 'checker123' } })).body.token;
  const scr = (await j('/api/console/v1/screens/home', { token: maker })).body.draft;
  scr.root.children[0].props.text = 'Welcome back, {{customer.firstName}}!';
  scr.root.children.splice(2, 0, { type: 'Banner', props: { title: 'Ramadan offer', text: 'Zero fees on transfers', tone: 'promo', icon: 'gift' } });
  const save = await j('/api/console/v1/screens/home', { method: 'PUT', token: maker, body: { json: scr } });
  assert(save.status === 200 && save.body.warnings.length === 0, 'maker saved draft without validation errors');
  const bad = JSON.parse(JSON.stringify(scr)); bad.root.children.push({ type: 'Hologram' });
  const badSave = await j('/api/console/v1/validate', { method: 'POST', token: maker, body: { kind: 'screen', json: bad } });
  assert(badSave.body.errors.some(e => e.includes('Hologram')), 'validator rejects unknown widget');
  const th = (await j('/api/console/v1/themes/default', { token: maker })).body.draft;
  th.colors.primary = '#B00020';
  await j('/api/console/v1/themes/default', { method: 'PUT', token: maker, body: { json: th } });
  const rel = await j('/api/console/v1/releases', { method: 'POST', token: maker, body: { note: 'smoke' } });
  assert(rel.status === 200, 'release submitted: ' + JSON.stringify(rel.body));
  const self = await j(`/api/console/v1/releases/${rel.body.no}/approve`, { method: 'POST', token: maker });
  assert(self.status === 403, 'maker cannot approve own release');
  const ap = await j(`/api/console/v1/releases/${rel.body.no}/approve`, { method: 'POST', token: checker });
  assert(ap.status === 200 && ap.body.configVersion === m1.configVersion + 1, 'checker approved; config version bumped');
  await new Promise(r => setTimeout(r, 300));
  assert(events.join('').includes('event: config.published'), 'app received config.published over SSE (no app release)');
  const m2 = (await j('/api/app/v1/manifest', { token: app })).body;
  assert(m2.theme.colors.primary === '#B00020', 'new theme colour in manifest');
  assert(m2.screens.home !== m1.screens.home && m2.screens.accounts === m1.screens.accounts, 'only changed screen hash differs');
  const home2 = (await j('/api/app/v1/screens/home', { token: app })).body;
  assert(home2.root.children[0].props.text.startsWith('Welcome back') && JSON.stringify(home2).includes('Ramadan offer'), 'app gets new home screen');

  // transfer journey
  const inst = (await j('/api/app/v1/journeys/transfer/instances', { method: 'POST', token: app, body: {} })).body;
  const skip = (await j(`/api/app/v1/journeys/instances/${inst.instanceId}/tasks/transfer.submit`, { method: 'POST', token: app, body: { state: { from: 'A-1001-1', to: 'P1', amount: 10 } } })).body;
  assert(!skip.ok && skip.error.code === 'JOURNEY_ORDER', 'server blocks skipping validation/review');
  const inst2 = (await j('/api/app/v1/journeys/transfer/instances', { method: 'POST', token: app, body: {} })).body;
  const over = (await j(`/api/app/v1/journeys/instances/${inst2.instanceId}/tasks/transfer.validate`, { method: 'POST', token: app, body: { state: { from: 'A-1001-1', to: 'P1', amount: 5000 } } })).body;
  assert(!over.ok && over.error.code === 'LIMIT_EXCEEDED' && over.next === 'amount', 'per-txn limit enforced server-side, routed back to amount');
  const v = (await j(`/api/app/v1/journeys/instances/${inst2.instanceId}/tasks/transfer.validate`, { method: 'POST', token: app, body: { state: { from: 'A-1001-1', fromLabel: 'Current account', to: 'P1', toLabel: 'Fatma Al-Ali', amount: 25 } } })).body;
  assert(v.ok && v.next === 'review' && v.state.total === 25.25, 'validate ok with fee');
  const s = (await j(`/api/app/v1/journeys/instances/${inst2.instanceId}/tasks/transfer.submit`, { method: 'POST', token: app, body: { state: v.state, idempotencyKey: inst2.instanceId + ':submit' } })).body;
  assert(s.ok && s.next === 'done' && /^FT/.test(s.state.reference), 'transfer posted, reference ' + s.state.reference);
  await j('/api/app/v1/events', { method: 'POST', token: app, body: { events: [{ type: 'SCREEN_VIEW', screen: 'transfer_result' }, { type: 'NOT_ALLOWED' }] } });

  const c = (await j('/api/console/v1/customers/C1001/360', { token: checker })).body;
  assert(c.transactions.some(t => t.downstreamRef === s.state.reference && t.status === 'SUCCEEDED'), 'Customer 360 shows the transaction');
  assert(c.events.some(e => e.type === 'TXN_SUCCEEDED') && c.events.some(e => e.type === 'SCREEN_VIEW'), 'Customer 360 timeline has server + client events');
  // rollback
  const rb = await j(`/api/console/v1/releases/1/rollback`, { method: 'POST', token: checker });
  const m3 = (await j('/api/app/v1/manifest', { token: app })).body;
  assert(rb.status === 200 && m3.theme.colors.primary === '#0B6E69' && m3.screens.home === m1.screens.home, 'rollback restores release 1 as a new config version ' + m3.configVersion);
  // lock revokes session
  await j('/api/console/v1/customers/C1001/lock', { method: 'POST', token: checker, body: { reason: 'smoke test' } });
  await new Promise(r => setTimeout(r, 200));
  assert(events.join('').includes('session.revoked'), 'locking customer revokes the live session');
  assert((await j('/api/app/v1/manifest', { token: app })).status === 401, 'revoked token rejected');
  await j('/api/console/v1/customers/C1001/unlock', { method: 'POST', token: checker, body: { reason: 'smoke test done' } });
  ctrl.abort();
  console.log('\nALL SMOKE TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
