require('lsp.format_on_save').register('*.c,*.cpp')

return {
    filetypes = { 'c', 'cpp', 'objc', 'objcpp', 'cuda', 'proto' },
    -- cmd = { 'clangd' },
    -- '--log=verbose'}
    cmd = {'clangd', '--background-index', '--clang-tidy'},
    single_file_support = true,
    root_markers = {
        '.clangd',
        '.clang-tidy',
        'compile_commands.json',
        'compile_flags.txt',
        'configure.ac',
        'build.zig',
        '.git'
		},
    -- initialization_options = {
    --     fallback_flags = { '-std=c++17' },
    -- },
}
