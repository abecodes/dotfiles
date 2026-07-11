-- Module-singleton frecency core for completion accepts. Lazily allocated
-- so requiring this file is cheap. State is session-only — cross-session
-- persistence is a separate follow-up via the on_change seam in
-- frecency/init.lua.
--
-- TODO(persistence): cross-session memory of accepted completions.
-- The frecency core (lua/frecency/init.lua) already exposes the
-- `on_change` and `flush()` seams for a persistence layer; nothing here
-- uses them. Sketch:
--   * Hydrate `instance` on first M.attach() from a JSON blob in
--     stdpath('data') / 'completion-frecency.json' (see
--     frecency.snapshot() for the on-disk shape; bump SCHEMA_VERSION on
--     incompatible changes).
--   * Install on_change to mark dirty + schedule a debounced atomic
--     write (write-to-tmpfile + os.rename) so a crash mid-write doesn't
--     corrupt the store.
--   * Flush on VimLeavePre.
-- Without this, ranking starts cold every session — the bias is real
-- but ephemeral.

local frecency = require('frecency')

local M = {}

local instance

-- Idempotent. cooldown=0 because every accept is signal — there is no
-- clustering equivalent to BufEnter to suppress. half_life=3600 (1h) is a
-- starting heuristic.
function M.attach()
  instance = instance or frecency.new({
    event_weights = { accept = 100 },
    half_life     = 3600,
    cooldown      = 0,
  })
end

-- Read the just-accepted item out of v:completed_item. CompleteDonePre
-- fires on every dismiss/accept; v:completed_item is empty on dismiss.
-- Falls through to the LSP completion_item.label when `word` is missing
-- (some user_convert hooks could blank it).
function M.record_accept()
  if instance == nil then return end
  local ev = vim.v.event or {}
  local reason = ev.reason
  if reason ~= nil and reason ~= 'accept' then return end

  local ci = vim.v.completed_item or {}
  if vim.tbl_isempty(ci) then return end

  local key = ci.word
  if (key == nil or key == '') and ci.user_data and ci.user_data.nvim then
    local lsp = ci.user_data.nvim.lsp
    if lsp and lsp.completion_item then
      key = lsp.completion_item.label
    end
  end
  if key == nil or key == '' then return end

  instance.record(key, 'accept')
end

-- Stable rerank: every input item with a tracked frecency score sorts
-- ahead of zero-score items, preserving original order on ties via the
-- core's idx tiebreak. Items with no `word` field are skipped (defensive
-- — every source emits one).
function M.rank_items(items)
  if instance == nil or #items == 0 then return items end

  local words = {}
  local by_word = {}
  for _, it in ipairs(items) do
    local w = it.word
    if w then
      words[#words + 1] = w
      -- A word might appear twice if a duplicate slipped past the
      -- aggregator dedupe. Last-wins is fine for ordering — we only
      -- need ONE item back per ranked word.
      by_word[w] = it
    end
  end

  local ranked = instance.rank(words)
  local out = {}
  for i, w in ipairs(ranked) do
    out[i] = by_word[w]
  end
  return out
end

return M
