-- This file can be loaded by calling `lua require('plugins')` from your init.vim
-- vim.api.nvim_command('packadd packer.nvim')
--[[ use {
  'myusername/example',        -- The plugin location string
  -- The following keys are all optional
  disable = boolean,           -- Mark a plugin as inactive
  as = string,                 -- Specifies an alias under which to install the plugin
  installer = function,        -- Specifies custom installer. See 'custom installers' below.
  updater = function,          -- Specifies custom updater. See 'custom installers' below.
  after = string or list,      -- Specifies plugins to load before this plugin. See 'sequencing' below
  rtp = string,                -- Specifies a subdirectory of the plugin to add to runtimepath.
  opt = boolean,               -- Manually marks a plugin as optional.
  branch = string,             -- Specifies a git branch to use
  tag = string,                -- Specifies a git tag to use
  commit = string,             -- Specifies a git commit to use
  lock = boolean,              -- Skip this plugin in updates/syncs
  run = string, function, or table, -- Post-update/install hook. See 'update/install hooks'.
  requires = string or list,   -- Specifies plugin dependencies. See 'dependencies'.
  rocks = string or list,      -- Specifies Luarocks dependencies for the plugin
  config = string or function, -- Specifies code to run after this plugin is loaded.
  -- The setup key implies
  setup = string or function,  -- Specifies code to run before this plugin is loaded.
  -- The following keys all imply lazy-loading and imply
  cmd = string or list,        -- Specifies commands which load this plugin.
  ft = string or list,         -- Specifies filetypes which load this plugin.
  keys = string or list,       -- Specifies maps which load this plugin. See 'Keybindings'.
  event = string or list,      -- Specifies autocommand events which load this plugin.
  fn = string or list          -- Specifies functions which load this plugin.
  cond = string, function, or list of strings/functions,   -- Specifies a conditional test to load this plugin
  module = string or list      -- Specifies Lua module names for require. When requiring a string which starts
                               -- with one of these module names, the plugin will be loaded.
} ]] -- recompile if this file changes
vim.cmd [[autocmd BufWritePost plugins.lua PackerCompile]]

-- setup is called before load, config after

return require('packer').startup(function()
    -- Packer can manage itself
    use 'wbthomason/packer.nvim'

    use {
		'nvim-tree/nvim-web-devicons',
        version = 'nerd-v2-compat',
		config = function()
			require('nvim-web-devicons').setup()
		end,
	}

    -- Editor components
    use {
        'mhinz/vim-startify',
        config = [[require('plugins.vim-startify.config')]],
    }
    use {
        'liuchengxu/vim-which-key',
        setup = [[require('plugins.vim-which-key.setup')]],
        config = [[require('plugins.vim-which-key.config')]]
    }
    use {
        'mbbill/undotree',
        setup = [[require('plugins.undotree.setup')]]
    }
    use {
        'simrat39/symbols-outline.nvim',
        setup = [[require('plugins.symbols-outline.setup')]],
        config = [[require('plugins.symbols-outline.config')]]
    }
    use {
        'folke/todo-comments.nvim',
        requires = 'nvim-lua/plenary.nvim',
        config = [[require('plugins.todo-comments.config')]]
    }
    use {
        'folke/trouble.nvim',
        requires = 'nvim-tree/nvim-web-devicons',
        setup = [[require('plugins.trouble.setup')]],
        config = [[require('plugins.trouble.config')]]
    }
    use {
        'sindrets/diffview.nvim',
        wants = {'nvim-tree/nvim-web-devicons'},
        config = [[require('plugins.diffview.config')]]
    }
    use {
        'gennaro-tedesco/nvim-peekup',
        config = [[require('plugins.nvim-peekup.config')]]
    }
    use {
        'wfxr/minimap.vim',
        setup = [[require('plugins.minimap.setup')]],
        disable = true
    }
    use {
        'NeogitOrg/neogit',
        config = [[require('plugins.neogit.config')]],
        setup = [[require('plugins.neogit.setup')]],
        requires = {
            'nvim-lua/plenary.nvim',
            'nvim-telescope/telescope.nvim',
            'sindrets/diffview.nvim'
        }
    }
    -- use {
    --     'ThePrimeagen/harpoon',
    --     requires = 'nvim-lua/plenary.nvim',
    --     config = [[require('plugins.harpoon.config')]],
    --     setup = [[require('plugins.harpoon.setup')]],
    -- }

    -- Editor visuals
    use {'machakann/vim-sandwich'} -- maybe use nvim-surround
    use {
        'windwp/nvim-autopairs',
        config = [[require('plugins.nvim-autopairs.config')]],
        after = {'coq_nvim'}
    }
    use {
        'lukas-reineke/indent-blankline.nvim',
        config = [[require('plugins.indent-blankline.config')]],
        after = {'rainbow-delimiters.nvim'}
    }
    use {
        'machakann/vim-highlightedyank',
        config = [[require('plugins.vim-highlightedyank.config')]]
    }
    use {'edluffy/specs.nvim', config = [[require('plugins.specs.config')]]}
    use {
        'andymass/vim-matchup',
        config = [[require('plugins.vim-matchup.config')]],
        wants = {'nvim-treesitter'}
    }
    use {'sunjon/shade.nvim', config = [[require('plugins.shade.config')]]}

    -- project
    use {
        'airblade/vim-rooter',
        config = [[require('plugins.vim-rooter.config')]]
    }
    use {
		'lewis6991/gitsigns.nvim',
		requires = {'nvim-lua/plenary.nvim'},
		config = function()
			require('gitsigns').setup()
		end
	}

    -- terminal
    use {
        'numToStr/FTerm.nvim',
        config = [[require('plugins.fterm.config')]],
        setup = [[require('plugins.fterm.setup')]]
    }

    -- search
    use {
        'nvim-telescope/telescope.nvim',
        requires = {
            {'nvim-lua/popup.nvim'}, {'nvim-telescope/telescope-symbols.nvim'},
            {'nvim-telescope/telescope-file-browser.nvim'},
            {'nvim-telescope/telescope-fzf-native.nvim', run = 'make'},
            {'nvim-telescope/telescope-ui-select.nvim'}
        },
        wants = {
            'plenary.nvim',
            'popup.nvim',
            'telescope-symbols.nvim',
            'telescope-ui-select.nvim',
            'refactoring.nvim'
        },
        setup = [[require('plugins.telescope.setup')]],
        config = [[require('plugins.telescope.config')]]
    }
    use 'brooth/far.vim'

    -- writing/reading
    use {
        'shortcuts/no-neck-pain.nvim',
        tag = '*',
        config = [[require('plugins.no-neck-pain.config')]],
    }
    use 'nullchilly/fsread.nvim'
    use {
        'folke/zen-mode.nvim',
        config = [[require('plugins.zen-mode.config')]],
        requires = {
            {
                'folke/twilight.nvim',
                config = [[require('plugins.twilight.config')]]
            }
        },
        cmd = {'ZenMode'}
    }
    use {
        'renerocksai/telekasten.nvim',
        config = [[require('plugins.telekasten.config')]],
        setup = [[require('plugins.telekasten.setup')]],
        wants = {'plenary.nvim', 'telescope.nvim'},
    }
    use {
        'JellyApple102/flote.nvim',
        config = [[require('plugins.flote.config')]],
    }

    -- documentation
    use {
        'kkoomen/vim-doge',
        run = ':call doge#install()'
        --[[ config = function()
            vim.g.doge_doc_standard_python = 'google'
        end, ]]
    }

    -- comments
    use {
        'tpope/vim-commentary',
        setup = [[require('plugins.vim-commentary.setup')]],
        wants = 'nvim-ts-context-commentstring'
    }

    -- motion
    use {
        'ggandor/lightspeed.nvim',
        config = [[require('plugins.lightspeed-nvim.config')]],
        requires = {
            'tpope/vim-repeat'
        }
    }
    use {
        'declancm/cinnamon.nvim',
        config = [[require('plugins.cinnamon.config')]],
        setup = [[require('plugins.cinnamon.setup')]],
        wants = {'plenary.nvim'}
    }
    use {
        'abecodes/tabout.nvim',
        -- branch = 'feature/tabout-md',
        config = [[require('plugins.tabout.config')]],
        requires = {'nvim-treesitter'},
        after = {'coq_nvim'}
    }

    -- lsp
    use {
        'neovim/nvim-lspconfig',
        config = [[require('plugins.nvim-lspconfig.config')]],
        setup = [[require('plugins.nvim-lspconfig.setup')]],
        wants = {'nvim-treesitter', 'coq_nvim', 'nvim-navic'},
    }
    use {
        'nvim-treesitter/nvim-treesitter',
        run = ':TSUpdate',
        config = [[require('plugins.nvim-treesitter.config')]],
        requires = {
            'JoosepAlviste/nvim-ts-context-commentstring' -- needs to be enabled in treesitter config
        }
    }
    use {
        'hiphish/rainbow-delimiters.nvim',
        config = [[require('plugins.rainbow-delimiters.config')]]
    }
    use {
        'windwp/nvim-ts-autotag',
        config = [[require('plugins.nvim-ts-autotag.config')]]
    }
    use {'folke/lsp-colors.nvim'}
    use {
        'nvim-lua/lsp_extensions.nvim',
        config = [[require('plugins.lsp_extensions.config')]]
    }
    use {
        'onsails/lspkind-nvim',
        config = [[require('plugins.lspkind-nvim.config')]]
    }
    use {
        'ray-x/lsp_signature.nvim',
        config = [[require('plugins.lsp_signature.config')]],
        after = {'nvim-lspconfig'}
    }
    use {
        'nvim-treesitter/nvim-treesitter-context',
        setup = [[require('plugins.nvim-treesitter-context.setup')]],
        config = [[require('plugins.nvim-treesitter-context.config')]],
        requires = {
            'nvim-treesitter/nvim-treesitter'
        },
        wants = {'nvim-treesitter'}
    }
    use {
        'ms-jpq/coq_nvim',
        branch = 'coq',
        requires = {{'ms-jpq/coq.artifacts', branch = 'artifacts'}},
        config = [[require('plugins.coq_nvim.config')]],
        setup = [[require('plugins.coq_nvim.setup')]],
        wants = {'nvim-treesitter'}
    }
    use {
        'ThePrimeagen/refactoring.nvim',
        config = [[require('plugins.refactoring.config')]],
        setup = [[require('plugins.refactoring.setup')]],
        wants = {'plenary.nvim', 'nvim-treesitter'}
    }

    -- language suppport
    use {
        'maxmellon/vim-jsx-pretty',
        ft = {
            'javascriptreact', 'javascript.jsx', 'typescriptreact',
            'typescript.tsx'
        }
    }
    use {
        'mattn/emmet-vim',
        ft = {
            'javascriptreact', 'javascript.jsx', 'typescriptreact',
            'typescript.tsx', 'html'
        }
    }

    -- testing
    use {
        'mfussenegger/nvim-dap',
        config = [[require('plugins.nvim-dap.config')]]
    }
    use {
        'rcarriga/nvim-dap-ui',
        config = [[require('plugins.nvim-dap-ui.config')]],
        requires = {'nvim-neotest/nvim-nio'},
        wants = {'nvim-dap'}
    }
    use {
        'nvim-telescope/telescope-dap.nvim',
        setup = [[require('plugins.telescope-dap.setup')]],
        config = [[require('plugins.telescope-dap.config')]],
        wants = {'nvim-dap', 'nvim-treesitter', 'telescope.nvim'}
    }

    -- bars
    use {
        'SmiteshP/nvim-navic',
        -- config = [[require('plugins.nvim-navic.config')]],
        requires = 'neovim/nvim-lspconfig',
        wants = {'nvim-treesitter'}
    }
    use {
        'nvim-lualine/lualine.nvim',
        config = [[require('plugins.lualine.config')]],
        wants = {'nvim-tree/nvim-web-devicons', 'SmiteshP/nvim-navic'}
    }

    -- theme
    use { 'atelierbram/Base2Tone-nvim' }
    use {'ntk148v/vim-horizon', as = 'horizon'}

    -- ui
    use {
        'stevearc/dressing.nvim',
        config = [[require('plugins.dressing.config')]],
    }

    -- tryouts:
    -- use {'tpope/vim-dispatch', cmd = {'Dispatch', 'Make', 'Focus', 'Start'}}
    -- replacement for lightline, is it working with the theme?
    --[[ use {
    'glepnir/galaxyline.nvim', branch = 'main', config = function() require'statusline' end,
    requires = {'nvim-tree/nvim-web-devicons'}
  } ]]
end)

--[[ config = {
  display = {
    open_fn = function()
      return require('packer.util').float({ border = 'single' })
    end
  },
	profile = {
    enable = true,
    threshold = 1 -- the amount in ms that a plugins load time must be over for it to be included in the profile
  }
} ]]
