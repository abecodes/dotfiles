local npairs = require("nvim-autopairs")
local Rule = require('nvim-autopairs.rule')

npairs.setup({
  map_cr = false,
  map_bs = true,
})

local markup_fts = { html = true, xml = true, jsx = true, tsx = true, vue = true, svelte = true }
npairs.add_rule(
  Rule("<", ">")
    :with_pair(function() return markup_fts[vim.bo.filetype] == true end)
)
