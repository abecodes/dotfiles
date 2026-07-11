return {
	cmd = { 'rust-analyzer' },
	single_file_support = true,
  filetypes = { 'rust' },
	root_markers = {
		'Cargo.toml',
		'rust-project.json',
		'.git',
	},
  settings = {
    ['rust-analyzer'] = {
			-- migrated from `assist.importMergeBehavior` / `assist.importPrefix`
			imports = {
				granularity = { group = 'module' },
				prefix = 'self',
			},
			diagnostics = { disabled = { 'unresolved-import' } },
			-- migrated from `cargo.loadOutDirsFromCheck = true`
			cargo = {
				buildScripts = { enable = true },
			},
			procMacro = { enable = true },
			-- migrated from `checkOnSave = { command = ..., extraArgs = ... }`:
			-- in the new schema `checkOnSave` is a boolean toggle and the
			-- command/args live under `check`.
			checkOnSave = true,
			check = {
				command = 'clippy',
				extraArgs = {
					'--',
					'-Wclippy::pedantic',
				},
			},
		}
  }
}
