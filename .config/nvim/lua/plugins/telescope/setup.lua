---@diagnostic disable-next-line: different-requires
local telescope = require('telescope')

telescope.setup {
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
    }
}

-- pcall-guard every extension: telescope-fzf-native's install_command builds
-- asynchronously, so the .so may not exist yet on first startup after install.
-- A bare load_extension('fzf') failure would abort this whole setup file.
--
-- Extensions whose provider is itself lazy (e.g. refactoring.nvim's telescope
-- extension) register themselves from their own setup.lua, not here — loading
-- them here would drag the provider onto the rtp whenever telescope loads.
for _, ext in ipairs({ 'file_browser', 'fzf' }) do
    local ok, err = pcall(telescope.load_extension, ext)
    if not ok then
        require('logger').warn('telescope: load_extension("' .. ext .. '") failed: ' .. tostring(err))
    end
end

-- Keymaps live in plugins/telescope/keys.lua (shared with the lazy
-- on_key stubs in pack/loader.lua). The loader auto-registers them
-- after this setup runs — rhs `require('telescope.builtin')…` calls
-- then have telescope on rtp.
