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
				end_lnum = issue.Pos.Line,
				col = 0,
				severity = vim.diagnostic.severity.WARN,
				source = issue.FromLinter,
				message = issue.Text,
				user_data = {},
			}

			-- if issue.Severity == "error" then
			msg.severity = vim.diagnostic.severity.ERROR
			-- end

			if utils.str_has_prefix(issue.Text, "shadow") or
				utils.str_has_prefix(issue.Text, "use-any") or
				utils.str_has_prefix(issue.Text, "add-constant") or
				utils.str_has_prefix(issue.Text, "unhandled-error") or
				utils.str_has_prefix(issue.Text, "nested-structs") or
				utils.str_has_prefix(issue.Text, "unexported-return") or
				utils.str_has_prefix(issue.Text, "unused-receiver") or
				utils.str_has_prefix(issue.Text, "unused-parameter") or
				utils.str_has_prefix(issue.Text, "singleCaseSwitch") or
				utils.str_has_prefix(issue.Text, "var-declaration") or
				utils.str_has_prefix(issue.Text, "composites") or
				utils.str_has_prefix(issue.Text, "cognitive-complexity") then
				msg.severity = vim.diagnostic.severity.WARN

				goto insert_into
			end

			if string.find(issue.Text, "is missing field") then
				msg.severity = vim.diagnostic.severity.HINT

				goto insert_into
			end

			if utils.str_has_prefix(issue.Text, "function-length") or
				utils.str_has_prefix(issue.Text, "ifElseChain") or
				utils.str_has_prefix(issue.Text, "cyclomatic") or
				utils.str_has_prefix(issue.Text, "argument-limit") or
				utils.str_has_prefix(issue.Text, "confusing-naming") or
				utils.str_has_prefix(issue.Text, "redundant-import-alias") then
				msg.severity = vim.diagnostic.severity.INFO
			end

			::insert_into::
			table.insert(out, msg)
			::continue_issue::
		end

		::continue::
	end

	if #out > 0 then
		vim.diagnostic.set(
			namespace,
			vim.api.nvim_get_current_buf(),
			out,
			{
				severity_sort = true,
				virtual_text = true,
				underline = true,
			}
		)

		return
	end

	vim.diagnostic.reset(
		namespace,
		vim.api.nvim_get_current_buf()
	)
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
