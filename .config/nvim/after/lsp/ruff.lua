local custom_attach = require('lsp.utils.attach')

-- see https://docs.astral.sh/ruff/installation/

require('lsp.format_on_save').register('*.py')

return {
	cmd = { 'ruff', 'server' },
	single_file_support = true,
	filetypes = {'python'},
	root_markers = {
		'ruff.toml',
		'.ruff.toml',
		'pyproject.toml',
		'pyvenv.cfg',
		'.git',
	},
	on_attach = function(client, bufnr)
		-- Disable hover in favor of Pyright. https://docs.astral.sh/ruff/editors/setup/#neovim
		client.server_capabilities.hoverProvider = false
		custom_attach(client, bufnr)
	end,
	-- see https://docs.astral.sh/ruff/editors/settings/
	init_options = {
		settings = {
			logLevel = 'warn',
			-- Any extra CLI arguments for `ruff` go here.
			-- does not work for config
			args = {},
		},
	},
}
