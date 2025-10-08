return {
	cmd = { 'rust-analyzer' },
	single_file_support = true,
  filetypes = { 'rust', 'rs' },
	root_markers = {
		'Cargo.toml',
		'rust-project.json',
		'.git',
	},
  settings = {
    ['rust-analyzer'] = {
			assist = {importMergeBehavior = 'last', importPrefix = 'by_self'},
			diagnostics = {disabled = {'unresolved-import'}},
			cargo = {loadOutDirsFromCheck = true},
			procMacro = {enable = true},
			checkOnSave = {
				command = 'clippy',
				extraArgs = {
					'--',
					'-Wclippy::pedantic',
				}
			}
		}
  }
}
