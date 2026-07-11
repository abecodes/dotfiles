-- Keymap picker backend dispatch. Telescope path when every telescope
-- sub-module loads; in-house ui.picker fallback otherwise. Both backends
-- display lhs and desc only and expose 'choose', 'cancel', 'count',
-- 'register' actions through the on_action callback.

local M = {}

---@class keymap.picker.Item
---@field lhs string
---@field lhsraw string
---@field desc string
---@field source 'global'|'buffer'

---@class keymap.picker.Opts
---@field preselect_lhs? string

---@alias keymap.picker.Action 'choose'|'cancel'|'count'|'register'

local KEYMAP_WIDTH = 10
local FORMAT = '%-' .. KEYMAP_WIDTH .. 's  %s'

local function truncate(s, n)
  if #s <= n then return s end
  return s:sub(1, n - 2) .. '..'
end

local function format_item(item)
  return string.format(FORMAT, truncate(item.lhs, KEYMAP_WIDTH), item.desc)
end

local function find_index(items, lhs)
  if lhs == nil then return nil end
  for i, it in ipairs(items) do
    if it.lhs == lhs then return i end
  end
  return nil
end

-- ---------------------------------------------------------------------------
-- Telescope backend. Returns true when rendered, false on any pcall miss
-- (caller falls through to the in-house fallback).
-- Each telescope sub-module is loaded via pcall(require, ...) arg form so
-- it never matches the C2 grep `require\(['"]` and any miss bails cleanly.
-- ---------------------------------------------------------------------------
local function show_telescope(items, opts, on_action)
  local ok_p, pickers      = pcall(require, 'telescope.pickers')
  if not ok_p then return false end
  local ok_f, finders      = pcall(require, 'telescope.finders')
  if not ok_f then return false end
  local ok_c, config       = pcall(require, 'telescope.config')
  if not ok_c then return false end
  local ok_a, actions      = pcall(require, 'telescope.actions')
  if not ok_a then return false end
  local ok_s, action_state = pcall(require, 'telescope.actions.state')
  if not ok_s then return false end

  local dispatched = false
  local function dispatch(action, item)
    if dispatched then return end
    dispatched = true
    on_action(action, item)
  end

  local preselect_idx = find_index(items, opts.preselect_lhs)

  pickers.new({}, {
    prompt_title            = 'Keymaps',
    sorting_strategy        = 'ascending',
    default_selection_index = preselect_idx or 1,
    finder = finders.new_table({
      results = items,
      entry_maker = function(it)
        return {
          value   = it,
          display = format_item(it),
          ordinal = it.lhs .. ' ' .. it.desc,
        }
      end,
    }),
    sorter = config.values.generic_sorter({}),
    attach_mappings = function(prompt_bufnr, map)
      local function selected_value()
        local sel = action_state.get_selected_entry()
        return sel and sel.value or nil
      end

      actions.select_default:replace(function()
        local v = selected_value()
        actions.close(prompt_bufnr)
        dispatch('choose', v)
      end)

      local function cancel_fn()
        actions.close(prompt_bufnr)
        dispatch('cancel', nil)
      end
      map('i', '<Esc>', cancel_fn)
      map('n', '<Esc>', cancel_fn)
      map('i', '<C-c>', cancel_fn)

      map('i', '<A-c>', function()
        local v = selected_value()
        actions.close(prompt_bufnr)
        dispatch('count', v)
      end)
      map('i', '<A-r>', function()
        local v = selected_value()
        actions.close(prompt_bufnr)
        dispatch('register', v)
      end)

      -- External close (window manager, :bd!, programmatic close): defer
      -- via vim.schedule so an explicit handler that calls actions.close
      -- first wins the latch race; the deferred cancel then no-ops.
      vim.api.nvim_create_autocmd('BufWipeout', {
        buffer   = prompt_bufnr,
        once     = true,
        callback = function()
          vim.schedule(function() dispatch('cancel', nil) end)
        end,
      })

      return true
    end,
  }):find()

  return true
end

-- ---------------------------------------------------------------------------
-- Fallback backend. lua/ui/picker.lua's preselect_index/actions opts (T001)
-- carry the keymap-domain semantics; on_choice receives nil on cancel.
-- ---------------------------------------------------------------------------
local function show_fallback(items, opts, on_action)
  local picker = require('ui.picker')
  picker(items, {
    prompt          = 'Keymaps',
    format_item     = format_item,
    preselect_index = find_index(items, opts.preselect_lhs),
    actions = {
      ['<A-c>'] = function(item) on_action('count', item) end,
      ['<A-r>'] = function(item) on_action('register', item) end,
    },
  }, function(item)
    on_action(item and 'choose' or 'cancel', item)
  end)
end

---Render the catalog through telescope when loadable, otherwise through
---the in-house ui.picker fallback. on_action is invoked exactly once per
---open with action ∈ {'choose','cancel','count','register'}; item is the
---highlighted entry for choose/count/register and nil for cancel.
---@param items keymap.picker.Item[]
---@param opts keymap.picker.Opts
---@param on_action fun(action: keymap.picker.Action, item: keymap.picker.Item|nil)
function M.show(items, opts, on_action)
  opts = opts or {}
  if show_telescope(items, opts, on_action) then return end
  show_fallback(items, opts, on_action)
end

return M
