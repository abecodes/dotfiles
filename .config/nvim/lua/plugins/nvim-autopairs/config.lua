local npairs = require("nvim-autopairs")
local Rule = require('nvim-autopairs.rule')
-- local cond = require('nvim-autopairs.conds')
-- local ts_conds = require('nvim-autopairs.ts-conds')

npairs.setup({
  map_cr = false,
  map_bs = true,
})
--[[ npairs.add_rules({
  Rule("<", ">")
    :with_pair(ts_conds.is_not_ts_node({'function'}))
}) ]]
npairs.add_rule(Rule("<", ">"))
