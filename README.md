# 🐋 小鲸 · DSH Whale Pet

A pixel whale that lives in the session header (the `conversation.session.header.utilities` slot) and reacts to the agent:

| Agent state | What the whale does |
|---|---|
| Running | Swims fast and blows bubbles |
| Waiting on you (approval / question / plan review) | Jumps with a `!` |
| Turn finished | Spouts water, +10 XP (+15 when well fed) |
| Quiet for 3 minutes | Falls asleep (zzz) |
| Food below 20% | Thinks about 🐟 |

Click it to open a status card where you can **pet** it (+1 XP, at most once every 10s) or **feed** it (+25 food, +2 XP). Food drains 4 points per real-time hour.

Growth: 🥚 egg (hatches on the first finished task) → baby whale → cool whale with shades at Lv.5 → legendary whale with a crown at Lv.10.
Progress is saved in the browser's `localStorage` (`dsh-whale-pet:v1`).

## Development

```sh
../pnpm-with-node install
node --test               # model, lifecycle, and server-rendered mood tests
node preview.mjs && open preview.html   # every stage × mood, plus the card
```

## Install into the desktop app

```sh
R="/Applications/DeepSeek Harness.app/Contents/Resources/runtime"
cd ~/.dsh/profiles/desktop
DSH_DESKTOP_NODE_EXECUTABLE="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  "$R/bin/node" "$R/pnpm/bin/pnpm.mjs" add file:/Users/byronwayne/Desktop/DSH/whale-pet-plugin
```

Then enable `@local/dsh-whale-pet` in **Settings → Plugins**. The app hot-applies it.
Re-run the `pnpm add` after each source change (it installs a copy, not a link).

Rollback: disable it in Settings → Plugins, then run `pnpm remove @local/dsh-whale-pet` in the same directory (or restore `package.json.bak-before-whale-pet`).
