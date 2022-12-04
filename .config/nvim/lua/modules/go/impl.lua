local Job = require 'plenary.job'
local ts_utils = require 'ts_utils'
local logger = require 'logger'

-- shameless plug of https://github.com/olexsmir/gopher.nvim/blob/main/lua/gopher/_utils/ts/init.lua
local querys = {
	struct_block = [[((type_declaration (type_spec name:(type_identifier) @struct.name type: (struct_type)))@struct.declaration)]],
	em_struct_block = [[(field_declaration name:(field_identifier)@struct.name type: (struct_type)) @struct.declaration]],
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

local get_struct_node_at_pos = function(row, col, bufnr)
  local query = querys.struct_block .. ' ' .. querys.em_struct_block
  local bufn = bufnr or vim.api.nvim_get_current_buf()
	-- TODO: simplify to just get node at cursor and check if struct
  local ns = ts_utils.nodes_at_cursor(query, get_name_defaults(), bufn, row, col)
  if ns == nil then
		logger.debug('struct not found')
  else
    return ns[#ns]
  end
end

---@return string
local function get_struct()
  local ns = get_struct_node_at_pos(unpack(vim.api.nvim_win_get_cursor(0)))
  if ns == nil then
    logger.log('[impl] put cursor on a struct or specify a receiver')
    return ''
  end

  vim.api.nvim_win_set_cursor(0, {
    ns.dim.e.r,
    ns.dim.e.c,
  })

  return ns.name
end

return function(data)
  local args = data.fargs
  local iface, recv_name = '', ''
  local recv = get_struct()

	if recv == '' then
		return
	end

  if #args == 0 then
    iface = vim.fn.input('generating method stubs for interface: ')
    vim.cmd('redraw!')
    if iface == '' then
      logger.log('usage: GoImpl f *File io.Reader')
      return
    end
  elseif #args == 1 then -- :GoImpl io.Reader
    recv = string.lower(recv) .. ' *' .. recv
    vim.cmd 'redraw!'
    iface = args[1]
  elseif #args == 2 then -- :GoImpl w io.Writer
    recv_name = args[1]
    recv = string.format('%s *%s', recv_name, recv)
    iface = args[#args]
  elseif #args > 2 then
    iface = args[#args]
    recv = args[#args - 1]
    recv_name = args[#args - 2]
    recv = string.format('%s %s', recv_name, recv)
  end

  local cmd_args = {
    '-dir', vim.fn.fnameescape(vim.fn.expand '%:p:h'),
    recv,
    iface
  }

  local res_data
  Job:new({
    command = 'impl',
    args = cmd_args,
    on_exit = function(data, retval)
      if retval ~= 0 then
        logger.warn('command "impl ' .. unpack(cmd_args) .. '" exited with code ' .. retval)
        return
      end

      res_data = data:result()
    end,
  }):sync()

  local pos = vim.fn.getcurpos()[2]
  table.insert(res_data, 1, '')
  vim.fn.append(pos, res_data)
end
