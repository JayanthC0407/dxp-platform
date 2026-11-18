// Seed data for the DXP prototype: widget registry, screens, journeys, themes,
// segment assignments, entitlements, staff, customers and the mock core-banking book.
const crypto = require('crypto');

function hashPassword(pw) {
  const salt = crypto.randomBytes(8).toString('hex');
  const h = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `${salt}:${h}`;
}

// ---------- Widget registry (manifests) ----------
const P = (type, extra = {}) => ({ type, ...extra });
const APP_WIDGETS = ['retail-accounts', 'casa-account-card', 'loans-account-card', 'loan-summary', 'credit-card', 'recent-account-transactions', 'spend-summary', 'quick-links', 'offers'];
const widgets = [
  { type: 'Column', major: 1, category: 'Layout', container: true, events: [], props: { padding: P('number', { default: 16 }), gap: P('number', { default: 12 }), scroll: P('boolean', { default: false }), align: P('enum', { values: ['stretch', 'start', 'center'] }) } },
  { type: 'Row', major: 1, category: 'Layout', container: true, events: [], props: { gap: P('number', { default: 8 }), align: P('enum', { values: ['start', 'center', 'spaceBetween'] }) } },
  { type: 'Card', major: 1, category: 'Layout', container: true, events: ['tap'], props: { padding: P('number', { default: 16 }), tone: P('enum', { values: ['surface', 'primary'] }) } },
  { type: 'Text', major: 1, category: 'Display', events: [], props: { text: P('string', { default: 'Text' }), style: P('enum', { values: ['headline', 'title', 'body', 'caption', 'muted'] }), align: P('enum', { values: ['start', 'center', 'end'] }) } },
  { type: 'Button', major: 1, category: 'Input', events: ['tap'], props: { label: P('string', { default: 'Button' }), variant: P('enum', { values: ['primary', 'secondary', 'text'] }), icon: P('icon') } },
  { type: 'Banner', major: 1, category: 'Marketing', events: ['tap'], props: { title: P('string', { default: 'Banner title' }), text: P('string', { default: 'Banner text' }), tone: P('enum', { values: ['info', 'promo', 'warning'] }), icon: P('icon') } },
  { type: 'BalanceCard', major: 1, category: 'Banking', events: ['tap'], props: { title: P('string', { default: 'Total balance' }), amount: P('string', { default: '0' }), currency: P('string', { default: 'KWD' }), subtitle: P('string') } },
  { type: 'AccountList', major: 1, category: 'Banking', events: ['tap'], bindable: ['items'], props: { items: P('binding') } },
  { type: 'TxnList', major: 1, category: 'Banking', events: [], bindable: ['items'], props: { items: P('binding'), limit: P('number', { default: 5 }) } },
  { type: 'QuickActions', major: 1, category: 'Banking', events: [], props: { items: P('json', { default: [{ label: 'Accounts', icon: 'wallet', action: { type: 'nativeRoute', route: '/accounts' } }] }) } },
  { type: 'TextField', major: 1, category: 'Input', events: [], props: { label: P('string', { default: 'Label' }), field: P('string', { default: 'field' }), placeholder: P('string'), keyboard: P('enum', { values: ['text', 'number'] }) } },
  { type: 'AmountField', major: 1, category: 'Input', events: [], props: { label: P('string', { default: 'Amount' }), field: P('string', { default: 'amount' }), currency: P('string', { default: 'KWD' }) } },
  { type: 'SelectList', major: 1, category: 'Input', events: ['tap'], bindable: ['items'], props: { label: P('string'), field: P('string', { default: 'selection' }), items: P('binding'), labelKey: P('string', { default: 'name' }), subtitleKey: P('string'), valueKey: P('string', { default: 'id' }) } },
  { type: 'OtpInput', major: 1, category: 'Banking', events: [], props: { field: P('string', { default: 'otp' }), length: P('number', { default: 6 }) } },
  { type: 'ReviewSummary', major: 1, category: 'Banking', events: [], props: { rows: P('json', { default: [{ label: 'Label', value: 'Value' }] }) } },
  { type: 'ResultPanel', major: 1, category: 'Banking', events: [], props: { status: P('enum', { values: ['success', 'failure'] }), title: P('string', { default: 'Done' }), message: P('string') } },
  // The Demo Bank app's own Home widgets, placed by name (CONTRACT-OBDX §4).
  // Keep APP_WIDGETS in step with the app's RetailAppWidgets.names.
  { type: 'AppWidget', major: 1, category: 'App widgets', events: [], props: { name: P('enum', { values: APP_WIDGETS }) } },
  { type: 'Divider', major: 1, category: 'Layout', events: [], props: {} },
  { type: 'Spacer', major: 1, category: 'Layout', events: [], props: { size: P('number', { default: 16 }) } },
].map(w => ({ ...w, version: `${w.major}.0.0`, minRuntime: '1.0.0', status: 'active' }));

// ---------- Screens (Demo Bank showcase, CONTRACT-OBDX §10) ----------
// `home` is drawn in the DXP slot on the native Retail Home; the others open
// from the Retail menu. Data comes from OBDX through the app (CONTRACT-OBDX §6).
const route = (r) => ({ type: 'nativeRoute', route: r });
const screens = {
  home: {
    // The whole Home body (CONTRACT-OBDX §10): the app keeps only its header,
    // menu and bottom bar. Starts as today's Home so the Studio shows what is
    // already there.
    id: 'home', title: 'Home', layout: 'full',
    data: {},
    root: { type: 'Column', props: { padding: 0, gap: 16 }, children: [
      { type: 'AppWidget', props: { name: 'retail-accounts' } },
      { type: 'Banner', props: { title: 'Personal loans made simple', text: 'See your loans and what you can borrow.', tone: 'promo', icon: 'gift' }, on: { tap: route('/accounts/loans') } },
      { type: 'QuickActions', props: { items: [
        { label: 'Accounts', icon: 'wallet', action: route('/accounts') },
        { label: 'Transfer', icon: 'send', action: route('/transfer') },
        { label: 'Cards', icon: 'card', action: route('/cards/credit') },
        { label: 'Offers', icon: 'star', action: { type: 'navigate', screen: 'offers' } },
      ] } },
      { type: 'AppWidget', props: { name: 'recent-account-transactions' } },
      { type: 'AppWidget', props: { name: 'spend-summary' } },
      { type: 'AppWidget', props: { name: 'loan-summary' } },
      { type: 'AppWidget', props: { name: 'quick-links' } },
      { type: 'AppWidget', props: { name: 'offers' } },
    ] },
  },
  offers: {
    id: 'offers', title: 'Offers',
    data: {},
    root: { type: 'Column', props: { padding: 16, gap: 12, scroll: true }, children: [
      { type: 'Text', props: { text: 'Offers for you', style: 'headline' } },
      { type: 'Banner', props: { title: 'Grow your savings', text: 'Open a term deposit from the app.', tone: 'info', icon: 'chart' }, on: { tap: route('/accounts/term-deposits') } },
      { type: 'Banner', props: { title: 'Pay bills on time', text: 'Register your billers once and pay in seconds.', tone: 'promo', icon: 'receipt' }, on: { tap: route('/bills') } },
      { type: 'Button', props: { label: 'View my accounts', variant: 'secondary', icon: 'wallet' }, on: { tap: route('/accounts') } },
    ] },
  },
  my_money: {
    id: 'my_money', title: 'My money',
    data: { accounts: { source: 'accounts.list' } },
    root: { type: 'Column', props: { padding: 16, gap: 12, scroll: true }, children: [
      { type: 'Text', props: { text: 'Hello, {{customer.firstName}}', style: 'headline' } },
      { type: 'Text', props: { text: 'Your accounts, live from OBDX', style: 'muted' } },
      { type: 'AccountList', bind: { items: 'accounts' }, on: { tap: route('/accounts') } },
    ] },
  },
};

// Journeys run in the app (CONTRACT-OBDX §5). The POC journey is chosen in phase 0.
const journeys = {};

const colors = (primary, background) => ({ primary, onPrimary: '#FFFFFF', secondary: '#1B1B1B', background, surface: '#FFFFFF', onSurface: '#1B1B1B', muted: '#6B6B6B', success: '#1E8E3E', danger: '#C62828' });
const themes = {
  default: { id: 'default', brandName: 'Demo Bank', colors: colors('#0B6E69', '#F3F6F6'), radius: 14, fontFamily: 'Roboto' },
  premier: { id: 'premier', brandName: 'Bank One Premier', colors: colors('#8A6D1F', '#F7F4EC'), radius: 18, fontFamily: 'Roboto' },
  youth: { id: 'youth', brandName: 'Bank One Go', colors: colors('#6C3CE1', '#F4F1FD'), radius: 22, fontFamily: 'Roboto' },
};

const navItem = (label, icon, screen) => ({ label, icon, action: { type: 'navigate', screen } });
const assignments = {
  default: {
    id: 'default',
    segments: {
      DEFAULT: { theme: 'default', home: 'home', menu: [navItem('Offers', 'star', 'offers'), navItem('My money', 'wallet', 'my_money')] },
      RETAIL: {},
      PREMIER: { theme: 'premier' },
      YOUTH: { theme: 'youth' },
    },
  },
};

const segments = [
  { code: 'DEFAULT', name: 'Default', fallback: null, rule: 'fallback for all customers' },
  { code: 'RETAIL', name: 'Retail', fallback: 'DEFAULT', rule: 'customer.segment == RETAIL' },
  { code: 'PREMIER', name: 'Premier', fallback: 'DEFAULT', rule: 'customer.segment == PREMIER' },
  { code: 'YOUTH', name: 'Youth (15-21)', fallback: 'DEFAULT', rule: 'customer.segment == YOUTH' },
];

const features = [
  { code: 'TXN.TRANSFER.OWN', name: 'Transfer to own / saved payees', kind: 'txn' },
  { code: 'CARD.FREEZE', name: 'Freeze a card', kind: 'service' },
  { code: 'VIEW.STATEMENTS', name: 'View statements', kind: 'view' },
];

const entitlements = [
  { id: 'E1', subjectType: 'segment', subjectId: 'DEFAULT', feature: 'TXN.TRANSFER.OWN', enabled: true, perTxnLimit: 1000, dailyLimit: 3000, currency: 'KWD' },
  { id: 'E2', subjectType: 'segment', subjectId: 'PREMIER', feature: 'TXN.TRANSFER.OWN', enabled: true, perTxnLimit: 10000, dailyLimit: 50000, currency: 'KWD' },
  { id: 'E3', subjectType: 'segment', subjectId: 'YOUTH', feature: 'TXN.TRANSFER.OWN', enabled: true, perTxnLimit: 50, dailyLimit: 100, currency: 'KWD' },
  { id: 'E4', subjectType: 'segment', subjectId: 'DEFAULT', feature: 'CARD.FREEZE', enabled: true },
  { id: 'E5', subjectType: 'segment', subjectId: 'DEFAULT', feature: 'VIEW.STATEMENTS', enabled: true },
];

const staff = [
  { username: 'maker', name: 'Mona Designer', roles: ['designer', 'maker', 'csr'], password: 'maker123' },
  { username: 'checker', name: 'Khaled Approver', roles: ['approver', 'csr'], password: 'checker123' },
  { username: 'admin', name: 'Admin User', roles: ['admin', 'designer', 'maker', 'approver', 'csr'], password: 'admin123' },
];

const customers = [
  { id: 'C1001', cif: '00410012', username: 'aisha', name: 'Aisha Al-Sabah', firstName: 'Aisha', segment: 'RETAIL', email: 'aisha@example.com', mobile: '+965 5000 1001', rm: 'Digital desk', status: 'ACTIVE', kycStatus: 'VERIFIED', riskRating: 'LOW' },
  { id: 'C1002', cif: '00410027', username: 'omar', name: 'Omar Haddad', firstName: 'Omar', segment: 'PREMIER', email: 'omar@example.com', mobile: '+965 5000 1002', rm: 'Sara Qasem', status: 'ACTIVE', kycStatus: 'VERIFIED', riskRating: 'MEDIUM' },
  { id: 'C1003', cif: '00410033', username: 'lina', name: 'Lina Mansour', firstName: 'Lina', segment: 'YOUTH', email: 'lina@example.com', mobile: '+965 5000 1003', rm: 'Digital desk', status: 'ACTIVE', kycStatus: 'VERIFIED', riskRating: 'LOW' },
];

// Mock core banking book (stands in for FLEXCUBE / Temenos etc. behind the adapter)
const core = {
  accounts: {
    C1001: [
      { id: 'A-1001-1', name: 'Current account', number: '...0012', type: 'CURRENT', balance: 1840.25, currency: 'KWD' },
      { id: 'A-1001-2', name: 'Savings', number: '...0049', type: 'SAVINGS', balance: 6200, currency: 'KWD' },
    ],
    C1002: [
      { id: 'A-1002-1', name: 'Premier current', number: '...7781', type: 'CURRENT', balance: 48210.5, currency: 'KWD' },
      { id: 'A-1002-2', name: 'USD account', number: '...7790', type: 'CURRENT', balance: 15300, currency: 'USD' },
      { id: 'A-1002-3', name: 'Term deposit', number: '...7802', type: 'DEPOSIT', balance: 100000, currency: 'KWD' },
    ],
    C1003: [
      { id: 'A-1003-1', name: 'Go account', number: '...3301', type: 'CURRENT', balance: 142.75, currency: 'KWD' },
    ],
  },
  payees: {
    C1001: [{ id: 'P1', name: 'Fatma Al-Ali', account: 'KW81 CBKU ...4410', bank: 'CBK' }, { id: 'P2', name: 'Landlord - Salmiya', account: 'KW22 NBOK ...9012', bank: 'NBK' }],
    C1002: [{ id: 'P3', name: 'Haddad Trading', account: 'KW55 GULB ...1120', bank: 'Gulf Bank' }, { id: 'P4', name: 'Nadia Haddad', account: 'KW10 BBYN ...7733', bank: 'Boubyan' }],
    C1003: [{ id: 'P5', name: 'Mum', account: 'KW81 CBKU ...5521', bank: 'CBK' }],
  },
  cards: {
    C1001: [{ id: 'K1', name: 'Visa Debit', number: '**** 4417', status: 'ACTIVE', limit: 2000, currency: 'KWD' }],
    C1002: [{ id: 'K2', name: 'Visa Infinite', number: '**** 9001', status: 'ACTIVE', limit: 25000, currency: 'KWD' }, { id: 'K3', name: 'Debit card', number: '**** 3320', status: 'ACTIVE', limit: 5000, currency: 'KWD' }],
    C1003: [{ id: 'K4', name: 'Go prepaid', number: '**** 6612', status: 'ACTIVE', limit: 200, currency: 'KWD' }],
  },
  txns: {
    C1001: [
      { id: 'T1', date: '2026-11-04', description: 'Salary - Ministry', amount: 1450, currency: 'KWD', status: 'POSTED' },
      { id: 'T2', date: '2026-11-03', description: 'Sultan Center', amount: -38.4, currency: 'KWD', status: 'POSTED' },
      { id: 'T3', date: '2026-11-02', description: 'Talabat', amount: -6.75, currency: 'KWD', status: 'POSTED' },
    ],
    C1002: [
      { id: 'T4', date: '2026-11-05', description: 'Dividend - KSE', amount: 2200, currency: 'KWD', status: 'POSTED' },
      { id: 'T5', date: '2026-11-01', description: 'Emirates', amount: -640, currency: 'KWD', status: 'POSTED' },
    ],
    C1003: [
      { id: 'T6', date: '2026-11-03', description: 'Allowance', amount: 50, currency: 'KWD', status: 'POSTED' },
      { id: 'T7', date: '2026-11-02', description: 'Cinescape', amount: -4.5, currency: 'KWD', status: 'POSTED' },
    ],
  },
};

function seed() {
  const now = new Date().toISOString();
  const items = { screen: {}, journey: {}, theme: {}, assignments: {} };
  const add = (kind, map) => {
    for (const [id, json] of Object.entries(map)) {
      const v1 = { ...json, version: 1 };
      items[kind][id] = { id, draft: { json: v1, updatedBy: 'system', updatedAt: now }, versions: [{ version: 1, json: v1, publishedAt: now, releaseNo: 1 }] };
    }
  };
  add('screen', screens); add('journey', journeys); add('theme', themes); add('assignments', assignments);
  const snapshot = {};
  for (const kind of Object.keys(items)) { snapshot[kind] = {}; for (const id of Object.keys(items[kind])) snapshot[kind][id] = 1; }
  return {
    meta: { seededAt: now },
    widgets, items, segments, features, entitlements,
    staff: staff.map(s => ({ username: s.username, name: s.name, roles: s.roles, active: true, passwordHash: hashPassword(s.password) })),
    customers: customers.map(c => ({ ...c, passwordHash: hashPassword('1234'), failedLogins: 0, devices: [] })),
    core,
    releases: [{ no: 1, status: 'PUBLISHED', note: 'Initial configuration', configVersion: 1, snapshot, changes: [], submittedBy: 'system', approvedBy: 'system', submittedAt: now, publishedAt: now }],
    active: { releaseNo: 1, configVersion: 1, snapshot },
    journeyInstances: {}, transactions: [], events: [], sessions: [], audit: [], seq: 0,
  };
}

module.exports = { seed, hashPassword };
