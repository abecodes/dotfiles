local hooks = require('hooks.hooks')

-- RUST inline hints
hooks.register(
	'*.rs',
	'BufHidden,BufLeave,InsertEnter',
	{
		require('lsp_extensions.inlay_hints').clear
	}
)
hooks.register(
	'*.rs',
	'CursorMoved,InsertLeave,BufEnter,BufWinEnter,TabEnter,BufWritePost',
	{
		function()
			require('lsp_extensions').inlay_hints({
				prefix = '',
				highlight = 'Comment',
				enabled = {'TypeHint', 'ChainingHint', 'ParameterHint'}
			})
		end
	}
)
