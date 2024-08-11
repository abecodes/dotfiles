local nvim_lsp = require('lspconfig')
local util = require('lspconfig.util')

return {
    filetypes = {'zig', 'zir'},
    cmd = { '/opt/homebrew/bin/zls' },
    single_file_support = true,
    root_dir = util.root_pattern("zls.json", "build.zig", ".git"),
    settings = {
        zls = {
            -- other options see: https://github.com/zigtools/zls/blob/master/src/Config.zig
            zig_exe_path = '/opt/homebrew/bin/zig',
        }
    },
}
