local get_hex = require('cokeline/utils').get_hex
local is_picking_focus = require('cokeline/mappings').is_picking_focus
local is_picking_close = require('cokeline/mappings').is_picking_close

local red = vim.g.terminal_color_1
local yellow = vim.g.terminal_color_3
-- local modified_fg = get_hex('Todo', 'bg')
local modified_fg = '#09F7A0'
local errors_fg = get_hex('DiagnosticError', 'fg')
local warnings_fg = get_hex('DiagnosticWarn', 'fg')

require('cokeline').setup({
	show_if_buffers_are_at_least = 2,
  default_hl = {
    focused = {
      fg = get_hex('Normal', 'fg'),
      bg = 'NONE',
    },
    unfocused = {
      fg = get_hex('Comment', 'fg'),
      bg = 'NONE',
    },
  },

  components = {
    {
      text = function(buffer) return (buffer.index ~= 1) and '▏' or '' end,
      hl = {
        fg = get_hex('Normal', 'fg')
      },
    },
    -- {
    --   text = function(buffer) return '    ' .. buffer.devicon.icon end,
    --   hl = {
    --     fg = function(buffer) return buffer.devicon.color end,
    --   },
    -- },
    {
      text = '  ',
    },
		{
			text = function(buffer)
				if buffer.is_focused then
					return buffer.devicon.icon
				else
					return
					(is_picking_focus() or is_picking_close())
						and buffer.pick_letter .. ' '
						or buffer.devicon.icon
				end
			end,
			hl = {
				fg = function(buffer)
					if buffer.is_focused then
						return buffer.devicon.color
					else
						return
						(is_picking_focus() and yellow)
							or (is_picking_close() and red)
					end
				end,
				style = function(buffer)
					if buffer.is_focused then
						return nil
					else
						return
						(is_picking_focus() or is_picking_close())
						and 'italic,bold'
						or nil
					end
				end,
			}
		},
    {
      text = function(buffer) return buffer.filename end,
      hl = {
        style = function(buffer) return buffer.is_focused and 'bold' or nil end,
      }
    },
		{
			text = ' '
		},
		{
			text = function(buffer)
				return
					(buffer.diagnostics.errors ~= 0 and '  ' .. buffer.diagnostics.errors)
					or (buffer.diagnostics.warnings ~= 0 and '  ' .. buffer.diagnostics.warnings)
					or ''
			end,
			hl = {
				fg = function(buffer)
					return
						(buffer.diagnostics.errors ~= 0 and errors_fg)
						or (buffer.diagnostics.warnings ~= 0 and warnings_fg)
						or nil
				end,
			},
			truncation = { priority = 2 },
		},
		{
			text = ' '
		},
		{
			text = function(buffer)
				return buffer.is_modified and '●' or ''
			end,
			hl = {
				fg = function(buffer)
					return buffer.is_modified and modified_fg or nil
				end
			},
			truncation = { priority = 5 },
		},
    -- {
    --   text = '',
    --   delete_buffer_on_left_click = true,
    -- },
    {
      text = '  ',
    },
  },
})
