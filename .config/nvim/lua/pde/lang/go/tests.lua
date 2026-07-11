local utils          = require('utils')
local node_at_cursor = require('pde.lang.go._node_at_cursor')
local logger         = require('logger')

-- shameless plug of https://github.com/olexsmir/gopher.nvim/blob/main/lua/gopher/_utils/ts/init.lua
local querys = {
	method_name = [[((method_declaration receiver: (parameter_list)@method.receiver name: (field_identifier)@method.name body:(block))@method.declaration)]],
	func = [[((function_declaration name: (identifier)@function.name) @function.declaration)]],
}

---@param row integer
---@param col integer
---@param bufnr integer|nil
---@return table|nil
local get_func_method_node_at_pos = function(row, col, bufnr)
  local query = querys.func .. " " .. querys.method_name
  return node_at_cursor(query, bufnr, row, col, 'function not found')
end

local M = {}

---@param cmd_args table
local function run(cmd_args)
	local cmd = { 'gotests', unpack(cmd_args) }

	local stderr_lines, handle_stderr = utils.proc.stderr_accumulator()

	utils.proc.run_async(
		cmd,
		{
			cwd = utils.buf.get_filedir(),
			stderr_buffered = true,
			on_stderr = handle_stderr,
			on_exit = function(_, retval)
				if retval ~= 0 then
					local stderr = #stderr_lines > 0 and table.concat(stderr_lines, ' / ') or nil
					logger.warn(utils.proc.format_err('gotests ' .. table.concat(cmd_args, ' '), retval, stderr))
					return
				end

				logger.info('unit test(s) generated')
			end,
		}
	)
end

---@param args table
local function add_test(args)
  table.insert(args, '-w')
  table.insert(args, utils.buf.get_filepath())
  run(args)
end

---generate unit test for one function
---@param parallel boolean
function M.add(parallel)
  local ns = get_func_method_node_at_pos(unpack(vim.api.nvim_win_get_cursor(0)))
  if ns == nil or ns.name == nil then
    logger.warn('[gotests] place cursor on func/method and execute the command again')
    return
  end

  local cmd_args = { '-only', ns.name }
  if parallel then
    table.insert(cmd_args, '-parallel')
  end

  add_test(cmd_args)
end

---generate unit tests for all functions in current file
---@param parallel boolean
function M.all(parallel)
  local cmd_args = { '-all' }
  if parallel then
    table.insert(cmd_args, '-parallel')
  end

  add_test(cmd_args)
end

---generate unit tests for all exported functions
---@param parallel boolean
function M.exp(parallel)
  local cmd_args = {}
  if parallel then
    table.insert(cmd_args, '-parallel')
  end

  table.insert(cmd_args, '-exported')
  add_test(cmd_args)
end

return M
