import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const React = require('react');
const ReactDOM = require('react-dom');
const { renderToStaticMarkup } = require('react-dom/server');
const HOUR = 60 * 60 * 1000;

/** Load client.js the way the page's module loader does, against a fake document and storage. */
function load(stored = null) {
  let plugin;
  const storage = new Map(stored === null ? [] : [['dsh-whale-pet:v1', JSON.stringify(stored)]]);
  const head = [];
  const document = {
    head: { appendChild: (tag) => head.push(tag) },
    createElement: () => { const tag = { dataset: {}, remove: () => head.splice(head.indexOf(tag), 1) }; return tag; },
  };
  const window = {
    __ModuleLoader__: { load: (entry) => {
      assert.equal(entry.id, '@local/dsh-whale-pet');
      plugin = entry.factory((id) => ({ react: React, 'react-dom': ReactDOM })[id]);
    } },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
  };
  vm.runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'),
    { window, document, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON });
  return { plugin, storage, head, window };
}

function mount(stored) {
  const loaded = load(stored);
  const disposers = [], dictionaries = new Map();
  let registration;
  loaded.plugin.apply({
    effect: (fn) => disposers.push(fn()),
    locale: {
      register: (ns, dicts) => { dictionaries.set(ns, dicts); return () => dictionaries.delete(ns); },
      bind: (ns) => (key) => dictionaries.get(ns).zh[key] ?? key,
    },
    slots: {
      inject: (name, fn) => { assert.equal(name, 'conversation.session.header.utilities'); fn(); },
      register: (options, view) => { registration = { options, view }; },
    },
  });
  return { ...loaded, disposers, dictionaries, registration };
}

function render(m, status) {
  const statuses = new Map([['s1', status]]);
  const t = (key) => m.dictionaries.get('local-whale-pet').zh[key] ?? key;
  return renderToStaticMarkup(React.createElement(m.registration.view,
    { sessionId: 's1', useSessionStatus: (select) => select(statuses), t }));
}

test('registers one header utility with dictionaries and styles, and disposes both', () => {
  const m = mount();
  assert.deepEqual({ ...m.registration.options, label: undefined },
    { name: 'conversation.session.header.utilities', id: 'whale-pet', order: -20, locale: 'local-whale-pet', label: undefined });
  assert.equal(m.registration.options.label(), '小鲸');
  assert.equal(m.head.length, 1);
  assert.deepEqual(Object.keys(m.dictionaries.get('local-whale-pet').zh).sort(), Object.keys(m.dictionaries.get('local-whale-pet').en).sort());
  m.disposers.forEach((dispose) => dispose());
  assert.equal(m.head.length, 0);
  assert.equal(m.dictionaries.size, 0);
});

test('renders a pixel sprite whose mood follows the session status', () => {
  const m = mount({ hatched: true, xp: 0, fed: 80, fedAt: Date.now() });
  const idle = render(m, { running: false });
  assert.match(idle, /class="wp-trigger"/);
  assert.match(idle, /wp-mood-idle/);
  assert.match(idle, /<svg[^>]*class="wp-sprite wp-baby"/);
  assert.match(idle, /aria-label="小鲸 · 悠闲地游着"/);
  assert.match(render(m, { running: true }), /wp-mood-working.*wp-bubble/);
  assert.match(render(m, { running: false, pendingInteraction: { kind: 'approval' } }), /wp-mood-alert.*>!</);
  assert.match(render(mount(), { running: false }), /wp-sprite wp-egg/);
});

test('hungry and grown-up whales look different', () => {
  const now = Date.now();
  const hungry = render(mount({ hatched: true, xp: 0, fed: 10, fedAt: now }), { running: false });
  assert.match(hungry, /wp-mood-hungry.*🐟/);
  const legend = render(mount({ hatched: true, xp: 2000, fed: 90, fedAt: now }), { running: false });
  assert.match(legend, /wp-legend/);
  assert.match(legend, /fill="#ffc83d"/); // the crown
});

test('a finished turn hatches the egg, grants XP once, and levels up', () => {
  const { model: pet } = load().plugin;
  let r = pet.award(pet.initial, 's1', 1000);
  assert.equal(r.hatched, true);
  assert.equal(r.state.tasks, 1);
  assert.equal(r.state.xp, 15); // well fed bonus
  assert.equal(pet.award(r.state, 's1', 2000).ignored, true);
  assert.equal(pet.award(r.state, 's2', 2000).ignored, undefined);
  r = pet.award(r.state, 's1', 5000);
  assert.equal(r.leveledUp, true); // 30 XP ≥ 20 → Lv.2
  assert.equal(pet.levelOf(r.state.xp), 2);
});

test('stages and level curve', () => {
  const { model: pet } = load().plugin;
  assert.equal(pet.stageOf(pet.initial), 'egg');
  assert.equal(pet.stageOf({ hatched: true, xp: 0 }), 'baby');
  assert.equal(pet.stageOf({ hatched: true, xp: 320 }), 'cool');
  assert.equal(pet.stageOf({ hatched: true, xp: 1620 }), 'legend');
  for (let level = 1; level < 20; level++) assert.equal(pet.levelOf(pet.xpForLevel(level)), level);
});

test('satiety drains with wall-clock time and feeding refills it', () => {
  const { model: pet } = load().plugin;
  const s = { ...pet.initial, fed: 50, fedAt: 0 };
  assert.equal(pet.satietyOf(s, 5 * HOUR), 30);
  assert.equal(pet.satietyOf(s, 100 * HOUR), 0);
  const fed = pet.feed(s, 5 * HOUR);
  assert.equal(fed.state.fed, 55);
  assert.equal(fed.state.xp, 2);
  assert.equal(pet.feed({ ...s, fed: 99, fedAt: 0 }, 0).refused, true);
});

test('petting earns XP at most every 10 seconds but always counts', () => {
  const { model: pet } = load().plugin;
  let s = pet.pet(pet.initial, 100000).state;
  s = pet.pet(s, 105000).state;
  s = pet.pet(s, 111000).state;
  assert.deepEqual([s.pets, s.xp], [3, 2]);
});

test('mood priority: pending > running > celebrating > sleepy > hungry > idle', () => {
  const { model: pet } = load().plugin;
  const base = { pending: false, running: false, celebrating: false, sleepy: false, satiety: 80 };
  assert.equal(pet.moodOf({ ...base, pending: true, running: true }), 'alert');
  assert.equal(pet.moodOf({ ...base, running: true, celebrating: true }), 'working');
  assert.equal(pet.moodOf({ ...base, celebrating: true, sleepy: true }), 'happy');
  assert.equal(pet.moodOf({ ...base, sleepy: true, satiety: 5 }), 'sleepy');
  assert.equal(pet.moodOf({ ...base, satiety: 5 }), 'hungry');
  assert.equal(pet.moodOf(base), 'idle');
});

test('corrupt or foreign storage revives into a valid pet', () => {
  const { model: pet } = load().plugin;
  const s = pet.revive({ xp: 'lots', tasks: -3, hatched: 'yes', fed: 500, lastAward: null }, 42);
  assert.deepEqual({ ...s, lastAward: { ...s.lastAward } }, { xp: 0, tasks: 0, pets: 0, hatched: false, fed: 100, fedAt: 42, lastPetXpAt: 0, lastAward: {} });
  assert.match(render(mount('garbage'), { running: false }), /wp-egg/);
});
