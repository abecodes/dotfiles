local custom_attach = require('lsp.utils.attach')

local function organize_imports()
  local params = {
      command = '_typescript.organizeImports',
      arguments = { vim.api.nvim_buf_get_name(0) },
      title = ''
  }

	for _, client in ipairs(vim.lsp.get_clients({ bufnr = 0, name = 'ts_ls' })) do
		client:exec_cmd(params)
	end
end

require('lsp.format_on_save').register('*.ts,*.tsx,*.js,*.jsx', { organize_imports })

return {
	on_attach = function(client, bufnr)
		-- disable formatting, handled with prettierd via efm ls
			client.server_capabilities.documentFormattingProvider = false
			vim.keymap.set('n', 'go', '<cmd>LspTSImports<CR>', { buffer = bufnr, silent = true })
			custom_attach(client, bufnr)
	end,
	root_markers = {
		'package.json',
		'.git'
	},
	cmd = {'typescript-language-server', '--stdio'},
	filetypes = {
			'javascript', 'javascriptreact', 'typescript',
			'typescriptreact'
	},
	commands = {
		LspTSImports = {
			organize_imports,
			description = "Organize Imports"
		}
	}
}
