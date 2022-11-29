local logger = require('logger')

---@class MapargDict
---@field lhs string The {lhs} of the mapping.
---@field rhs string The {rhs} of the mapping as typed.
---@field silent number 1 for a |:map-silent| mapping, else 0.
---@field noremap number 1 if the {rhs} of the mapping is not remappable.
---@field expr number 1 for an expression mapping (|:map-<expr>|).
---@field buffer number 1 for a buffer local mapping (|:map-local|).
---@field mode string | "'n'" | "'v'" | "'x'" | "'s'" | "'o'" | "'!'" | "'i'" | "'l'" | "'c'" | "'t'" | "''" | "' '" | "'!'"  " " Normal, Visual and Operator-pending, "!" Insert and Commandline mode (|mapmode-ic|)
---@field sid number The script local ID, used for <sid> mappings (|<SID>|).

---@class JobOpts
---@field stdout_buffered boolean send stdout line by line
---@field on_stdout function(_, data)
---@field on_stderr function(_, data)

---@class AutocmdOpts
---@field pattern string
---@field callback function()

---@class CmdOpts
---@field force boolean (default true) Override any previous definition

local id = 0

---@class Luna
local M = {}

M.log = logger

--- @param cmd string
M.get_buf_func = function(cmd)
	if not (type(cmd) == 'string') then
		logger.warn(logger.dump(cmd)..' in no valid param to get_buf_func')
		return nil
	end

	return function()
		vim.api.nvim_command(
			':%!'..cmd
		)
	end
end

---create a new autogroup
---@param event string
---@param group string
---@param opts AutocmdOpts
M.new_autocmd = function(event, group, opts)
	local o = {
		group = vim.api.nvim_create_augroup(group, { clear = true })
	}
	o = vim.tbl_deep_extend("force", {}, o, opts or {})
	vim.api.nvim_create_autocmd(event, o)
end

---add a new command
---@param name string
---@param func string
---@param opts CmdOpts
M.new_cmd = function(name, func, opts)
	vim.api.nvim_create_user_command(name, func, opts)
end

---add a new command to buffer
---@param name string
---@param func string
---@param opts CmdOpts
M.new_buf_cmd = function(name, func, opts)
	vim.api.nvim_buf_create_user_command(0, name, func, opts)
end

---run a new external job
---@param cmds string[]
---@param opts JobOpts
M.run_external = function(cmds, opts)
	return vim.fn.jobstart(cmds, opts)
end

---get the name to the current file
---@return string
M.get_filename = function()
	return vim.fn.expand("%:t")
end

---get the path to the current file
---@return string
M.get_filepath = function()
	return vim.api.nvim_buf_get_name(0)
end

---get the dir to the current file
---@return string
M.get_filedir = function()
	return vim.fn.expand("%:p:h")
end

---check if cursor is at a certain position
---@param line number
---@param col number
---@return boolean
M.is_cursor_at_position = function(line, col)
    local cursor = vim.api.nvim_win_get_cursor(0)

    return line == cursor[1] - 1 and col == cursor[2]
end

---registers a command!
---@param command string
---@param fn_string string
M.register_command = function(command, fn_string)
    vim.api.nvim_command('command! ' .. command .. ' ' .. fn_string)
end

---split a string
--- https://stackoverflow.com/questions/1426954/split-string-in-lua
---@param str string
---@param sep string
---@return string[]
M.split = function (str, sep)
    if sep == nil then
        sep = "%s"
    end
    local t={}
		-- for match in (s .. delimiter):gmatch("(.-)" .. delimiter) do
    for s in string.gmatch(str, "([^"..sep.."]+)") do
        table.insert(t, s)
    end
    return t
end

---string is nil or blank
---@param str string
---@return boolean
M.str_is_empty = function (str)
    return str == nil or str == ''
end

---uppercase first char of a string
---@param str string
---@return string
M.str_capitalize = function (str)
    return (str:gsub("^%l", string.upper))
end

---lowercase first char of a string
---@param str string
---@return string
M.str_lowerlize = function (str)
    return (str:gsub("^%u", string.lower))
end

---map a key in mode
---@param mode string | "'n'" | "'v'" | "'x'" | "'s'" | "'o'" | "'!'" | "'i'" | "'l'" | "'c'" | "'t'" | "''"
---@param lhs string
---@param rhs string
---@param opts? {silent: boolean, expr: boolean}
M.map_key = function(mode, lhs, rhs, opts)
    local options = {noremap = true}
    if opts then options = vim.tbl_extend('force', options, opts) end
    vim.api.nvim_set_keymap(mode, lhs, rhs, options)
end

---unmap a key in mode
---@param mode string | "'n'" | "'v'" | "'x'" | "'s'" | "'o'" | "'!'" | "'i'" | "'l'" | "'c'" | "'t'" | "''"
---@param lhs string
M.unmap_key = function(mode, lhs) vim.api.nvim_del_keymap(mode, lhs) end

---escape a string
---@param str string
M.replace_key = function(str)
    return vim.api.nvim_replace_termcodes(str, true, true, true)
end

---get the global rhs for a lhs
---@param lhs string
---@param mode string | "'n'" | "'v'" | "'x'" | "'s'" | "'o'" | "'!'" | "'i'" | "'l'" | "'c'" | "'t'" | "''"
---@return string
M.get_rhs = function(lhs, mode)
    local rhs = ''

    for _, mapping in ipairs(vim.api.nvim_get_keymap(mode)) do
        if mapping.lhs == lhs then
            if mapping.rhs ~= '' then rhs = mapping.rhs end
            break
        end
    end

    return rhs
end

M.git_branch = function()
    return vim.fn.system("git rev-parse --abbrev-ref HEAD 2> /dev/null | echo ''")
end

return M
