-- Presentation layer for the frecency-ranked buffer picker.
--
-- Renders a pre-ranked list of { bufnr, path, score } items either through
-- Telescope (if loadable at invocation time) or through the in-house
-- lua/ui/picker.lua fallback. Selection switches the current buffer.
--
-- The Telescope path keeps frecency biasing during typing: a hammered
-- buffer outranks a stale-but-closer-fzy-match. The combiner is
--
--   empty prompt → entry.frecency_term
--   non-empty    → fzy + ALPHA * entry.frecency_term
--
-- where frecency_term = -log(1 + score) (lower-is-better, telescope
-- convention) and ALPHA = 0.1 keeps both terms on comparable scales.
--
-- We use telescope's standard Sorter:new pipeline (discard = true) so
-- telescope's built-in _was_discarded cache short-circuits non-matches
-- automatically. No custom discard cache, no start callback.
--
-- Data-only — does NOT depend on the frecency core. The data contract
-- (item shape) is owned by lua/frecency/buffer.lua.

local M = {}

---@class frecency.buffer_picker.Item
---@field bufnr integer
---@field path string
---@field score number

local ALPHA = 0.1

-- Smaller is better (telescope convention; sorters.lua:32-34).
-- A bigger raw score yields a more-negative term, ranking the item higher
-- under telescope's ascending comparator. math.max(0, score) defends
-- against any caller passing a negative score (the core invariant forbids
-- it but the picker doesn't trust input).
local function frecency_term(score)
  return -math.log(1 + math.max(0, score or 0))
end

-- Tabular layout: right-aligned score, two spaces, then a cwd-relative
-- path. Defensive nil-check on item.path: type annotations are not
-- runtime-enforced and the picker is the boundary between caller-supplied
-- data and Neovim API; a misshapen item produces a debuggable display
-- rather than a confusing error inside fnamemodify.
local function format_item(item)
  if item.path == nil then
    return string.format('%7.2f  <unknown>', item.score or 0)
  end
  local rel = vim.fn.fnamemodify(item.path, ':~:.')
  return string.format('%7.2f  %s', item.score, rel)
end

-- Selection handler shared by both backends.
local function select_buffer(bufnr)
  if bufnr == nil then return end
  if not vim.api.nvim_buf_is_valid(bufnr) then return end
  vim.api.nvim_set_current_buf(bufnr)
end

-- ---------------------------------------------------------------------------
-- Telescope backend.
-- ---------------------------------------------------------------------------
local function telescope_render(items)
  local pickers      = require('telescope.pickers')
  local finders      = require('telescope.finders')
  local sorters      = require('telescope.sorters')
  local actions      = require('telescope.actions')
  local action_state = require('telescope.actions.state')
  local conf         = require('telescope.config').values

  local fzy_sorter = sorters.get_fzy_sorter({})

  local frecency_sorter = sorters.Sorter:new({
    discard = true,  -- enables telescope's built-in _was_discarded cache
    -- scoring_function returns SMALLER-IS-BETTER (telescope convention).
    -- Return -1 for non-match (telescope marks the entry discarded and
    -- short-circuits subsequent prompt evaluations until _start resets the
    -- cache). The non-match test MUST be `fzy < 0`, NOT `<= 0`: exact
    -- matches encode as fzy_score = 0 (sorters.lua:464 inline comment),
    -- and `<= 0` silently drops them. The reference impl
    -- telescope-frecency.nvim has the `<= 0` bug; we don't replicate it.
    scoring_function = function(_, prompt, _, entry)
      if prompt == nil or prompt == '' then
        return entry.frecency_term
      end
      local fzy = fzy_sorter.scoring_function(nil, prompt, entry.ordinal)
      if fzy < 0 then return -1 end
      return fzy + ALPHA * entry.frecency_term
    end,
    highlighter = fzy_sorter.highlighter,
  })

  pickers.new({}, {
    prompt_title     = 'Frecency buffers',
    sorting_strategy = 'ascending',  -- visual fill direction; comparator is in scoring_function
    finder = finders.new_table({
      results = items,
      ---@param item frecency.buffer_picker.Item
      entry_maker = function(item)
        return {
          value         = item,
          display       = format_item(item),
          ordinal       = item.path or '',
          bufnr         = item.bufnr,
          path          = item.path,
          score         = item.score,
          -- Pre-compute once per result-set repopulation. entry_maker runs
          -- only when results change, not on every keystroke, so this
          -- avoids per-key math.log over the buffer list.
          frecency_term = frecency_term(item.score),
        }
      end,
    }),
    previewer = conf.grep_previewer({}),
    sorter    = frecency_sorter,
    attach_mappings = function(prompt_bufnr, _)
      actions.select_default:replace(function()
        local selected = action_state.get_selected_entry()
        actions.close(prompt_bufnr)
        select_buffer(selected and selected.bufnr or nil)
      end)
      return true
    end,
  }):find()
end

-- ---------------------------------------------------------------------------
-- ui.picker fallback. Verified signature at lua/ui/picker.lua:14:
--   return function(items, opts, on_choice)
-- where opts may include `prompt`, `format_item`, `preview`,
-- `preview_filetype`, `on_refresh`. Items are already pre-ranked, so the
-- fallback shows them in input order — no fuzzy biasing in this path
-- (acceptable: this is the degraded mode used only when telescope is
-- absent).
-- ---------------------------------------------------------------------------
local function ui_picker_render(items)
  local picker = require('ui.picker')
  picker(items, {
    prompt      = 'Frecency buffers',
    format_item = format_item,
  }, function(item, _idx)
    if item == nil then return end
    select_buffer(item.bufnr)
  end)
end

-- ---------------------------------------------------------------------------
-- Public entry point.
-- ---------------------------------------------------------------------------

---Render a pre-ranked list of buffer items through Telescope or the
---in-house ui.picker fallback. Caller owns sorting and filtering. Empty
---input short-circuits before either backend is touched.
---@param items frecency.buffer_picker.Item[]
function M.show(items)
  if items == nil or #items == 0 then return end

  -- pcall(require, 'telescope') is NOT cached in package.loaded on
  -- failure. A runtime install of telescope starts working on the next
  -- show() call; a broken telescope re-evaluates each time and falls
  -- through to ui.picker (acceptable: user gets a working picker either
  -- way).
  local ok, _ = pcall(require, 'telescope')
  if ok then
    telescope_render(items)
  else
    ui_picker_render(items)
  end
end

return M
