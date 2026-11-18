/* DXP web renderer: the same server-driven UI contract the Flutter runtime implements (CONTRACT.md).
   Used by the console's live phone preview and by the browser device simulator. */
(function (global) {
  const ICONS = { home: '⌂', send: '➤', swap: '⇄', card: '▭', receipt: '☰', wallet: '◫', user: '◉', logout: '⎋', bolt: 'ϟ', gift: '✦', info: 'ⓘ', lock: '🔒︎', chart: '▤', phone: '☏', star: '★' };
  const icon = (n) => ICONS[n] || ICONS.info;

  function getPath(ctx, path) {
    if (!path) return undefined;
    return String(path).trim().split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
  }
  function money(v) {
    const n = Number(v);
    if (!isFinite(n)) return v == null ? '' : String(v);
    return n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  function interp(str, ctx) {
    if (typeof str !== 'string') return str;
    return str.replace(/\{\{\s*([^}|]+?)\s*(?:\|\s*(\w+)\s*)?\}\}/g, (_, p, f) => {
      const v = getPath(ctx, p);
      if (f === 'money') return money(v);
      if (f === 'date') return v ? String(v).slice(0, 10) : '';
      return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    });
  }
  function interpDeep(v, ctx) {
    if (typeof v === 'string') return interp(v, ctx);
    if (Array.isArray(v)) return v.map(x => interpDeep(x, ctx));
    if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = k === 'action' ? v[k] : interpDeep(v[k], ctx); return o; }
    return v;
  }
  function resolveProps(node, ctx) {
    const props = {};
    for (const [k, v] of Object.entries(node.props || {})) props[k] = (k === 'items' && Array.isArray(v)) ? v : interpDeep(v, ctx);
    for (const [k, p] of Object.entries(node.bind || {})) props[k] = getPath(ctx, p);
    return props;
  }
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };

  const W = {
    Column(n, p, ctx, env, kids) {
      return h('div', { class: 'dx-col' + (p.scroll ? ' dx-scroll' : ''), style: { padding: (p.padding ?? 0) + 'px', gap: (p.gap ?? 0) + 'px', alignItems: { start: 'flex-start', center: 'center' }[p.align] || 'stretch' } }, kids());
    },
    Row(n, p, ctx, env, kids) {
      return h('div', { class: 'dx-row', style: { gap: (p.gap ?? 8) + 'px', justifyContent: { center: 'center', spaceBetween: 'space-between' }[p.align] || 'flex-start' } }, kids());
    },
    Card(n, p, ctx, env, kids) {
      return h('div', { class: 'dx-card' + (p.tone === 'primary' ? ' dx-primary' : ''), style: { padding: (p.padding ?? 16) + 'px' }, onclick: n.on && n.on.tap ? () => env.act(n.on.tap, ctx) : null }, kids());
    },
    Text(n, p) { return h('div', { class: 'dx-text dx-' + (p.style || 'body'), style: { textAlign: p.align || 'start' } }, p.text ?? ''); },
    Button(n, p, ctx, env) {
      return h('button', { class: 'dx-btn dx-btn-' + (p.variant || 'primary'), onclick: () => n.on && n.on.tap && env.act(n.on.tap, ctx) }, p.icon ? h('span', { class: 'dx-ic' }, icon(p.icon)) : null, p.label || '');
    },
    Banner(n, p, ctx, env) {
      return h('div', { class: 'dx-banner dx-' + (p.tone || 'info'), onclick: n.on && n.on.tap ? () => env.act(n.on.tap, ctx) : null },
        h('div', { class: 'dx-banner-ic' }, icon(p.icon || (p.tone === 'promo' ? 'star' : 'info'))),
        h('div', {}, h('div', { class: 'dx-banner-t' }, p.title || ''), h('div', { class: 'dx-banner-x' }, p.text || '')));
    },
    BalanceCard(n, p, ctx, env) {
      return h('div', { class: 'dx-card dx-primary dx-balance', onclick: n.on && n.on.tap ? () => env.act(n.on.tap, ctx) : null },
        h('div', { class: 'dx-caption-on' }, p.title || ''), h('div', { class: 'dx-big' }, money(p.amount), ' ', h('small', {}, p.currency || '')), p.subtitle ? h('div', { class: 'dx-caption-on' }, p.subtitle) : null);
    },
    AccountList(n, p, ctx, env) {
      const items = Array.isArray(p.items) ? p.items : [];
      return h('div', { class: 'dx-hlist' }, items.map((a, i) => h('div', { class: 'dx-card dx-acc' + (i === 0 ? ' dx-primary' : ''), onclick: n.on && n.on.tap ? () => env.act(n.on.tap, { ...ctx, item: a }) : null },
        h('div', { class: 'dx-acc-name' }, a.name), h('div', { class: 'dx-acc-no' }, a.number), h('div', { class: 'dx-acc-bal' }, money(a.balance), ' ', h('small', {}, a.currency)))));
    },
    TxnList(n, p) {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, p.limit || 50);
      if (!items.length) return h('div', { class: 'dx-text dx-muted' }, 'No transactions yet');
      return h('div', { class: 'dx-card dx-list' }, items.map(t => h('div', { class: 'dx-li' },
        h('div', {}, h('div', { class: 'dx-li-t' }, t.description), h('div', { class: 'dx-li-s' }, String(t.date).slice(0, 10))),
        h('div', { class: 'dx-amt ' + (t.amount < 0 ? 'dx-neg' : 'dx-pos') }, (t.amount > 0 ? '+' : '') + money(t.amount), ' ', t.currency))));
    },
    QuickActions(n, p, ctx, env) {
      const items = Array.isArray(p.items) ? p.items : [];
      return h('div', { class: 'dx-qa' }, items.map(it => h('button', { class: 'dx-qa-i', onclick: () => it.action && env.act(it.action, ctx) }, h('span', { class: 'dx-qa-ic' }, icon(it.icon)), h('span', {}, interp(it.label, ctx)))));
    },
    TextField(n, p, ctx, env) {
      const f = p.field || 'field';
      const inp = h('input', { class: 'dx-input', placeholder: p.placeholder || '', inputmode: p.keyboard === 'number' ? 'decimal' : 'text', value: env.state[f] ?? '' });
      inp.addEventListener('input', () => env.setState(f, p.keyboard === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value));
      return h('label', { class: 'dx-field' }, p.label ? h('span', {}, p.label) : null, inp);
    },
    AmountField(n, p, ctx, env) {
      const f = p.field || 'amount';
      const inp = h('input', { class: 'dx-input dx-amount', inputmode: 'decimal', placeholder: '0.000', value: env.state[f] ?? '' });
      inp.addEventListener('input', () => env.setState(f, inp.value === '' ? '' : Number(inp.value)));
      return h('label', { class: 'dx-field' }, h('span', {}, p.label || 'Amount'), h('div', { class: 'dx-amount-wrap' }, inp, h('b', {}, p.currency || 'KWD')));
    },
    SelectList(n, p, ctx, env) {
      const f = p.field || 'selection', lk = p.labelKey || 'name', sk = p.subtitleKey, vk = p.valueKey || 'id';
      const items = Array.isArray(p.items) ? p.items : [];
      return h('div', { class: 'dx-field' }, p.label ? h('span', {}, p.label) : null,
        h('div', { class: 'dx-card dx-list' }, items.map(it => h('div', { class: 'dx-li dx-sel' + (env.state[f] === it[vk] ? ' dx-on' : ''), onclick: () => { env.setState(f, it[vk]); env.setState(f + 'Label', it[lk]); env.rerender(); if (n.on && n.on.tap) env.act(n.on.tap, { ...ctx, item: it }); } },
          h('div', {}, h('div', { class: 'dx-li-t' }, it[lk]), sk ? h('div', { class: 'dx-li-s' }, it[sk]) : null), h('div', { class: 'dx-radio' })))));
    },
    OtpInput(n, p, ctx, env) {
      const f = p.field || 'otp';
      const inp = h('input', { class: 'dx-input dx-otp', maxlength: p.length || 6, inputmode: 'numeric', value: env.state[f] ?? '' });
      inp.addEventListener('input', () => env.setState(f, inp.value));
      return inp;
    },
    ReviewSummary(n, p, ctx) {
      const rows = Array.isArray(p.rows) ? p.rows : [];
      return h('div', { class: 'dx-card dx-list' }, rows.map(r => h('div', { class: 'dx-li' }, h('div', { class: 'dx-li-s' }, interp(r.label, ctx)), h('div', { class: 'dx-li-t' }, interp(r.value, ctx)))));
    },
    ResultPanel(n, p) {
      const ok = p.status !== 'failure';
      return h('div', { class: 'dx-result' }, h('div', { class: 'dx-result-ic ' + (ok ? 'dx-ok' : 'dx-bad') }, ok ? '✓' : '!'), h('div', { class: 'dx-text dx-headline', style: { textAlign: 'center' } }, p.title || ''), h('div', { class: 'dx-text dx-muted', style: { textAlign: 'center' } }, p.message || ''));
    },
    Divider() { return h('hr', { class: 'dx-hr' }); },
    Spacer(n, p) { return h('div', { style: { height: (p.size ?? 16) + 'px' } }); },
  };

  function renderNode(node, ctx, env, path = 'root') {
    let el;
    try {
      const fn = W[node && node.type];
      if (!fn) {
        env.onError && env.onError({ code: 'UNSUPPORTED_WIDGET', type: node && node.type });
        el = h('div', { class: 'dx-unsupported' }, 'Unsupported: ' + (node && node.type));
      } else {
        const p = resolveProps(node, ctx);
        el = fn(node, p, ctx, env, () => (node.children || []).map((c, i) => renderNode(c, ctx, env, path + '.' + i)));
      }
    } catch (e) {
      env.onError && env.onError({ code: 'RENDER_ERROR', type: node && node.type, message: String(e) });
      el = h('div', { class: 'dx-unsupported' }, 'Could not render ' + (node && node.type));
    }
    if (env.design) {
      el.dataset.path = path;
      el.classList.add('dx-design');
      if (env.selected === path) el.classList.add('dx-selected');
      el.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); env.onSelect && env.onSelect(path); }, true);
    }
    return el;
  }

  function applyTheme(el, theme) {
    const c = (theme && theme.colors) || {};
    const set = (k, v) => v && el.style.setProperty(k, v);
    set('--p', c.primary); set('--onp', c.onPrimary); set('--bg', c.background); set('--surface', c.surface);
    set('--on', c.onSurface); set('--muted', c.muted); set('--ok', c.success); set('--bad', c.danger);
    el.style.setProperty('--r', ((theme && theme.radius) ?? 14) + 'px');
  }

  const CSS = `
  .dx-root{--p:#0B6E69;--onp:#fff;--bg:#F3F6F6;--surface:#fff;--on:#1b1b1b;--muted:#6b6b6b;--ok:#1E8E3E;--bad:#C62828;--r:14px;background:var(--bg);color:var(--on);font:14px/1.4 Roboto,system-ui,-apple-system,Segoe UI,sans-serif;transition:background .4s}
  .dx-col{display:flex;flex-direction:column}.dx-row{display:flex;align-items:center}.dx-scroll{overflow:auto}
  .dx-card{background:var(--surface);border-radius:var(--r);box-shadow:0 1px 3px rgba(0,0,0,.07);transition:background .4s,border-radius .4s}
  .dx-primary{background:var(--p)!important;color:var(--onp)}
  .dx-text.dx-headline{font-size:22px;font-weight:700}.dx-text.dx-title{font-size:16px;font-weight:600}.dx-text.dx-caption{font-size:12px}.dx-text.dx-muted{color:var(--muted)}
  .dx-btn{border:0;border-radius:calc(var(--r) * .8);padding:13px 16px;font-weight:600;font-size:15px;cursor:pointer;display:flex;gap:8px;justify-content:center;align-items:center;transition:background .4s}
  .dx-btn-primary{background:var(--p);color:var(--onp)}.dx-btn-secondary{background:transparent;border:1.5px solid var(--p);color:var(--p)}.dx-btn-text{background:none;color:var(--p)}
  .dx-banner{display:flex;gap:12px;padding:14px;border-radius:var(--r);background:var(--surface);border-left:4px solid var(--p);cursor:default}
  .dx-banner.dx-promo{background:linear-gradient(90deg,color-mix(in srgb,var(--p) 14%,var(--surface)),var(--surface))}.dx-banner.dx-warning{border-color:#E8A317}
  .dx-banner-ic{font-size:20px;color:var(--p)}.dx-banner-t{font-weight:600}.dx-banner-x{color:var(--muted);font-size:13px}
  .dx-balance{padding:18px}.dx-big{font-size:26px;font-weight:700}.dx-caption-on{opacity:.85;font-size:12px}
  .dx-hlist{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px}.dx-acc{min-width:160px;padding:14px;cursor:pointer}
  .dx-acc-name{font-weight:600}.dx-acc-no{font-size:12px;opacity:.75}.dx-acc-bal{font-size:18px;font-weight:700;margin-top:10px}
  .dx-list{padding:4px 14px}.dx-li{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid rgba(0,0,0,.06);gap:12px}.dx-li:last-child{border:0}
  .dx-li-t{font-weight:500}.dx-li-s{font-size:12px;color:var(--muted)}.dx-amt{font-weight:600;white-space:nowrap}.dx-neg{color:var(--on)}.dx-pos{color:var(--ok)}
  .dx-qa{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.dx-qa-i{background:var(--surface);border:0;border-radius:var(--r);padding:12px 4px;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px;color:var(--on);cursor:pointer}
  .dx-qa-ic{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--p) 14%,transparent);color:var(--p);font-size:17px}
  .dx-field{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted)}.dx-input{border:1.5px solid rgba(0,0,0,.12);border-radius:calc(var(--r)*.7);padding:12px;font-size:15px;background:var(--surface);color:var(--on)}
  .dx-amount-wrap{display:flex;align-items:center;gap:8px;background:var(--surface);border-radius:var(--r);padding:6px 14px}.dx-amount{border:0;font-size:28px;font-weight:700;flex:1;min-width:0;padding:8px 0}.dx-amount-wrap b{color:var(--muted)}
  .dx-sel{cursor:pointer}.dx-radio{width:18px;height:18px;border-radius:50%;border:2px solid rgba(0,0,0,.2)}.dx-on .dx-radio{border:6px solid var(--p)}
  .dx-otp{letter-spacing:12px;text-align:center;font-size:22px}
  .dx-result{display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px 8px}.dx-result-ic{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;font-size:32px;color:#fff}.dx-ok{background:var(--ok)}.dx-bad{background:var(--bad)}
  .dx-hr{border:0;border-top:1px solid rgba(0,0,0,.08);width:100%}
  .dx-unsupported{border:1px dashed #aaa;color:#888;padding:8px;font-size:12px;border-radius:6px}
  .dx-design{outline:1px dashed transparent;outline-offset:2px;cursor:pointer}.dx-design:hover{outline-color:rgba(0,120,255,.45)}.dx-selected{outline:2px solid #1a73e8!important}
  `;
  function injectCss() { if (!document.getElementById('dx-css')) document.head.append(h('style', { id: 'dx-css' }, CSS)); }

  global.DXP = { renderNode, applyTheme, interp, getPath, money, icon, injectCss, h };
})(window);
