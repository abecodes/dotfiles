-- Pure-Lua frecency core: factory producing isolated scoring instances.
--
-- Calling convention: instance methods are invoked with DOT syntax. The
-- factory returns a flat table of plain closures with no `self` parameter,
-- matching the project's `lua/cache.lua` precedent. Colon-call
-- (`instance:record(...)`) silently shifts arguments — `key` binds to the
-- instance table and `event` binds to the intended `key` — producing
-- unknown-event errors on every record, no-op migrate, empty rank, zero
-- score. All consumers in this codebase MUST use dot.
--
-- Future persistence seam (no consumer in this spec):
--   - `opts.on_change: fun()` is read lazily on every `record`/`migrate`
--     call. A future persistence module installs the hook by assigning
--     `opts.on_change = ...` AFTER M.new(opts) returns. The lazy read
--     guarantees the install takes effect for every subsequent call.
--   - `instance.snapshot()` returns `{ version, records }` where `records`
--     is the LIVE map (no defensive copy). The persistence module is the
--     one consumer authorized to mutate through `snapshot().records` (for
--     hydration on load). Any other consumer MUST treat it as read-only.
--
-- Constraint: opts is retained by reference. Do not mutate fields after
-- construction except for `opts.on_change` (the documented install path).

---@class frecency.Record
---@field score number             -- non-negative
---@field reference_time number    -- seconds, opts.now() at last record
---@field last_seen table<string, number>  -- per-event-type last record time

---@class frecency.Snapshot
---@field version integer
---@field records table<string, frecency.Record>

---@class frecency.Opts
---@field event_weights table<string, number>  -- required
---@field half_life number                     -- required, seconds, > 0 and finite
---@field cooldown number                      -- required, seconds, >= 0
---@field now? fun(): number                   -- optional, defaults to os.time
---@field on_change? fun()                     -- optional, fired on state change

---@class frecency.Instance
---@field record fun(key: string, event: string): nil
---@field score fun(key: string): number
---@field rank fun(keys: string[]): string[]
---@field migrate fun(from: string, to: string): nil
---@field snapshot fun(): frecency.Snapshot
---@field flush fun(): nil

local M = {}

-- Bumped only when the on-disk Record shape/semantics change. Future
-- persistence layers compare loaded Snapshot.version to this constant by
-- exact equality and start empty on mismatch.
M.SCHEMA_VERSION = 1

---Create a fresh frecency instance. Each call returns an independent
---closure-based table with its own private records map.
---@param opts frecency.Opts
---@return frecency.Instance
function M.new(opts)
  assert(type(opts) == 'table', '[frecency] opts must be a table')
  assert(
    type(opts.event_weights) == 'table',
    '[frecency] opts.event_weights must be a table<string, number>'
  )
  for ev, w in pairs(opts.event_weights) do
    assert(
      type(w) == 'number',
      '[frecency] opts.event_weights["' .. tostring(ev) .. '"] must be a number'
    )
  end
  assert(
    type(opts.half_life) == 'number' and opts.half_life > 0 and opts.half_life < math.huge,
    '[frecency] opts.half_life must be a positive finite number (seconds)'
  )
  assert(
    type(opts.cooldown) == 'number' and opts.cooldown >= 0,
    '[frecency] opts.cooldown must be a non-negative number (seconds)'
  )
  assert(
    opts.now == nil or type(opts.now) == 'function',
    '[frecency] opts.now must be a function returning seconds, or nil'
  )
  assert(
    opts.on_change == nil or type(opts.on_change) == 'function',
    '[frecency] opts.on_change must be a function or nil'
  )

  local event_weights = opts.event_weights
  local half_life     = opts.half_life
  local cooldown      = opts.cooldown
  local now_fn        = opts.now or os.time

  ---@type table<string, frecency.Record>
  local records = {}

  -- Pure helper. Returns the time-decayed score for a non-nil rec at a
  -- caller-supplied time t. Caller samples t once via now_fn() and passes
  -- the same value through subsequent reads on the same logical operation.
  -- Clamps t against backwards clock jumps (NTP correction, manual change)
  -- so the result never exceeds the stored score.
  local function decayed(rec, t)
    local clamped_t = t
    if clamped_t < rec.reference_time then
      clamped_t = rec.reference_time
    end
    return rec.score * 2 ^ ((rec.reference_time - clamped_t) / half_life)
  end

  local function score(key)
    assert(type(key) == 'string', '[frecency] score: key must be a string')
    local rec = records[key]
    if rec == nil then return 0 end
    return decayed(rec, now_fn())
  end

  local function record(key, event)
    assert(type(key) == 'string', '[frecency] record: key must be a string')
    assert(type(event) == 'string', '[frecency] record: event must be a string')

    local weight = event_weights[event]
    if weight == nil then
      error('[frecency] unknown event: ' .. tostring(event), 0)
    end

    local t = now_fn()
    local rec = records[key]

    if rec ~= nil then
      local last = rec.last_seen[event]
      if last ~= nil and (t - last) < cooldown then
        -- Cooldown gate: complete no-op (no score change, no last_seen
        -- update, no on_change fire).
        return
      end
      -- Re-anchor: read time-decayed score with the same t we sampled
      -- above, add the weight, advance reference_time and last_seen[event].
      -- Field-level mutation (not table replacement) preserves the
      -- last_seen table identity for any captured references.
      rec.score            = decayed(rec, t) + weight
      rec.reference_time   = t
      rec.last_seen[event] = t
    else
      -- First record for this key. No cooldown applies. Decay multiplier
      -- on a fresh anchor is 1, so stored score equals the weight.
      records[key] = {
        score          = weight,
        reference_time = t,
        last_seen      = { [event] = t },
      }
    end

    -- Lazy field access: persistence module (future) may install via
    -- opts.on_change = ... after M.new returns; the read here picks it up.
    if opts.on_change ~= nil then opts.on_change() end
  end

  local function rank(keys)
    assert(type(keys) == 'table', '[frecency] rank: keys must be a table')
    local n = #keys
    if n == 0 then return {} end

    -- Sample t exactly once and feed the same value into decayed for every
    -- key. A non-idempotent injected now (e.g. a counter used in tests)
    -- therefore cannot skew tie ordering across keys.
    local t = now_fn()
    local decorated = {}
    for i = 1, n do
      local rec = records[keys[i]]
      local s = (rec ~= nil) and decayed(rec, t) or 0
      decorated[i] = { key = keys[i], score = s, idx = i }
    end

    -- Decorate-sort-undecorate for stable descending sort. LuaJIT
    -- table.sort is NOT stable; idx tiebreak preserves input order.
    table.sort(decorated, function(a, b)
      if a.score ~= b.score then
        return a.score > b.score
      end
      return a.idx < b.idx
    end)

    local out = {}
    for i = 1, n do
      out[i] = decorated[i].key
    end
    return out
  end

  local function migrate(from, to)
    assert(type(from) == 'string', '[frecency] migrate: from must be a string')
    assert(type(to) == 'string', '[frecency] migrate: to must be a string')
    if from == to then return end
    local rec = records[from]
    if rec == nil then return end
    -- Relocate the same Record table (preserves last_seen identity for any
    -- external references). If `to` had a record, it is overwritten and
    -- the prior contents are discarded.
    records[to]   = rec
    records[from] = nil
    if opts.on_change ~= nil then opts.on_change() end
  end

  local function snapshot()
    -- Returns the LIVE records map. Future persistence module is
    -- authorized to mutate via this seam (e.g. hydrating on load); any
    -- other consumer MUST treat it as read-only.
    return { version = M.SCHEMA_VERSION, records = records }
  end

  -- DEC-007: `flush` is on the instance shape regardless of whether
  -- persistence is attached. Core installs a no-op; a future persistence
  -- module replaces it in place with a real synchronous-flush impl.
  local function flush() end

  return {
    record   = record,
    score    = score,
    rank     = rank,
    migrate  = migrate,
    snapshot = snapshot,
    flush    = flush,
  }
end

return M
