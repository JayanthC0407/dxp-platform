/* DXP back-office console (reference implementation). Vanilla JS, talks to /api/console/v1. */
const API = '/api/console/v1';
const { h } = DXP;
DXP.injectCss();
const S = { token: sessionStorage.getItem('dxp.staff'), user: JSON.parse(sessionStorage.getItem('dxp.user') || 'null'), view: 'dashboard', widgets: [] };
const root = document.getElementById('root');
const ICON_NAMES = ['home', 'send', 'swap', 'card', 'receipt', 'wallet', 'user', 'logout', 'bolt', 'gift', 'info', 'lock', 'chart', 'phone', 'star'];

async function api(path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { 'content-type': 'application/json', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { logout(); throw new Error('Please log in'); }
  if (!r.ok) { const e = new Error((j.error && j.error.message) || 'Request failed'); e.details = j.error && j.error.details; throw e; }
  return j;
}
function toast(m) { let t = document.querySelector('.toast'); if (!t) { t = h('div', { class: 'toast' }); document.body.append(t); } t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200); }
const has = (...roles) => S.user && roles.some(r => S.user.roles.includes(r));
const fmt = (ts) => ts ? new Date(ts).toLocaleString() : '';
const tag = (txt, kind = '') => h('span', { class: 'tag ' + kind }, txt);
const statusTag = (s) => tag(s, { PUBLISHED: 'ok', SUCCEEDED: 'ok', ACTIVE: 'ok', PENDING: 'warn', SUBMITTED: 'warn', REJECTED: 'bad', FAILED: 'bad', LOCKED: 'bad' }[s] || 'grey');

// ---------------- auth ----------------
function loginView(err) {
  const u = h('input', { value: 'maker' }), p = h('input', { type: 'password', value: 'maker123' });
  const go = async () => {
    try { const r = await api('/auth/login', { method: 'POST', body: { username: u.value, password: p.value } }); S.token = r.token; S.user = r.user; sessionStorage.setItem('dxp.staff', r.token); sessionStorage.setItem('dxp.user', JSON.stringify(r.user)); boot(); }
    catch (e) { loginView(e.message); }
  };
  p.addEventListener('keydown', e => e.key === 'Enter' && go());
  root.replaceChildren(h('div', { class: 'login card' }, h('h1', {}, 'DXP Console'), h('p', { class: 'sub' }, 'Digital banking experience platform'),
    h('label', { class: 'f' }, 'Username', u), h('label', { class: 'f' }, 'Password', p), err ? h('div', { class: 'err' }, err) : null,
    h('button', { class: 'btn pri', onclick: go }, 'Sign in'),
    h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '14px' } }, 'Demo: maker / maker123 (designer, maker) · checker / checker123 (approver) · admin / admin123')));
}
function logout() { S.token = null; S.user = null; sessionStorage.clear(); loginView(); }

// ---------------- shell ----------------
const NAV = [
  ['Operate', [['dashboard', 'Dashboard'], ['customers', 'Customers & 360']]],
  ['Experience Studio', [['screens', 'Screens'], ['journeys', 'Journeys'], ['themes', 'Branding & themes'], ['segments', 'Segments & menus'], ['widgets', 'Widget registry']]],
  ['Govern', [['releases', 'Releases'], ['entitlements', 'Entitlements'], ['access', 'Staff & audit']]],
];
async function boot() {
  if (!S.token) return loginView();
  try { S.widgets = await api('/widgets'); } catch { return; }
  try { S.flutter = (await (await fetch('/flutter-status')).json()).flutterWeb; } catch { S.flutter = false; }
  go(S.view);
}
function shell(content) {
  root.replaceChildren(h('div', { class: 'app' },
    h('nav', { class: 'side' }, h('div', { class: 'brand' }, 'DXP Console', h('small', {}, 'Bank One · reference build')),
      NAV.map(([g, items]) => [h('div', { class: 'grp' }, g), items.map(([k, l]) => h('button', { class: S.view === k ? 'on' : '', onclick: () => go(k) }, l))]),
      h('div', { class: 'me' }, `${S.user.name}`, h('br'), S.user.roles.join(', '), h('br'), h('a', { href: '#', onclick: (e) => { e.preventDefault(); logout(); } }, 'Sign out'), ' · ', h('a', { href: S.flutter ? '/app/' : '/simulator/', target: '_blank' }, S.flutter ? 'Web app (Flutter)' : 'Device simulator'))),
    h('main', { class: 'main' }, content)));
}
async function go(view, arg) {
  S.view = view;
  shell(h('div', { class: 'muted' }, 'Loading…'));
  try { shell(await VIEWS[view](arg)); } catch (e) { shell(h('div', { class: 'err' }, e.message)); }
}

// ---------------- dashboard ----------------
async function dashboard() {
  const m = await api('/metrics/overview');
  const k = (l, v) => h('div', { class: 'card kpi' }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
  const tx = Object.entries(m.transactions);
  const el = h('div', {}, h('h1', {}, 'Operations dashboard'), h('p', { class: 'sub' }, `Live configuration v${m.activeConfig.configVersion} (release ${m.activeConfig.releaseNo}) · ${m.connectedDevices} device(s) connected to the live channel`),
    h('div', { class: 'grid g4' }, k('Logins (24h)', m.last24h.logins), k('Active sessions', m.activeSessions), k('Journeys completed / started', `${m.last24h.journeysCompleted} / ${m.last24h.journeysStarted}`), k('Client errors (24h)', m.last24h.errors)),
    h('div', { class: 'grid g2', style: { marginTop: '12px' } },
      h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Transactions'), tx.length ? h('table', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Total'), h('th', {}, 'Succeeded'), h('th', {}, 'Failed'), h('th', {}, 'Value')), tx.map(([t, b]) => h('tr', {}, h('td', {}, t), h('td', {}, b.total), h('td', {}, b.succeeded), h('td', {}, b.failed), h('td', {}, DXP.money(b.amount))))) : h('p', { class: 'muted' }, 'No transactions yet.'),
        h('h2', {}, 'Config adoption (customers per version)'), Object.keys(m.configAdoption).length ? h('div', { class: 'row' }, Object.entries(m.configAdoption).map(([v, n]) => tag(`v${v}: ${n}`))) : h('p', { class: 'muted' }, 'No devices have reported yet.')),
      h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Latest events'), h('div', { class: 'timeline' }, m.recentEvents.map(e => h('div', {}, h('span', { class: 't' }, fmt(e.ts)), h('b', {}, e.type), ' ', h('span', { class: 'muted' }, [e.customerId, e.screen, e.journey && e.journey.id].filter(Boolean).join(' · ')))))))
  );
  return el;
}

// ---------------- Flutter preview (the real runtime, as an iframe) ----------------
// The Studio posts {screen, data, theme, selected, design} into the Flutter web build (?mode=preview);
// the preview posts back select / action / error messages. Same origin only.
function flutterPreview({ onSelect, onAction } = {}) {
  const frame = h('iframe', { class: 'pframe', src: '/app/?mode=preview', title: 'Flutter preview' });
  let ready = false, last = null;
  const send = (doc) => { last = doc; if (ready && frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify({ type: 'dxp.preview', ...doc }), location.origin); };
  if (S.previewListener) window.removeEventListener('message', S.previewListener);
  S.previewListener = (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'dxp.preview.ready') { ready = true; if (last) send(last); }
    if (m.type === 'dxp.preview.select' && onSelect) onSelect(m.path);
    if (m.type === 'dxp.preview.action') (onAction || ((a) => toast(`Action: ${a.type} ${a.screen || a.journey || ''}`)))(m.action);
    if (m.type === 'dxp.preview.error') toast(`Preview: ${m.message}`);
  };
  window.addEventListener('message', S.previewListener);
  return { frame, send };
}

// ---------------- screens (visual builder) ----------------
const nodeAt = (rootNode, path) => path.split('.').slice(1).reduce((n, i) => n && n.children && n.children[Number(i)], rootNode);
const parentPath = (p) => p.split('.').slice(0, -1).join('.');
async function screensList() {
  const list = await api('/screens');
  const nid = h('input', { placeholder: 'new_screen_id' });
  return h('div', {}, h('h1', {}, 'Screens'), h('p', { class: 'sub' }, 'Compose screens from registered widgets. Changes are drafts until a release is approved.'),
    h('table', {}, h('tr', {}, h('th', {}, 'Screen'), h('th', {}, 'Live version'), h('th', {}, 'Draft'), h('th', {}, 'Last edit'), h('th', {})),
      list.map(s => h('tr', {}, h('td', {}, h('b', {}, s.id), ' ', h('span', { class: 'muted' }, s.title)), h('td', {}, s.liveVersion ? 'v' + s.liveVersion : tag('new', 'warn')), h('td', {}, s.hasDraftChanges ? tag('unreleased changes', 'warn') : tag('in sync', 'ok')), h('td', { class: 'muted' }, `${s.updatedBy} · ${fmt(s.updatedAt)}`), h('td', {}, h('button', { class: 'btn sm', onclick: () => go('screen', s.id) }, 'Open builder'))))),
    has('designer', 'admin') ? h('div', { class: 'row', style: { marginTop: '12px', maxWidth: '420px' } }, nid, h('button', { class: 'btn', onclick: async () => {
      const id = nid.value.trim().replace(/[^a-z0-9_]/gi, '_').toLowerCase(); if (!id) return;
      await api('/screens/' + id, { method: 'PUT', body: { json: { id, title: id, data: {}, root: { type: 'Column', props: { padding: 16, gap: 12, scroll: true }, children: [{ type: 'Text', props: { text: 'New screen', style: 'headline' } }] } } } });
      go('screen', id);
    } }, 'New screen')) : null);
}

async function screenBuilder(id) {
  const [item, customers, screensL, journeysL] = await Promise.all([api('/screens/' + id), api('/customers'), api('/screens'), api('/journeys')]);
  const B = { json: item.draft, sel: 'root', customer: customers[0] && customers[0].id, asCustomer: false, warnings: [], dirty: false, preview: null };
  const byType = Object.fromEntries(S.widgets.map(w => [w.type, w]));
  const el = h('div', {});
  const stage = h('div', { class: 'stage' }), insp = h('div', { class: 'insp card' }), header = h('div', {});

  async function refreshPreview() {
    try { B.preview = await api('/preview', { method: 'POST', body: { json: B.json, customerId: B.customer } }); } catch (e) { B.preview = null; toast(e.message); }
    drawStage();
  }
  let pt; const schedulePreview = () => { clearTimeout(pt); pt = setTimeout(refreshPreview, 350); };
  function changed() { B.dirty = true; drawHeader(); drawStage(); drawInspector(); schedulePreview(); }

  function drawHeader() {
    header.replaceChildren(h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => go('screens') }, '‹ Screens'), h('h1', { style: { margin: 0 } }, `Screen: ${id}`), item.liveVersion ? tag('live v' + item.liveVersion, 'ok') : tag('not live', 'warn'), B.dirty ? tag('unsaved', 'warn') : null, h('span', { class: 'sp' }),
      h('label', { class: 'row muted' }, 'Preview as', h('select', { style: { width: '200px' }, onchange: (e) => { B.customer = e.target.value; refreshPreview(); } }, customers.map(c => h('option', { value: c.id, selected: c.id === B.customer }, `${c.name} (${c.segment})`)))),
      h('label', { class: 'row muted' }, h('input', { type: 'checkbox', style: { width: 'auto' }, checked: B.asCustomer, onchange: (e) => { B.asCustomer = e.target.checked; drawStage(); } }), 'As customer sees it'),
      has('designer', 'admin') ? h('button', { class: 'btn pri', onclick: save }, 'Save draft') : null),
    ...(B.warnings.length ? [h('div', { class: 'err' }, h('b', {}, 'Validation: '), B.warnings.join(' · '))] : []));
  }
  async function save() {
    try { const r = await api('/screens/' + id, { method: 'PUT', body: { json: B.json } }); B.warnings = r.warnings || []; B.dirty = false; drawHeader(); toast(B.warnings.length ? 'Saved with warnings' : 'Draft saved. Submit a release to publish.'); }
    catch (e) { toast(e.message); }
  }
  const fp = S.flutter ? flutterPreview({ onSelect: (p) => { B.sel = p; drawInspector(); drawStage(); } }) : null;
  function drawStage() {
    if (fp) {
      if (!stage.contains(fp.frame)) stage.replaceChildren(h('div', { class: 'phone' }, h('div', { class: 'scr' }, fp.frame)), h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Live preview runs the real Flutter runtime. Click an element to select it; switch on "As customer sees it" for the resolved screen.'));
      if (B.preview) fp.send({ screen: B.asCustomer ? B.preview.screen : B.json, data: B.preview.data, theme: B.preview.theme, selected: B.sel, design: !B.asCustomer });
      return;
    }
    const scr = h('div', { class: 'scr dx-root' });
    if (B.preview) {
      DXP.applyTheme(scr, B.preview.theme);
      const ctx = { ...B.preview.data, state: {}, theme: B.preview.theme };
      const env = { state: {}, setState() {}, rerender() {}, act: (a) => toast(`Action: ${a.type} ${a.screen || a.journey || ''}`), design: !B.asCustomer, selected: B.sel, onSelect: (p) => { B.sel = p; drawStage(); drawInspector(); } };
      const node = B.asCustomer ? B.preview.screen.root : B.json.root;
      scr.append(h('div', { style: { padding: '14px 16px 6px', fontWeight: 600 } }, B.json.title || ''), DXP.renderNode(node, ctx, env));
    } else scr.append(h('div', { style: { padding: '40px', color: '#888' } }, 'Loading preview…'));
    stage.replaceChildren(h('div', { class: 'phone' }, scr), h('p', { class: 'muted', style: { fontSize: '12px' } }, B.asCustomer ? 'Resolved for this customer: segment and entitlement rules applied.' : 'Design mode: click any element to select it. Elements with visibility rules are still shown.'));
  }
  function addWidget(type) {
    const w = byType[type];
    const node = { type, props: {} };
    for (const [k, spec] of Object.entries(w.props)) if (spec.default !== undefined) node.props[k] = JSON.parse(JSON.stringify(spec.default));
    if (w.container) node.children = [];
    const selNode = nodeAt(B.json.root, B.sel);
    if (selNode && byType[selNode.type] && byType[selNode.type].container) { (selNode.children = selNode.children || []).push(node); B.sel = `${B.sel}.${selNode.children.length - 1}`; }
    else { const pp = parentPath(B.sel); const parent = nodeAt(B.json.root, pp); const idx = Number(B.sel.split('.').pop()); parent.children.splice(idx + 1, 0, node); B.sel = `${pp}.${idx + 1}`; }
    changed();
  }
  function move(delta) {
    if (B.sel === 'root') return; const pp = parentPath(B.sel); const parent = nodeAt(B.json.root, pp); const i = Number(B.sel.split('.').pop()); const j = i + delta;
    if (j < 0 || j >= parent.children.length) return; [parent.children[i], parent.children[j]] = [parent.children[j], parent.children[i]]; B.sel = `${pp}.${j}`; changed();
  }
  function remove() { if (B.sel === 'root') return; const pp = parentPath(B.sel); nodeAt(B.json.root, pp).children.splice(Number(B.sel.split('.').pop()), 1); B.sel = pp; changed(); }
  function dup() { if (B.sel === 'root') return; const pp = parentPath(B.sel); const parent = nodeAt(B.json.root, pp); const i = Number(B.sel.split('.').pop()); parent.children.splice(i + 1, 0, JSON.parse(JSON.stringify(parent.children[i]))); B.sel = `${pp}.${i + 1}`; changed(); }

  function jsonField(label, value, onOk, rows = 4) {
    const ta = h('textarea', { rows }, value === undefined ? '' : JSON.stringify(value, null, 1));
    ta.addEventListener('blur', () => { const t = ta.value.trim(); if (!t) return onOk(undefined); try { onOk(JSON.parse(t)); ta.style.borderColor = ''; } catch { ta.style.borderColor = '#f04438'; toast('Invalid JSON in ' + label); } });
    return h('label', { class: 'f' }, label, ta);
  }
  function drawInspector() {
    const node = nodeAt(B.json.root, B.sel);
    const w = node && byType[node.type];
    const tree = h('div', { class: 'tree' });
    const walk = (n, p, d) => { tree.append(h('div', { class: p === B.sel ? 'on' : '', style: { paddingLeft: 6 + d * 12 + 'px' }, onclick: () => { B.sel = p; drawStage(); drawInspector(); } }, n.type, n.visibleIf ? ' ◐' : '', n.props && n.props.text ? h('span', { class: 'muted' }, '  ' + String(n.props.text).slice(0, 22)) : n.props && n.props.label ? h('span', { class: 'muted' }, '  ' + n.props.label) : null)); (n.children || []).forEach((c, i) => walk(c, `${p}.${i}`, d + 1)); };
    walk(B.json.root, 'root', 0);
    const fields = [];
    if (node && w) {
      for (const [k, spec] of Object.entries(w.props)) {
        const set = (v) => { if (v === '' || v === undefined) delete node.props[k]; else node.props[k] = v; changed(); };
        const cur = (node.props || {})[k];
        node.props = node.props || {};
        if (spec.type === 'binding') { fields.push(h('label', { class: 'f' }, `${k} (data binding)`, h('input', { value: (node.bind || {})[k] || '', placeholder: 'e.g. accounts', onchange: (e) => { node.bind = node.bind || {}; if (e.target.value) node.bind[k] = e.target.value; else delete node.bind[k]; changed(); } }))); continue; }
        if (spec.type === 'enum') fields.push(h('label', { class: 'f' }, k, h('select', { onchange: (e) => set(e.target.value) }, h('option', { value: '' }, '(default)'), spec.values.map(v => h('option', { value: v, selected: cur === v }, v)))));
        else if (spec.type === 'icon') fields.push(h('label', { class: 'f' }, k, h('select', { onchange: (e) => set(e.target.value) }, h('option', { value: '' }, '(none)'), ICON_NAMES.map(v => h('option', { value: v, selected: cur === v }, `${DXP.icon(v)}  ${v}`)))));
        else if (spec.type === 'number') fields.push(h('label', { class: 'f' }, k, h('input', { type: 'number', value: cur ?? '', onchange: (e) => set(e.target.value === '' ? '' : Number(e.target.value)) })));
        else if (spec.type === 'boolean') fields.push(h('label', { class: 'f row' }, h('input', { type: 'checkbox', style: { width: 'auto' }, checked: !!cur, onchange: (e) => set(e.target.checked) }), k));
        else if (spec.type === 'json') fields.push(jsonField(k, cur, set, 8));
        else fields.push(h('label', { class: 'f' }, k, h('input', { value: cur ?? '', oninput: (e) => { node.props[k] = e.target.value; B.dirty = true; drawHeader(); drawStage(); schedulePreview(); } })));
      }
      if (w.events.includes('tap')) fields.push(jsonField('On tap → action', (node.on || {}).tap, (v) => { node.on = node.on || {}; if (v) node.on.tap = v; else delete node.on.tap; changed(); }, 3),
        h('div', { class: 'row', style: { flexWrap: 'wrap', marginTop: '-4px', marginBottom: '8px' } }, h('span', { class: 'muted', style: { fontSize: '11px' } }, 'Quick:'),
          h('select', { class: 'sm', style: { width: '48%' }, onchange: (e) => { if (!e.target.value) return; node.on = { ...(node.on || {}), tap: { type: 'navigate', screen: e.target.value } }; changed(); } }, h('option', { value: '' }, 'navigate to…'), screensL.map(s => h('option', { value: s.id }, s.id))),
          h('select', { class: 'sm', style: { width: '48%' }, onchange: (e) => { if (!e.target.value) return; node.on = { ...(node.on || {}), tap: { type: 'startJourney', journey: e.target.value } }; changed(); } }, h('option', { value: '' }, 'start journey…'), journeysL.map(s => h('option', { value: s.id }, s.id)))));
      fields.push(jsonField('Visible if (entitlement / segment)', node.visibleIf, (v) => { if (v) node.visibleIf = v; else delete node.visibleIf; changed(); }, 2));
    }
    insp.replaceChildren(
      h('div', { class: 'row' }, h('b', {}, node ? node.type : ''), h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: () => move(-1) }, '↑'), h('button', { class: 'btn sm', onclick: () => move(1) }, '↓'), h('button', { class: 'btn sm', onclick: dup }, 'Duplicate'), h('button', { class: 'btn sm dan', onclick: remove }, 'Delete')),
      h('h2', {}, 'Properties'), ...fields,
      h('h2', {}, 'Outline'), tree,
      h('h2', {}, 'Screen settings'),
      h('label', { class: 'f' }, 'Title', h('input', { value: B.json.title || '', oninput: (e) => { B.json.title = e.target.value; B.dirty = true; drawHeader(); drawStage(); } })),
      jsonField('Data sources', B.json.data || {}, (v) => { B.json.data = v || {}; changed(); }, 3),
      h('details', {}, h('summary', { class: 'muted' }, 'Full screen JSON'), jsonField('', B.json, (v) => { if (v && v.root) { B.json = v; B.sel = 'root'; changed(); } }, 18)));
  }
  const cats = {};
  S.widgets.forEach(w => (cats[w.category] = cats[w.category] || []).push(w));
  const pal = h('div', { class: 'pal' }, h('b', {}, 'Widgets'), h('p', { class: 'muted', style: { fontSize: '11.5px', margin: '4px 0' } }, 'Adds into the selected container, or after the selected widget.'),
    Object.entries(cats).map(([c, ws]) => [h('div', { class: 'cat' }, c), ws.map(w => h('button', { disabled: !has('designer', 'admin'), onclick: () => addWidget(w.type) }, w.type))]));
  el.append(header, h('div', { class: 'studio', style: { marginTop: '10px' } }, pal, stage, insp));
  drawHeader(); drawStage(); drawInspector(); refreshPreview();
  return el;
}

// ---------------- journeys ----------------
async function journeysView(selId) {
  const list = await api('/journeys');
  const id = selId || (list[0] && list[0].id);
  const item = id ? await api('/journeys/' + id) : null;
  let json = item && item.draft;
  const flow = h('div', {}), errBox = h('div', {});
  const drawFlow = () => {
    if (!json || !json.steps) return flow.replaceChildren();
    const order = []; const seen = new Set(); const walk = (n) => { if (!n || seen.has(n) || !json.steps[n]) return; seen.add(n); order.push(n); const s = json.steps[n]; walk(s.next); walk(s.onSuccess); walk(s.onError); };
    walk(json.start); Object.keys(json.steps).forEach(walk);
    flow.replaceChildren(h('div', { class: 'steps' }, order.map((n, i) => { const s = json.steps[n]; return [i ? h('span', { class: 'arrow' }, '→') : null, h('div', { class: 'step' + (s.task ? ' task' : '') + (s.terminal ? ' term' : '') }, h('div', { class: 'n' }, n, n === json.start ? ' ▶' : ''), h('div', { class: 't' }, s.screen ? `screen: ${s.screen}` : `task: ${s.task}`), s.next ? h('div', { class: 't' }, `next → ${s.next}`) : null, s.onSuccess ? h('div', { class: 't' }, `ok → ${s.onSuccess} · error → ${s.onError}`) : null, s.screen ? h('a', { href: '#', class: 't', onclick: (e) => { e.preventDefault(); go('screen', s.screen); } }, 'edit screen') : null)]; })));
  };
  const ta = h('textarea', { rows: 22 }, json ? JSON.stringify(json, null, 2) : '');
  ta.addEventListener('input', () => { try { json = JSON.parse(ta.value); ta.style.borderColor = ''; drawFlow(); } catch { ta.style.borderColor = '#f04438'; } });
  drawFlow();
  const nid = h('input', { placeholder: 'new_journey_id' });
  return h('div', {}, h('h1', {}, 'Journeys'), h('p', { class: 'sub' }, 'A journey is a state machine of screen steps and server task steps. Money-movement tasks run on the server, which keeps the authoritative state.'),
    h('div', { class: 'row', style: { marginBottom: '10px' } }, list.map(j => h('button', { class: 'btn' + (j.id === id ? ' pri' : ''), onclick: () => go('journeys', j.id) }, j.id, j.hasDraftChanges ? ' •' : '')), h('span', { class: 'sp' }),
      has('designer', 'admin') ? [nid, h('button', { class: 'btn', onclick: async () => { const nj = nid.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'); if (!nj) return; await api('/journeys/' + nj, { method: 'PUT', body: { json: { id: nj, title: nj, start: 'start', steps: { start: { screen: 'home', terminal: true } } } } }); go('journeys', nj); } }, 'New journey')] : null),
    item ? h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, item.id), item.liveVersion ? tag('live v' + item.liveVersion, 'ok') : tag('not live', 'warn'), item.hasDraftChanges ? tag('unreleased changes', 'warn') : null),
      h('h2', {}, 'Storyboard'), flow, h('h2', {}, 'Definition'), ta, errBox,
      has('designer', 'admin') ? h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn pri', onclick: async () => { try { const r = await api('/journeys/' + id, { method: 'PUT', body: { json } }); errBox.replaceChildren(r.warnings.length ? h('div', { class: 'err' }, r.warnings.join(' · ')) : ''); toast('Journey draft saved'); } catch (e) { toast(e.message); } } }, 'Save draft')) : null) : null);
}

// ---------------- themes ----------------
async function themesView(selId) {
  const [list, customers] = await Promise.all([api('/themes'), api('/customers')]);
  const id = selId || 'default';
  const item = await api('/themes/' + id);
  const t = item.draft;
  const prev = h('div', { class: 'phone' });
  const tfp = S.flutter ? flutterPreview() : null;
  let homeP = null;
  const drawPrev = async () => {
    if (tfp) {
      if (!homeP) homeP = await api('/preview', { method: 'POST', body: { screenId: 'home', customerId: customers[0].id, themeId: id } });
      if (!prev.contains(tfp.frame)) prev.replaceChildren(h('div', { class: 'scr' }, tfp.frame));
      tfp.send({ screen: { ...homeP.screen, title: t.brandName }, data: homeP.data, theme: t, design: false });
      return;
    }
    const p = await api('/preview', { method: 'POST', body: { screenId: 'home', customerId: customers[0].id, themeId: id } });
    const scr = h('div', { class: 'scr dx-root' }); DXP.applyTheme(scr, t);
    scr.append(h('div', { style: { padding: '14px 16px 4px', fontWeight: 700, color: 'var(--p)' } }, t.brandName), DXP.renderNode(p.screen.root, { ...p.data, state: {} }, { state: {}, setState() {}, rerender() {}, act() {} }));
    prev.replaceChildren(scr);
  };
  const colorRow = (k) => h('div', { class: 'swatch' }, h('input', { type: 'color', value: t.colors[k], oninput: (e) => { t.colors[k] = e.target.value.toUpperCase(); drawPrev(); } }), h('span', {}, k), h('span', { class: 'muted mono' }, t.colors[k]));
  drawPrev();
  return h('div', {}, h('h1', {}, 'Branding & themes'), h('p', { class: 'sub' }, 'Themes are token sets assigned to segments. A published theme recolours running apps immediately.'),
    h('div', { class: 'row', style: { marginBottom: '10px' } }, list.map(x => h('button', { class: 'btn' + (x.id === id ? ' pri' : ''), onclick: () => go('themes', x.id) }, x.title, x.hasDraftChanges ? ' •' : ''))),
    h('div', { class: 'grid', style: { gridTemplateColumns: '340px 1fr' } },
      h('div', { class: 'card' }, h('label', { class: 'f' }, 'Brand name', h('input', { value: t.brandName, oninput: (e) => { t.brandName = e.target.value; drawPrev(); } })),
        ['primary', 'onPrimary', 'background', 'surface', 'onSurface', 'muted', 'success', 'danger'].map(colorRow),
        h('label', { class: 'f' }, `Corner radius: ${t.radius}px`, h('input', { type: 'range', min: 0, max: 28, value: t.radius, oninput: (e) => { t.radius = Number(e.target.value); e.target.parentElement.firstChild.textContent = `Corner radius: ${t.radius}px`; drawPrev(); } })),
        has('designer', 'admin') ? h('button', { class: 'btn pri', onclick: async () => { await api('/themes/' + id, { method: 'PUT', body: { json: t } }); toast('Theme draft saved'); } }, 'Save draft') : null),
      h('div', { class: 'stage' }, prev)));
}

// ---------------- segments & menus ----------------
async function segmentsView() {
  const [segs, asg, themes, screens] = await Promise.all([api('/segments'), api('/assignments/default'), api('/themes'), api('/screens')]);
  const A = asg.draft;
  const rows = segs.map(s => {
    const a = A.segments[s.code] = A.segments[s.code] || {};
    const sel = (key, opts) => h('select', { onchange: (e) => { if (e.target.value) a[key] = e.target.value; else delete a[key]; } }, h('option', { value: '' }, s.code === 'DEFAULT' ? '(required)' : '(inherit)'), opts.map(o => h('option', { value: o.id, selected: a[key] === o.id }, o.id)));
    const menu = h('textarea', { rows: 4 }, a.menu ? JSON.stringify(a.menu) : '');
    menu.addEventListener('blur', () => { const v = menu.value.trim(); if (!v) { delete a.menu; return; } try { a.menu = JSON.parse(v); menu.style.borderColor = ''; } catch { menu.style.borderColor = '#f04438'; } });
    return h('tr', {}, h('td', {}, h('b', {}, s.code), h('div', { class: 'muted' }, s.name), h('div', { class: 'muted', style: { fontSize: '11px' } }, s.fallback ? `falls back to ${s.fallback}` : 'root')), h('td', {}, sel('theme', themes)), h('td', {}, sel('home', screens)), h('td', { style: { width: '45%' } }, menu));
  });
  return h('div', {}, h('h1', {}, 'Segments & menus'), h('p', { class: 'sub' }, 'Which theme, home screen and bottom menu each segment receives. Empty = inherit from the fallback segment.'),
    h('table', {}, h('tr', {}, h('th', {}, 'Segment'), h('th', {}, 'Theme'), h('th', {}, 'Home screen'), h('th', {}, 'Menu (JSON: [{label, icon, action}])')), rows),
    has('designer', 'admin') ? h('button', { class: 'btn pri', style: { marginTop: '10px' }, onclick: async () => { await api('/assignments/default', { method: 'PUT', body: { json: A } }); toast('Assignment draft saved'); } }, 'Save draft') : null);
}

// ---------------- widgets ----------------
async function widgetsView() {
  const ws = await api('/widgets');
  const ta = h('textarea', { rows: 10 }, JSON.stringify({ type: 'FxRateTicker', major: 1, category: 'Banking', events: ['tap'], props: { pairs: { type: 'json', default: ['USD/KWD', 'EUR/KWD'] }, title: { type: 'string', default: 'Live FX' } }, minRuntime: '1.1.0' }, null, 2));
  return h('div', {}, h('h1', {}, 'Widget registry'), h('p', { class: 'sub' }, 'Widgets are built by developers into the app runtime (one store release), then registered here. From then on business users can use them in any screen with no further release.'),
    h('table', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Version'), h('th', {}, 'Category'), h('th', {}, 'Props'), h('th', {}, 'Events'), h('th', {}, 'Min runtime'), h('th', {}, 'Status')),
      ws.map(w => h('tr', {}, h('td', {}, h('b', {}, w.type)), h('td', {}, w.version), h('td', {}, w.category), h('td', { class: 'mono' }, Object.keys(w.props).join(', ')), h('td', {}, w.events.join(', ')), h('td', {}, w.minRuntime), h('td', {}, statusTag(w.status === 'active' ? 'ACTIVE' : w.status))))),
    has('admin') ? h('div', { class: 'card', style: { marginTop: '12px' } }, h('h2', { style: { marginTop: 0 } }, 'Register a widget manifest'), ta, h('button', { class: 'btn pri', style: { marginTop: '8px' }, onclick: async () => { try { await api('/widgets', { method: 'POST', body: JSON.parse(ta.value) }); S.widgets = await api('/widgets'); toast('Widget registered'); go('widgets'); } catch (e) { toast(e.message); } } }, 'Register')) : null);
}

// ---------------- releases ----------------
async function releasesView() {
  const [changes, rels] = await Promise.all([api('/changes'), api('/releases')]);
  const note = h('input', { placeholder: 'What changed and why' });
  const errBox = h('div', {});
  const pending = rels.find(r => r.status === 'PENDING');
  return h('div', {}, h('h1', {}, 'Releases'), h('p', { class: 'sub' }, 'Maker submits draft changes; a different checker approves. Approval publishes atomically, bumps the config version and signals every connected app.'),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Unreleased draft changes'), changes.length ? h('table', {}, changes.map(c => h('tr', {}, h('td', {}, tag(c.kind, 'grey')), h('td', {}, h('b', {}, c.id)), h('td', { class: 'muted' }, 'by ' + c.by)))) : h('p', { class: 'muted' }, 'Nothing to release.'),
        has('maker', 'admin') && changes.length && !pending ? h('div', {}, h('label', { class: 'f', style: { marginTop: '10px' } }, 'Release note', note), errBox, h('button', { class: 'btn pri', onclick: async () => { try { const r = await api('/releases', { method: 'POST', body: { note: note.value } }); toast(`Release ${r.no} submitted for approval`); go('releases'); } catch (e) { errBox.replaceChildren(h('div', { class: 'err' }, e.message, e.details ? h('ul', {}, e.details.map(d => h('li', {}, d))) : null)); } } }, 'Submit for approval')) : null,
        pending ? h('p', { class: 'muted' }, `Release ${pending.no} is awaiting approval.`) : null),
      h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Awaiting approval'), pending ? h('div', {}, h('p', {}, h('b', {}, `Release ${pending.no}`), ` by ${pending.submittedBy} · ${fmt(pending.submittedAt)}`), h('p', { class: 'muted' }, pending.note || '(no note)'), h('ul', {}, pending.changes.map(c => h('li', {}, `${c.kind}: ${c.id}`))),
        has('approver', 'admin') ? h('div', { class: 'row' }, h('button', { class: 'btn pri', onclick: async () => { try { const r = await api(`/releases/${pending.no}/approve`, { method: 'POST' }); toast(`Published config v${r.configVersion}. ${r.notifiedDevices} device(s) notified.`); go('releases'); } catch (e) { toast(e.message); } } }, 'Approve & publish'), h('button', { class: 'btn dan', onclick: async () => { await api(`/releases/${pending.no}/reject`, { method: 'POST', body: { reason: prompt('Reason?') || '' } }); go('releases'); } }, 'Reject')) : h('p', { class: 'muted' }, 'Sign in as an approver (checker / checker123) to approve.')) : h('p', { class: 'muted' }, 'No release pending.'))),
    h('h2', {}, 'History'),
    h('table', {}, h('tr', {}, h('th', {}, 'No'), h('th', {}, 'Status'), h('th', {}, 'Config'), h('th', {}, 'Note'), h('th', {}, 'Items'), h('th', {}, 'Maker → checker'), h('th', {}, 'Published'), h('th', {})),
      rels.map(r => h('tr', {}, h('td', {}, r.no), h('td', {}, statusTag(r.status)), h('td', {}, r.configVersion ? 'v' + r.configVersion : ''), h('td', {}, r.note), h('td', { class: 'mono' }, r.changes.map(c => `${c.kind}:${c.id}`).join(', ')), h('td', {}, `${r.submittedBy} → ${r.approvedBy || r.rejectedBy || '…'}`), h('td', { class: 'muted' }, fmt(r.publishedAt)),
        h('td', {}, r.status === 'PUBLISHED' && has('approver', 'admin') ? h('button', { class: 'btn sm', onclick: async () => { if (!confirm(`Roll back live config to release ${r.no}?`)) return; const x = await api(`/releases/${r.no}/rollback`, { method: 'POST' }); toast(`Rolled back. Config v${x.configVersion} is live.`); go('releases'); } }, 'Roll back to this') : null)))));
}

// ---------------- customers & 360 ----------------
async function customersView() {
  const q = h('input', { placeholder: 'Search name, CIF, username, mobile' });
  const tbody = h('tbody', {});
  const load = async () => { const list = await api('/customers?q=' + encodeURIComponent(q.value)); tbody.replaceChildren(...list.map(c => h('tr', {}, h('td', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); go('c360', c.id); } }, c.name)), h('td', { class: 'mono' }, c.cif), h('td', {}, c.username), h('td', {}, c.segment), h('td', {}, statusTag(c.status)), h('td', { class: 'muted' }, fmt(c.lastLogin)), h('td', {}, c.devices)))); };
  q.addEventListener('input', load); load();
  return h('div', {}, h('h1', {}, 'Customers'), h('p', { class: 'sub' }, 'Digital customers, their status and a 360 view of everything they did on digital channels.'), h('div', { style: { maxWidth: '420px', marginBottom: '10px' } }, q),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'CIF'), h('th', {}, 'Username'), h('th', {}, 'Segment'), h('th', {}, 'Status'), h('th', {}, 'Last login'), h('th', {}, 'Devices'))), tbody));
}
async function c360(id) {
  const d = await api(`/customers/${id}/360`);
  const p = d.profile;
  const lockBtn = has('csr', 'admin') ? h('button', { class: 'btn ' + (p.status === 'ACTIVE' ? 'dan' : 'pri'), onclick: async () => { const reason = prompt('Reason (required, audited)'); if (!reason) return; await api(`/customers/${id}/${p.status === 'ACTIVE' ? 'lock' : 'unlock'}`, { method: 'POST', body: { reason } }); go('c360', id); } }, p.status === 'ACTIVE' ? 'Lock digital access' : 'Unlock') : null;
  const filterSel = h('select', { style: { width: '220px' } }, h('option', { value: '' }, 'All events'), ['SESSION_', 'TXN_', 'JOURNEY_', 'SCREEN_VIEW', 'UI_ACTION', 'CONFIG_APPLIED', 'SERVICE_REQUEST', 'ERROR', 'LOGIN_FAILED', 'DEVICE_'].map(x => h('option', { value: x }, x)));
  const tl = h('div', { class: 'timeline' });
  const drawTl = () => tl.replaceChildren(...d.events.filter(e => !filterSel.value || e.type.startsWith(filterSel.value)).slice(0, 150).map(e => h('div', {}, h('span', { class: 't' }, fmt(e.ts)), h('b', {}, e.type), ' ', h('span', { class: 'muted' }, [e.screen, e.journey && `${e.journey.id}${e.journey.step ? '/' + e.journey.step : ''}`, e.payload && (e.payload.amount !== undefined ? `${e.payload.amount} ${e.payload.currency || ''}` : e.payload.action || e.payload.request || e.payload.configVersion), e.platform, e.source].filter(x => x !== undefined && x !== null && x !== '').join(' · ')))));
  filterSel.addEventListener('change', drawTl); drawTl();
  return h('div', {},
    h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => go('customers') }, '‹ Customers'), h('h1', { style: { margin: 0 } }, p.name), statusTag(p.status), tag(p.segment), h('span', { class: 'sp' }), lockBtn),
    h('p', { class: 'sub' }, `CIF ${p.cif} · ${p.username} · ${p.mobile} · ${p.email} · KYC ${p.kycStatus} · risk ${p.riskRating} · RM ${p.rm}`),
    h('div', { class: 'grid g3' },
      h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Digital profile'), h('div', {}, `Last login: ${fmt(p.lastLogin) || 'never'}`), h('div', {}, `Failed logins: ${p.failedLogins || 0}`), h('h2', {}, 'Devices'), d.devices.length ? d.devices.map(v => h('div', { class: 'mono' }, `${v.deviceId} · ${v.platform} · runtime ${v.runtime}`)) : h('div', { class: 'muted' }, 'None')),
      h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Active entitlements'), Object.entries(d.entitlements).map(([f, e]) => h('div', {}, h('b', {}, f), e.perTxnLimit ? h('span', { class: 'muted' }, ` · ${e.perTxnLimit}/txn · ${e.dailyLimit}/day ${e.currency}`) : null, e.subjectType === 'customer' ? tag('override', 'warn') : h('span', { class: 'muted' }, ` (${e.subjectId})`)))),
      h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Journey funnel'), Object.keys(d.funnel).length ? h('table', {}, h('tr', {}, h('th', {}, 'Journey'), h('th', {}, 'Started'), h('th', {}, 'Completed'), h('th', {}, 'Abandoned')), Object.entries(d.funnel).map(([j, f]) => h('tr', {}, h('td', {}, j), h('td', {}, f.started), h('td', {}, f.completed), h('td', {}, f.abandoned)))) : h('div', { class: 'muted' }, 'No journeys yet'))),
    h('h2', {}, 'Customer-initiated transactions'),
    d.transactions.length ? h('table', {}, h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Type'), h('th', {}, 'Amount'), h('th', {}, 'To'), h('th', {}, 'Status'), h('th', {}, 'Downstream ref'), h('th', {}, 'Journey')), d.transactions.map(t => h('tr', {}, h('td', {}, fmt(t.createdAt)), h('td', {}, t.type), h('td', {}, `${DXP.money(t.amount)} ${t.currency}`), h('td', {}, t.toLabel || t.to), h('td', {}, statusTag(t.status), t.errorCode ? h('span', { class: 'muted' }, ' ' + t.errorCode) : null), h('td', { class: 'mono' }, t.downstreamRef || ''), h('td', { class: 'mono' }, t.journeyInstance)))) : h('p', { class: 'muted' }, 'No transactions from digital channels yet.'),
    h('div', { class: 'grid g2', style: { marginTop: '12px' } },
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, 'Activity timeline'), h('span', { class: 'sp' }), filterSel), tl),
      h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Products'), h('p', { class: 'muted', style: { fontSize: '11.5px' } }, `From core banking, as of ${fmt(d.products.asOf)}`), h('table', {}, d.products.accounts.map(a => h('tr', {}, h('td', {}, a.name, h('div', { class: 'muted mono' }, a.number)), h('td', {}, `${DXP.money(a.balance)} ${a.currency}`)))), h('h2', {}, 'Cards'), h('table', {}, d.products.cards.map(c => h('tr', {}, h('td', {}, c.name, h('div', { class: 'muted mono' }, c.number)), h('td', {}, statusTag(c.status))))))));
}

// ---------------- entitlements ----------------
async function entitlementsView() {
  const [ents, feats, segs] = await Promise.all([api('/entitlements'), api('/features'), api('/segments')]);
  const can = has('admin', 'maker');
  const row = (e) => {
    const save = async () => { await api('/entitlements/' + e.id, { method: 'PUT', body: e }); toast(`Saved ${e.id}. Connected apps refresh their entitlements.`); };
    const num = (k) => h('input', { type: 'number', value: e[k] ?? '', disabled: !can, style: { width: '110px' }, onchange: (x) => { e[k] = x.target.value === '' ? undefined : Number(x.target.value); } });
    return h('tr', {}, h('td', { class: 'mono' }, e.id), h('td', {}, `${e.subjectType}: `, h('b', {}, e.subjectId)), h('td', {}, e.feature), h('td', {}, h('input', { type: 'checkbox', style: { width: 'auto' }, checked: e.enabled, disabled: !can, onchange: (x) => { e.enabled = x.target.checked; } })), h('td', {}, num('perTxnLimit')), h('td', {}, num('dailyLimit')), h('td', {}, e.currency || ''), h('td', {}, can ? h('button', { class: 'btn sm', onclick: save }, 'Save') : null));
  };
  const subj = h('select', {}, segs.map(s => h('option', { value: 'segment:' + s.code }, 'segment: ' + s.code)), h('option', { value: 'customer:C1003' }, 'customer: C1003 (override)'));
  const feat = h('select', {}, feats.map(f => h('option', { value: f.code }, f.code)));
  return h('div', {}, h('h1', {}, 'Entitlements & limits'), h('p', { class: 'sub' }, 'Resolved per customer: customer override → segment → fallback segments. The same resolution hides UI in the app and enforces limits in the transaction gateway.'),
    h('table', {}, h('tr', {}, h('th', {}, 'Id'), h('th', {}, 'Subject'), h('th', {}, 'Feature'), h('th', {}, 'Enabled'), h('th', {}, 'Per txn'), h('th', {}, 'Daily'), h('th', {}, 'Ccy'), h('th', {})), ents.map(row)),
    can ? h('div', { class: 'row card', style: { marginTop: '12px', maxWidth: '640px' } }, subj, feat, h('button', { class: 'btn', onclick: async () => { const [t, sid] = subj.value.split(':'); await api('/entitlements/E' + Date.now().toString().slice(-6), { method: 'PUT', body: { subjectType: t, subjectId: sid, feature: feat.value, enabled: true, currency: 'KWD' } }); go('entitlements'); } }, 'Add rule')) : null);
}

// ---------------- staff & audit ----------------
async function accessView() {
  const [staff, audit] = await Promise.all([has('admin') ? api('/staff') : Promise.resolve(null), api('/audit')]);
  return h('div', {}, h('h1', {}, 'Staff & audit'), h('p', { class: 'sub' }, 'Console users (federated to the bank IdP in production) and the hash-chained audit trail.'),
    staff ? h('table', {}, h('tr', {}, h('th', {}, 'User'), h('th', {}, 'Name'), h('th', {}, 'Roles'), h('th', {}, 'Status')), staff.map(s => h('tr', {}, h('td', {}, s.username), h('td', {}, s.name), h('td', {}, s.roles.map(r => tag(r))), h('td', {}, statusTag(s.active ? 'ACTIVE' : 'DISABLED'))))) : h('p', { class: 'muted' }, 'Staff list requires the admin role.'),
    h('h2', {}, 'Audit trail'), h('table', {}, h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Actor'), h('th', {}, 'Action'), h('th', {}, 'Entity'), h('th', {}, 'Hash')), audit.map(a => h('tr', {}, h('td', {}, fmt(a.ts)), h('td', {}, a.actor), h('td', {}, a.action), h('td', { class: 'mono' }, a.entity), h('td', { class: 'mono muted' }, a.hash)))));
}

const VIEWS = { dashboard, customers: customersView, c360, screens: screensList, screen: screenBuilder, journeys: journeysView, themes: themesView, segments: segmentsView, widgets: widgetsView, releases: releasesView, entitlements: entitlementsView, access: accessView };
// keep sidebar highlight for sub-views
const _shell = shell;
shell = function (c) { const v = S.view; if (v === 'screen') S.view = 'screens'; if (v === 'c360') S.view = 'customers'; _shell(c); S.view = v; };
boot();
