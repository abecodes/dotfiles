local nvim_lsp = require('lspconfig')
local custom_attach = require('lsp.utils.attach')

local servers = {
	-- INFO: Name needs to equal the name in
	-- https://github.com/neovim/nvim-lspconfig/blob/master/doc/server_configurations.md
	'clangd',
	'efm',
	'gopls',
	'html',
	'pyright',
	'ruff',
	'rust_analyzer',
	'ts_ls',
	'zls',
}

for _, lsp in ipairs(servers) do
  nvim_lsp[lsp].setup(vim.tbl_extend(
		'force',
		{
			on_attach = custom_attach,
			flags = {
				debounce_text_changes = 150,
			},
		},
		require('lsp.servers.' .. lsp .. '.settings')
	))
end
