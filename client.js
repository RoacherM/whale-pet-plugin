window.__ModuleLoader__.load({
  id: '@local/dsh-whale-pet',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;
    const NS = 'local-whale-pet';
    const STORAGE_KEY = 'dsh-whale-pet:v1';
    const HOUR = 60 * 60 * 1000;
    const SLEEP_AFTER = 3 * 60 * 1000;
    const PET_XP_COOLDOWN = 10 * 1000;

    // ── Model: pure functions over a plain JSON state, so progress is testable and storable. ──

    const initial = { xp: 0, tasks: 0, pets: 0, hatched: false, fed: 80, fedAt: 0, lastPetXpAt: 0, lastAward: {} };

    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
    /** Level curve: Lv2 at 20 XP, Lv5 at 320 XP, Lv10 at 1620 XP. */
    const levelOf = (xp) => 1 + Math.floor(Math.sqrt(xp / 20));
    const xpForLevel = (level) => 20 * (level - 1) * (level - 1);
    /** Satiety drains 4 points per hour of wall-clock time, even while the page is closed. */
    const satietyOf = (state, now) => clamp(state.fed - Math.max(0, now - state.fedAt) / HOUR * 4, 0, 100);
    const stageOf = (state) => !state.hatched ? 'egg' : levelOf(state.xp) < 5 ? 'baby' : levelOf(state.xp) < 10 ? 'cool' : 'legend';

    function outcome(before, after) {
      return { state: after, leveledUp: levelOf(after.xp) > levelOf(before.xp), hatched: !before.hatched && after.hatched };
    }

    /** One finished agent turn; repeated reports of the same session within 3s count once. */
    function award(state, sessionId, now) {
      const last = state.lastAward[sessionId];
      if (last !== undefined && now - last < 3000) return { state, leveledUp: false, hatched: false, ignored: true };
      const satiety = satietyOf(state, now);
      const lastAward = { ...state.lastAward, [sessionId]: now };
      // Keep only recent sessions so the stored record stays small.
      for (const key of Object.keys(lastAward)) if (now - lastAward[key] > HOUR) delete lastAward[key];
      return outcome(state, { ...state, xp: state.xp + (satiety >= 60 ? 15 : 10), tasks: state.tasks + 1,
        hatched: true, fed: Math.max(0, satiety - 3), fedAt: now, lastAward });
    }

    function pet(state, now) {
      const earns = now - state.lastPetXpAt >= PET_XP_COOLDOWN;
      return outcome(state, { ...state, pets: state.pets + 1, xp: state.xp + (earns ? 1 : 0),
        lastPetXpAt: earns ? now : state.lastPetXpAt });
    }

    function feed(state, now) {
      const satiety = satietyOf(state, now);
      if (satiety >= 95) return { state, leveledUp: false, hatched: false, refused: true };
      return outcome(state, { ...state, fed: Math.min(100, satiety + 25), fedAt: now, xp: state.xp + 2 });
    }

    function moodOf({ pending, running, celebrating, sleepy, satiety }) {
      if (pending) return 'alert';
      if (running) return 'working';
      if (celebrating) return 'happy';
      if (sleepy) return 'sleepy';
      if (satiety < 20) return 'hungry';
      return 'idle';
    }

    function revive(raw, now) {
      const value = raw && typeof raw === 'object' ? raw : {};
      const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
      return {
        xp: Math.max(0, num(value.xp, 0)), tasks: Math.max(0, num(value.tasks, 0)), pets: Math.max(0, num(value.pets, 0)),
        hatched: value.hatched === true, fed: clamp(num(value.fed, initial.fed), 0, 100), fedAt: num(value.fedAt, now),
        lastPetXpAt: num(value.lastPetXpAt, 0),
        lastAward: value.lastAward && typeof value.lastAward === 'object' ? { ...value.lastAward } : {},
      };
    }

    const model = { initial, levelOf, xpForLevel, satietyOf, stageOf, award, pet, feed, moodOf, revive };

    // ── Pixel art: 16×10 grids, one character per pixel. ──

    const palette = {
      D: '#1f2c7a', B: '#4d6bfe', W: '#e3e9ff', C: '#ff9db5', S: '#fbf5e6', P: '#4d6bfe',
      K: '#151515', G: '#ffc83d', R: '#ff4d6d', L: '#8fa4ff',
    };
    const grids = {
      whale: [
        '...........D..D.',
        '...........DBBD.',
        '..DDDDDD....DBD.',
        '.DBLLBBBDD..DBD.',
        'DBLBBBBBBBDDBBD.',
        'DBBBBBBBBBBBBD..',
        'DBBCBBBBBBBBBD..',
        'DWWWWWWBBBBBD...',
        '.DWWWWWWWBDD....',
        '..DDDDDDDD......',
      ],
      egg: [
        '......DDDD......',
        '.....DSSSSD.....',
        '....DSSPSSSD....',
        '....DSSSSSSD....',
        '...DSSSSSPSSD...',
        '...DSPSSSSSSD...',
        '...DSSSSSSSSD...',
        '....DSSSSPSD....',
        '.....DSSSSD.....',
        '......DDDD......',
      ],
      shades: [
        '................', '................', '................', '................', '................',
        '.KKKKKK.........', '.KKK............',
      ],
      crown: ['...G.G.G........', '...GGRGG........'],
    };
    function rectsOf(grid) {
      const rects = [];
      grid.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const c = row[x];
          if (c !== '.') rects.push({ x, y, fill: palette[c], key: x + ':' + y });
        }
      });
      return rects;
    }
    const layers = {
      egg: [rectsOf(grids.egg)],
      baby: [rectsOf(grids.whale)],
      cool: [rectsOf(grids.whale), rectsOf(grids.shades)],
      legend: [rectsOf(grids.whale), rectsOf(grids.shades), rectsOf(grids.crown)],
    };

    function Sprite({ stage, mood, scale }) {
      const rects = [];
      for (const layer of layers[stage]) {
        for (const r of layer) rects.push(h('rect', { key: rects.length, x: r.x, y: r.y, width: 1, height: 1, fill: r.fill }));
      }
      // The eye sits under the shades once the whale grows up, so only the young ones blink.
      if (stage === 'baby') {
        rects.push(h('rect', {
          key: 'eye', className: 'wp-eye' + (mood === 'sleepy' ? ' wp-eye-closed' : ''),
          x: 2, y: 5, width: 1, height: 1, fill: '#0d1333',
        }));
      }
      return h('svg', {
        className: 'wp-sprite wp-' + stage, width: 16 * scale, height: 10 * scale,
        viewBox: '0 0 16 10', shapeRendering: 'crispEdges', 'aria-hidden': true,
      }, rects);
    }

    function Effects({ mood, hearts, flash }) {
      const out = [];
      if (mood === 'working') {
        for (let i = 0; i < 3; i++) out.push(h('span', { key: 'b' + i, className: 'wp-fx wp-bubble', style: { animationDelay: i * 0.35 + 's' } }));
      }
      if (mood === 'alert') out.push(h('span', { key: 'alert', className: 'wp-fx wp-alert' }, '!'));
      if (mood === 'happy') {
        for (let i = 0; i < 4; i++) out.push(h('span', { key: 's' + i, className: 'wp-fx wp-drop wp-drop-' + i }));
      }
      if (mood === 'sleepy') {
        for (let i = 0; i < 2; i++) out.push(h('span', { key: 'z' + i, className: 'wp-fx wp-z', style: { animationDelay: i * 1.2 + 's' } }, 'z'));
      }
      if (mood === 'hungry') out.push(h('span', { key: 'fish', className: 'wp-fx wp-think' }, '🐟'));
      for (const id of hearts) out.push(h('span', { key: 'h' + id, className: 'wp-fx wp-heart', style: { '--wp-dx': ((id * 37) % 7) - 3 } }, '♥'));
      if (flash) out.push(h('span', { key: 'flash', className: 'wp-fx wp-flash' }, '✦'));
      return out;
    }

    function Stage({ stage, mood, hearts, flash, scale }) {
      return h('span', {
        className: 'wp-stage wp-mood-' + mood, style: { '--wp-s': scale + 'px', width: 16 * scale, height: 10 * scale },
      }, h(Sprite, { stage, mood, scale }), h(Effects, { mood, hearts, flash }));
    }

    function Bar({ value, tone, label }) {
      return h('div', { className: 'wp-bar', role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(value) },
        h('span', { className: 'wp-bar-fill wp-bar-' + tone, style: { transform: 'scaleX(' + value / 100 + ')' } }));
    }

    const css = `
      .wp-trigger { position:relative; display:inline-flex; align-items:flex-end; justify-content:center; width:40px; height:28px; padding:0 0 2px; border:none; border-radius:6px; background:transparent; cursor:pointer; overflow:visible; flex:none; }
      .wp-trigger:hover { background:var(--dsw-alias-interactive-bg-hover); }
      .wp-trigger:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
      .wp-stage { position:relative; display:inline-block; line-height:0; }
      .wp-sprite { display:block; overflow:visible; }
      .wp-eye { transform-box:fill-box; transform-origin:center; animation:wp-blink 4.2s infinite; }
      .wp-eye-closed { animation:none; transform:scaleY(.25); }

      .wp-mood-idle .wp-sprite, .wp-mood-hungry .wp-sprite { animation:wp-bob 2.4s ease-in-out infinite; }
      .wp-mood-working .wp-sprite { animation:wp-swim .5s ease-in-out infinite; }
      .wp-mood-alert .wp-sprite { animation:wp-jump .6s ease-in-out infinite; }
      .wp-mood-happy .wp-sprite { animation:wp-hop .45s ease-in-out infinite; }
      .wp-mood-sleepy .wp-sprite { animation:wp-breathe 4s ease-in-out infinite; transform-origin:bottom center; }
      .wp-egg { transform-origin:50% 90%; animation:wp-wobble 1.8s ease-in-out infinite !important; }
      .wp-mood-working .wp-egg, .wp-mood-alert .wp-egg { animation-duration:.45s !important; }

      .wp-fx { position:absolute; pointer-events:none; line-height:1; font-weight:700; }
      .wp-bubble { left:calc(var(--wp-s) * -1.5); top:calc(var(--wp-s) * 4); width:calc(var(--wp-s) * 1.5); height:calc(var(--wp-s) * 1.5); border:1px solid #8fa4ff; border-radius:50%; opacity:0; animation:wp-rise 1.05s ease-out infinite; }
      .wp-alert { left:calc(var(--wp-s) * 5); top:calc(var(--wp-s) * -5.5); font-size:calc(var(--wp-s) * 5); color:var(--dsw-alias-state-warning-primary, #f5a623); animation:wp-pop .6s ease-in-out infinite; }
      .wp-drop { left:calc(var(--wp-s) * 4); top:calc(var(--wp-s) * 1); width:var(--wp-s); height:calc(var(--wp-s) * 1.4); border-radius:50% 50% 50% 50% / 60% 60% 40% 40%; background:#6fc3ff; animation:wp-spout .9s ease-out infinite; }
      .wp-drop-0 { --wp-dx:-2; animation-delay:0s; } .wp-drop-1 { --wp-dx:2; animation-delay:.2s; }
      .wp-drop-2 { --wp-dx:-1; animation-delay:.45s; } .wp-drop-3 { --wp-dx:1; animation-delay:.65s; }
      .wp-z { left:calc(var(--wp-s) * 9); top:calc(var(--wp-s) * 1); font-size:calc(var(--wp-s) * 3.5); color:var(--dsw-alias-label-tertiary); opacity:0; animation:wp-float 2.4s ease-out infinite; }
      .wp-think { left:calc(var(--wp-s) * -3); top:calc(var(--wp-s) * -3); font-size:calc(var(--wp-s) * 4); animation:wp-bob 1.6s ease-in-out infinite; }
      .wp-heart { left:calc(var(--wp-s) * 6); top:calc(var(--wp-s) * 1); font-size:calc(var(--wp-s) * 4); color:#ff5c8a; animation:wp-heart 1s ease-out forwards; }
      .wp-flash { left:calc(var(--wp-s) * 12); top:calc(var(--wp-s) * -4); font-size:calc(var(--wp-s) * 4.5); color:#ffc83d; animation:wp-spark 1.2s ease-in-out infinite; }

      .wp-card { position:fixed; z-index:1000; width:272px; border:1px solid var(--dsw-alias-border-l2); border-radius:14px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); box-shadow:0 12px 32px rgba(0,0,0,.16); overflow:hidden; animation:wp-in .18s ease-out; font-size:13px; }
      .wp-pond { position:relative; display:flex; align-items:flex-end; justify-content:center; height:112px; padding-bottom:14px; background:linear-gradient(180deg, rgba(111,195,255,.10), rgba(77,107,254,.22)); cursor:pointer; }
      .wp-pond::after { content:''; position:absolute; left:0; right:0; bottom:0; height:10px; background:repeating-linear-gradient(90deg, rgba(77,107,254,.35) 0 8px, transparent 8px 16px); animation:wp-wave 3s linear infinite; }
      .wp-body { padding:12px 14px 14px; display:flex; flex-direction:column; gap:10px; }
      .wp-title { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
      .wp-name { font-size:15px; font-weight:600; }
      .wp-level { color:var(--dsw-alias-label-secondary); font-variant-numeric:tabular-nums; }
      .wp-quip { margin:0; padding:8px 10px; border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); line-height:1.45; }
      .wp-row { display:grid; grid-template-columns:44px 1fr 56px; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary); font-size:12px; }
      .wp-row b { text-align:right; font-weight:500; font-variant-numeric:tabular-nums; color:var(--dsw-alias-label-primary); }
      .wp-bar { height:6px; border-radius:3px; background:var(--dsw-alias-border-l1); overflow:hidden; }
      .wp-bar-fill { display:block; height:100%; transform-origin:left center; transition:transform .4s ease; }
      .wp-bar-xp { background:linear-gradient(90deg, #4d6bfe, #8fa4ff); }
      .wp-bar-food { background:linear-gradient(90deg, #ff9f43, #ffc83d); }
      .wp-stats { display:flex; justify-content:space-between; color:var(--dsw-alias-label-tertiary); font-size:12px; }
      .wp-actions { display:flex; gap:8px; }
      .wp-actions button { flex:1; padding:7px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; cursor:pointer; }
      .wp-actions button:hover { background:var(--dsw-alias-interactive-bg-hover); }
      .wp-actions button:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }

      @keyframes wp-blink { 0%, 93%, 100% { transform:scaleY(1); } 96% { transform:scaleY(.15); } }
      @keyframes wp-bob { 0%, 100% { transform:translateY(0); } 50% { transform:translateY(calc(var(--wp-s) * -.8)); } }
      @keyframes wp-swim { 0%, 100% { transform:translate(0, 0) rotate(-4deg); } 50% { transform:translate(calc(var(--wp-s) * -.6), calc(var(--wp-s) * -.6)) rotate(4deg); } }
      @keyframes wp-jump { 0%, 100% { transform:translateY(0); } 40% { transform:translateY(calc(var(--wp-s) * -2)); } }
      @keyframes wp-hop { 0%, 100% { transform:translateY(0) rotate(0); } 50% { transform:translateY(calc(var(--wp-s) * -1.4)) rotate(-6deg); } }
      @keyframes wp-breathe { 0%, 100% { transform:scale(1, 1); } 50% { transform:scale(1.03, .95); } }
      @keyframes wp-wobble { 0%, 100% { transform:rotate(0); } 25% { transform:rotate(-9deg); } 75% { transform:rotate(9deg); } }
      @keyframes wp-rise { 0% { opacity:.9; transform:translate(0, 0) scale(.6); } 100% { opacity:0; transform:translate(calc(var(--wp-s) * -1.5), calc(var(--wp-s) * -6)) scale(1.1); } }
      @keyframes wp-pop { 0%, 100% { transform:scale(1); } 50% { transform:scale(1.25) translateY(calc(var(--wp-s) * -.5)); } }
      @keyframes wp-spout { 0% { opacity:1; transform:translate(0, 0); } 100% { opacity:0; transform:translate(calc(var(--wp-s) * var(--wp-dx) * 1.5), calc(var(--wp-s) * -6)); } }
      @keyframes wp-float { 0% { opacity:0; transform:translate(0, 0) scale(.7); } 30% { opacity:1; } 100% { opacity:0; transform:translate(calc(var(--wp-s) * 3), calc(var(--wp-s) * -6)) scale(1.1); } }
      @keyframes wp-heart { 0% { opacity:1; transform:translate(0, 0) scale(.6); } 100% { opacity:0; transform:translate(calc(var(--wp-s) * var(--wp-dx)), calc(var(--wp-s) * -8)) scale(1.2); } }
      @keyframes wp-spark { 0%, 100% { opacity:.3; transform:scale(.7) rotate(0); } 50% { opacity:1; transform:scale(1.2) rotate(45deg); } }
      @keyframes wp-wave { from { background-position:0 0; } to { background-position:32px 0; } }
      @keyframes wp-in { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
      @media (prefers-reduced-motion: reduce) { .wp-stage *, .wp-card, .wp-pond::after { animation:none !important; } }
    `;

    const quips = 3;
    const zh = {
      name: '小鲸', open: '打开小鲸', close: '关闭', level: 'Lv.', xp: '经验', food: '饱腹',
      tasks: '陪你完成 {n} 个任务', pets: '被摸了 {n} 次', pet: '摸摸 ♥', feed: '喂小鱼 🐟',
      'stage.egg': '神秘的蛋', 'stage.baby': '小鲸宝', 'stage.cool': '墨镜酷鲸', 'stage.legend': '传说鲸王',
      'mood.idle': '悠闲地游着', 'mood.working': '正在陪你干活', 'mood.alert': '需要你看一眼！',
      'mood.happy': '任务完成，喷个水花！', 'mood.hungry': '肚子饿了', 'mood.sleepy': '睡着了',
      'event.levelUp': '升级啦！现在是 Lv.{n}', 'event.hatch': '蛋壳裂开了……小鲸孵化啦！', 'event.full': '嗝～吃不下啦',
      'event.fed': '好吃！谢谢你的小鱼', 'event.petted': '嘿嘿，好舒服～',
      'quip.egg.0': '蛋里好像有什么在动……完成一个任务就能孵化。', 'quip.egg.1': '咚、咚。像是在敲键盘的声音。', 'quip.egg.2': '温暖的蛋。它似乎在偷听你们的对话。',
      'quip.idle.0': '今天也要写出没有 bug 的代码！', 'quip.idle.1': '我在这片 token 海里游来游去～', 'quip.idle.2': '有什么任务尽管丢过来。',
      'quip.working.0': '咕噜咕噜，Agent 正在努力思考……', 'quip.working.1': '我帮你盯着进度，别担心。', 'quip.working.2': '工具调用一个接一个，冲鸭！',
      'quip.alert.0': 'Agent 在等你回复哦！', 'quip.alert.1': '有个决定需要你来拍板。', 'quip.alert.2': '叮！轮到你了。',
      'quip.happy.0': '噗——任务完成，庆祝一下！', 'quip.happy.1': '又完成一个，我们真是好搭档。', 'quip.happy.2': '经验 +10，感觉自己变强了！',
      'quip.hungry.0': '肚子咕咕叫……能给我一条小鱼吗？', 'quip.hungry.1': '饿得游不动了。', 'quip.hungry.2': '小鱼……想吃小鱼……',
      'quip.sleepy.0': 'Zzz……梦到自己变成了一只大鲸鱼……', 'quip.sleepy.1': 'Zzz……（戳一下就会醒）', 'quip.sleepy.2': 'Zzz……编译通过了……',
    };
    const en = {
      name: 'Wally', open: 'Open Wally the whale', close: 'Close', level: 'Lv.', xp: 'XP', food: 'Food',
      tasks: '{n} tasks together', pets: 'Petted {n} times', pet: 'Pet ♥', feed: 'Feed 🐟',
      'stage.egg': 'Mystery egg', 'stage.baby': 'Baby whale', 'stage.cool': 'Cool whale', 'stage.legend': 'Legendary whale',
      'mood.idle': 'Swimming around', 'mood.working': 'Working with you', 'mood.alert': 'Needs your attention!',
      'mood.happy': 'Task done, splash!', 'mood.hungry': 'Hungry', 'mood.sleepy': 'Asleep',
      'event.levelUp': 'Level up! Now Lv.{n}', 'event.hatch': 'Crack... Wally hatched!', 'event.full': 'Burp, too full',
      'event.fed': 'Yum! Thanks for the fish', 'event.petted': 'Hehe, that feels nice',
      'quip.egg.0': 'Something is moving inside... finish a task to hatch it.', 'quip.egg.1': 'Tap, tap. Sounds like typing.', 'quip.egg.2': 'A warm egg. It seems to be listening in.',
      'quip.idle.0': 'Let us write bug-free code today!', 'quip.idle.1': 'Swimming around the sea of tokens.', 'quip.idle.2': 'Throw me a task anytime.',
      'quip.working.0': 'Blub blub, the agent is thinking hard...', 'quip.working.1': 'I am keeping an eye on progress.', 'quip.working.2': 'Tool call after tool call, go go go!',
      'quip.alert.0': 'The agent is waiting for you!', 'quip.alert.1': 'A decision needs your call.', 'quip.alert.2': 'Ding! Your turn.',
      'quip.happy.0': 'Pffft, task done, time to celebrate!', 'quip.happy.1': 'Another one done. Great team.', 'quip.happy.2': '+10 XP, feeling stronger!',
      'quip.hungry.0': 'My tummy is rumbling... a fish, maybe?', 'quip.hungry.1': 'Too hungry to swim.', 'quip.hungry.2': 'Fish... want fish...',
      'quip.sleepy.0': 'Zzz... dreaming of being a giant whale...', 'quip.sleepy.1': 'Zzz... (poke me to wake up)', 'quip.sleepy.2': 'Zzz... build passed...',
    };

    return {
      inject: ['slots', 'locale'],
      model,
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'whale-pet: dictionaries');
        const bound = ctx.locale.bind(NS);

        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/dsh-whale-pet';
          tag.textContent = css;
          document.head.appendChild(tag);
          return () => tag.remove();
        }, 'whale-pet: styles');

        // One pet shared by every session view on this page; progress survives reloads.
        const listeners = new Set();
        let state = initial;
        try { state = revive(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null'), Date.now()); } catch { state = revive(null, Date.now()); }
        const store = {
          get: () => state,
          subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
          apply(step) {
            const result = step(state);
            if (result.state !== state) {
              state = result.state;
              try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked: keep the in-memory pet */ }
              listeners.forEach((listener) => listener());
            }
            return result;
          },
        };

        function useTimeouts() {
          const ids = React.useRef(new Set());
          React.useEffect(() => () => { ids.current.forEach((id) => clearTimeout(id)); ids.current.clear(); }, []);
          return React.useCallback((fn, ms) => {
            const id = setTimeout(() => { ids.current.delete(id); fn(); }, ms);
            ids.current.add(id);
          }, []);
        }

        function WhalePet(props) {
          const { sessionId, useSessionStatus } = props;
          const t = typeof props.t === 'function' ? props.t : bound;
          const fmt = (key, n) => t(key).replace('{n}', String(n));
          const pet$ = React.useSyncExternalStore(store.subscribe, store.get, store.get);
          const running = useSessionStatus((s) => (sessionId === undefined ? false : s.get(sessionId)?.running === true));
          const pending = useSessionStatus((s) => (sessionId === undefined ? undefined : s.get(sessionId)?.pendingInteraction?.kind));
          const later = useTimeouts();

          const [open, setOpen] = React.useState(false);
          const [celebrating, setCelebrating] = React.useState(false);
          const [sleepy, setSleepy] = React.useState(false);
          const [hearts, setHearts] = React.useState([]);
          const [flash, setFlash] = React.useState(null);
          const [seed, setSeed] = React.useState(0);
          const [now, setNow] = React.useState(() => Date.now());
          const [wake, setWake] = React.useState(0);
          const buttonRef = React.useRef(null);
          const cardRef = React.useRef(null);
          const wasRunning = React.useRef(running);

          const announce = (result) => {
            if (result.hatched) setFlash(t('event.hatch'));
            else if (result.leveledUp) setFlash(fmt('event.levelUp', levelOf(result.state.xp)));
            if (result.hatched || result.leveledUp) later(() => setFlash(null), 4000);
          };

          // A running → idle edge without a pending question is a finished turn.
          React.useEffect(() => {
            const finished = wasRunning.current && !running && pending === undefined;
            wasRunning.current = running;
            if (!finished || sessionId === undefined) return;
            const result = store.apply((s) => award(s, String(sessionId), Date.now()));
            if (result.ignored) return;
            setCelebrating(true);
            later(() => setCelebrating(false), 3500);
            announce(result);
          }, [running, pending, sessionId]);

          // Doze off after a quiet stretch; any activity or poke wakes the whale up.
          React.useEffect(() => {
            setSleepy(false);
            if (running || pending !== undefined) return undefined;
            const id = setTimeout(() => setSleepy(true), SLEEP_AFTER);
            return () => clearTimeout(id);
          }, [running, pending, wake]);

          // Hunger is time-based; refresh it once a minute.
          React.useEffect(() => {
            const id = setInterval(() => setNow(Date.now()), 60 * 1000);
            return () => clearInterval(id);
          }, []);

          React.useEffect(() => {
            if (!open) return undefined;
            const onPointer = (event) => {
              if (cardRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return;
              setOpen(false);
            };
            const onKey = (event) => { if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); } };
            document.addEventListener('pointerdown', onPointer, true);
            document.addEventListener('keydown', onKey, true);
            return () => {
              document.removeEventListener('pointerdown', onPointer, true);
              document.removeEventListener('keydown', onKey, true);
            };
          }, [open]);

          const satiety = satietyOf(pet$, now);
          const stage = stageOf(pet$);
          const mood = moodOf({ pending: pending !== undefined, running, celebrating, sleepy, satiety });
          const level = levelOf(pet$.xp);
          const floor = xpForLevel(level);
          const xpProgress = ((pet$.xp - floor) / (xpForLevel(level + 1) - floor)) * 100;
          const quip = flash ?? t('quip.' + (stage === 'egg' && mood === 'idle' ? 'egg' : mood) + '.' + (seed % quips));

          const poke = () => {
            setWake((n) => n + 1);
            setSeed((n) => n + 1);
            const id = Date.now();
            setHearts((list) => [...list.slice(-4), id]);
            later(() => setHearts((list) => list.filter((x) => x !== id)), 1000);
            announce(store.apply((s) => pet(s, Date.now())));
          };
          const giveFish = () => {
            setWake((n) => n + 1);
            const result = store.apply((s) => feed(s, Date.now()));
            setNow(Date.now());
            setFlash(t(result.refused ? 'event.full' : 'event.fed'));
            later(() => setFlash(null), 2500);
            if (!result.refused) announce(result);
          };
          const toggle = () => {
            setWake((n) => n + 1);
            setSeed((n) => n + 1);
            setNow(Date.now());
            setOpen((v) => !v);
          };

          const label = t('name') + ' · ' + t('mood.' + mood);
          const rect = open ? buttonRef.current?.getBoundingClientRect() : undefined;
          const card = open && rect ? h('div', {
            ref: cardRef, className: 'wp-card', role: 'dialog', 'aria-label': t('name'),
            style: { top: rect.bottom + 8, left: Math.max(8, Math.min(rect.right - 272, window.innerWidth - 280)) },
          },
            h('div', { className: 'wp-pond', onClick: poke, title: t('pet') },
              h(Stage, { stage, mood, hearts, flash: flash !== null, scale: 6 })),
            h('div', { className: 'wp-body' },
              h('div', { className: 'wp-title' },
                h('span', { className: 'wp-name' }, t('name')),
                h('span', { className: 'wp-level' }, t('level') + level + ' · ' + t('stage.' + stage))),
              h('p', { className: 'wp-quip', role: 'status' }, quip),
              h('div', { className: 'wp-row' }, h('span', null, t('xp')), h(Bar, { value: xpProgress, tone: 'xp', label: t('xp') }), h('b', null, pet$.xp)),
              h('div', { className: 'wp-row' }, h('span', null, t('food')), h(Bar, { value: satiety, tone: 'food', label: t('food') }), h('b', null, Math.round(satiety) + '%')),
              h('div', { className: 'wp-stats' }, h('span', null, fmt('tasks', pet$.tasks)), h('span', null, fmt('pets', pet$.pets))),
              h('div', { className: 'wp-actions' },
                h('button', { type: 'button', onClick: poke }, t('pet')),
                h('button', { type: 'button', onClick: giveFish }, t('feed'))))) : null;
          // Portal to the page root like shipped popovers, so header clipping or transforms never trap the card.
          const layer = card === null ? null : ReactDOM.createPortal(card, document.body);

          return h(React.Fragment, null,
            h('button', {
              ref: buttonRef, type: 'button', className: 'wp-trigger', onClick: toggle,
              'aria-label': label, title: label, 'aria-expanded': open, 'aria-haspopup': 'dialog',
            }, h(Stage, { stage, mood, hearts, flash: flash !== null, scale: 2 })),
            layer);
        }

        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'whale-pet',
          order: -20,
          locale: NS,
          label: () => bound('name'),
        }, WhalePet));
      },
    };
  },
});
