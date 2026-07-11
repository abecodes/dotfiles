-- Mutable module-local options for the completion stack. init.lua's
-- setup() merges user opts in here at config-load time. Other modules
-- read from M.opts at call time so a setup() call after first attach
-- still takes effect on subsequent triggers.

local M = {}

M.opts = {
  -- Truncate `abbr` (the displayed completion text) to this many cells.
  -- Long LSP labels otherwise push the docs side-popup off-screen.
  max_label = 15,
  -- Truncate the `menu` column (LSP detail / function signature) to this
  -- many cells. Function signatures from gopls/rust-analyzer are often
  -- 60+ chars; truncating keeps the pum slim so the docs popup has room.
  max_menu  = 30,

  -- Per-kind item caps applied AFTER frecency rank, BEFORE pushing to the
  -- pum. Keys match the LSP CompletionItemKind names plus 'Buffer' /
  -- 'Treesitter' for our custom sources. `default` covers any kind not
  -- listed.
  caps = {
    Text       = 2,
    Buffer     = 2,
    Treesitter = 2,
    Function   = 3,
    Method     = 3,
    Field      = 3,
    Property   = 3,
    default    = 5,
  },

  -- Nerd-font icons replacing the textual kind label in the pum's `kind`
  -- column. Override per-kind via setup({ icons = { Function = '...' } }).
  icons = require('completion.icons'),

  -- Highlight groups assigned per kind via the `kind_hlgroup` field of
  -- vim.fn.complete()'s items. Maps to treesitter capture groups by
  -- default so colors track the active colorscheme. Override per-kind
  -- via setup({ highlights = { Function = 'Special' } }).
  highlights = {
    Text          = '@string',
    Method        = '@function.method',
    Function      = '@function',
    Constructor   = '@constructor',
    Field         = '@field',
    Variable      = '@variable',
    Class         = '@type',
    Interface     = '@type',
    Module        = '@module',
    Property      = '@property',
    Unit          = '@number',
    Value         = '@constant',
    Enum          = '@type',
    Keyword       = '@keyword',
    Snippet       = '@string',
    Color         = '@string.special',
    File          = 'Directory',
    Reference     = '@variable',
    Folder        = 'Directory',
    EnumMember    = '@constant',
    Constant      = '@constant',
    Struct        = '@type',
    Event         = '@function',
    Operator      = '@operator',
    TypeParameter = '@type',
    Buffer        = 'Comment',
    Treesitter    = 'Comment',
    default       = 'Pmenu',
  },

  -- Source scope and behavior.
  sources = {
    -- 'current'    = scan only the current buffer (cheapest)
    -- 'all_loaded' = scan every loaded + listed buffer (cross-file words)
    buffer_scope = 'all_loaded',
  },

  -- Trigger debounces. Adjust higher for slow typers, lower for snappier
  -- response on fast typing.
  debounce = {
    -- ms to wait after a regular keyword keystroke before firing the
    -- aggregator (TextChangedI path). Defaulted to 500 for a measured
    -- typing pace; drop to 80-150 for fast typers.
    text_changed_ms = 500,
    -- ms to wait after a trigger character (`.`, `:`, etc.) before firing
    -- the LSP request. Lower = snappier; LSP servers are fine with this.
    trigger_char_ms = 25,
  },

  -- Loading-state placeholder. When the LSP hasn't responded after
  -- threshold_ms, the pum shows a single "Loading…" sentinel so the user
  -- knows something is in flight. Replaced by real items when the LSP
  -- (or the soft timeout) arrives. Set enabled=false to disable.
  loading = {
    enabled      = true,
    threshold_ms = 150,
    label        = 'Loading…',
    -- icon defaults to icons.default if nil
    icon         = nil,
  },

  -- Docs side-popup constraints. Nil → no cap on that axis (default Vim
  -- sizing). Both default to capped values to prevent giant docstrings
  -- from eating the screen.
  docs = {
    max_width  = 60,
    max_height = 20,
    -- Initial RTT estimate for completionItem/resolve. Lower = first
    -- docs popup appears sooner. Subsequent requests track real RTT via
    -- the EMA in docs.lua.
    initial_rtt_ms = 50,
  },
}

---Merge user opts into M.opts. Shallow-merge for top-level keys; nested
---tables (`caps`, `icons`, `highlights`, `docs`, `loading`, `debounce`,
---`sources`) are merged with `'force'` so users can override individual
---entries without restating the whole map.
---@param user_opts table?
function M.merge(user_opts)
  if not user_opts then return end
  for k, v in pairs(user_opts) do
    if type(v) == 'table' and type(M.opts[k]) == 'table' then
      M.opts[k] = vim.tbl_extend('force', M.opts[k], v)
    else
      M.opts[k] = v
    end
  end
end

return M
