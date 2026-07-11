return {
    filetypes = {'zig', 'zir'},
    cmd = { 'zls' },
    single_file_support = true,
		root_markers = {
			'zls.json',
			'build.zig',
			'.git'
		},
    settings = {
        zls = {
            -- other options see: https://github.com/zigtools/zls/blob/master/src/Config.zig
            -- zls needs an absolute path; resolve via $PATH at config-load time.
            zig_exe_path = vim.fn.exepath('zig'),
        }
    },
}
