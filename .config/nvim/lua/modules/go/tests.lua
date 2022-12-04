local utils = require('utils')
local ts_utils = require('ts_utils')
local logger = require('logger')

-- shameless plug of https://github.com/olexsmir/gopher.nvim/blob/main/lua/gopher/_utils/ts/init.lua
local querys = {
	method_name = [[((method_declaration receiver: (parameter_list)@method.receiver name: (field_identifier)@method.name body:(block))@method.declaration)]],
	func = [[((function_declaration name: (identifier)@function.name) @function.declaration)]],
}

---@return table
local get_name_defaults = function()
  return {
    ['func'] = 'function',
    ['if'] = 'if',
    ['else'] = 'else',
    ['for'] = 'for',
  }
end

---@param row string
---@param col string
---@param bufnr string|nil
---@param do_notify boolean|nil
---@return table|nil
local get_func_method_node_at_pos = function(row, col, bufnr, do_notify)
  local notify = do_notify or true
  local query = querys.func .. " " .. querys.method_name
  local bufn = bufnr or vim.api.nvim_get_current_buf()
  local ns = ts_utils.nodes_at_cursor(query, get_name_defaults(), bufn, row, col)
  if ns == nil then
    if notify then
      logger.debug("function not found")
    end
  else
    return ns[#ns]
  end
end

local M = {}

---@param cmd_args table
local function run(cmd_args)
	local cmd = { 'gotests', unpack(cmd_args) }

	utils.run_external(
		cmd,
		{
			cwd = utils.get_filedir(),
			on_exit = function(_, retval)
				if retval ~= 0 then
					logger.warn('command "gotests ' .. unpack(cmd_args) .. '" exited with code ' .. retval)
					return
				end

				logger.log('unit test(s) generated')
			end,
		}
	)
end

---@param args table
local function add_test(args)
  -- local fpath = vim.fn.expand('%')
  table.insert(args, '-w')
  table.insert(args, utils.get_filename())
  run(args)
end

---generate unit test for one function
---@param parallel boolean
function M.add(parallel)
  local ns = get_func_method_node_at_pos(unpack(vim.api.nvim_win_get_cursor(0)))
  if ns == nil or ns.name == nil then
    logger.print('[gotests] place cursor on func/method and execute the command again')
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
