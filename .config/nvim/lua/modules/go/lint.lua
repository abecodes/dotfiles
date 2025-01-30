local utils = require('utils')
local logger = require('logger')
local ts = require('vim.treesitter')
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
					-- LineRange may not be present
					"LineRange": {
						"From": 13,
						"To": 127
					},
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

			start_col = issue.Pos.Column - 1
			end_col = issue.Pos.Column

			if not issue.LineRange then
				issue.LineRange = {
					From = issue.Pos.Line,
					To = issue.Pos.Line,
				}
			end

			_, start_col, _, end_col = ts.get_node_range(
				ts.get_node({
					bufnr = 0,
					pos = {
						issue.Pos.Line-1,
						issue.Pos.Column
					}
				})
			)

			local msg = {
				bufnr = vim.api.nvim_get_current_buf(),
				lnum = issue.LineRange.From-1,
				end_lnum = issue.LineRange.To-1,
				col = start_col,
				end_col = end_col,
				severity = vim.diagnostic.severity.WARN,
				source = issue.FromLinter,
				message = issue.Text,
				user_data = {},
			}

			if msg.end_lnum > msg.lnum then
				msg.end_lnum = msg.lnum + 1
				msg.end_col = 0
			end

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
				utils.str_has_prefix(issue.Text, "flag-parameter") or
				utils.str_has_prefix(issue.Text, "return with no blank line before") or
				utils.str_has_prefix(issue.Text, "composites") or
				utils.str_has_prefix(issue.Text, "cognitive-complexity") or
				string.find(issue.Text, "returns interface") then
				msg.severity = vim.diagnostic.severity.WARN

				goto insert_into
			end

			if string.find(issue.Text, "is missing field") or
				utils.str_has_prefix(issue.Text, "confusing-naming") or
				utils.str_has_prefix(issue.Text, "line-length-limit") or
				utils.str_has_prefix(issue.Text, "get-return") or
				utils.str_has_prefix(issue.Text, "error-strings") or
				utils.str_has_suffix(issue.Text, "is unused") then
				msg.severity = vim.diagnostic.severity.HINT

				goto insert_into
			end

			if utils.str_has_prefix(issue.Text, "function-length") or
				utils.str_has_prefix(issue.Text, "ifElseChain") or
				utils.str_has_prefix(issue.Text, "max-public-structs") or
				utils.str_has_prefix(issue.Text, "cyclomatic") or
				utils.str_has_prefix(issue.Text, "argument-limit") or
				utils.str_has_prefix(issue.Text, "function-result-limit") or
				string.find(issue.Text, "returns generic interface") or
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
				-- virtual_text = true,
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
