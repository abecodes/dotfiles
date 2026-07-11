# usage-tracker

SQLite-backed usage tracking for pi. Records one row per LLM call in **every**
process — the top-level pi and every subagent at any depth — plus token savings
emitted by `lean-ctx`. The `/stats` command opens an interactive dashboard that
groups by timeframe / provider / model / agent.

See [DESIGN.md](./DESIGN.md) for the full design and rationale.

## What it does

- **`message_end` recorder** — every assistant message with `usage` becomes one
  `llm_usage` row (tokens, cost, provider, model, agent, depth, project). Fires
  in all run modes (tui / rpc / json / print), so subagent calls are captured
  automatically — the extension is global, so it loads in every spawned child.
- **`/stats` dashboard** — TUI-only. Horizontal stacked bars by model, with
  timeframe / metric / filter / scope / savings controls. In non-TUI modes the
  command just prints a notice; recording is unaffected.
- **Retention** — rows older than 2 years are pruned once per process at
  depth-0 `session_start`. The DB file size is shown once at startup.

## Storage

- **Path:** `${PI_CODING_AGENT_DIR:-~/.pi/agent}/usage.db` (global; aggregates
  across all projects and sessions).
- **Binding:** `node:sqlite` (`DatabaseSync`), WAL mode, `busy_timeout=5000` so
  concurrent writers (parent + N subagents) serialize instead of erroring.
- **Best-effort:** every store call is wrapped in try/catch and never throws
  into the agent loop. If `node:sqlite` is unavailable the store no-ops after a
  single debug log.

## Privacy

No prompt text, message content, or tool arguments are stored — only token
counts, costs, model/provider/agent labels, timestamps, and the recording
process's working directory (`cwd`) plus its resolved project root. `cwd` is
the only mildly sensitive field. Delete `usage.db` to reset all history.

## Dashboard keys

| Key | Action |
|---|---|
| `tab` / `shift+tab` | Cycle timeframe: today → 24h → 30d → 1y |
| `c` | Toggle bar metric: cost($) ↔ tokens (input+output) |
| `p` `m` `a` | Cycle the provider / model / agent filter |
| `u` | Toggle scope: global ↔ current project |
| `s` | Toggle the savings panel + ghost "saved" bar segment |
| `r` | Reset filters / metric / scope / timeframe to defaults |
| `q` / `esc` | Close |

## Cross-extension wiring

- `lean-ctx` calls `recordSavings()` from `updateSavedFooter`, tagging each row
  with the producing tool (`read` / `bash` / `ls` / `find` / `grep`).
- `subagent` sets `PI_SUBAGENT_NAME` on child spawn so child rows attribute to
  the agent that ran them. `PI_SUBAGENT_DEPTH` and `PI_USAGE_ROOT_SESSION` ride
  along via inherited env.
