local prettier = require 'lsp.formatters.prettier'
local eslint = require 'lsp.linters.eslint'
-- local clippy = require 'lsp.servers.efm.linters.clippy'
-- local rustfmt = require 'lsp.servers.efm.formatters.rustfmt'

local languages = {
    typescript = {prettier, eslint},
    javascript = {prettier, eslint},
    typescriptreact = {prettier, eslint},
    ['typescript.tsx'] = {prettier, eslint},
    javascriptreact = {prettier, eslint},
    ['javascript.jsx'] = {prettier, eslint},
    vue = {prettier, eslint},
    yaml = {prettier},
    json = {prettier},
    html = {prettier},
    scss = {prettier},
    css = {prettier},
    markdown = {prettier}
    -- rust = {rustfmt, clippy}
}


return {
		on_init = function ()
			vim.api.nvim_command('silent! !prettierd start')
			vim.api.nvim_command('silent! !eslint_d start')
			vim.api.nvim_exec2([[
				augroup LspEfmCleanup
						autocmd!
						autocmd VimLeavePre * silent! :!prettierd stop
						autocmd VimLeavePre * silent! :!eslint_d stop
				augroup END
			]], {output = false})
		end,
    on_exit = function()
        vim.schedule_wrap(function()
            vim.api.nvim_command('!prettierd stop')
            vim.api.nvim_command('!eslint_d stop')
            vim.schedule(function()
                pcall(function()
                    vim.api.nvim_clear_autocmds { group = 'LspEfmCleanup' }
                    -- or
                    -- vim.api.nvim_del_augroup_by_name(name)
                    end)
                end)
        end)
    end,
    cmd = {'efm-langserver', '-loglevel', '10', '-logfile', '/tmp/efm.log'},
    init_options = {documentFormatting = true},
    filetypes = vim.tbl_keys(languages),
		root_markers = {
			'package.json',
			'.git'
		},
    settings = {
        rootMarkers = {vim.fn.getcwd()},
        lintDebounce = 100,
        languages = languages
    }
}
