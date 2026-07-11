# Nvim

## 📦 Plugins

Plugin manager: Neovim's native `vim.pack`, wrapped by `lua/pack/loader.lua`
(lazy triggers, dep resolution, install hooks). See `## 📦 Package management`
below and `lua/pack/ARCHITECTURE.md` for the full pipeline. The manifest
lives in `lua/plugins.lua`.

```bash
# --- Shared deps
nvim-lua/plenary.nvim
nvim-lua/popup.nvim
nvim-neotest/nvim-nio

# --- Editor components
mhinz/vim-startify           # session / start screen
liuchengxu/vim-which-key     # leader hint popup (fed from keymap `desc` fields)
mbbill/undotree              # undo tree visualizer
folke/todo-comments.nvim     # TODO/FIXME highlighter + picker
folke/trouble.nvim           # diagnostic / quickfix list
sindrets/diffview.nvim       # diff / file-history UI
gennaro-tedesco/nvim-peekup  # register peek
NeogitOrg/neogit             # git UI

# --- Editor visuals
machakann/vim-sandwich               # surround text objects
windwp/nvim-autopairs                # auto-close pairs (replaces pears.nvim)
lukas-reineke/indent-blankline.nvim  # indent guides
andymass/vim-matchup                 # extended %-matching

# --- Project
lewis6991/gitsigns.nvim  # gutter diff signs (replaces vim-signify)

# --- Search / replace
nvim-telescope/telescope.nvim
nvim-telescope/telescope-symbols.nvim
nvim-telescope/telescope-file-browser.nvim
nvim-telescope/telescope-fzf-native.nvim
MagicDuck/grug-far.nvim  # project-wide find & replace (replaces far.vim)

# --- Writing / docs
renerocksai/telekasten.nvim  # zettelkasten
danymat/neogen               # doc-comment generator (replaces vim-doge)

# --- Motion
codeberg.org/andyg/leap.nvim  # 2-char jump (replaces hop.nvim / clever-f)
tpope/vim-repeat
abecodes/tabout.nvim          # escape pairs with Tab

# --- Icons / theme
nvim-tree/nvim-web-devicons   # filetype icons
atelierbram/Base2Tone-nvim    # colorscheme (active: base2tone_lavender_dark)

# --- LSP / Treesitter / completion
# nvim-treesitter is GONE (archived upstream) — replaced by the in-tree
# `lua/treesitter/` module.
JoosepAlviste/nvim-ts-context-commentstring  # filetype-aware comment strings
hiphish/rainbow-delimiters.nvim              # rainbow brackets (replaces nvim-ts-rainbow)
windwp/nvim-ts-autotag                       # HTML/JSX auto-tag
nvim-treesitter/nvim-treesitter-context      # sticky context header
ray-x/lsp_signature.nvim                     # inline signature help
whynothugo/lsp_lines.nvim                    # virtual-line diagnostics
ms-jpq/coq_nvim                              # disabled (auto_start = false); kept loaded so `after`-chains for autopairs/tabout still get their event ordering. See `## ✨ Completion`.
ms-jpq/coq.artifacts                         # coq snippet artifacts (unused while coq is disabled)
ThePrimeagen/refactoring.nvim

# --- Debugging
mfussenegger/nvim-dap
rcarriga/nvim-dap-ui
nvim-telescope/telescope-dap.nvim

# --- Filetype-lazy
maxmellon/vim-jsx-pretty  # JSX  (loaded on react / html FileType)
mattn/emmet-vim           # emmet (loaded on react / html FileType)
```

## 🧩 In-tree modules

These live under `lua/` and are loaded directly from `init.lua` — not plugins.
Several replace plugins that used to be in the list above; others add
functionality that no plugin covered cleanly.

| Module                            | Purpose                                                                                                   |
|-----------------------------------|-----------------------------------------------------------------------------------------------------------|
| `lua/pack/`                       | Lazy-loading wrapper around `vim.pack`. See `lua/pack/ARCHITECTURE.md`.                                  |
| `lua/treesitter/`                 | Replaces archived `nvim-treesitter`; parser install, query loading, `nvim-treesitter` require-shim.      |
| `lua/winbar/`                     | Custom statusline + winbar (replaces `lightline.vim` / `barbar.nvim`). See `lua/winbar/ARCHITECTURE.md`. |
| `lua/lsp/`                        | LSP bootstrap on top of native `vim.lsp` (replaces `nvim-lspconfig`).                                    |
| `lua/completion/`                 | Multi-source completion (LSP + buffer + treesitter) with frecency reranking (replaces `coq_nvim`). See `lua/completion/architecture.md`. |
| `lua/frecency/`                   | Generic time-decay scoring core. Used by `lua/completion/` and the buffer picker.                       |
| `lua/ui/`                         | Float primitives + `vim.ui.input` / `vim.ui.select` replacements (replaces `dressing.nvim`).             |
| `lua/notes/`                      | Per-branch / per-project notes + todos + sticky in-window bar.                                           |
| `lua/jira/`                       | Native Jira picker (`:JiraList`, `:JiraOpen`) with Telescope.                                            |
| `lua/pde/`                        | Project-dev-env rules (EOL / tabstop / file header) + lang helpers (Go) + project rooter.                |
| `lua/theme/`, `lua/theme_overwrites/` | Palette + per-colorscheme override dispatcher.                                                       |
| `lua/hooks/`                      | Generic event-bucket system backing the PDE rules.                                                       |

## 🎭 Profiles

The config is shared between machines (e.g. personal + work) from one branch.
Profile-aware loading lets each machine pick up its own extras and overrides
without per-machine git branches. The current profile is read from
`NVIM_PROFILE` (defaults to `private`) and exposed by `lua/profile.lua`:

```lua
local profile = require('profile')
profile.current             -- 'private' | 'work' | …
profile.is_enabled('work')  -- boolean
```

Set it per shell or in your shell rc on the machine that needs it:

```bash
NVIM_PROFILE=work nvim
```

### File conventions

Profile-suffixed files are picked up automatically. The suffix is the profile
name; files without a suffix are the baseline.

| Path                                       | Semantics    | Notes                                                |
|--------------------------------------------|--------------|------------------------------------------------------|
| `lua/plugins_<profile>.lua`                | append       | Returns a list of specs; concatenated to the manifest before dep resolution. |
| `lua/hooks_<profile>.lua`                  | deep-merge   | Returns the same `{ fileID → { event → hooks } }` tree; new entries added, matching ones concatenated. |
| `lua/plugins/<name>/config_<profile>.lua`  | replace      | Loaded *instead of* `config.lua` if present.        |
| `lua/plugins/<name>/setup_<profile>.lua`   | replace      | Loaded *instead of* `setup.lua` if present.         |
| `lua/plugins/<name>/keys_<profile>.lua`    | replace      | Loaded *instead of* `keys.lua` for stub registration and `auto_register_keys`. |

When you ship `keys_<profile>.lua`, the loader's stub registration and
`auto_register_keys` paths pick it up automatically. If your `setup.lua`
also imports the keys file manually for one-source-of-truth keymap registration,
ship a matching `setup_<profile>.lua` that imports the right variant — the
manual require path is not profile-aware.

### Examples

**Adding a work-only plugin** — `lua/plugins_work.lua`:

```lua
return {
  {
    src      = vim.fn.stdpath('config'),
    name     = 'jira',
    requires = { 'nvim-telescope/telescope.nvim' },
    on_cmd   = { 'JiraList', 'JiraOpen' },
    on_key   = true,
  },
}
```

**Adding a work-only Go hook** — `lua/hooks_work.lua` (deep-merged, so the
base `*.go` `BufWritePre` entries — `go.format` etc. — stay intact and the
copyright rule is appended):

```lua
return {
  ['*.go'] = {
    ['BufWritePre'] = {
      {
        func  = require('pde.rules.add_header')(
          '// Copyright Example Corp. All Rights Reserved.'),
        order = 99,
      },
    },
  },
}
```

**Profile-specific zettelkasten config** — `lua/plugins/telekasten/setup_work.lua`
(replaces `setup.lua` when `NVIM_PROFILE=work`):

```lua
require('telekasten').setup({
  home              = vim.fn.expand('~/work/notes'),
  template_new_note = vim.fn.expand('~/work/notes/templates/work.md'),
  -- … other work-specific settings
})
```

### Keeping machine-specific files out of git

`.gitignore` matches the suffix patterns by default, so dropping
`lua/plugins_work.lua` on the work machine never shows up in the diff against
the personal machine. Add an explicit `!` exception if you ever want a
profile variant to be checked in.

### Caveats

- Syntax errors in profile-suffixed files are **not** silently swallowed — the
  loader probes the path with `fs_stat` and then `require`s directly.
- A profile with no overrides is a valid state — no warning if `NVIM_PROFILE`
  is set but no suffix files exist.
- The profile is resolved once at startup; changing `NVIM_PROFILE`
  mid-session has no effect until restart.

## 📝 Notes & todo

Lightweight notes and todo system in `lua/notes/`, scoped per git branch and
per project. Files are plain markdown / plain text under a config-chosen
directory.

Keybindings (all under `<leader>p`):

| Key          | Action                          |
|--------------|---------------------------------|
| `<leader>pn` | Open branch notes (float)       |
| `<leader>pN` | Open project notes (float)      |
| `<leader>pt` | Add branch todo                 |
| `<leader>pT` | Add project todo                |
| `<leader>px` | Mark current todo done          |
| `<leader>pr` | Review branch todos             |
| `<leader>pR` | Review project todos            |
| `<leader>pd` | Generate doc comment (Neogen)   |

A 1-line sticky bar at the top of each window (`lua/notes/sticky.lua`) shows
the active todos. It is event-driven (BufEnter / WinScrolled / TodoChanged /
BufWritePost) and mtime-cached, so the hot path does no disk I/O.

## 🎫 Jira

Native Jira integration in `lua/jira/` — the only plugin it touches is
Telescope for the picker. Credentials come from env / config.

- `:JiraList` — run a saved JQL and pick an issue
- `:JiraOpen` — open a specific issue (key argument or under-cursor)

## 🪟 UI primitives

`lua/ui/` provides the shared float building blocks used by notes, Jira,
and the overrides of `vim.ui.input` / `vim.ui.select`. It replaces what
`dressing.nvim` used to do, in a style that matches the in-tree winbar.

| File                    | Role                                                   |
|-------------------------|--------------------------------------------------------|
| `ui/float.lua`          | Shared float opener, backdrop, scratch buffers         |
| `ui/common.lua`         | Cleanup / restore-caller helpers                       |
| `ui/input.lua`          | `vim.ui.input` replacement                             |
| `ui/select.lua`         | `vim.ui.select` replacement (small / large variants)   |
| `ui/picker.lua`         | Generic item picker                                    |
| `ui/live_select.lua`    | Filter-as-you-type list                                |
| `ui/textarea.lua`       | Multi-line editable float                              |
| `ui/float_badge.lua`    | Title / footer badge helpers                           |
| `ui/loading.lua`        | Spinner                                                |

## ✨ Completion

`lua/completion/` is a native multi-source completion stack that replaces
`coq_nvim`. It drives Vim's built-in popup menu via `vim.fn.complete()`
and merges three sources, ranking the result by frecency before it hits
the menu.

| Source     | What it pulls                                                        |
|------------|----------------------------------------------------------------------|
| LSP        | `textDocument/completion` from every attached client, plus side-popup docs via `completionItem/resolve` and snippet expansion via `vim.snippet`. |
| Buffer     | Keyword-regex scan of the current buffer.                            |
| Treesitter | Identifier-kind nodes when a parser is attached.                     |

Triggering is two-pronged: `InsertCharPre` fires on the LSP server's
declared trigger characters (`.`, `:`, etc.); a debounced `TextChangedI`
handler fires on plain prefix typing after 2+ keyword chars. Either path
snapshots the cursor, fans out to the sources, merges responses (deduping
by word, LSP wins), reranks via frecency, and pushes once.

The async-safety scaffolding — adaptive RTT debounce, cursor-snapshot
validation, request cancellation on next trigger, generation tokens to
drop stale callbacks — is cribbed directly from Neovim's runtime
`lua/vim/lsp/completion.lua`. A 1 s soft timeout keeps one slow LSP from
stalling the merged emit; late responses noop.

Frecency lives in `lua/frecency/` (a generic time-decay scoring core also
used by the buffer picker). Each accepted completion is recorded on
`CompleteDonePre`; subsequent triggers rerank candidates by decayed score.
Session-only — **cross-session persistence is a TODO**: the core's
`on_change` / `flush()` seams are already wired, but no persistence layer
hydrates them yet. See the TODO at the top of `lua/completion/frecency.lua`
for the sketch.

Coq is **disabled, not removed**: `vim.g.coq_settings.auto_start = false`
keeps the plugin off but still `packadd`'d, which preserves the
`after = { 'ms-jpq/coq_nvim' }` event-ordering chains for `nvim-autopairs`
and `tabout.nvim`. Flip `auto_start` back to `'shut-up'` in
`lua/plugins/coq_nvim/config.lua` to roll back.

Full design / data-flow / source breakdown / config reference / snippet
integration recipe: `lua/completion/architecture.md`.

## 📦 Package management

Plugins are installed by Neovim's built-in `vim.pack`. `lua/pack/loader.lua`
wraps it to add:

- Lazy triggers: `ft`, `on_event`, `on_cmd`, `on_key`, `on_init`
- Dependency resolution with three severities: `requires` / `wants` / `after`
- Propagation: a spec with no explicit lazy field inherits laziness from its
  reverse-deps when every rdep is lazy
- Per-plugin `config.lua` / `setup.lua` conventions at `lua/plugins/<name>/`
- Post-install hooks (external process or ex-command)
- `:PackSync` for manual reconciliation, gated by a manifest hash so it only
  runs when the spec changed

Full pipeline and phase ordering: `lua/pack/ARCHITECTURE.md`.
Spec schema (fields, examples): header of `lua/plugins.lua`.

## 📖 Resources

- [vim-galore](https://github.com/mhinz/vim-galore)
- [learn vim script](https://learnvimscriptthehardway.stevelosh.com)
- [awesome neovim](https://github.com/rockerBOO/awesome-neovim)
