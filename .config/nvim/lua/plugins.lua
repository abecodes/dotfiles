-- ============================================================
-- Plugin spec schema reference
-- ============================================================
-- Required:
--   src       = 'https://...' | '/abs/path' | '~/path'   plugin URL or local
--                                                         checkout
--
-- Optional:
--   name      = 'foo'                              override auto-derived name
--   version   = 'tag-or-branch'                    vim.pack version pin
--
-- Dependencies (slugs matched against another spec's src):
--   requires  = { 'owner/repo', ... }              hard — log.error if missing, continues
--   wants     = { 'owner/repo', ... }              soft — log.warn if missing
--   after     = { 'owner/repo', ... }              order-only — log.error if missing, continues
--
-- Lazy triggers (all optional, all combinable — plugin loads on FIRST fire):
--   ft        = { 'go', 'typescriptreact', ... }   FileType match
--   on_event  = { 'BufReadPre', 'LspAttach' }      matching autocmd event
--   on_init   = true                               VimEnter + vim.schedule
--   on_cmd    = { 'Telescope', 'Neogit' }          stub user command(s)
--                                                    (args/bang/range/mods preserved)
--   on_key    = { '<leader>dD', '""' }             first key press; each entry
--                                                    is a string (normal mode)
--                                                    or { mode = 'v', lhs = … }.
--                                                    Stubs carry no desc.
--             = true                                auto-discover from
--                                                    `lua/plugins/<name>/keys.lua`.
--                                                    Stubs carry `opts.desc`
--                                                    so which-key / :map show
--                                                    labels pre-load. setup.lua
--                                                    imports the same file to
--                                                    register the real keymaps —
--                                                    one source of truth.
--
-- A spec with no lazy field inherits laziness from its reverse-deps when all
-- rdeps are lazy. See lua/pack/ARCHITECTURE.md → "Lazy propagation".
--
-- Force-eager opt-out:
--   eager     = true                               skip propagation; stay
--                                                    eager even if every rdep
--                                                    is lazy
--
-- Post-install hook:
--   install_command
--     = 'COQdeps'    → ex command via vim.schedule (packadd-first if lazy)
--     = { 'make' }   → external process via proc.run_async, cwd = install path
--
-- See lua/pack/ARCHITECTURE.md for the full pipeline (phase ordering,
-- propagation rules, stub semantics, maintenance hash gating).
-- ============================================================

-- NOTE: nvim-treesitter is replaced by the in-tree `lua/treesitter/` module
-- (see lua/treesitter/init.lua — loaded from the top-level init.lua before
-- this file). Plugins that historically declared
-- `requires = { 'nvim-treesitter/nvim-treesitter' }` or the `wants` variant
-- have that entry removed — the runtime `require('nvim-treesitter')` is
-- satisfied by lua/treesitter/shim/nvim-treesitter.lua via package.preload.

-- nvim-dap / nvim-dap-ui share a single source of truth at
-- `plugins/nvim-dap/keys.lua`; `plugins/nvim-dap-ui/keys.lua` re-exports
-- it so both specs' `on_key = true` resolve to identical trigger
-- bundles. See lua/pack/ARCHITECTURE.md → "Lazy propagation".

local plugins = {
  -- devicons (pinned to nerd-v2-compat tag; eager because lua/winbar/winbar.lua
  -- requires it at startup via init.lua, outside the plugin dep graph)
  { src = 'https://github.com/nvim-tree/nvim-web-devicons', version = 'nerd-v2-compat', eager = true },

  -- shared dependencies
  'https://github.com/nvim-lua/plenary.nvim',
  'https://github.com/nvim-lua/popup.nvim',
  'https://github.com/nvim-neotest/nvim-nio',

  -- Editor components
  'https://github.com/mhinz/vim-startify',
  'https://github.com/liuchengxu/vim-which-key',
  {
    src    = 'https://github.com/mbbill/undotree',
    on_cmd = { 'UndotreeToggle', 'UndotreeShow', 'UndotreeHide', 'UndotreeFocus' },
    on_key = true,
  },
  { src = 'https://github.com/folke/todo-comments.nvim', requires = { 'nvim-lua/plenary.nvim' }, on_event = { 'BufReadPost' } },
  {
    src      = 'https://github.com/folke/trouble.nvim',
    requires = { 'nvim-tree/nvim-web-devicons' },
    on_cmd   = { 'Trouble' },
    on_key   = true,
  },
  { src = 'https://github.com/sindrets/diffview.nvim',   wants = { 'nvim-tree/nvim-web-devicons' }, on_cmd = { 'DiffviewOpen', 'DiffviewFileHistory', 'DiffviewClose', 'DiffviewFocusFiles', 'DiffviewRefresh', 'DiffviewToggleFiles' } },
  { src = 'https://github.com/gennaro-tedesco/nvim-peekup', on_key = true },
  {
    src      = 'https://github.com/NeogitOrg/neogit',
    requires = {
      'nvim-lua/plenary.nvim',
      'nvim-telescope/telescope.nvim',
      'sindrets/diffview.nvim',
    },
    on_cmd   = { 'Neogit' },
    on_key   = true,
  },

  -- Editor visuals
  'https://github.com/machakann/vim-sandwich',
  -- NOTE: on_event = {'InsertEnter'} — could move to on_init if first-keystroke feels sluggish
  { src = 'https://github.com/windwp/nvim-autopairs',               after = { 'ms-jpq/coq_nvim' }, on_event = { 'InsertEnter' } },
  { src = 'https://github.com/lukas-reineke/indent-blankline.nvim', after = { 'hiphish/rainbow-delimiters.nvim' }, on_event = { 'BufReadPost' } },
  { src = 'https://github.com/andymass/vim-matchup',                on_event = { 'BufReadPost' } },

  -- Project
  { src = 'https://github.com/lewis6991/gitsigns.nvim', requires = { 'nvim-lua/plenary.nvim' }, on_event = { 'BufReadPre' } },

  -- Search
  {
    src      = 'https://github.com/nvim-telescope/telescope.nvim',
    requires = {
      'nvim-lua/popup.nvim',
      'nvim-telescope/telescope-symbols.nvim',
      'nvim-telescope/telescope-file-browser.nvim',
      'nvim-telescope/telescope-fzf-native.nvim',
    },
    wants    = { 'nvim-lua/plenary.nvim' },
    on_cmd   = { 'Telescope' },
    -- Keymaps live in plugins/telescope/keys.lua — auto-discovered by
    -- the loader for stubs (with desc) and imported by setup.lua for
    -- real registration post-load.
    on_key   = true,
  },
  'https://github.com/nvim-telescope/telescope-symbols.nvim',
  'https://github.com/nvim-telescope/telescope-file-browser.nvim',
  { src = 'https://github.com/nvim-telescope/telescope-fzf-native.nvim', install_command = { 'make' } },
  {
    src    = 'https://github.com/MagicDuck/grug-far.nvim',
    on_cmd = { 'GrugFar', 'GrugFarWithin' },
    on_key = true,
  },

  -- Writing / reading
  {
    src    = 'https://github.com/renerocksai/telekasten.nvim',
    wants  = { 'nvim-lua/plenary.nvim', 'nvim-telescope/telescope.nvim' },
    on_cmd = { 'Telekasten' },
    on_key = true,
  },

  -- Documentation
  { src = 'https://github.com/danymat/neogen', on_cmd = { 'Neogen' }, on_key = true },

  -- Comments

  -- Motion
  { src = 'https://codeberg.org/andyg/leap.nvim', requires = { 'tpope/vim-repeat' } },
  'https://github.com/tpope/vim-repeat',
  {
    src      = 'https://github.com/abecodes/tabout.nvim',
    after    = { 'ms-jpq/coq_nvim' },
    on_event = { 'InsertEnter' },
  },

  -- LSP / Treesitter
  -- nvim-treesitter is GONE (archived upstream) — replaced by the in-tree
  -- `lua/treesitter/` module. See its init.lua + the README/plan for details.
  -- ts-context-commentstring: no rdeps after treesitter removal, stays eager by
  -- default (propagate_lazy leaves rootless specs alone). Its setup() call
  -- lives at lua/plugins/nvim-ts-context-commentstring/setup.lua.
  { src = 'https://github.com/JoosepAlviste/nvim-ts-context-commentstring' },
  { src = 'https://github.com/hiphish/rainbow-delimiters.nvim', on_event = { 'BufReadPost' } },
  'https://github.com/windwp/nvim-ts-autotag',
  { src = 'https://github.com/ray-x/lsp_signature.nvim',    on_event = { 'LspAttach' } },
  { src = 'https://git.sr.ht/~whynothugo/lsp_lines.nvim',   on_event = { 'LspAttach' } },  -- non-GitHub source
  {
    src    = 'https://github.com/nvim-treesitter/nvim-treesitter-context',
    on_key = true,
  },
  -- NOTE: on_event = {'InsertEnter'} — could move to on_init if first-keystroke feels sluggish
  {
    src             = 'https://github.com/ms-jpq/coq_nvim',
    version         = 'coq',
    requires        = { 'ms-jpq/coq.artifacts' },
    on_event        = { 'InsertEnter' },
    install_command = 'COQdeps',
  },
  { src = 'https://github.com/ms-jpq/coq.artifacts', version = 'artifacts' },
  {
    src    = 'https://github.com/ThePrimeagen/refactoring.nvim',
    wants  = { 'nvim-lua/plenary.nvim', 'nvim-telescope/telescope.nvim' },
    on_cmd = { 'Refactor' },
    on_key = true,
  },

  -- Debugging
  {
    src    = 'https://github.com/mfussenegger/nvim-dap',
    on_key = true,
  },
  {
    src      = 'https://github.com/rcarriga/nvim-dap-ui',
    requires = { 'nvim-neotest/nvim-nio' },
    wants    = { 'mfussenegger/nvim-dap' },
    -- plugins/nvim-dap-ui/keys.lua re-exports plugins/nvim-dap/keys.lua so
    -- both specs share an identical trigger bundle — keeps propagate_lazy
    -- from promoting either to on_init.
    on_key   = true,
  },
  {
    src    = 'https://github.com/nvim-telescope/telescope-dap.nvim',
    wants  = { 'mfussenegger/nvim-dap', 'nvim-telescope/telescope.nvim' },
    -- Loads on first use of the telescope-dap picker keys, which register as
    -- real mappings in setup.lua (after `telescope.load_extension('dap')`).
    -- Trade-off: `:Telescope dap <subcmd>` typed manually before any of these
    -- keys have fired will fail — any telescope-dap use in practice is inside
    -- a debugging session, so the key press is a natural trigger.
    on_key = true,
  },

  -- Theme
  'https://github.com/atelierbram/Base2Tone-nvim',

  -- ft-lazy: installed only, loaded on FileType event
  { src = 'https://github.com/maxmellon/vim-jsx-pretty', name = 'vim-jsx-pretty', ft = { 'javascriptreact', 'typescriptreact', 'html' } },
  { src = 'https://github.com/mattn/emmet-vim',          name = 'emmet-vim',      ft = { 'javascriptreact', 'typescriptreact', 'html' } },
}

-- Profile-specific plugin extras: append `lua/plugins_<profile>.lua` (if it
-- exists) to the manifest before dep resolution. See README "Profiles".
-- fs_stat-then-require (not pcall) so syntax errors in the overlay surface.
local profile_name = require('profile').current
local extras_path = vim.fn.stdpath('config') .. '/lua/plugins_' .. profile_name .. '.lua'
if vim.uv.fs_stat(extras_path) then
  vim.list_extend(plugins, require('plugins_' .. profile_name))
end

require('pack.loader').setup(plugins, {
  cli_deps = {
    { cmd = 'tree-sitter', req = 'lua/treesitter', hint = 'npm install -g tree-sitter-cli' },
  },
})
