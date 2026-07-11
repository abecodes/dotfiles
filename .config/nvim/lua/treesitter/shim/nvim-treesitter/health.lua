-- Shim for `require('nvim-treesitter.health')`.
--
-- Entry point for `:checkhealth nvim-treesitter`. Forwards to our own
-- validate.health() so the report surfaces under the historical name that
-- muscle memory and documentation both reference.

local M = {}

function M.check()
  require('treesitter.validate').health()
end

return M
