local nvim_lsp = require('lspconfig')
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

-- 'ruff.toml', '.ruff.toml'
local root_files = {'pyproject.toml', 'pyvenv.cfg'}

return {
	filetypes = {'python'},
	root_dir = function(filename)
		return nvim_lsp.util.root_pattern(unpack(root_files))(filename)
			or vim.fs.dirname(vim.fs.find('.git', { path = filename, upward = true })[1])
			-- or nvim_lsp.util.path.dirname(filename)
	end,
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
