local log = require('logger')

-- ============================================================
-- CLI dependency checks
-- To add a new check: append to the list below.
--   { cmd = 'binary-name', hint = 'how to install it' }
-- ============================================================
local cli_deps = {
  { cmd = 'tree-sitter', req = 'nvim-treesitter', hint = 'npm install -g tree-sitter-cli' },
}

for _, dep in ipairs(cli_deps) do
  if vim.fn.executable(dep.cmd) == 0 then
    log.warn('[vim.pack] missing CLI tool: `' .. dep.cmd .. '` (required by ' .. dep.req .. ')  →  ' .. dep.hint)
  end
end

-- ============================================================
-- Section 0: Post-install/update hooks (replaces packer `run`)
-- ============================================================
-- vim.pack fires User PackChanged after any install or update.
-- ev.data = { kind = "install"|"update"|"delete", spec, path, active }
vim.api.nvim_create_autocmd('User', {
  pattern = 'PackChanged',
  callback = function(ev)
    local d = ev.data
    if d.kind ~= 'install' and d.kind ~= 'update' then return end
    local name = d.spec.name or d.spec.src:match('[^/]+$')

    if name == 'coq_nvim' then
      log.log('[vim.pack] coq_nvim ' .. d.kind .. 'd — running :COQdeps', vim.log.levels.INFO)
      vim.schedule(function() vim.cmd('COQdeps') end)
    end

    if name == 'nvim-treesitter' then
      log.log('[vim.pack] nvim-treesitter ' .. d.kind .. 'd — running :TSUpdate', vim.log.levels.INFO)
      -- schedule so the plugin is fully on rtp before TSUpdate runs
      vim.schedule(function() vim.cmd('TSUpdate') end)
    end

    if name == 'telescope-fzf-native.nvim' then
      log.log('[vim.pack] telescope-fzf-native ' .. d.kind .. 'd — running make in ' .. d.path, vim.log.levels.INFO)
      vim.fn.jobstart({ 'make' }, {
        cwd = d.path,
        on_exit = function(_, code)
          if code == 0 then
            log.log('[vim.pack] telescope-fzf-native: make succeeded', vim.log.levels.INFO)
          else
            log.error('[vim.pack] telescope-fzf-native: make failed (exit ' .. code .. ')')
          end
        end,
      })
    end
  end,
})

-- ============================================================
-- Section 1: Eager plugins — install + load immediately
-- ============================================================
vim.pack.add({
  -- devicons (pinned to nerd-v2-compat tag)
  { src = 'https://github.com/nvim-tree/nvim-web-devicons', version = 'nerd-v2-compat' },

  -- shared dependencies
  'https://github.com/nvim-lua/plenary.nvim',
  'https://github.com/nvim-lua/popup.nvim',
  'https://github.com/nvim-neotest/nvim-nio',

  -- Editor components
  'https://github.com/mhinz/vim-startify',
  'https://github.com/liuchengxu/vim-which-key',
  'https://github.com/mbbill/undotree',
  'https://github.com/folke/todo-comments.nvim',
  'https://github.com/folke/trouble.nvim',
  'https://github.com/sindrets/diffview.nvim',
  'https://github.com/gennaro-tedesco/nvim-peekup',
  'https://github.com/NeogitOrg/neogit',

  -- Editor visuals
  'https://github.com/machakann/vim-sandwich',
  'https://github.com/windwp/nvim-autopairs',
  'https://github.com/lukas-reineke/indent-blankline.nvim',
  'https://github.com/machakann/vim-highlightedyank',
  'https://github.com/andymass/vim-matchup',

  -- Project
  'https://github.com/airblade/vim-rooter',
  'https://github.com/lewis6991/gitsigns.nvim',

  -- Search
  'https://github.com/nvim-telescope/telescope.nvim',
  'https://github.com/nvim-telescope/telescope-symbols.nvim',
  'https://github.com/nvim-telescope/telescope-file-browser.nvim',
  'https://github.com/nvim-telescope/telescope-fzf-native.nvim', -- make runs automatically via PackChanged
  'https://github.com/nvim-telescope/telescope-ui-select.nvim',
  'https://github.com/brooth/far.vim',
  'https://github.com/MagicDuck/grug-far.nvim',

  -- Writing / reading
  'https://github.com/nullchilly/fsread.nvim',
  'https://github.com/renerocksai/telekasten.nvim',
  'https://github.com/JellyApple102/flote.nvim',
  'https://github.com/yujinyuz/gitpad.nvim',

  -- Documentation
  'https://github.com/danymat/neogen',

  -- Comments
  'https://github.com/tpope/vim-commentary',

  -- Motion
  { src = 'https://codeberg.org/andyg/leap.nvim' },
  'https://github.com/tpope/vim-repeat',
  'https://github.com/abecodes/tabout.nvim',

  -- LSP / Treesitter
  { src = 'https://github.com/nvim-treesitter/nvim-treesitter', version = 'main' },  -- :TSUpdate runs automatically via PackChanged
  'https://github.com/JoosepAlviste/nvim-ts-context-commentstring',
  'https://github.com/hiphish/rainbow-delimiters.nvim',
  'https://github.com/windwp/nvim-ts-autotag',
  'https://github.com/nvim-lua/lsp_extensions.nvim',
  'https://github.com/onsails/lspkind-nvim',
  'https://github.com/ray-x/lsp_signature.nvim',
  { src = 'https://git.sr.ht/~whynothugo/lsp_lines.nvim' },   -- non-GitHub source
  'https://github.com/nvim-treesitter/nvim-treesitter-context',
  { src = 'https://github.com/ms-jpq/coq_nvim',    version = 'coq' },
  { src = 'https://github.com/ms-jpq/coq.artifacts', version = 'artifacts' },
  'https://github.com/ThePrimeagen/refactoring.nvim',

  -- Debugging
  'https://github.com/mfussenegger/nvim-dap',
  'https://github.com/rcarriga/nvim-dap-ui',
  'https://github.com/nvim-telescope/telescope-dap.nvim',

  -- Bars
  'https://github.com/SmiteshP/nvim-navic',
  'https://github.com/nvim-lualine/lualine.nvim',

  -- Theme
  'https://github.com/atelierbram/Base2Tone-nvim',

  -- UI
  'https://github.com/stevearc/dressing.nvim',
}, { load = true })

-- ============================================================
-- Section 2: ft-lazy plugins — install only, no immediate load
-- ============================================================
-- Loaded on-demand via the FileType autocommand in Section 5.
vim.pack.add({
  { src = 'https://github.com/maxmellon/vim-jsx-pretty', name = 'vim-jsx-pretty' },
  { src = 'https://github.com/mattn/emmet-vim',          name = 'emmet-vim' },
})

-- ============================================================
-- Section 3: setup() calls  (packer `setup` key — runs before config)
-- ============================================================
require('plugins.vim-which-key.setup')
require('plugins.undotree.setup')
require('plugins.trouble.setup')
require('plugins.neogit.setup')
require('plugins.coq_nvim.setup')
require('plugins.telescope.setup')
require('plugins.far.setup')
require('plugins.grug-far.setup')
require('plugins.leap.setup')
require('plugins.lsp_lines.setup')
require('plugins.nvim-treesitter-context.setup')
require('plugins.refactoring.setup')
require('plugins.telekasten.setup')
require('plugins.gitpad.setup')
require('plugins.vim-commentary.setup')
require('plugins.telescope-dap.setup')

-- ============================================================
-- Section 4: config() calls  (packer `config` key — runs after load)
-- ============================================================
-- Load ordering preserved from packer `after` relationships:
--   rainbow-delimiters  → indent-blankline
--   coq_nvim            → nvim-autopairs, tabout

require('nvim-web-devicons').setup()

require('plugins.vim-startify.config')
require('plugins.vim-which-key.config')
require('plugins.todo-comments.config')
require('plugins.trouble.config')
require('plugins.diffview.config')
require('plugins.nvim-peekup.config')
require('plugins.neogit.config')
require('plugins.vim-highlightedyank.config')
require('plugins.vim-matchup.config')
require('plugins.vim-rooter.config')
require('gitsigns').setup()
require('plugins.telescope.config')
require('plugins.grug-far.config')
require('plugins.telekasten.config')
require('plugins.flote.config')
require('plugins.gitpad.config')
require('plugins.neogen.config')
require('plugins.leap.config')
require('plugins.nvim-treesitter.config')
require('plugins.rainbow-delimiters.config')   -- must come before indent-blankline
require('plugins.nvim-ts-autotag.config')
require('plugins.lsp_extensions.config')
require('plugins.lspkind-nvim.config')
require('plugins.lsp_signature.config')
require('plugins.lsp_lines.config')
require('plugins.nvim-treesitter-context.config')
require('plugins.coq_nvim.config')             -- must come before nvim-autopairs and tabout
require('plugins.nvim-autopairs.config')
require('plugins.indent-blankline.config')     -- after rainbow-delimiters
require('plugins.tabout.config')               -- after coq_nvim
require('plugins.refactoring.config')
require('plugins.nvim-dap.config')
require('plugins.nvim-dap-ui.config')
require('plugins.telescope-dap.config')
require('plugins.lualine.config')
require('plugins.dressing.config')

-- ============================================================
-- Section 5: FileType autocommand for ft-lazy plugins
-- ============================================================
vim.api.nvim_create_autocmd('FileType', {
  pattern = { 'javascriptreact', 'javascript.jsx', 'typescriptreact', 'typescript.tsx', 'html' },
  once = true,
  callback = function()
    vim.cmd('packadd vim-jsx-pretty')
    vim.cmd('packadd emmet-vim')
  end,
})
