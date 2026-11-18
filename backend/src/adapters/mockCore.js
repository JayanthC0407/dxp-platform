// Mock downstream adapter implementing the canonical banking interface.
// A real deployment swaps this for FLEXCUBE / OBDX, Temenos, OBPM, card-switch adapters
// that implement the same functions and map errors to the same canonical codes.
const store = require('../store');

class CanonicalError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const latency = () => new Promise(r => setTimeout(r, 150 + Math.random() * 200));
const core = () => store.get().core;

const mockCore = {
  name: 'mock-core',
  async customerProfile(c) { return { id: c.id, name: c.name, firstName: c.firstName, segment: c.segment, email: c.email, mobile: c.mobile, rm: c.rm }; },
  async accountsList(c) { await latency(); return core().accounts[c.id] || []; },
  async txnHistory(c) { await latency(); return [...(core().txns[c.id] || [])].sort((a, b) => (a.date < b.date ? 1 : -1)); },
  async payeesList(c) { return core().payees[c.id] || []; },
  async cardsList(c) { return core().cards[c.id] || []; },

  async transferSubmit(c, { from, to, amount, note }) {
    await latency();
    const acc = (core().accounts[c.id] || []).find(a => a.id === from);
    if (!acc) throw new CanonicalError('ACCOUNT_INVALID', 'The source account was not found.');
    const payee = (core().payees[c.id] || []).find(p => p.id === to);
    if (!payee) throw new CanonicalError('BENEFICIARY_INVALID', 'The beneficiary is not valid.');
    if (amount > acc.balance) throw new CanonicalError('INSUFFICIENT_FUNDS', 'Not enough balance in the selected account.');
    acc.balance = Math.round((acc.balance - amount) * 1000) / 1000;
    const ref = 'FT' + Date.now().toString().slice(-9);
    (core().txns[c.id] = core().txns[c.id] || []).unshift({ id: ref, date: new Date().toISOString().slice(0, 10), description: `Transfer to ${payee.name}${note ? ' - ' + note : ''}`, amount: -amount, currency: acc.currency, status: 'POSTED' });
    store.save();
    return { reference: ref, status: 'POSTED' };
  },

  async cardBlock(c, { cardId }) {
    await latency();
    const card = (core().cards[c.id] || []).find(k => k.id === cardId);
    if (!card) throw new CanonicalError('CARD_INVALID', 'Please choose a card.');
    if (card.status === 'FROZEN') throw new CanonicalError('CARD_ALREADY_FROZEN', 'This card is already frozen.');
    card.status = 'FROZEN';
    store.save();
    return { reference: 'CB' + Date.now().toString().slice(-8) };
  },
};

module.exports = { adapter: mockCore, CanonicalError };
