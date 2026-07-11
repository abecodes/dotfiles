-- see https://www.andersevenrud.net/neovim.github.io/lsp/configurations/pyright/

return {
	cmd = { 'pyright-langserver', '--stdio' },
	single_file_support = true,
	filetypes = {'python'},
	root_markers = {
		'pyproject.toml',
		'pyvenv.cfg',
		'ruff.toml',
		'.ruff.toml',
		'.git'
	},
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
