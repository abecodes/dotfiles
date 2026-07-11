-- Minimal in-memory cache. One instance per call site; keys are strings.
--
-- TTL is a per-get argument, not a per-instance one, so the same cache can
-- hold values with different freshness requirements. peek/set support the
-- async-produce-then-sync-read pattern (a background job writes a value,
-- later code reads whatever is there). Values are wrapped in `{ value, time }`
-- so cached `false` / `nil` is distinguishable from a miss.

local M = {}

function M.new()
	local entries = {}

	local function fresh(e, ttl_ms)
		if not e then return false end
		if not ttl_ms or ttl_ms == 0 then return true end
		return (vim.uv.now() - e.time) < ttl_ms
	end

	local self = {}

	---@param key string
	---@param producer fun(): any
	---@param ttl_ms? integer  nil / 0 → never expire
	---@return any
	function self.get(key, producer, ttl_ms)
		local e = entries[key]
		if fresh(e, ttl_ms) then return e.value end
		local v = producer()
		entries[key] = { value = v, time = vim.uv.now() }
		return v
	end

	---@param key string
	---@return any|nil
	function self.peek(key)
		local e = entries[key]
		if not e then return nil end
		return e.value
	end

	---@param key string
	---@param value any
	function self.set(key, value)
		entries[key] = { value = value, time = vim.uv.now() }
	end

	function self.clear() entries = {} end

	return self
end

return M
