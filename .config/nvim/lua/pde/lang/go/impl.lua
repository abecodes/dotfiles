local utils          = require('utils')
local node_at_cursor = require('pde.lang.go._node_at_cursor')
local logger         = require('logger')

-- shameless plug of https://github.com/olexsmir/gopher.nvim/blob/main/lua/gopher/_utils/ts/init.lua
local querys = {
	struct_block = [[((type_declaration (type_spec name:(type_identifier) @struct.name type: (struct_type)))@struct.declaration)]],
	em_struct_block = [[(field_declaration name:(field_identifier)@struct.name type: (struct_type)) @struct.declaration]],
}

local get_struct_node_at_pos = function(row, col, bufnr)
	-- TODO: simplify to just get node at cursor and check if struct
  local query = querys.struct_block .. ' ' .. querys.em_struct_block
  return node_at_cursor(query, bufnr, row, col, 'struct not found')
end

---@return string name
---@return integer end_row 1-based row where the struct declaration ends (0 when no struct)
local function get_struct()
  local ns = get_struct_node_at_pos(unpack(vim.api.nvim_win_get_cursor(0)))
  if ns == nil then
    return '', 0
  end

  -- ns.dim.e.c is 1-based (see _ts_nodes.lua); nvim_win_set_cursor wants 0-based col.
  vim.api.nvim_win_set_cursor(0, {
    ns.dim.e.r,
    math.max(0, ns.dim.e.c - 1),
  })

  return ns.name, ns.dim.e.r
end

return function(data)
  local args = data.fargs
  local iface, recv_name = '', ''
  local recv, struct_end_row = get_struct()

	if recv == '' and #args < 3 then
    logger.info('[impl] put cursor on a struct or specify a receiver')
		return
	end

  if #args == 0 then
    iface = vim.fn.input('generating method stubs for interface: ')
    vim.cmd('redraw!')
    if iface == '' then
      logger.info('usage: GoImpl f *File io.Reader')
      return
    end
  elseif #args == 1 then -- :GoImpl io.Reader
    recv = string.lower(vim.fn.strcharpart(recv, 0, 1)) .. ' *' .. recv
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
    '-dir',
    vim.fn.expand('%:p:h'),
    recv,
    iface
  }

  local res = utils.proc.run_sync({ 'impl', unpack(cmd_args) })
  if res.code ~= 0 then
    logger.error(utils.proc.format_err('impl ' .. table.concat(cmd_args, ' '), res.code, res.stderr))
    return
  end

  local res_data = vim.split(res.stdout, '\n')
  if res_data[#res_data] == '' then table.remove(res_data) end
  if #res_data == 0 then return end

  table.insert(res_data, 1, '')
  vim.fn.append(struct_end_row, res_data)
end
