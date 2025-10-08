local custom_attach = require('lsp.utils.attach')

local servers = {
	-- INFO: Name needs to equal the name in
	-- https://github.com/neovim/nvim-lspconfig/blob/master/doc/server_configurations.md
	'clangd',
	'efm',
	'gopls',
	'html',
	'lua_ls',
	'pyright',
	'ruff',
	'rust_analyzer',
	'ts_ls',
	'zls',
}

-- INFO: default capabilities
-- local capabilities = vim.lsp.protocol.make_client_capabilities()
-- capabilities = require('coq').lsp_ensure_capabilities(capabilities)
-- capabilities.textDocument.completion.completionItem.snippetSupport = true
-- capabilities.textDocument.completion.completionItem.resolveSupport = {
--	properties = { 'documentation', 'detail', 'additionalTextEdits' }
-- }

-- INFO: float window coloring
-- https://neovim.discourse.group/t/lsp-diagnostics-how-and-where-to-retrieve-severity-level-to-customise-border-color/1679
vim.lsp.util.open_floating_preview = (function(orig)
	return function(contents, syntax, opts)
		local lnum = vim.api.nvim_win_get_cursor(0)[1] - 1
		local diagnostics = vim.diagnostic.get(opts.bufnr or 0, { lnum = lnum })
		local max_severity = vim.diagnostic.severity.HINT

		for _, d in ipairs(diagnostics) do
			-- Equality is "less than" based on how the severities are encoded
			if d.severity < max_severity then
				max_severity = d.severity
			end
		end

		local border_color = ({
			[vim.diagnostic.severity.HINT]  = "DiagnosticHint",
			[vim.diagnostic.severity.INFO]  = "DiagnosticInfo",
			[vim.diagnostic.severity.WARN]  = "DiagnosticWarn",
			[vim.diagnostic.severity.ERROR] = "DiagnosticError",
		})[max_severity]

		opts.border = {
			{ "╭", border_color },
			{ "─", border_color },
			{ "╮", border_color },
			{ "│", border_color },
			{ "╯", border_color },
			{ "─", border_color },
			{ "╰", border_color },
			{ "│", border_color },
		}

		return orig(contents, syntax, opts)
	end

end)(vim.lsp.util.open_floating_preview)

-- INFO: setting default config
vim.lsp.config('*', {
	on_attach = custom_attach,
  root_markers = { '.git' },
})

for _, lsp in ipairs(servers) do
	vim.lsp.enable(lsp)

	-- vim.lsp.config(
	-- 	lsp,
	-- 	vim.tbl_extend(
	-- 		'force',
	-- 		{
	-- 			-- capabilities = capabilities,
	-- 			on_attach = custom_attach,
	-- 			flags = {
	-- 				debounce_text_changes = 150,
	-- 			},
	-- 		},
	-- 		require('lsp.servers.' .. lsp .. '.settings')
	-- 	)
	-- )
end
