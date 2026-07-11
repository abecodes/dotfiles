# command-runner

Runs user-authored orchestration scripts as `/<name>` slash commands. The plan
lives in deterministic code (a `.js` module); the model is invoked only at the
leaves via the injected `c` handle. The orchestration runs identically every
time; the agent/LLM/CLI *results* still vary.

See `DESIGN.md` for the rationale (especially the "Trust model" section on why
there is no `node:vm`) and `c-api.ts` for the typed `c` contract.

## Layout

```
~/.pi/agent/commands/          (user commands)
  package.json                 ← {"type":"module"} — written automatically (see below)
  <name>/
    index.js                   export default async (c, args) => string
    helpers.js?                optional ES module, importable by index.js
    <data files>?              optional static inputs read via c.read
<cwd>/.pi/commands/            (project commands — only when the project is trusted)
```

Each `<name>/index.js` becomes the slash command `/<name>`. User and project
commands are merged; **project wins on a name clash**.

## Authoring a command

```js
// ~/.pi/agent/commands/review-all/index.js
export default async (c, args) => {
  const targets = args.split(/\s+/).filter(Boolean);
  const findings = await c.map(targets, (t) =>
    c.agent({ agent: "reviewer", prompt: `Review ${t}` })
  );
  const synth = await c.agent({
    agent: "synth",
    prompt: `Combine:\n${findings.map((f) => f.text).join("\n---\n")}`,
  });
  return synth.text; // becomes the command's report
};
```

The `c` handle: `c.agent(req)`, `c.map(items, fn, {concurrency})`, `c.all(ps)`,
`c.bash(cmd, {cwd,timeoutMs})`, `c.read(path)`, `c.write(path, content)`,
`c.ask(params)`, `c.log(msg)`, `c.phase(name, fn)`, and `c.args`. See `c-api.ts`
for full signatures.

`c.agent` spawns are allow-list-gated exactly like the `subagent` tool's agents.
`c.bash`/`c.read`/`c.write` run as the (trusted) command process and are **not**
gated. `c.write` creates parent dirs. `c.ask` prompts the user with the same
questionnaire contract as the `ask_user_question` tool (reusing its dialog); in
a headless session it resolves to `{cancelled:true, error:"no_ui"}` instead of
throwing, so the command can fall back.
`c.map` is capped at 4 concurrent spawns (a per-call `concurrency` can lower but
not raise the cap).

## Result display

A command's report is delivered as a custom message rendered as a `✓ /<name>`
(or `✗` on failure) block — the body is exactly the string the command returned.
Activity is carried in the message details (not the body) and shown when you
expand the block (default `ctrl+o`):

- **Agents** — each `c.agent` call: ✓/✗, agent, tokens · cost · duration.
- **Steps** — the `c.log` lines and `c.phase` markers (`▶ name` / `✓ name (Nms)`),
  newest-bounded to keep the session entry small.
- **Calls** — a count of `c.bash` / `c.read` / `c.write` invocations (e.g.
  `3 shell · 2 reads · 5 writes`); their output isn't logged, only counted.

While the command runs, the same activity streams into a transient widget above
the editor (live per-agent rows, a done roll-up, the shell/read count, and the
latest log lines). The widget clears on completion; the expandable result block
is the durable record.

## Discovery & registration

On `session_start` and `resources_discover`, the extension scans the command
dirs and registers each `/<name>`. After `/commandify` writes a new command,
the skill queues `/reload` (which re-emits both events) so it appears the same
session.

## v0 limitations

- **ESM marker.** Command files load via native `import()`, and `export default`
  only parses as ESM when a `type:module` package.json is in scope. `~/.pi/agent`
  has none, so the runner writes `{"type":"module"}` into each commands root on
  discovery (idempotent; it never overwrites an existing package.json). If you
  keep your own package.json there, make sure it sets `"type": "module"`.

- **Picking up changes in-session.** Command scripts are imported with an
  mtime-based cache-buster, so **editing an existing command takes effect on its
  next run** — no restart. Caveats: (1) registering a brand-*new* command (so
  `/name` exists) happens during discovery on startup/`/reload`; if a new command
  doesn't appear after `/reload`, a full pi restart always picks it up. (2)
  Editing a *helper* module imported by `index.js` without touching `index.js`
  won't bust the cache (its mtime is unchanged) — touch `index.js` or restart.

- **Cancellation.** Command handlers don't reliably receive a usable
  `ctx.signal`, so a long synchronous command may not be Esc-cancellable.
  Acceptable for short fan-outs — it's the in-turn cost of having no background
  engine (a deliberate choice; see DESIGN.md). Revisit only if it bites.

- **`c.agent` requires a named `agent`.** The contract marks `agent` optional
  ("bare prompt on the default model"), but the v0 spawn path is agent-centric;
  a request without `agent` resolves to `ok:false` with a clear error rather than
  silently doing nothing.

## Files

- `index.ts` — discovery, registration, the run handler (widget, delivery,
  failure banner, truncation). Thin wiring; not unit-tested.
- `c.ts` — `createCommandApi(deps)`, the dep-injected `c` factory.
- `discover.ts` — pure command-dir scanning.
- `load.ts` — native dynamic import + default-export validation.
- `report.ts` — failure banner + truncation (dep-injected).
- `c-api.ts` — the typed `c` contract (source of truth for the API shape).

## Tests

```bash
cd ~/.pi/agent/extensions/command-runner
node --test --experimental-strip-types test/*.test.ts
```

All tests inject deps, so none spawn a real `pi` or shell out. They cover
discovery + project override, the `c` factory (map concurrency/order, all, bash,
read, log/phase tagging & timing), module loading (happy / no-default / throws),
and report finalization (failure banner + truncation).
