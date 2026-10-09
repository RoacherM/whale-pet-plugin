// Renders every stage × mood (plus the open card) into preview.html for a visual check outside DSH.
// Usage: node preview.mjs && open preview.html
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const h = React.createElement;

let plugin, css = '';
const storage = new Map();
const document = { head: { appendChild: (tag) => { css = tag.textContent; } }, createElement: () => ({ dataset: {}, remove() {} }) };
vm.runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), {
  window: {
    __ModuleLoader__: { load: (entry) => { plugin = entry.factory((id) => (id === 'react' ? React : { createPortal: (node) => node })); } },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    innerWidth: 1200,
  },
  document, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON,
});

const dicts = new Map();
let View;
plugin.apply({
  effect: (fn) => fn(),
  locale: { register: (ns, d) => { dicts.set(ns, d); return () => {}; }, bind: (ns) => (k) => dicts.get(ns).zh[k] ?? k },
  slots: { inject: (_n, fn) => fn(), register: (_o, view) => { View = view; } },
});
const t = (k) => dicts.get('local-whale-pet').zh[k] ?? k;

const now = Date.now();
const pets = { egg: { hatched: false }, baby: { hatched: true, xp: 40 }, cool: { hatched: true, xp: 400 }, legend: { hatched: true, xp: 2000 } };
const moods = {
  idle: { running: false }, working: { running: true }, alert: { running: false, pendingInteraction: { kind: 'question' } },
  hungry: { running: false, _fed: 5 },
};
const cells = [];
for (const [stage, p] of Object.entries(pets)) {
  for (const [mood, status] of Object.entries(moods)) {
    storage.set('dsh-whale-pet:v1', JSON.stringify({ ...p, fed: status._fed ?? 90, fedAt: now }));
    plugin.apply({ effect: (fn) => fn(), locale: { register: () => () => {}, bind: () => t },
      slots: { inject: (_n, fn) => fn(), register: (_o, view) => { View = view; } } });
    const html = renderToStaticMarkup(h(View, { sessionId: 's', useSessionStatus: (sel) => sel(new Map([['s', status]])), t }));
    cells.push(`<figure><div class="hdr">${html}</div><figcaption>${stage} · ${mood}</figcaption></figure>`);
  }
}

writeFileSync(new URL('./preview.html', import.meta.url), `<!doctype html><meta charset="utf-8"><title>Whale pet preview</title>
<style>
  :root { --dsw-alias-bg-layer-1:#fff; --dsw-alias-bg-layer-2:#f4f5f7; --dsw-alias-label-primary:#1b1d21; --dsw-alias-label-secondary:#5b606b;
    --dsw-alias-label-tertiary:#8a8f99; --dsw-alias-border-l1:#e8e9ec; --dsw-alias-border-l2:#dcdee3; --dsw-alias-interactive-bg-hover:#eef0f3;
    --dsw-alias-brand-primary:#4d6bfe; --dsw-alias-state-warning-primary:#f5a623; }
  body { font-family:-apple-system,system-ui,sans-serif; margin:24px; background:#fafbfc; }
  .grid { display:grid; grid-template-columns:repeat(4, 150px); gap:12px; }
  figure { margin:0; padding:22px 8px 8px; background:#fff; border:1px solid #e8e9ec; border-radius:10px; text-align:center; }
  .hdr { display:flex; justify-content:center; transform:scale(2); transform-origin:center bottom; height:56px; align-items:flex-end; }
  figcaption { margin-top:8px; font-size:12px; color:#5b606b; }
  .card-demo { position:relative; height:420px; margin-top:24px; }
  .card-demo .wp-card { position:absolute !important; top:0 !important; left:0 !important; }
  ${css}
</style>
<h3>小鲸 — stages × moods</h3><div class="grid">${cells.join('')}</div>
<div class="card-demo">${cardHtml()}</div>`);

function cardHtml() {
  // Render the card by rendering the view with open state forced through a tiny React shim.
  storage.set('dsh-whale-pet:v1', JSON.stringify({ hatched: true, xp: 130, tasks: 11, pets: 23, fed: 72, fedAt: now }));
  plugin.apply({ effect: (fn) => fn(), locale: { register: () => () => {}, bind: () => t },
    slots: { inject: (_n, fn) => fn(), register: (_o, view) => { View = view; } } });
  const useState = React.useState;
  let calls = 0;
  React.useState = (init) => (++calls === 1 ? [true, () => {}] : useState(init)); // first useState is `open`
  const useRef = React.useRef;
  React.useRef = (init) => (init === null ? { current: { getBoundingClientRect: () => ({ bottom: 0, right: 272 }), contains: () => false } } : useRef(init));
  try {
    return renderToStaticMarkup(h(View, { sessionId: 's', useSessionStatus: (sel) => sel(new Map([['s', { running: true }]])), t }));
  } finally { React.useState = useState; React.useRef = useRef; }
}
console.log('wrote preview.html');
