local custom_attach = require('lsp.utils.attach')

-- Severity-coloured borders used to live here as a global monkey-patch of
-- `vim.lsp.util.open_floating_preview`. They now live at the call sites
-- (hover / signature_help / diagnostic open_float) in lsp.utils.attach —
-- each passes `border = severity_border()` per call.

-- Capability tweak: by default Neovim's resolveSupport.properties includes
-- `additionalTextEdits`, which lets servers defer auto-import edits to
-- the completionItem/resolve roundtrip. Our completion accept path
-- (lua/completion/snippet.lua:on_accept) reads from the ORIGINAL item
-- pulled out of v:completed_item — items that weren't navigated-to (and
-- therefore never resolved by docs.lua) carry the deferred fields as nil.
-- Removing additionalTextEdits from this list forces the server to send
-- it on the initial response instead. Slight payload bump on every
-- completion, but a hard correctness win for auto-imports.
local capabilities = vim.tbl_deep_extend('force',
	vim.lsp.protocol.make_client_capabilities(),
	{
		textDocument = {
			completion = {
				completionItem = {
					resolveSupport = {
						properties = { 'documentation', 'command' },
					},
				},
			},
		},
	}
)

vim.lsp.config('*', {
	on_attach    = custom_attach,
	root_markers = { '.git' },
	capabilities = capabilities,
})

-- Enable every server that has a matching after/lsp/<name>.lua file.
for _, path in ipairs(vim.api.nvim_get_runtime_file('after/lsp/*.lua', true)) do
	vim.lsp.enable(vim.fn.fnamemodify(path, ':t:r'))
end
