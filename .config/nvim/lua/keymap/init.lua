local catalog = require('keymap.catalog')
local picker = require('keymap.picker')
local logger = require('logger')

local M = {}

---Build the byte string and feed it once with mode 'm'.
---@param originating_mode string  'n' | 'v' | 'V' | '\22'
---@param item table              { lhs, lhsraw, desc, source }
---@param modifier_prefix string  '' | '<count>' | '"<reg>'
local function feed_keys(originating_mode, item, modifier_prefix)
	local visual_prefix = (originating_mode ~= 'n') and 'gv' or ''
	local lhs_replaced = vim.api.nvim_replace_termcodes(item.lhs, true, false, true)
	local keys = visual_prefix .. (modifier_prefix or '') .. lhs_replaced
	vim.api.nvim_feedkeys(keys, 'm', false)
end

---Open the keymap picker. Captures the originating mode at call time,
---snapshots the catalog, warns and bails when the snapshot is empty,
---otherwise hands off to picker.show. Defines a closure-recursive
---show_picker so the count/register cancel/invalid path can re-open
---with the originally-highlighted entry preselected (DEC-007).
function M.open()
	local originating_mode = vim.fn.mode():sub(1, 1)
	local items = catalog.snapshot(originating_mode)
	if #items == 0 then
		logger.warn('[keymap] no described keymaps in this mode')
		return
	end

	local show_picker
	show_picker = function(picker_items, picker_mode, preselect_lhs)
		local function on_action(action, item)
			if action == 'choose' then
				feed_keys(picker_mode, item, '')
			elseif action == 'cancel' then
				if picker_mode ~= 'n' then
					vim.api.nvim_feedkeys('gv', 'm', false)
				end
			elseif action == 'count' then
				local preselect = item and item.lhs or nil
				vim.ui.input({ prompt = 'count' }, function(value)
					if type(value) ~= 'string' then
						show_picker(picker_items, picker_mode, preselect)
						return
					end
					if value:match('^[1-9][0-9]*$') then
						if not item then return end
						feed_keys(picker_mode, item, value)
					else
						logger.error('[keymap] invalid count: ' .. vim.inspect(value))
						show_picker(picker_items, picker_mode, preselect)
					end
				end)
			elseif action == 'register' then
				local preselect = item and item.lhs or nil
				vim.ui.input({ prompt = 'register' }, function(value)
					if type(value) ~= 'string' then
						show_picker(picker_items, picker_mode, preselect)
						return
					end
					if value:match('^[a-zA-Z0-9"+*/=#%%.:_-]$') then
						if not item then return end
						feed_keys(picker_mode, item, '"' .. value)
					else
						logger.error('[keymap] invalid register: ' .. vim.inspect(value))
						show_picker(picker_items, picker_mode, preselect)
					end
				end)
			end
		end
		picker.show(picker_items, { preselect_lhs = preselect_lhs }, on_action)
	end

	show_picker(items, originating_mode, nil)
end

require('utils.keys').map_key(
	{ 'n', 'x' },
	'<leader>kk',
	M.open,
	{ silent = true, desc = 'Keymap picker' }
)

return M
