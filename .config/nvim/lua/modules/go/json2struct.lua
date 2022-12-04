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
		''
	)

	if not pcall(vim.json.decode,text) then
		-- no json, just paste
		return
	end

	local input = 'n'
	vim.ui.input(
		{
			prompt = 'turn JSON to struct[<name>/N]?:',
		},
		function(val)
			input = val
		end
	)

	if utils.str_is_empty(input) or string.lower(input) == 'n' then
		return
	end

	vim.api.nvim_exec(
		'redir => b:gojson\n!echo \'' .. text .. '\' | json2go -n ' .. input .. ' -mk 99\nredir END',
		true
	)

	local _,x = string.find(vim.b.gojson, '99\r\n\n\n')
	local struct = utils.split(string.sub(vim.b.gojson, x),'\n')
	vim.b.gojson = nil

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
			s[2] + string.len(struct[#struct])
		}
	)
end


local pasteStart = function()
	pastes[vim.api.nvim_get_current_buf()] = {
		pos_start = vim.api.nvim_win_get_cursor(0)
	}
end

local pasteEnd = function()
	if not pastes[vim.api.nvim_get_current_buf()] then
		return
	end

	pastes[vim.api.nvim_get_current_buf()].pos_end = vim.api.nvim_win_get_cursor(0)
	handlePaste()
end


local function paste_handler(overridden)
  return function(lines, phase)
		if utils.get_fileext() == 'go' then
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
