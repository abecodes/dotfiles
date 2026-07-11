-- Or just set to grey directly, e.g. { fg = '#777777' },
-- if Comment is saturated.
-- vim.api.nvim_set_hl(0, 'LeapBackdrop', { link = 'Comment' })
local hl = require('utils.hl')

hl.apply_on_colorscheme(function()
  hl.link_all({
    LeapLabelPrimary   = 'Todo',
    LeapLabelSecondary = 'IncSearch',
  })
end, 'codes.abe.plugins.leap.highlights')
