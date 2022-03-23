local nvim_lsp = require('lspconfig')
local custom_attach = require('lsp.utils.attach')

local servers = { 'gopls', 'tsserver', 'efm', 'rust_analyzer', 'html' }
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
