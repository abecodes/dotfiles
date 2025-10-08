local custom_attach = require('lsp.utils.attach')
local hooks = require('hooks.hooks')

local function organize_imports()
  local params = {
      command = '_typescript.organizeImports',
      arguments = { vim.api.nvim_buf_get_name(0) },
      title = ''
  }

	vim.lsp.Client.execute_command(params)
end

hooks.register(
	'*.ts,*.tsx,*.js,*.jsx',
	'BufWritePre',
	{
		organize_imports,
		function()
			vim.lsp.buf.format(nil, 1000)
		end
	}
)

return {
	on_attach = function(client, bufnr)
		-- disable formatting, handled with prettierd via efm ls
			client.server_capabilities.document_formatting = false
			vim.api.nvim_buf_set_keymap(
				bufnr, 'n', 'go',
				':LspOrganizeImports<CR>',
				{silent = true}
			)
			custom_attach(client, bufnr)
	end,
	root_markers = {
		'package.json',
		'.git'
	},
	cmd = {'typescript-language-server', '--stdio'},
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
