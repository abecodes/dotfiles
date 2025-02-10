local nvim_lsp = require('lspconfig')

-- see https://www.andersevenrud.net/neovim.github.io/lsp/configurations/pyright/

-- 'ruff.toml', '.ruff.toml'
local root_files = {'pyproject.toml', 'pyvenv.cfg'}

return {
	filetypes = {'python'},
	root_dir = function(filename)
		return nvim_lsp.util.root_pattern(unpack(root_files))(filename)
			or vim.fs.dirname(vim.fs.find('.git', { path = filename, upward = true })[1])
			-- or nvim_lsp.util.path.dirname(filename)
	end,
	settings = {
		pyright = {
			-- Using Ruff's import organizer
			disableOrganizeImports = true,
		},
		python = {
			analysis = {
				-- defaults
				--[[
				autoSearchPaths = true,
				diagnosticMode = "workspace",
				useLibraryCodeForTypes = true
				--]]
				-- Ignore all files for analysis to exclusively use Ruff for linting
				ignore = { '*' },
			},
		},
	},
}
