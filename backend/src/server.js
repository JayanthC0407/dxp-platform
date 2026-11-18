// DXP reference backend: App API (customers), Console API (staff), live channel (SSE), static console + simulator.
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const resolver = require('./resolver');
const journeys = require('./journeys');
const validate = require('./validate');
const { adapter } = require('./adapters/mockCore');

const reset = process.argv.includes('--reset') || process.argv.includes('--reset-only');
store.load({ reset });
if (process.argv.includes('--reset-only')) { console.log('Data reset to seed.'); process.exit(0); }

const PORT = Number(process.env.PORT || 8090);
if (process.env.NODE_ENV === 'production' && !process.env.DXP_TOKEN_SECRET) { console.error('DXP_TOKEN_SECRET is required in production'); process.exit(1); }
const SECRET = process.env.DXP_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
// CONTRACT-OBDX §1.1 / §12.4: one app key per environment. The default is for local dev only.
if (process.env.NODE_ENV === 'production' && !process.env.DXP_APP_KEY) { console.error('DXP_APP_KEY is required in production'); process.exit(1); }
const APP_KEY = process.env.DXP_APP_KEY || 'demo-bank-dev-key';
const IN_SCOPE_USER_TYPES = ['RETAIL'];
const CONTRACT = 'obdx-1';
const ORIGINS = (process.env.DXP_ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '256kb' }));
// Baseline security headers (production: also enforced at the gateway / WAF)
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Opener-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/app')) {
    // Flutter web build: CanvasKit needs wasm; may be framed by the console (same origin) as the Studio preview.
    // Prototype allows Google's font host for fallback glyphs; production self-hosts fonts (blueprint 2.1).
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://fonts.gstatic.com; worker-src 'self' blob:; frame-ancestors 'self'");
  } else if (!req.path.startsWith('/api/')) res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'");
  next();
});
app.use((req, res, next) => { const o = req.headers.origin; res.set('Access-Control-Allow-Origin', ORIGINS.includes('*') ? '*' : (ORIGINS.includes(o) ? o : 'null')); res.set('Vary', 'Origin'); res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-None-Match, X-DXP-App-Key'); res.set('Access-Control-Expose-Headers', 'ETag'); res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); if (req.method === 'OPTIONS') return res.sendStatus(204); next(); });

// ---------- tokens ----------
function sign(payload, ttlSec) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSec * 1000 })).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}
function verify(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() ? p : null;
}
function checkPassword(pw, stored) {
  const [salt, h] = stored.split(':');
  const calc = crypto.scryptSync(pw, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(calc));
}
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer /, '') || req.query.token;
const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => { if (e.code) return fail(res, 400, e.code, e.message); console.error(e); fail(res, 500, 'INTERNAL', 'Unexpected error'); });

// CONTRACT-OBDX §1.1: the app opens a platform session after its OBDX login.
// The platform knows the user only as an opaque userRef plus a segment, so
// `req.customer` here is a pseudo customer with no personal data.
function customerAuth(req, res, next) {
  const p = verify(bearer(req));
  const db = store.get();
  const sess = p && p.typ === 'app' && db.sessions.find(s => s.id === p.sid && !s.endedAt);
  if (!sess) return fail(res, 401, 'UNAUTHORIZED', 'Platform session expired.');
  req.customer = { id: sess.customerId, segment: sess.segment, status: 'ACTIVE' };
  req.session = sess; next();
}
function staffAuth(...roles) {
  return (req, res, next) => {
    const p = verify(bearer(req));
    const u = p && p.typ === 'staff' && store.get().staff.find(s => s.username === p.sub && s.active);
    if (!u) return fail(res, 401, 'UNAUTHORIZED', 'Please log in.');
    if (roles.length && !roles.some(r => u.roles.includes(r))) return fail(res, 403, 'FORBIDDEN', `Requires role: ${roles.join(' or ')}`);
    req.staff = u; next();
  };
}

// ---------- live channel (SSE) ----------
const clients = new Set(); // {res, customerId, sessionId}
function broadcast(event, data, filter = () => true) {
  for (const c of clients) if (filter(c)) c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 20000).unref();

// =====================================================================
// APP API
// =====================================================================
const A = express.Router();

// CONTRACT-OBDX §1.1 - session handshake (identity option A). The customer
// has already logged in to OBDX; the app tells us its user type and segment.
A.post('/session', (req, res) => {
  if ((req.headers['x-dxp-app-key'] || '') !== APP_KEY) return fail(res, 401, 'BAD_APP_KEY', 'Unknown app.');
  const db = store.get();
  const { userType, segment, userRef, deviceId, platform, appVersion, contract, widgets } = req.body || {};
  if (contract !== CONTRACT) return fail(res, 400, 'CONTRACT_MISMATCH', `Platform speaks ${CONTRACT}.`);
  if (!IN_SCOPE_USER_TYPES.includes(userType)) return fail(res, 403, 'NOT_IN_SCOPE', 'This user type is not in the POC.');
  if (!/^u_[a-f0-9]{16,64}$/.test(String(userRef || ''))) return fail(res, 400, 'BAD_USER_REF', 'userRef must be an opaque hash.');
  const seg = db.segments.some(s => s.code === segment) ? segment : userType;
  const sess = { id: store.id('S'), customerId: userRef, segment: seg, userType, deviceId, platform, runtime: appVersion, widgets: Array.isArray(widgets) ? widgets : [], startedAt: new Date().toISOString() };
  db.sessions.push(sess);
  store.recordEvent({ type: 'SESSION_LOGIN', customerId: userRef, sessionId: sess.id, deviceId, source: 'server', platform, appVersion });
  store.save();
  res.json({ accessToken: sign({ typ: 'app', sid: sess.id }, 8 * 3600), configVersion: db.active.configVersion, segment: seg });
});

A.post('/session/end', customerAuth, (req, res) => {
  req.session.endedAt = new Date().toISOString();
  store.recordEvent({ type: 'SESSION_LOGOUT', customerId: req.customer.id, sessionId: req.session.id, source: 'server' });
  store.save();
  res.json({ ok: true });
});

A.get('/manifest', customerAuth, (req, res) => {
  const m = resolver.manifest(req.customer, req.session.platform);
  const etag = '"' + store.sha(m) + '"';
  if (req.headers['if-none-match'] === etag) return res.sendStatus(304);
  res.set('ETag', etag).json(m);
});
A.get('/screens/:id', customerAuth, (req, res) => {
  const s = resolver.resolveScreen(req.params.id, req.customer, { platform: req.session.platform });
  if (!s) return fail(res, 404, 'NOT_FOUND', 'Screen not found');
  res.json(s);
});
A.get('/journeys/:id', customerAuth, (req, res) => {
  const j = resolver.resolveJourney(req.params.id, req.customer, { platform: req.session.platform });
  if (!j) return fail(res, 404, 'NOT_FOUND', 'Journey not available');
  res.json(j);
});

const sources = {
  'customer.profile': c => adapter.customerProfile(c),
  'accounts.list': c => adapter.accountsList(c),
  'txn.history': c => adapter.txnHistory(c),
  'payees.list': c => adapter.payeesList(c),
  'cards.list': c => adapter.cardsList(c),
};
// CONTRACT-OBDX §1, §5, §6: data sources and journey tasks run in the app,
// against OBDX. `sources` above stays only for the console preview's sample data.

const CLIENT_EVENTS = ['SCREEN_VIEW', 'UI_ACTION', 'JOURNEY_STARTED', 'JOURNEY_STEP', 'JOURNEY_COMPLETED', 'JOURNEY_ABANDONED', 'CONFIG_APPLIED', 'ERROR'];
A.post('/events', customerAuth, (req, res) => {
  const evs = Array.isArray((req.body || {}).events) ? req.body.events.slice(0, 100) : [];
  let n = 0;
  for (const e of evs) {
    if (!CLIENT_EVENTS.includes(e.type)) continue;
    store.recordEvent({ type: e.type, ts: e.ts, customerId: req.customer.id, sessionId: req.session.id, deviceId: req.session.deviceId, source: 'client', platform: req.session.platform, appVersion: req.session.runtime, screen: e.screen, journey: e.journey, payload: e.payload, clientConfigVersion: e.configVersion });
    n++;
  }
  res.json({ accepted: n });
});

A.get('/live', customerAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const client = { res, customerId: req.customer.id, sessionId: req.session.id };
  clients.add(client);
  res.write(`event: hello\ndata: ${JSON.stringify({ configVersion: store.get().active.configVersion })}\n\n`);
  req.on('close', () => clients.delete(client));
});

app.use('/api/app/v1', A);

// =====================================================================
// CONSOLE API
// =====================================================================
const C = express.Router();
const KINDS = { screens: 'screen', journeys: 'journey', themes: 'theme', assignments: 'assignments' };

C.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = store.get().staff.find(s => s.username === username && s.active);
  if (!u || !checkPassword(String(password || ''), u.passwordHash)) return fail(res, 401, 'INVALID_CREDENTIALS', 'Wrong username or password');
  store.audit(u.username, 'STAFF_LOGIN', u.username);
  res.json({ token: sign({ typ: 'staff', sub: u.username }, 12 * 3600), user: { username: u.username, name: u.name, roles: u.roles } });
});

C.get('/widgets', staffAuth(), (req, res) => res.json(store.get().widgets));
C.post('/widgets', staffAuth('admin'), (req, res) => {
  const w = req.body || {};
  if (!w.type || !w.major || !w.props) return fail(res, 400, 'INVALID', 'type, major and props are required');
  const db = store.get();
  const i = db.widgets.findIndex(x => x.type === w.type);
  const rec = { category: 'Custom', events: [], status: 'active', minRuntime: '1.0.0', version: `${w.major}.0.0`, ...w };
  if (i >= 0) db.widgets[i] = rec; else db.widgets.push(rec);
  store.audit(req.staff.username, 'WIDGET_REGISTERED', `${w.type}@${w.major}`);
  res.json(rec);
});

function itemSummary(kind, item) {
  const db = store.get();
  const live = db.active.snapshot[kind] && db.active.snapshot[kind][item.id];
  const latest = item.versions[item.versions.length - 1];
  const dirty = !latest || JSON.stringify(strip(latest.json)) !== JSON.stringify(strip(item.draft.json));
  return { id: item.id, title: item.draft.json.title || item.draft.json.brandName || item.id, liveVersion: live || null, latestVersion: latest ? latest.version : null, hasDraftChanges: dirty, updatedBy: item.draft.updatedBy, updatedAt: item.draft.updatedAt };
}
const strip = (j) => { const c = { ...j }; delete c.version; return c; };

for (const [plural, kind] of Object.entries(KINDS)) {
  C.get(`/${plural}`, staffAuth(), (req, res) => res.json(Object.values(store.get().items[kind]).map(i => itemSummary(kind, i))));
  C.get(`/${plural}/:id`, staffAuth(), (req, res) => {
    const item = store.get().items[kind][req.params.id];
    if (!item) return fail(res, 404, 'NOT_FOUND', 'Not found');
    res.json({ ...itemSummary(kind, item), draft: item.draft.json, versions: item.versions.map(v => ({ version: v.version, publishedAt: v.publishedAt, releaseNo: v.releaseNo })) });
  });
  C.put(`/${plural}/:id`, staffAuth('designer', 'admin'), (req, res) => {
    const db = store.get();
    const json = req.body && req.body.json;
    if (!json || typeof json !== 'object') return fail(res, 400, 'INVALID', 'Body must be {json}');
    json.id = req.params.id;
    const errors = validateItem(kind, json);
    let item = db.items[kind][req.params.id];
    if (!item) item = db.items[kind][req.params.id] = { id: req.params.id, versions: [] };
    item.draft = { json, updatedBy: req.staff.username, updatedAt: new Date().toISOString() };
    store.audit(req.staff.username, 'DRAFT_SAVED', `${kind}:${req.params.id}`);
    res.json({ ok: true, warnings: errors, ...itemSummary(kind, item) });
  });
}

function refs(useDrafts = true) {
  const db = store.get();
  return { screens: new Set(Object.keys(db.items.screen)), journeys: new Set(Object.keys(db.items.journey)), drafts: useDrafts };
}
function validateItem(kind, json) {
  const db = store.get();
  if (kind === 'screen') return validate.checkScreen(json, db.widgets, refs());
  if (kind === 'journey') return validate.checkJourney(json, refs());
  if (kind === 'theme') return validate.checkTheme(json);
  return [];
}

C.post('/validate', staffAuth(), (req, res) => res.json({ errors: validateItem(req.body.kind, req.body.json || {}) }));

// Preview: resolve a draft (or published) screen for a chosen customer, with data
C.post('/preview', staffAuth(), wrap(async (req, res) => {
  const db = store.get();
  const c = db.customers.find(x => x.id === req.body.customerId) || db.customers[0];
  const json = req.body.json || (db.items.screen[req.body.screenId] || {}).draft?.json;
  if (!json) return fail(res, 404, 'NOT_FOUND', 'Screen not found');
  const screen = resolver.resolveScreen(json.id, c, { json });
  const data = { customer: await adapter.customerProfile(c) };
  for (const [alias, d] of Object.entries(json.data || {})) if (sources[d.source]) data[alias] = await sources[d.source](c);
  const asg = resolver.resolveAssignment(c, null);
  const themeId = req.body.themeId || asg.theme || 'default';
  const theme = (db.items.theme[themeId] || db.items.theme.default).draft.json;
  res.json({ screen, data, theme, customer: { id: c.id, name: c.name, segment: c.segment } });
}));

// ---------- releases (maker-checker) ----------
function pendingChanges() {
  const db = store.get(); const changes = [];
  for (const kind of Object.keys(db.items)) for (const item of Object.values(db.items[kind])) {
    const s = itemSummary(kind, item);
    if (s.hasDraftChanges) changes.push({ kind, id: item.id, json: JSON.parse(JSON.stringify(item.draft.json)), by: item.draft.updatedBy });
  }
  return changes;
}
C.get('/changes', staffAuth(), (req, res) => res.json(pendingChanges().map(({ kind, id, by }) => ({ kind, id, by }))));
C.get('/releases', staffAuth(), (req, res) => res.json([...store.get().releases].reverse().map(r => ({ ...r, changes: r.changes.map(({ kind, id, by }) => ({ kind, id, by })) }))));

C.post('/releases', staffAuth('maker', 'admin'), (req, res) => {
  const db = store.get();
  if (db.releases.some(r => r.status === 'PENDING')) return fail(res, 409, 'PENDING_EXISTS', 'Another release is awaiting approval.');
  const changes = pendingChanges();
  if (!changes.length) return fail(res, 400, 'NO_CHANGES', 'There are no draft changes to release.');
  const errors = changes.flatMap(ch => validateItem(ch.kind, ch.json).map(e => `${ch.kind}:${ch.id} - ${e}`));
  if (errors.length) return res.status(422).json({ error: { code: 'VALIDATION_FAILED', message: 'Fix the errors before submitting', details: errors } });
  const rel = { no: db.releases.length + 1, status: 'PENDING', note: (req.body || {}).note || '', audience: (req.body || {}).audience || 'ALL', changes, submittedBy: req.staff.username, submittedAt: new Date().toISOString() };
  db.releases.push(rel);
  store.audit(req.staff.username, 'RELEASE_SUBMITTED', `release:${rel.no}`, { items: changes.map(c => `${c.kind}:${c.id}`) });
  res.json({ no: rel.no, status: rel.status });
});

function activate(rel, snapshot, actor) {
  const db = store.get();
  db.active = { releaseNo: rel.no, configVersion: db.active.configVersion + 1, snapshot };
  Object.assign(rel, { status: 'PUBLISHED', snapshot, configVersion: db.active.configVersion, approvedBy: actor, publishedAt: new Date().toISOString() });
  store.save();
  broadcast('config.published', { configVersion: db.active.configVersion, releaseNo: rel.no });
}

C.post('/releases/:no/approve', staffAuth('approver', 'admin'), (req, res) => {
  const db = store.get();
  const rel = db.releases.find(r => r.no === Number(req.params.no));
  if (!rel || rel.status !== 'PENDING') return fail(res, 400, 'INVALID_STATE', 'Release is not pending');
  if (rel.submittedBy === req.staff.username) return fail(res, 403, 'SELF_APPROVAL', 'Maker and checker must be different people.');
  const snapshot = JSON.parse(JSON.stringify(db.active.snapshot));
  for (const ch of rel.changes) {
    const item = db.items[ch.kind][ch.id] || (db.items[ch.kind][ch.id] = { id: ch.id, versions: [], draft: { json: ch.json, updatedBy: ch.by, updatedAt: new Date().toISOString() } });
    const version = (item.versions.length ? item.versions[item.versions.length - 1].version : 0) + 1;
    const json = { ...ch.json, version };
    item.versions.push({ version, json, publishedAt: new Date().toISOString(), releaseNo: rel.no });
    (snapshot[ch.kind] = snapshot[ch.kind] || {})[ch.id] = version;
  }
  activate(rel, snapshot, req.staff.username);
  store.audit(req.staff.username, 'RELEASE_PUBLISHED', `release:${rel.no}`, { configVersion: db.active.configVersion });
  res.json({ no: rel.no, status: rel.status, configVersion: db.active.configVersion, notifiedDevices: clients.size });
});
C.post('/releases/:no/reject', staffAuth('approver', 'admin'), (req, res) => {
  const rel = store.get().releases.find(r => r.no === Number(req.params.no));
  if (!rel || rel.status !== 'PENDING') return fail(res, 400, 'INVALID_STATE', 'Release is not pending');
  Object.assign(rel, { status: 'REJECTED', rejectedBy: req.staff.username, reason: (req.body || {}).reason || '' });
  store.audit(req.staff.username, 'RELEASE_REJECTED', `release:${rel.no}`);
  res.json({ no: rel.no, status: rel.status });
});
// Rollback = publish an earlier release's snapshot as a new release (new configVersion). Dual control.
C.post('/releases/:no/rollback', staffAuth('approver', 'admin'), (req, res) => {
  const db = store.get();
  const target = db.releases.find(r => r.no === Number(req.params.no) && r.snapshot);
  if (!target) return fail(res, 400, 'INVALID', 'Release has no snapshot to roll back to');
  const rel = { no: db.releases.length + 1, status: 'PENDING', note: `Rollback to release ${target.no}`, changes: [], rollbackOf: target.no, submittedBy: req.staff.username, submittedAt: new Date().toISOString() };
  db.releases.push(rel);
  activate(rel, JSON.parse(JSON.stringify(target.snapshot)), req.staff.username);
  // Reset drafts to what is now live so the next release starts clean
  for (const kind of Object.keys(target.snapshot)) for (const [id, ver] of Object.entries(target.snapshot[kind])) { const it = db.items[kind][id]; const v = it && it.versions.find(x => x.version === ver); if (v) it.draft = { json: JSON.parse(JSON.stringify(v.json)), updatedBy: req.staff.username, updatedAt: new Date().toISOString() }; }
  store.audit(req.staff.username, 'RELEASE_ROLLBACK', `release:${rel.no}`, { to: target.no });
  res.json({ no: rel.no, status: rel.status, configVersion: db.active.configVersion });
});

// ---------- segments, entitlements, staff ----------
C.get('/segments', staffAuth(), (req, res) => res.json(store.get().segments));
C.get('/features', staffAuth(), (req, res) => res.json(store.get().features));
C.get('/entitlements', staffAuth(), (req, res) => res.json(store.get().entitlements));
C.put('/entitlements/:id', staffAuth('admin', 'maker'), (req, res) => {
  const db = store.get();
  const e = req.body || {};
  let rec = db.entitlements.find(x => x.id === req.params.id);
  const before = rec ? { ...rec } : null;
  if (!rec) { rec = { id: req.params.id }; db.entitlements.push(rec); }
  for (const k of ['subjectType', 'subjectId', 'feature', 'enabled', 'perTxnLimit', 'dailyLimit', 'currency']) if (e[k] !== undefined) rec[k] = e[k];
  store.audit(req.staff.username, 'ENTITLEMENT_CHANGED', `entitlement:${rec.id}`, { before, after: rec });
  // Entitlements change what the manifest contains -> tell apps to reload (no new config release needed)
  broadcast('config.published', { configVersion: db.active.configVersion, reason: 'entitlements' });
  res.json(rec);
});
C.get('/staff', staffAuth('admin'), (req, res) => res.json(store.get().staff.map(({ passwordHash, ...s }) => s)));

// ---------- customers & 360 ----------
const custSummary = (c) => ({ id: c.id, cif: c.cif, name: c.name, username: c.username, segment: c.segment, status: c.status, lastLogin: c.lastLogin || null, devices: c.devices.length });
C.get('/customers', staffAuth(), (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  res.json(store.get().customers.filter(c => !q || [c.id, c.cif, c.name, c.username, c.mobile].join(' ').toLowerCase().includes(q)).map(custSummary));
});
C.get('/customers/:id/360', staffAuth(), wrap(async (req, res) => {
  const db = store.get();
  const c = db.customers.find(x => x.id === req.params.id);
  if (!c) return fail(res, 404, 'NOT_FOUND', 'Customer not found');
  const events = db.events.filter(e => e.customerId === c.id).slice(-300).reverse();
  const txns = db.transactions.filter(t => t.customerId === c.id).slice().reverse();
  const funnel = {};
  for (const e of events) {
    if (!e.journey || !e.journey.id || !/^JOURNEY_/.test(e.type) || e.source === 'client' && e.type === 'JOURNEY_STARTED') continue;
    const f = funnel[e.journey.id] = funnel[e.journey.id] || { started: 0, completed: 0, abandoned: 0 };
    if (e.type === 'JOURNEY_STARTED') f.started++; if (e.type === 'JOURNEY_COMPLETED') f.completed++; if (e.type === 'JOURNEY_ABANDONED') f.abandoned++;
  }
  res.json({
    profile: { ...custSummary(c), email: c.email, mobile: c.mobile, rm: c.rm, kycStatus: c.kycStatus, riskRating: c.riskRating, failedLogins: c.failedLogins },
    devices: c.devices,
    entitlements: resolver.resolveEntitlements(c),
    sessions: db.sessions.filter(s => s.customerId === c.id).slice(-10).reverse(),
    products: { accounts: await adapter.accountsList(c), cards: await adapter.cardsList(c), asOf: new Date().toISOString() },
    transactions: txns, events, funnel,
  });
}));
for (const [act, status] of [['lock', 'LOCKED'], ['unlock', 'ACTIVE']]) {
  C.post(`/customers/:id/${act}`, staffAuth('csr', 'admin'), (req, res) => {
    const db = store.get();
    const c = db.customers.find(x => x.id === req.params.id);
    if (!c) return fail(res, 404, 'NOT_FOUND', 'Customer not found');
    if (!(req.body || {}).reason) return fail(res, 400, 'REASON_REQUIRED', 'A reason is required');
    c.status = status; if (status === 'ACTIVE') c.failedLogins = 0;
    if (status === 'LOCKED') { db.sessions.filter(s => s.customerId === c.id && !s.endedAt).forEach(s => { s.endedAt = new Date().toISOString(); }); broadcast('session.revoked', {}, cl => cl.customerId === c.id); }
    store.audit(req.staff.username, `CUSTOMER_${status}`, c.id, { reason: req.body.reason });
    store.save();
    res.json(custSummary(c));
  });
}

// ---------- operations ----------
C.get('/metrics/overview', staffAuth(), (req, res) => {
  const db = store.get();
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const recent = db.events.filter(e => e.ts >= dayAgo);
  const count = (t) => recent.filter(e => e.type === t).length;
  const byType = {};
  for (const t of db.transactions) { const b = byType[t.type] = byType[t.type] || { total: 0, succeeded: 0, failed: 0, amount: 0 }; b.total++; if (t.status === 'SUCCEEDED') { b.succeeded++; b.amount += t.amount; } if (t.status === 'FAILED') b.failed++; }
  const adoption = {};
  for (const e of db.events.filter(e => e.type === 'CONFIG_APPLIED')) adoption[e.payload && e.payload.configVersion] = (adoption[e.payload && e.payload.configVersion] || new Set()).add(e.customerId);
  res.json({
    activeConfig: db.active, connectedDevices: clients.size,
    activeSessions: db.sessions.filter(s => !s.endedAt).length,
    last24h: { logins: count('SESSION_LOGIN'), failedLogins: count('LOGIN_FAILED'), screenViews: count('SCREEN_VIEW'), journeysStarted: recent.filter(e => e.type === 'JOURNEY_STARTED' && e.source === 'server').length, journeysCompleted: count('JOURNEY_COMPLETED'), journeysAbandoned: count('JOURNEY_ABANDONED'), errors: count('ERROR') },
    transactions: byType,
    configAdoption: Object.fromEntries(Object.entries(adoption).map(([k, v]) => [k, v.size])),
    recentEvents: db.events.slice(-25).reverse(),
  });
});
C.get('/audit', staffAuth(), (req, res) => res.json(store.get().audit.slice(-300).reverse()));

app.use('/api/console/v1', C);

// ---------- static: console, simulator, shared renderer ----------
app.use('/console', express.static(path.join(__dirname, '..', 'public', 'console')));
app.use('/simulator', express.static(path.join(__dirname, '..', 'public', 'simulator')));
// Flutter web build of the customer app (web presentation layer). Built with --base-href /app/ by scripts/build_flutter_web.sh
const APP_DIR = path.join(__dirname, '..', 'public', 'app');
app.use('/app', express.static(APP_DIR, { setHeaders: (res, file) => { if (file.endsWith('index.html') || file.endsWith('flutter_service_worker.js') || file.endsWith('version.json')) res.set('Cache-Control', 'no-cache'); } }));
app.get('/flutter-status', (req, res) => res.json({ flutterWeb: require('fs').existsSync(path.join(APP_DIR, 'index.html')) }));
app.use('/shared', express.static(path.join(__dirname, '..', 'public', 'shared')));
app.get('/', (req, res) => res.redirect('/console/'));
app.get('/health', (req, res) => res.json({ ok: true, configVersion: store.get().active.configVersion }));
// Kubernetes probes: liveness = process is up; readiness = store loaded and not shutting down
let shuttingDown = false;
app.get('/health/live', (req, res) => res.json({ ok: true }));
app.get('/health/ready', (req, res) => (shuttingDown || !store.get()) ? res.status(503).json({ ok: false }) : res.json({ ok: true }));

if (require.main === module) {
  const server = app.listen(PORT, () => console.log(`DXP backend on http://localhost:${PORT}  console: /console/  simulator: /simulator/`));
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use - most likely the DXP backend is already running in another terminal.\n  Check:  lsof -nP -iTCP:${PORT} -sTCP:LISTEN\n  Either use the running one, stop it (Ctrl+C in its terminal, or kill <PID>), or start on another port:  PORT=8091 npm start`);
    else console.error(e);
    process.exit(1);
  });
  // Graceful shutdown for rolling updates: fail readiness, let the LB drain, close SSE so clients reconnect elsewhere
  process.on('SIGTERM', () => {
    shuttingDown = true;
    setTimeout(() => { for (const c of clients) c.res.end(); store.saveNow(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); }, Number(process.env.DXP_DRAIN_MS || 5000));
  });
}
module.exports = app;
