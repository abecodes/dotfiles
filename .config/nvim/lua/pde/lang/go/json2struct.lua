--[[
	This module attaches to the paste event.

	It will only kick in in go files.

	It either receives the paste content as the actual lines or as a stream.

	In each case the cursor position at the start and the end of the paste are recorded.
	After the paste the module checks if the content is json.

	If so, it is ran through json2go (https://github.com/m-zajac/json2go) and the
	output is stored in a buffer var (downside of sync nonshell).

	The buffer var is then parsed and
	the original content replaced. The var gets cleared afterwards.
]]--
local utils = require('utils')

local enabled = false
local pastes = {}

local handleInput = function(input, text, s, e)
	if utils.str.str_is_empty(input) or string.lower(input) == 'n' then
		return
	end

	local res = utils.proc.run_sync({ 'json2go', '-n', input }, { stdin = text })
	if res.code ~= 0 then
		require('logger').error(utils.proc.format_err('json2go', res.code, res.stderr))
		return
	end

	local out = res.stdout
	if out:sub(-1) == '\n' then out = out:sub(1, -2) end
	local struct = vim.split(out, '\n')
	table.insert(struct, 1, '')

	vim.api.nvim_buf_set_text(
		0,
		s[1] - 1,
		s[2],
		e[1] - 1,
		e[2],
		struct
	)

	vim.api.nvim_win_set_cursor(
		0,
		{
			(s[1] - 1) + #struct,
			#struct[#struct]
		}
	)
end

local handlePaste = function()
	local s = pastes[vim.api.nvim_get_current_buf()].pos_start
	local e = pastes[vim.api.nvim_get_current_buf()].pos_end
	local text = table.concat(
		vim.api.nvim_buf_get_text(
			vim.api.nvim_get_current_buf(),
			s[1] - 1,
			s[2],
			e[1] - 1,
			e[2],
			{}
		),
		'\n'
	)

	local ok, decoded = pcall(vim.json.decode, text)
	if not ok or type(decoded) ~= 'table' then
		-- not a json object/array, just paste
		return
	end

	vim.ui.input(
		{
			prompt = 'turn JSON to struct[<name>/N]?:',
		},
		function(val)
			handleInput(val, text, s, e)
		end
	)
end


local pasteStart = function()
	pastes[vim.api.nvim_get_current_buf()] = {
		pos_start = vim.api.nvim_win_get_cursor(0)
	}
end

local pasteEnd = function()
	local bufnr = vim.api.nvim_get_current_buf()
	if not pastes[bufnr] then
		return
	end

	pastes[bufnr].pos_end = vim.api.nvim_win_get_cursor(0)
	handlePaste()
	pastes[bufnr] = nil
end


local function paste_handler(overridden)
  return function(lines, phase)
		if utils.buf.get_fileext() == 'go' then
			if phase == -1 then
				-- non-streaming: all text is in a single call

				pasteStart()
				overridden(lines, phase)
				pasteEnd()
			elseif phase == 1 then
				-- starts the paste

				pasteStart()
				overridden(lines, phase)
			elseif phase == 3 then
				-- ends the paste

				overridden(lines, phase)
				pasteEnd()
			else
				-- phase 2

				overridden(lines, phase)
			end
		else
			overridden(lines, phase)
		end
  end
end

return function()
	if not enabled then
		vim.paste = paste_handler(vim.paste)
		enabled = true
	end
end
