vim.api.nvim_exec([[
	augroup LspExtensions
		autocmd!
		autocmd BufHidden,BufLeave,InsertEnter  *.rs lua require'lsp_extensions.inlay_hints'.clear()
		autocmd CursorMoved,InsertLeave,BufEnter,BufWinEnter,TabEnter,BufWritePost *.rs lua require'lsp_extensions'.inlay_hints{ prefix = '', highlight = "Comment", enabled = {"TypeHint", "ChainingHint", "ParameterHint"} }
	augroup END
]], true)
