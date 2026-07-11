# `pack.loader` — architecture

Thin lazy-loading layer on top of Neovim's built-in `vim.pack`. The manifest
lives in `lua/plugins.lua`; this document explains **how** the loader turns
that manifest into installed, lazily-triggered plugins.

For the spec schema (fields, types, examples), see the header comment of
`lua/plugins.lua`.

---

## Overview — the 9 phases

`require('pack.loader').setup(plugins, opts)` runs the full pipeline in a
fixed order. Each phase assumes the previous one completed.

1. **CLI dep advisory** — warn if tools named in `opts.cli_deps` are missing.
2. **Validate → topo-sort → propagate lazy** — build the dep index,
   validate references, reorder so deps come before dependents, then decide
   which plugins stay eager vs. become lazy.
3. **Install-hook dispatcher** — register the `User PackChanged` autocmd so
   `install_command` runs when vim.pack installs/updates a plugin.
4. **Config pass** — `require('plugins.<name>.config')` for **every** plugin
   (eager or lazy). Configs set globals that plugins read on load, so they
   must exist pre-load regardless of when load happens.
5. **Install phase** — `vim.pack.add(eager, { load = true })` then
   `vim.pack.add(lazy, { load = function() end })`. Local specs (absolute
   or `~` path) are `rtp:prepend`ed and skip vim.pack entirely.

   The lazy variant **must** use the no-op callable, not `load = false`.
   `false` maps to `:packadd!`, which adds the plugin's path to rtp at
   install time; Neovim then auto-sources
   `pack/*/opt/<name>/plugin/*.lua` for paths added during init at the
   `vim_did_enter` 0→1 transition. The callable form short-circuits
   inside vim.pack before `:packadd` runs (`runtime/lua/vim/pack.lua` —
   `pack_add` returns early on callable `load`), so the path is never
   added to rtp until `load_plugin` issues the real `:packadd` on
   trigger fire. Without this, any plugin whose `plugin/*` file does
   real work (e.g. nvim-treesitter-context's `plugin/treesitter-context.lua`
   calls `require('treesitter-context').setup()`) silently pre-empts the
   user's `setup.lua` for every fresh buffer until the first trigger
   fires.
6. **Maintenance gating** — hash the manifest; if it changed, schedule a
   `UIEnter` once-autocmd to run src-reconcile + prune, and always register
   `:PackSync` for manual invocation.
7. **Eager setup pass** — `require('plugins.<name>.setup')` for non-lazy
   plugins only. Lazy plugins run setup from inside `load_plugin`.
8. **Lazy loader closure** — build `load_plugin(spec)` which recurses into
   lazy deps first, then `packadd`s the target, then runs its setup.
9. **Trigger wiring** — register autocmds / user commands / keymaps that
   call `load_plugin` on first fire.

---

## Dependency resolution

Three dep fields with different severity and purpose:

| Field      | Missing dep behavior    | Load order | Participates in propagation |
|------------|--------------------------|------------|------------------------------|
| `requires` | `log.error`, continue    | Yes        | Yes                          |
| `wants`    | `log.warn`, continue     | Yes        | Yes                          |
| `after`    | `log.error`, continue    | Yes        | Yes                          |

All three are flattened by `collect_deps` and treated the same by topo-sort
and propagation. The semantic distinction is purely about log severity.

All misconfigurations are logged in a single pass so the user sees every
issue without restarting; the loader never aborts. `:checkhealth pack.loader`
surfaces the same diagnostics post-startup. Note: use the full name
`pack.loader` — `:checkhealth pack` also triggers builtin `vim.pack`,
whose check spawns one `git` subprocess per plugin and is slow.

### Index — first-match-wins

`build_dep_index(plugins)` indexes each spec by every `'/'`-terminated
suffix of its `src`:

```
src = 'https://github.com/nvim-lua/plenary.nvim'
→ keys: 'github.com/nvim-lua/plenary.nvim',
        'nvim-lua/plenary.nvim',
        'plenary.nvim'
```

A dep slug like `'nvim-lua/plenary.nvim'` is an O(1) table lookup. **First
match wins** when two specs share a trailing suffix, preserving the
prior-art linear-scan semantics.

### Topo sort

DFS with in-progress / done marks. Cycles log a warning and break out
(the partial order is still valid for the non-cyclic subgraph). After
reordering, the index is rebuilt because first-match-wins output is
order-sensitive.

---

## Lazy propagation

A plugin is **lazy** if it declares any of `ft`, `on_event`, `on_init`,
`on_cmd`, `on_key`. Plugins without a lazy field inherit laziness from
their reverse-deps according to four rules:

1. **No rdeps** → stay eager (root).
2. **All rdeps lazy, identical trigger bundle** → propagate lazy (the
   plugin loads when its rdep loads; no own trigger needed).
3. **All rdeps lazy, mixed bundles** → propagate lazy **and** mark
   `needs_init` (VimEnter safety net), then warn. The rdep chains don't
   agree on a single trigger, so we load on VimEnter to guarantee the
   plugin is ready whichever rdep fires first.
4. **Any rdep eager** → stay eager. The eager dependent will reach out for
   this dep at startup — it must be on the rtp already.

> **Note on rule 3 (`on_init` promotion):** "promoted to `on_init`" means
> the plugin is loaded by the shared `VimEnter` once-autocmd via
> `vim.schedule` (see "Trigger wiring") — i.e. it loads at startup,
> just deferred past `init.lua`. This is **not** "lazy on user demand"
> like genuine `on_event`/`on_cmd`/`on_key`/`ft` triggers. The startup
> log line includes the explicit `(loads at VimEnter, not on user demand)`
> reminder, and `:checkhealth pack.loader` lists every promoted spec in
> its "lazy split" section. Avoid mixed-bundle rdep chains when you want
> a dep to load only on actual user interaction.

`eager = true` is an explicit opt-out: skip propagation regardless of
rdep status. Used for plugins that must be loaded at startup even though
all consumers are lazy (e.g. when their ftplugins race `FileType` on the
first buffer).

### Why `bundle_key` sorts

`bundle_key(spec)` produces a deterministic string from the LAZY_FIELDS
values so "identical trigger bundle" is a cheap string compare. List
entries are sorted before concatenation so `{ 'a', 'b' }` and
`{ 'b', 'a' }` map to the same key.

---

## Load phases and ordering

Why the phase order matters:

- **Config before install.** A plugin's `plugins/<name>/config.lua` often
  sets `vim.g.<plugin>_*` globals that the plugin reads at load time.
  Since lazy plugins load on a trigger that's wired up last, but eager
  plugins load inside `vim.pack.add(..., { load = true })`, configs must
  run for everyone **before** any install/load happens.
- **Install before eager-setup.** An eager plugin's setup will `require`
  the plugin module, which fails unless vim.pack has already added it to
  the rtp.
- **Eager-setup before trigger wiring.** Trigger wiring only fires for
  lazy specs. Eager plugins are fully operational before the first buffer
  is loaded.
- **`load_plugin` recurses deps before packadd.** A lazy plugin's lazy
  deps must be on the rtp before the plugin's own `setup.lua` runs (it
  may `require` them).

---

## `on_cmd` stubs — attr-set caveats

On first invocation, the stub removes itself, loads the plugin (which
re-registers the real command), then re-dispatches.

Nuances the dispatcher must handle:

- **`-range` vs `-count` are mutually exclusive** in Vim user commands
  (a numeric prefix parses as one OR the other, never both). We keep
  `range = true` so `:'<,'>Cmd` works at stub-time; `:5Cmd` count-prefix
  invocations are lost at the stub but work normally after the real
  command takes over.
- **`-register` is deliberately omitted.** With `-register` on, nvim eats
  the first whitespace-delimited arg char as a register name before the
  callback fires (`:JiraList mine` → register=`m`, args=`ine`, with no
  way to reconstruct). Register-prefixed invocations don't work at
  stub-time but do after the real command registers.
- **Narrowing to the real command's attrs.** The real command may accept
  a narrower set than the stub (e.g. no `range`). The dispatcher looks
  up the real command (buf-local first, then global) and only forwards
  `bang` / `range` when the target actually accepts them, otherwise
  `vim.cmd` rejects with "Command cannot accept range: …".

---

## `on_key` stubs

On first press, the stub removes itself, loads the plugin (which defines
the real mapping), then feeds the key back via `nvim_feedkeys`.

### Two forms

`spec.on_key` accepts either a list or the literal `true`:

- **List form** — `on_key = { '<leader>dD', { mode = 'v', lhs = '<leader>tr' }, '""' }`.
  Each entry is a string (normal mode) or a `{ mode, lhs }` table.
  Stubs register **without** `desc`. Useful for plugins whose keymaps
  are registered by the plugin itself (not by our setup.lua) or for
  non-leader triggers that don't need labels (e.g. `nvim-peekup`'s
  `""`).

- **`true`** — auto-discover from `lua/plugins/<name>/keys.lua`.
  The loader reads the file at trigger-wiring time, iterates its
  entries, and registers a stub per `(mode, lhs)` with `desc` pulled
  from each entry's `opts.desc`. The same keys.lua is imported by the
  plugin's `setup.lua` and handed to `utils.keys.register` to wire the
  real keymaps after load. Single source of truth — no drift between
  lazy triggers and real registrations.

### `keys.lua` shape

```lua
-- lua/plugins/<name>/keys.lua
return {
  { mode = 'n', lhs = '<leader>tf', rhs = "<cmd>Telescope find_files<CR>", opts = { desc = 'File in pwd' } },
  { mode = { 'n', 'v' }, lhs = '<leader>tr', rhs = "...", opts = { desc = 'Refactor' } },
  ...
}
```

Entries accept the exact fields `utils.keys.register` takes. `mode`
may be a string or a list (the loader fans out one stub per mode).
`opts.desc` is the only field the loader consults; the rest is used
only by setup.lua.

### Why stubs carry desc

`plugins.vim-which-key.whichkey.rebuild()` walks `nvim_get_keymap('n')`/`('v')` on every
`<leader>` press and filters by `m.desc ~= ''`. With desc on the stubs,
which-key surfaces labels for lazy plugins **before first load** — the
widget shows `+telescope` with all its subkeys the first time you press
`<leader>`, without telescope having been packadded. On first press of
any concrete key, the stub fires normally: plugin loads, setup.lua
re-registers the real (identically-labeled) keymap, feedkeys replays.

### Other caveats

- **Leader resolution is manual.** `nvim_replace_termcodes` does **not**
  expand `<leader>` / `<localleader>`. The plugin's real mapping is
  stored post-substitution (using whatever `vim.g.mapleader` resolves to),
  so the stub must run the same substitution before feeding or the real
  mapping won't match.
- **Last-writer-wins for duplicated `(mode, lhs)`.** Two specs can
  register a stub on the same key; `vim.keymap.set` keeps only the last
  registration. See nvim-dap / nvim-dap-ui in `lua/plugins.lua`: both
  declare `on_key = true`, and `lua/plugins/nvim-dap-ui/keys.lua`
  re-exports `lua/plugins/nvim-dap/keys.lua` so the two specs produce
  identical `bundle_key`s for propagation. At runtime only dap-ui's
  stub fires (later iteration wins); it loads dap-ui, which pulls in
  nvim-dap via `wants`, and nvim-dap's setup.lua registers the real
  keymaps.
- **Missing `keys.lua`.** `on_key = true` with no `lua/plugins/<name>/keys.lua`
  resolves to no stubs — the loader gates on `has_file(name, 'keys')`
  and emits `log.warn` at startup. The spec still counts as lazy for
  `is_lazy_spec` / `bundle_key`, so propagation treats it correctly —
  but the plugin won't actually load on any key press. A syntax error
  inside `keys.lua`, by contrast, propagates as a hard error at startup
  (intentional — it's a real bug, not a missing file).

---

## Trigger wiring — one autocmd per spec

Each spec gets its own autocmd (for `on_event` and `ft`), not a shared
one. Otherwise a single `FileType = 'go'` event would load every
go-tagged spec in one shot, defeating per-plugin laziness. Every
autocmd uses `once = true` so the handler fires at most once — the
stub/autocmd is removed on first fire, and subsequent fires are the
plugin's own handlers.

---

## `PackChanged` dispatcher

`vim.pack` fires the `User PackChanged` autocmd after any install or
update with `ev.data = { kind, spec, path, active }`. Plugins opt in to
post-install work by setting `install_command` on their spec.

- **Keyed by `spec.src`** (not `plugin_name`) because `PackChanged`'s
  `d.spec.src`-derived label diverges from `plugin_name` for
  `.nvim` / `.vim`-suffixed repos without an explicit `spec.name`.
- **String `install_command`** → `vim.schedule`ed ex command. If
  `ev.data.active` is false (plugin not yet on rtp — first-install of
  any plugin, or a lazy plugin whose trigger hasn't fired), `packadd
  name` runs first so the command is defined. If active, skip `packadd`
  to avoid re-sourcing `plugin/` scripts. This mirrors the canonical
  pattern in `:h vim.pack-events`.
- **List `install_command`** → `proc.run_async` with `cwd = d.path` (the
  plugin's install directory). Exit code is logged; nothing else reacts
  to success/failure.
- **Any other type** → warn and skip.

---

## Maintenance hash gating

`vim.pack.get()` spawns a local git subprocess per plugin (~500 ms
cumulative), so we only pay it when the manifest changes.

- **Hash covers** `src`, `name`, `version`, and a JSON-encoded
  `install_command` for every spec. `install_command` must be in the
  hash: `PackChanged` only fires on install/update, so changing a
  post-install hook on an already-installed plugin would otherwise never
  re-run — the hash change forces a reconcile.
- **Storage:** `stdpath('state')/pack-spec-hash`. One-line file.
- **Trigger:** if `compute_spec_hash() ≠ read_prev_hash()`, register a
  `UIEnter` once-autocmd. Inside it, `vim.schedule(run_maintenance)` so
  the UI is up first. `:PackSync` runs the same body unconditionally for
  manual invocation.
- **`run_maintenance`** — reads `nvim-pack-lock.json` (in `stdpath('config')`),
  compares its `plugins[name].src` to the live spec's `src`, and calls
  `vim.pack.update` on any drift. Then prunes anything in
  `vim.pack.get()` with `active == false`. Each `update`/`del` call is
  `pcall`-wrapped so one bad plugin doesn't abort the rest.
- **Write-on-success only.** `write_hash` runs only if the full body
  returned without error. A transient failure retries on next startup.

---

## Local specs

`is_local(spec)` is true when `src` starts with `/` or `~`. Local specs:

- Skip `vim.pack.add` entirely (they aren't vim.pack packages).
- Are `rtp:prepend`ed in the install phase **only when eager**. Lazy
  local specs defer `rtp:prepend` and `plugin/`/`ftdetect/` sourcing
  to `load_plugin` via the `local_packadd` helper — same lazy contract
  as vim.pack-managed lazy plugins.
- Skip the regular `:packadd` call inside `load_plugin` (it would
  error — there is no `pack/*/opt/<name>` directory). Lazy ones use
  `local_packadd(vim.fn.expand(src))` instead; eager ones already had
  their `rtp:prepend` done in the install phase.
- Still participate in the config/setup pass and trigger wiring the same
  way as a regular spec.

Used for in-tree modules declared as plugins so they get the same
config/setup lifecycle — e.g. `jira` in `lua/plugins.lua` resolves to
`stdpath('config')` and points at `plugins/jira/{config,setup}.lua`.

### Lazy local specs

`local_packadd(path)` mimics `:packadd`:

1. `vim.opt.rtp:prepend(path)` — adds path to runtimepath.
2. Sources `plugin/*.lua` and `plugin/*.vim`.
3. Sources `ftdetect/*.{vim,lua}`.
4. If `vim.v.vim_did_enter == 1`, also sources `after/plugin/**/*.{vim,lua}`
   explicitly. (During startup, Neovim's own rtp scan picks these up
   from any path on rtp; once `vim_did_enter` is `1` we have to source
   them ourselves. Same pattern `vim.pack` uses internally — see the
   post-startup branch of `pack_add` in `runtime/lua/vim/pack.lua`.)

Combined with the install-phase guard (`if not lazy_set[src]` around
the eager `rtp:prepend`), lazy local specs are off the rtp at startup
and only become reachable when their trigger fires. `package.loaded`
stays empty for them until then.

**Note on local specs whose `src` is `stdpath('config')`:** the config
dir is unconditionally on rtp from the moment Neovim starts (before
init.lua runs), so `rtp:prepend(stdpath('config'))` is a no-op
regardless of laziness. The `local_packadd` machinery still adds value
for any `plugin/*` or `ftdetect/*` directory the spec ships, since
those are the things `:packadd` (and our equivalent) actually source.
For `lua/` modules, Lua's own require-on-demand semantics handle
laziness — a `lua/<modname>/` tree under `stdpath('config')` is reachable
via `package.path` as soon as Neovim starts, but no module is loaded
until something calls `require('<modname>')`, which only happens inside
the spec's `setup.lua` (and only when the trigger fires).

The current `jira` spec illustrates the steady state: `src ==
stdpath('config')`, no `plugin/*` files, all behaviour driven through
`plugins/jira/setup.lua`. `package.loaded['jira']` is `nil` at startup
and `:checkhealth pack.loader`'s lazy-leak section confirms it.
