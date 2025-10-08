return {
    filetypes = {'zig', 'zir'},
    cmd = { '/opt/homebrew/bin/zls' },
    single_file_support = true,
		root_markers = {
			'zls.json',
			'build.zig',
			'.git'
		},
    settings = {
        zls = {
            -- other options see: https://github.com/zigtools/zls/blob/master/src/Config.zig
            zig_exe_path = '/opt/homebrew/bin/zig',
        }
    },
}
