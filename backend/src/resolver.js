// Resolves published configuration for one customer: segment fallback chain,
// entitlements, visibility filtering, manifest with content hashes.
const store = require('./store');

function segmentChain(code) {
  const db = store.get();
  const chain = [];
  let cur = db.segments.find(s => s.code === code);
  while (cur && !chain.includes(cur.code)) { chain.push(cur.code); cur = db.segments.find(s => s.code === cur.fallback); }
  if (!chain.includes('DEFAULT')) chain.push('DEFAULT');
  return chain;
}

// Resolution order: customer override -> segment chain (most specific first) -> none
function resolveEntitlements(customer) {
  const db = store.get();
  const chain = segmentChain(customer.segment);
  const out = {};
  for (const f of db.features) {
    const cust = db.entitlements.find(e => e.subjectType === 'customer' && e.subjectId === customer.id && e.feature === f.code);
    let e = cust;
    if (!e) for (const seg of chain) { e = db.entitlements.find(x => x.subjectType === 'segment' && x.subjectId === seg && x.feature === f.code); if (e) break; }
    if (e && e.enabled) out[f.code] = { ...e };
  }
  return out;
}

function publishedJson(kind, id, snapshot) {
  const db = store.get();
  const snap = snapshot || db.active.snapshot;
  const ver = snap[kind] && snap[kind][id];
  if (!ver) return null;
  const item = db.items[kind][id];
  const v = item && item.versions.find(x => x.version === ver);
  return v ? JSON.parse(JSON.stringify(v.json)) : null;
}

function isVisible(rule, ctx) {
  if (!rule) return true;
  if (rule.entitlement && !ctx.entitlements[rule.entitlement]) return false;
  if (rule.segment && !rule.segment.includes(ctx.segment)) return false;
  if (rule.platform && ctx.platform && !rule.platform.includes(ctx.platform)) return false;
  return true;
}

// Removes nodes (and items inside props arrays) the customer may not see.
function filterNode(node, ctx) {
  if (!node || !isVisible(node.visibleIf, ctx)) return null;
  const out = { ...node };
  delete out.visibleIf;
  if (out.props) {
    out.props = { ...out.props };
    for (const [k, v] of Object.entries(out.props)) {
      if (Array.isArray(v)) out.props[k] = v.filter(x => !(x && typeof x === 'object') || isVisible(x.visibleIf, ctx)).map(x => { if (x && typeof x === 'object' && x.visibleIf) { const c = { ...x }; delete c.visibleIf; return c; } return x; });
    }
  }
  if (Array.isArray(out.children)) out.children = out.children.map(c => filterNode(c, ctx)).filter(Boolean);
  return out;
}

function ctxFor(customer, platform) {
  return { segment: customer.segment, entitlements: resolveEntitlements(customer), platform };
}

function resolveScreen(id, customer, opts = {}) {
  const json = opts.json || publishedJson('screen', id, opts.snapshot);
  if (!json) return null;
  const ctx = ctxFor(customer, opts.platform);
  return { ...json, root: filterNode(json.root, ctx) };
}

function resolveJourney(id, customer, opts = {}) {
  const json = opts.json || publishedJson('journey', id, opts.snapshot);
  if (!json) return null;
  const ctx = ctxFor(customer, opts.platform);
  if (json.entitlement && !ctx.entitlements[json.entitlement]) return null;
  return json;
}

function resolveAssignment(customer, snapshot) {
  const a = publishedJson('assignments', 'default', snapshot) || { segments: {} };
  const chain = segmentChain(customer.segment).reverse(); // DEFAULT first, most specific last
  const merged = {};
  for (const seg of chain) Object.assign(merged, a.segments[seg] || {});
  return merged;
}

function manifest(customer, platform) {
  const db = store.get();
  const snap = db.active.snapshot;
  const asg = resolveAssignment(customer, snap);
  const themeJson = publishedJson('theme', asg.theme || 'default', snap) || publishedJson('theme', 'default', snap);
  const ctx = ctxFor(customer, platform);
  const screens = {}; const journeys = {};
  for (const sid of Object.keys(snap.screen || {})) { const s = resolveScreen(sid, customer, { platform }); if (s) screens[sid] = store.sha(s); }
  for (const jid of Object.keys(snap.journey || {})) { const j = resolveJourney(jid, customer, { platform }); if (j) journeys[jid] = store.sha(j); }
  const menu = (asg.menu || []).filter(m => isVisible(m.visibleIf, ctx));
  return {
    configVersion: db.active.configVersion,
    releaseNo: db.active.releaseNo,
    segment: customer.segment,
    theme: themeJson,
    home: asg.home || 'home',
    menu,
    screens, journeys,
    entitlements: Object.keys(ctx.entitlements),
  };
}

module.exports = { manifest, resolveScreen, resolveJourney, resolveEntitlements, segmentChain, publishedJson, filterNode, resolveAssignment };
