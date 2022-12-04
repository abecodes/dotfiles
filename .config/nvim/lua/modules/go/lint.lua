local utils = require('utils')
local logger = require('logger')
local namespace = vim.api.nvim_create_namespace('codes.abe.hooks.golangci')

local handle_stdout = function(_, data)
	if not data then
		return
	end

	--[[
		{"Issues":
			[
				{
					"FromLinter":"ineffassign",
					"Text":"ineffectual assignment to ctx",
					"Severity":"error",
					"SourceLines":[
						"\t\tctx, span := c.trc.Tracer(\"\").Start("
					],
					"Replacement":null,
					"Pos":{
						"Filename":"msg.go",
						"Offset":4435,
						"Line":169,
						"Column":3
					},
					"ExpectNoLint":false,
					"ExpectedNoLintLinter":""
				}
			],
			...
	--]]
	local out = {}

	for _, line in ipairs(data) do
		if line == nil or line == '' or line == 'null' then
			goto continue
		end

		local decoded = vim.json.decode(line)
		if not (decoded.Report.Error == nil) then
			logger.warn(decoded.Report.Error)
			break
		end

		for _, issue in ipairs(decoded.Issues) do
			if not (vim.fn.fnamemodify(issue.Pos.Filename, ':t') == utils.get_filename()) then
				goto continue_issue
			end
			local msg = {
				bufnr = vim.api.nvim_get_current_buf(),
				lnum = issue.Pos.Line - 1,
				col = 0,
				severity = vim.diagnostic.severity.WARN,
				source = issue.FromLinter,
				message = issue.Text,
				user_data = {},
			}

			if issue.Severity == "error" then
				msg.severity = vim.diagnostic.severity.ERROR
			end

			table.insert(out, msg)
			::continue_issue::
		end

		::continue::
	end

	vim.diagnostic.set(namespace, vim.api.nvim_get_current_buf(), out, {})
end


return function()
	vim.api.nvim_buf_clear_namespace(vim.api.nvim_get_current_buf(), namespace, 0, -1)

	utils.run_external(
		{
			'golangci-lint',
			'run',
			'--out-format',
			'json',
			'-c',
			vim.fn.expand('$HOME/.golangci.yaml'),
			'./...'
		},
		{
			cwd = utils.get_filedir(),
			stdout_buffered = true,
			on_stdout = handle_stdout
		}
	)
end
