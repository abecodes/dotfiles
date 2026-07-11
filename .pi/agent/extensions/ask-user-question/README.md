# ask-user-question

Pi extension. Adds the `ask_user_question` tool — a tabbed dialog the model
can put to you instead of guessing, with single/multi-select questions,
side-by-side markdown previews next to options, and a Submit-tab review.

This is a lean rewrite of [`@juicesharp/rpiv-ask-user-question`][upstream]
v1.6.1. Same tool name, same input schema, byte-compatible response
envelope. Trimmed: ~3,000 lines of Redux-style state plumbing, the i18n
SDK, eight locale files, a five-file preview-pane split, per-option notes.
Added: looser input limits, expandable previews, more keys for tab
switching.

[upstream]: https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question

## Why a rewrite

The upstream package is 4,263 LOC across 41 TypeScript files for what is
fundamentally a select list with checkboxes and a markdown pane. The
state layer alone is 1,620 LOC of selectors, projections, derivations,
focus contracts, and "row intent" — for a state space of roughly
`{ activeTab, answers[], cursor, mode, previewScroll }`. Locales add
eight JSON files for 22 strings of UI chrome that English speakers never
see. None of it is load-bearing; all of it goes.

This rewrite is ~1,200 LOC of source + ~350 LOC of tests across 7 files.
Same features minus notes/locales, plus the things below.

## Override of the upstream tool

There's no built-in `ask_user_question` in pi core — the tool only exists
because `@juicesharp/rpiv-ask-user-question` registers it. Pi's extension
loader walks paths in this order:

1. `${cwd}/.pi/extensions/` (project-local)
2. `~/.pi/agent/extensions/` (global) ← we live here
3. Configured npm packages from `~/.pi/agent/settings.json`

… and the runner aggregates registered tools **first-wins**
(see `pi-coding-agent/dist/core/extensions/runner.js#getAllRegisteredTools`).
So our local extension shadows the npm rpiv package automatically. You
can leave the npm package installed; it just no-ops.

If you want to be tidy, remove `npm:@juicesharp/rpiv-ask-user-question`
from `settings.json#packages` and `pi install --refresh`.

## Features kept

- 1–4 questions per turn, 2–6 options per question.
- Single-select with `Type something.` free-text fallback and
  `Chat about this` abort row.
- Multi-select with checkboxes and a `Next →` sentinel to advance.
- Side-by-side markdown preview pane next to options that carry `preview`.
- Tabbed multi-question dialogs.
- Submit-tab review with warnings for unanswered questions.
- Reserved labels rejected at validation:
  `Other`, `Type something.`, `Chat about this`, `Next →`.
- Byte-compatible LLM envelope:
  `User has answered your questions: "Q"="A". You can now continue …`
  with `selected preview: …` segment when the chosen option had a preview.
  `User wants to chat about this. Continue the conversation to help them
  decide.` for `chat` picks.

## Features dropped

- Per-option notes (`n` key, `notes` field on answer). Removed entirely.
- Localization. English only; no `@juicesharp/rpiv-i18n` dependency.
- The `~/.config/rpiv-ask-user-question/config.json` override for
  `promptGuidelines`. Hardcoded paragraph in `tool.ts` instead.

## Features added

- **Looser input limits.** `header` is the only field with a hard cap
  (24 chars; was 16). `label`, `description`, `question`, `preview`:
  no cap. Long labels wrap.
- **Expandable preview.** Default side-by-side, truncated with
  `… N lines hidden (p to expand)` footer when content overflows.
  Press `p` to expand to fullscreen, scroll with `↑↓ / PgUp PgDn / j k`,
  press `p` or `Esc` to collapse.
- **Extra tab-switch keys.** `Tab` / `Shift-Tab` already worked upstream.
  We additionally bind `← / →`.
- **`optionsOnly` questions.** Set `optionsOnly: true` on a question to drop
  the `Type something.` and `Chat about this` rows, leaving only the authored
  options (plus `Esc` to cancel). For answers consumed programmatically —
  control flow, not LLM input — where a typed or chat-handoff answer is
  meaningless. No effect on multi-select (which already omits those rows). See
  `buildSentinelRows` in `tool.ts` for the single source of truth.

## Keymap

```
Tab / Shift-Tab     prev / next question tab
← / →               prev / next question tab (alt)
↑ / ↓               navigate option rows           (compact mode)
                    scroll preview                 (fullscreen preview)
PgUp / PgDn         scroll preview by page         (fullscreen preview)
j / k               scroll preview                 (fullscreen preview)
Space               toggle option (multi-select only)
Enter               select / activate sentinel / submit (on submit tab)
p                   toggle preview fullscreen      (when option has preview)
Esc                 cancel · exit fullscreen preview · exit "Other" editor
```

## Compatibility note: quiet-prompts.ts

`~/.pi/agent/extensions/quiet-prompts.ts` watches
`tool_execution_start` / `tool_execution_end` and silences pi's streaming
working indicator while a name in its `QUIET_TOOLS` set is running.
Without that, the indicator's ~120ms tick rerenders pi, which makes
terminals like Kitty snap scrollback to the bottom — preventing you
from scrolling up to read the model's prose preceding the dialog.

`quiet-prompts.ts` already includes `"ask_user_question"` in its set.
Because we register under the same name, it works as-is. Leave that
extension installed.

## Files

```
ask-user-question/
├── index.ts          extension entry; registers tool
├── tool.ts           schemas, validator, hardcoded guidelines, envelope
├── tool.test.mjs     node:test harness for tool.ts (44 tests)
├── dialog.ts         stateful dialog: tabs, key router, preview-mode state
├── option-list.ts    single+multi rows, sentinels, "Other" inline editor
├── preview.ts        compact + fullscreen preview, scroll, "N hidden" footer
└── submit-tab.ts     answer review + unanswered warnings + Submit/Cancel
```

No `node_modules`, no `package.json`. The test harness loads `tool.ts`
via jiti (shipped inside `@earendil-works/pi-coding-agent`) and uses
`node:test` + `node:assert/strict` — same pattern as
`subagent/test/spawn.test.ts` and `_shared/bash-parse.test.mjs`.

## Running tests

```bash
node ~/.pi/agent/extensions/ask-user-question/tool.test.mjs
```

37 tests covering the validator, the schema's only enforced cap (header
≤ 24 chars), and the byte-exact envelope format. The dialog and TUI
components are smoke-tested by hand in pi.

## License

MIT (matching upstream).
