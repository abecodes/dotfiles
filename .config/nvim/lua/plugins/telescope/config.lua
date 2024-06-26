require('telescope').setup {
    defaults = {
        vimgrep_arguments = {
            'rg', '--color=never', '--no-heading', '--with-filename',
            '--line-number', '--column', '--smart-case', '--hidden', '--no-ignore'
        },
        prompt_prefix = '> ',
        selection_caret = '> ',
        entry_prefix = '  ',
        initial_mode = 'insert',
        selection_strategy = 'reset',
        sorting_strategy = 'descending',
        layout_strategy = 'horizontal',
        layout_config = {
            horizontal = {
                mirror = false,
                preview_cutoff = 50
            },
            vertical = {mirror = false},
        },
        file_sorter = require'telescope.sorters'.get_fuzzy_file,
        file_ignore_patterns = {},
        generic_sorter = require'telescope.sorters'.get_generic_fuzzy_sorter,
        winblend = 0,
        border = {},
        borderchars = {'─', '│', '─', '│', '╭', '╮', '╯', '╰'},
        color_devicons = true,
        use_less = true,
        path_display = {},
        set_env = {['COLORTERM'] = 'truecolor'}, -- default = nil,
        file_previewer = require'telescope.previewers'.vim_buffer_cat.new,
        grep_previewer = require'telescope.previewers'.vim_buffer_vimgrep.new,
        qflist_previewer = require'telescope.previewers'.vim_buffer_qflist.new,
        -- file_previewer = require'telescope.previewers'.cat.new,
        -- grep_previewer = require'telescope.previewers'.vimgrep.new,
        -- qflist_previewer = require'telescope.previewers'.qflist.new,
        -- Developer configurations: Not meant for general override
        buffer_previewer_maker = require'telescope.previewers'.buffer_previewer_maker
    },
    -- pickers = {
    --     find_files = {
    --         theme = 'dropdown'
    --     }
    -- },
    extensions = {
        fzf = {
            fuzzy = true,                    -- false will only do exact matching
            override_generic_sorter = true,  -- override the generic sorter
            override_file_sorter = true,     -- override the file sorter
            case_mode = 'smart_case',        -- or 'ignore_case' or 'respect_case'
                                            -- the default case_mode is 'smart_case'
        },
        file_browser = {
            hidden = true,
            path = '%:p:h',
            respect_gitignore = false,
        },
        ['ui-select'] = {
            require('telescope.themes').get_dropdown {
                -- even more opts
            }
            -- pseudo code / specification for writing custom displays, like the one
            -- for 'codeactions'
            -- specific_opts = {
            --   [kind] = {
            --     make_indexed = function(items) -> indexed_items, width,
            --     make_displayer = function(widths) -> displayer
            --     make_display = function(displayer) -> function(e)
            --     make_ordinal = function(e) -> string
            --   },
            --   -- for example to disable the custom builtin 'codeactions' display
            --      do the following
            --   codeactions = false,
            -- }
        }
    }
}

require('telescope').load_extension 'file_browser'
require('telescope').load_extension('fzf')
require('telescope').load_extension('refactoring')
-- require('telescope').load_extension('harpoon')
require('telescope').load_extension('ui-select')
