-- Buffer use case for the frecency module.
--
-- Tracks `enter` and `write` events for non-UI, named buffers, migrates
-- records on in-editor renames (`:saveas`, `:file`), and exposes a pick()
-- entry point that ranks listed buffers and dispatches to the picker
-- module in lua/frecency/buffer_picker.lua.
--
-- Scope notes:
--
-- * LSP-driven rename handling (workspace/willRenameFiles /
--   workspace/didRenameFiles) is a PLANNED future improvement and is NOT
--   implemented here. When an LSP server renames a file under the
--   project, this module will not see a BufFilePost for the affected
--   buffers and the frecency record under the old path will linger until
--   it decays. (REQ-019)
--
-- * External / out-of-editor renames — shell `mv`, `git mv`, edits made
--   by other editors — are explicitly OUT OF SCOPE for this feature.
--   The frecency record under the old path will remain; re-opening the
--   file at its new path starts a fresh record. (REQ-020)

local frecency        = require('frecency')
local utils_ui_buffer = require('utils.ui_buffer')
local autocmd         = require('utils.autocmd')

local M = {}

-- Module-local state, shared across all autocmd handler closures.
--
-- `instance` is the frecency core instance for buffer ranking. Allocated
-- lazily on first attach() so requiring this file is cheap. Reused
-- across attach() calls so re-attach (e.g. :source %, :Lazy reload) does
-- not drop accumulated session state — REQ-016 mandates intra-session
-- persistence even past :bdelete.
local instance

-- `bufnr_to_path` maps bufnr → absolute path, set on filter-passing
-- BufEnter and updated on BufFilePost; cleared on BufDelete / BufWipeout.
-- Authoritative source for the OLD path on BufFilePost (where the buffer's
-- own name has already been updated to NEW).
local bufnr_to_path = {}

-- ---------------------------------------------------------------------------
-- Filters
-- ---------------------------------------------------------------------------

-- Both filters MUST live in this module — adding the non-empty-path check
-- to utils.ui_buffer.is_ui_buffer is forbidden by project constraint.
local function is_trackable(bufnr, path)
  if utils_ui_buffer.is_ui_buffer(bufnr) then return false end
  if path == nil or path == '' then return false end
  return true
end

-- ---------------------------------------------------------------------------
-- Autocmd handlers
-- ---------------------------------------------------------------------------

-- BufEnter → record('enter') after filters; populate bufnr_to_path so
-- BufFilePost can recover the pre-rename path.
local function on_buf_enter(ev)
  if utils_ui_buffer.is_ui_buffer(ev.buf) then return end
  local path = vim.api.nvim_buf_get_name(ev.buf)
  if path == '' then return end
  bufnr_to_path[ev.buf] = path
  instance.record(path, 'enter')
end

-- BufWritePost → record('write'). Reads bufnr_to_path first as the
-- authoritative path source set by BufEnter; falls back to
-- nvim_buf_get_name when no tracked BufEnter occurred (e.g. plugin-
-- created buffers written without focus).
local function on_buf_write(ev)
  if utils_ui_buffer.is_ui_buffer(ev.buf) then return end
  local path = bufnr_to_path[ev.buf]
  if path == nil then
    path = vim.api.nvim_buf_get_name(ev.buf)
    if path == '' then return end
  end
  instance.record(path, 'write')
end

-- BufFilePost → migrate(old_path, new_path). Filter scope: is_ui_buffer
-- ONLY (the non-empty-path filter is intentionally skipped so :saveas
-- from an unnamed buffer can migrate; the core's migrate already no-ops
-- on absent `from` records). When BufFilePost fires, the rename has
-- already landed on the buffer's name, so nvim_buf_get_name returns the
-- NEW path; bufnr_to_path holds the OLD path.
local function on_buf_file_post(ev)
  if utils_ui_buffer.is_ui_buffer(ev.buf) then return end
  local old_path = bufnr_to_path[ev.buf]
  if old_path == nil then return end
  local new_path = vim.api.nvim_buf_get_name(ev.buf)
  bufnr_to_path[ev.buf] = new_path
  instance.migrate(old_path, new_path)
end

-- BufDelete / BufWipeout → drop the bufnr from the map. The frecency
-- record under the path is left in place — REQ-016 mandates intra-session
-- persistence after :bdelete so re-opening the file restores it.
local function on_buf_unload(ev)
  bufnr_to_path[ev.buf] = nil
end

-- ---------------------------------------------------------------------------
-- Public API
-- ---------------------------------------------------------------------------

---Install the autocommand wiring for buffer frecency tracking. Idempotent
---— safe to call twice; the named augroup is cleared on each call and the
---instance / bufnr_to_path module-locals are reused across re-attach so
---accumulated session state survives.
---@return nil
function M.attach()
  instance = instance or frecency.new({
    event_weights = { enter = 100, write = 2000 },
    half_life     = 1800,
    cooldown      = 5,
  })

  local grp = autocmd.new_augroup('codes.abe.frecency.buffer')

  autocmd.new_autocmd('BufEnter',                    grp, { callback = on_buf_enter })
  autocmd.new_autocmd('BufWritePost',                grp, { callback = on_buf_write })
  autocmd.new_autocmd('BufFilePost',                 grp, { callback = on_buf_file_post })
  autocmd.new_autocmd({ 'BufDelete', 'BufWipeout' }, grp, { callback = on_buf_unload })
end

---Open a frecency-ranked picker over listed buffers. Listed-but-not-loaded
---buffers (arglist entries, :badd) are included; their absence from the
---frecency store yields score = 0 so they appear at the bottom.
---No-op if attach() has not run.
---@return nil
function M.pick()
  if instance == nil then return end

  -- Enumerate listed buffers and build path → bufnr in one pass; the
  -- post-rank rejoin is then O(n).
  local path_to_bufnr = {}
  local keys          = {}

  for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
    if vim.fn.buflisted(bufnr) == 1 then
      local path = vim.api.nvim_buf_get_name(bufnr)
      if is_trackable(bufnr, path) then
        -- Two listed buffers sharing an absolute path is rare (pathological
        -- :saveas sequences). Last-wins; the picker only needs one bufnr
        -- per path because switching to either is observably equivalent.
        path_to_bufnr[path] = bufnr
        keys[#keys + 1]     = path
      end
    end
  end

  local ranked_keys = instance.rank(keys)

  local items = {}
  for i, path in ipairs(ranked_keys) do
    items[i] = {
      bufnr = path_to_bufnr[path],
      path  = path,
      score = instance.score(path),
    }
  end

  -- Lazy-require the picker so loading buffer.lua at startup does not
  -- pull picker code into memory until the user actually opens it.
  -- Always dispatch (including the empty-items case): the picker module
  -- short-circuits empty input internally so no window opens.
  require('frecency.buffer_picker').show(items)
end

return M
