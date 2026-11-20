// Publish-time checks (blueprint section 6): widget registry, props, actions, references, journey safety.
const ACTIONS = ['navigate', 'back', 'startJourney', 'next', 'finish', 'cancelJourney', 'setState', 'refresh', 'openUrl', 'toast', 'logout', 'nativeRoute'];
// CONTRACT-OBDX §7: the Demo Bank app's route table for obdx-1. Keep in step with the app.
const NATIVE_ROUTES = ['/home', '/transfer', '/accounts', '/accounts/loans', '/accounts/term-deposits', '/cards/credit', '/bills'];
// CONTRACT-OBDX §6: data sources the app resolves (against OBDX). Keep in step with the app.
const DATA_SOURCES = ['customer.profile', 'accounts.list', 'txn.history', 'cards.list', 'payees.list'];
// CONTRACT-OBDX §2, §3: a minimum app version is a plain x.y.z.
const VERSION = /^\d+\.\d+\.\d+$/;
const URL_ALLOW =[/^https:\/\/([a-z0-9-]+\.)*bankone\.example(\/|$)/i, /^https:\/\/([a-z0-9-]+\.)*profinch\.com(\/|$)/i];

function checkAction(a, where, refs, errors) {
  if (!a || typeof a !== 'object') return errors.push(`${where}: action must be an object`);
  if (!ACTIONS.includes(a.type)) return errors.push(`${where}: unknown action "${a.type}"`);
  if (a.type === 'navigate' && !refs.screens.has(a.screen)) errors.push(`${where}: navigate target "${a.screen}" does not exist`);
  if (a.type === 'startJourney' && !refs.journeys.has(a.journey)) errors.push(`${where}: journey "${a.journey}" does not exist`);
  if (a.type === 'nativeRoute' && !NATIVE_ROUTES.includes(a.route)) errors.push(`${where}: nativeRoute "${a.route}" is not in the app's route table (${NATIVE_ROUTES.join(', ')})`);
  if (a.type === 'openUrl' && !URL_ALLOW.some(r => r.test(a.url || ''))) errors.push(`${where}: URL "${a.url}" is not on the allow-list`);
}

function checkScreen(json, widgets, refs) {
  const errors = [];
  if (!json || typeof json !== 'object') return ['screen must be a JSON object'];
  if (!json.id) errors.push('screen.id is required');
  if (!json.root) errors.push('screen.root is required');
  if (json.minAppVersion !== undefined && !VERSION.test(String(json.minAppVersion))) errors.push(`screen.minAppVersion "${json.minAppVersion}" must look like 1.2.3`);
  for (const [alias, d] of Object.entries(json.data || {})) {
    const source = d && typeof d === 'object' ? d.source : d;
    if (!DATA_SOURCES.includes(source)) errors.push(`data.${alias}: source "${source}" is not one the app provides (${DATA_SOURCES.join(', ')})`);
  }
  const byType = Object.fromEntries(widgets.map(w => [w.type, w]));
  const walk = (n, path) => {
    if (!n || typeof n !== 'object') return errors.push(`${path}: node must be an object`);
    const minV = n.visibleIf && n.visibleIf.minAppVersion;
    if (minV !== undefined && !VERSION.test(String(minV))) errors.push(`${path}: visibleIf.minAppVersion "${minV}" must look like 1.2.3`);
    const w = byType[n.type];
    if (!w) return errors.push(`${path}: widget "${n.type}" is not in the registry`);
    if (w.status !== 'active') errors.push(`${path}: widget "${n.type}" is ${w.status}`);
    for (const [k, v] of Object.entries(n.props || {})) {
      const spec = w.props[k];
      if (!spec) { errors.push(`${path}.${n.type}: unknown prop "${k}"`); continue; }
      if (spec.type === 'enum' && v !== undefined && !spec.values.includes(v)) errors.push(`${path}.${n.type}.${k}: "${v}" is not one of ${spec.values.join(', ')}`);
      if (spec.type === 'number' && typeof v !== 'number') errors.push(`${path}.${n.type}.${k}: must be a number`);
      if (spec.type === 'boolean' && typeof v !== 'boolean') errors.push(`${path}.${n.type}.${k}: must be true/false`);
      if (Array.isArray(v)) v.forEach((it, i) => { if (it && it.action) checkAction(it.action, `${path}.${n.type}.${k}[${i}]`, refs, errors); });
    }
    for (const [ev, a] of Object.entries(n.on || {})) {
      if (!w.events.includes(ev)) errors.push(`${path}.${n.type}: does not emit "${ev}"`);
      checkAction(a, `${path}.${n.type}.on.${ev}`, refs, errors);
    }
    if (n.children && !w.container) errors.push(`${path}.${n.type}: cannot have children`);
    (n.children || []).forEach((c, i) => walk(c, `${path}.${n.type}[${i}]`));
  };
  if (json.root) walk(json.root, json.id || 'screen');
  return errors;
}

function checkJourney(json, refs) {
  const errors = [];
  if (!json.steps || !json.start) return ['journey needs "start" and "steps"'];
  if (!json.steps[json.start]) errors.push(`start step "${json.start}" does not exist`);
  for (const [name, s] of Object.entries(json.steps)) {
    if (!s.screen && !s.task) errors.push(`step "${name}": needs a screen or a task`);
    if (s.screen && !refs.screens.has(s.screen)) errors.push(`step "${name}": screen "${s.screen}" does not exist`);
    for (const k of ['next', 'onSuccess', 'onError']) if (s[k] && !json.steps[s[k]]) errors.push(`step "${name}": ${k} target "${s[k]}" does not exist`);
    if (s.screen && !s.terminal && !s.next) errors.push(`step "${name}": non-terminal screen step needs "next"`);
    if (s.task && (!s.onSuccess || !s.onError)) errors.push(`step "${name}": task step needs onSuccess and onError`);
    // Money-movement safety: a *.submit task must be entered from a screen step (the review) - never directly from another task.
    if (s.task && /\.submit$/.test(s.task)) {
      const into = Object.entries(json.steps).filter(([, x]) => x.next === name || x.onSuccess === name);
      if (!into.length || into.some(([, x]) => !x.screen)) errors.push(`step "${name}": a submit task must be preceded by a review screen`);
    }
  }
  return errors;
}

function checkTheme(json) {
  const errors = [];
  const hex = /^#[0-9A-Fa-f]{6}$/;
  for (const k of ['primary', 'onPrimary', 'background', 'surface', 'onSurface', 'muted', 'success', 'danger']) if (!hex.test((json.colors || {})[k] || '')) errors.push(`theme.colors.${k} must be #RRGGBB`);
  if (typeof json.radius !== 'number') errors.push('theme.radius must be a number');
  return errors;
}

module.exports = { checkScreen, checkJourney, checkTheme, ACTIONS, NATIVE_ROUTES, DATA_SOURCES };
