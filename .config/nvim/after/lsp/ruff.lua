local hooks = require('hooks.hooks')

-- see https://docs.astral.sh/ruff/installation/

hooks.register(
	'*.py',
	'BufWritePre',
	{
		function()
			vim.lsp.buf.format(nil, 1000)
		end
	}
)

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
	-- see https://docs.astral.sh/ruff/editors/settings/
	init_options = {
		settings = {
			logLevel = 'debug',
			-- Any extra CLI arguments for `ruff` go here.
			-- does not work for config
			args = {},
		},
	},
}
