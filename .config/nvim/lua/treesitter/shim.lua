-- Walks lua/treesitter/shim/ and registers package.preload for every
-- .lua file there, so require('nvim-treesitter') and submodules resolve
-- to our in-tree shims instead of hitting runtimepath.
--
-- Called once from lua/treesitter/init.lua's setup(). Idempotent —
-- package.preload[modname] = ... is a write, not an append.
--
-- Filesystem layout mirrors the module path the shim intercepts:
--   shim/nvim-treesitter.lua        → preload['nvim-treesitter']
--   shim/nvim-treesitter/locals.lua → preload['nvim-treesitter.locals']
-- Each entry lazy-loads via require() so files aren't read unless
-- something actually requires that name.

local M = {}

local function walk(dir, prefix)
  local entries = vim.fn.readdir(dir)
  if not entries then
    error(('[treesitter] readdir failed on shim dir: %s'):format(dir))
  end
  for _, entry in ipairs(entries) do
    local full = dir .. '/' .. entry
    local stat = vim.uv.fs_stat(full)
    if stat and stat.type == 'file' then
      local name = entry:match('^(.+)%.lua$')
      if name then
        local modname   = prefix ~= '' and (prefix .. '.' .. name) or name
        local shim_path = prefix ~= '' and ('treesitter.shim.' .. prefix .. '.' .. name)
                                        or ('treesitter.shim.' .. name)
        package.preload[modname] = function() return require(shim_path) end
      end
    elseif stat and stat.type == 'directory' then
      walk(full, prefix ~= '' and (prefix .. '.' .. entry) or entry)
    end
  end
end

function M.register()
  local here      = vim.fn.fnamemodify(debug.getinfo(1, 'S').source:sub(2), ':h')
  local shim_root = here .. '/shim'
  if vim.uv.fs_stat(shim_root) == nil then
    error(('[treesitter] shim root missing: %s — downstream require("nvim-treesitter") will fail')
      :format(shim_root))
  end
  walk(shim_root, '')
end

return M
