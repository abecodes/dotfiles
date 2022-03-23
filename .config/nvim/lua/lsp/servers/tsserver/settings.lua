local nvim_lsp = require('lspconfig')
local custom_attach = require('lsp.utils.attach')
local organize_imports = require('lsp.servers.tsserver.functions.organize_imports')

vim.api.nvim_exec([[
	augroup TsImports
		autocmd BufWritePre *.ts,*.tsx,*.js,*.jsx lua require"lsp.servers.tsserver.functions.organize_imports"()
		autocmd BufWritePre *.ts,*.tsx,*.js,*.jsx lua vim.lsp.buf.formatting_sync(nil, 1000)
	augroup END
]], true)

return {
    on_attach = function(client, bufnr)
			-- disable formatting, handled with prettierd via efm ls
        client.resolved_capabilities.document_formatting = false
        vim.api.nvim_buf_set_keymap(
					bufnr, 'n', 'go',
					':LspOrganizeImports<CR>',
					{silent = true}
				)
        custom_attach(client, bufnr)
    end,
    root_dir = function(fname)
        return nvim_lsp.util.root_pattern('package.json', '.git')(fname) or
					nvim_lsp.util.path.dirname(fname)
    end,
    cmd = {'typescript-language-server', '--stdio', '--tsserver-path=tsserver'},
    filetypes = {
        'javascript', 'javascriptreact', 'javascript.jsx', 'typescript',
        'typescriptreact', 'typescript.tsx'
    },
		commands = {
			LspTSImports = {
				organize_imports,
				description = "Organize Imports"
			}
		}
}
