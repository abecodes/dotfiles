local nvim_lsp = require('lspconfig')
local custom_attach = require('lsp.utils.attach')
local prettier = require 'lsp.servers.efm.formatters.prettier'
local eslint = require 'lsp.servers.efm.linters.eslint'
local clippy = require 'lsp.servers.efm.linters.clippy'
local rustfmt = require 'lsp.servers.efm.formatters.rustfmt'

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
    on_attach = function(client, bufnr)
        -- vim.api.nvim_exec([[
        --     augroup LspEfmCleanup
        --         autocmd!
        --         autocmd VimLeavePre * silent! :!prettierd stop
        --         autocmd VimLeavePre * silent! :!eslint_d stop
        --     augroup END
        -- ]], true)
        custom_attach(client, bufnr)
    end,
		on_init = function ()
			vim.api.nvim_command('silent! !prettierd start')
			vim.api.nvim_command('silent! !eslint_d start')
			vim.api.nvim_exec([[
				augroup LspEfmCleanup
						autocmd!
						autocmd VimLeavePre * silent! :!prettierd stop
						autocmd VimLeavePre * silent! :!eslint_d stop
				augroup END
			]], true)
		end,
    on_exit = function()
			vim.api.nvim_command('!prettierd stop')
			vim.api.nvim_command('!eslint_d stop')
			vim.api.nvim_exec([[
				augroup LspEfmCleanup
						autocmd!
				augroup END
			]], true)
			vim.api.nvim_command('aug! LspEfmCleanup')
    end,
    cmd = {'efm-langserver', '-loglevel', '10', '-logfile', '/tmp/efm.log'},
    init_options = {documentFormatting = true},
    filetypes = vim.tbl_keys(languages),
    -- root_dir = nvim_lsp.util.root_pattern('package.json', '.git'),
    root_dir = function(fname)
        return nvim_lsp.util.root_pattern('package.json', '.git')(fname) or
                   nvim_lsp.util.path.dirname(fname)
    end,
    settings = {
        rootMarkers = {vim.loop.cwd()},
        lintDebounce = 100,
        languages = languages
    }
}
