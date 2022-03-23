local nvim_lsp = require('lspconfig')

return {
    filetypes = { 'rust', 'rs' },
    root_dir = nvim_lsp.util.root_pattern('Cargo.toml', 'rust-project.json'),
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
