return {
	cmd = { 'gopls' },
	single_file_support = true,
  filetypes = {'go', 'gomod'},
	root_markers = {
		'go.mod',
		'.git'
	},
  settings = {
  	gopls = {
			-- formatting and linting via hook functions
			-- gofumpt = true,
			experimentalPostfixCompletions = true,
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
