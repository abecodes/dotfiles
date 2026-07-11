-- :checkhealth treesitter dispatcher.
-- The real report lives in treesitter.validate.health(); the
-- shim/nvim-treesitter/health.lua module forwards to the same function so
-- both :checkhealth names work.
return { check = function() require('treesitter.validate').health() end }
