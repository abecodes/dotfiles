local utils = require('utils')

return function()
	local content = vim.api.nvim_buf_get_line(0, 0, -1, false)
	local view = vim.fn.winsaveview()

	-- breaking lines
	-- { code = 0, signal = 0, stdout = 'hello', stderr = '' }
	local res = vim.system(
		{'golines', '-m', '80', '-t', '2', '--no-chain-split-dots', '--base-formatter', 'gofumpt'},
		{
			-- stdin = table.concat(content, '\n'),
			stdin = content,
			-- err: string, data: string (does not work in sync call aka :wait())
			-- stdout = function(err, data)
			-- end,
			-- err: string, data: string (does not work in sync call aka :wait())
			-- stderr = function(err, data)
			-- end,
			text = true
		}
	):wait()

	if res.code == 0 then
		content = vim.split(res.stdout, '\n')
	end

	-- organizing imports
	res = vim.system(
		{'gci', 'print', '-s', 'standard', '-s', 'default', '-s', 'blank', '-s', 'dot'},
		{
			-- stdin = table.concat(content, '\n'),
			stdin = content,
			-- err: string, data: string (does not work in sync call aka :wait())
			-- stdout = function(err, data)
			-- end,
			-- err: string, data: string (does not work in sync call aka :wait())
			-- stderr = function(err, data)
			-- end,
			text = true
		}
	):wait()

	if res.code == 0 then
		content = vim.split(res.stdout, '\n')
	end

	vim.api.nvim_buf_set_lines(0, 0, -1, false, content)
	vim.fn.winrestview(view)
end
