return {
	cmd = { 'gopls' },
  filetypes = {'go', 'gomod'},
	root_markers = {
		'go.mod',
		'.git'
	},
  settings = {
  	gopls = {
			-- formatting and linting via hook functions
			-- gofumpt = true,
			buildFlags = { '-tags=integration' },
			experimentalPostfixCompletions = true,
			-- Re-enabled: lua/completion/snippet.lua expands `insertTextFormat
			-- == Snippet` items via vim.snippet, which handles literal \n in
			-- postfix templates correctly (the coq parser couldn't).
			usePlaceholders = true,
			semanticTokens = true,
			-- analyses = {unusedparams = true, shadow = true},
			-- staticcheck = true
			-- hints = {
			--     assignVariableTypes = true,
			--     compositeLiteralFields = true,
			--     compositeLiteralTypes = true,
			--     constantValues = true,
			--     functionTypeParameters = true,
			--     parameterNames = true,
			--     rangeVariableTypes = true,
			-- },
    }
  }
}
