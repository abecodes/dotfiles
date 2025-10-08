local hooks = require('hooks.hooks')

hooks.register(
	'*.c,*.cpp',
	'BufWritePre',
	{
		function()
			vim.lsp.buf.format(nil, 1000)
		end
	}
)

return {
    filetypes = { 'c', 'cpp', 'objc', 'objcpp', 'cuda', 'proto' },
    -- cmd = { '/usr/bin/clangd' },
    -- '--log=verbose'}
    cmd = {'/usr/bin/clangd', '--background-index', '--clang-tidy'},
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
