-- Timing primitives for the completion aggregator.
--
-- Cursor-snapshot validity, adaptive debounce, and per-context exponential
-- moving RTT are cribbed from runtime/lua/vim/lsp/completion.lua (Neovim
-- 0.12.2) lines 115-145, ~80-90, 1045. Copies live here per-context rather
-- than module-global so multiple buffers/clients don't trample each other's
-- RTT estimates.

local M = {}

local ns_to_ms = 0.000001

-- Per-context exponential moving average. window=10, warmup=10 mirrors the
-- runtime constants (line 132). Stored on the context so each buffer's
-- aggregator owns its own RTT estimate.
local function exp_avg(window, warmup)
  local count = 0
  local sum   = 0
  local value = 0.0
  return function(sample)
    if count < warmup then
      count = count + 1
      sum   = sum + sample
      value = sum / count
    else
      local factor = 2.0 / (window + 1)
      value = value * (1 - factor) + sample * factor
    end
    return value
  end
end

---@param bufnr integer
function M.new_context(bufnr)
  return {
    bufnr             = bufnr,
    cursor            = nil,        -- { row, start_col } snapshot
    start_col         = nil,        -- byte col passed to vim.fn.complete()
    prefix            = '',         -- keyword-tail snapshotted at trigger time
    isIncomplete      = false,
    pending_requests  = {},         -- list of cancel callbacks
    last_request_time = nil,        -- vim.uv.hrtime() at trigger; doubles as
                                    -- generation token — late LSP/timer
                                    -- callbacks with a stale start_time noop.
    rtt_ms            = 10.0,       -- starting estimate; runtime uses 50, but our merged path is buffer+TS heavy
    _avg              = exp_avg(10, 10),
    completion_timer  = nil,        -- uv_timer_t for debounced trigger or
                                    -- emit-soft-timeout (whichever owns it)
  }
end

-- Wait (rtt - elapsed_since_last_request), clamped at 0. If no prior
-- request, fall back to current_rtt to give the first request a stable
-- launch budget.
function M.adaptive_debounce(ctx)
  if not ctx.last_request_time then
    return ctx.rtt_ms
  end
  local ms_since = (vim.uv.hrtime() - ctx.last_request_time) * ns_to_ms
  return math.max((ms_since - ctx.rtt_ms) * -1, 0)
end

function M.compute_new_average(ctx, sample_ms)
  ctx.rtt_ms = ctx._avg(sample_ms)
  return ctx.rtt_ms
end

-- Snapshot the cursor, the word-boundary start_col, AND the keyword-tail
-- prefix at request time. start_col is the byte index (1-based) of the
-- first char of the keyword under the cursor; matches vim.fn.complete()'s
-- col argument. Snapshotting prefix here (instead of at emit time) means
-- buffer/TS scans match the trigger-instant prefix even if the user typed
-- more chars while LSP was in flight — emit re-validates via
-- cursor_still_valid before pushing.
function M.snapshot_cursor(ctx)
  local row, col = unpack(vim.api.nvim_win_get_cursor(0))
  local line     = vim.api.nvim_get_current_line()
  local before   = line:sub(1, col)
  -- vim.fn.match returns 0-indexed byte position of the match.
  local boundary = vim.fn.match(before, '\\k*$')
  ctx.cursor    = { row, col }
  ctx.start_col = boundary + 1
  ctx.prefix    = before:sub(boundary + 1) or ''
  return ctx.cursor, ctx.start_col, ctx.prefix
end

-- Response handler runs scheduled. If the user moved off the request row
-- or backed up past the snapshotted start_col, the in-flight result is
-- stale — drop it. The runtime checks row + insert-mode (line ~983); we
-- additionally guard the start_col so a fast deletion past the keyword
-- boundary discards the response.
function M.cursor_still_valid(ctx)
  if not ctx.cursor then return false end
  local mode = vim.api.nvim_get_mode().mode
  if not (mode == 'i' or mode == 'ic') then return false end
  if vim.api.nvim_get_current_buf() ~= ctx.bufnr then return false end
  local row, col = unpack(vim.api.nvim_win_get_cursor(0))
  if row ~= ctx.cursor[1] then return false end
  if col + 1 < (ctx.start_col or 1) then return false end
  return true
end

function M.cancel_pending(ctx)
  for _, cancel in ipairs(ctx.pending_requests) do
    pcall(cancel)
  end
  ctx.pending_requests = {}
end

function M.reset_timer(ctx)
  if ctx.completion_timer then
    if not ctx.completion_timer:is_closing() then
      ctx.completion_timer:stop()
      ctx.completion_timer:close()
    end
    ctx.completion_timer = nil
  end
  M.cancel_pending(ctx)
end

return M
