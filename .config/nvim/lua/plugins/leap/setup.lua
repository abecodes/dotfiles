-- Or just set to grey directly, e.g. { fg = '#777777' },
-- if Comment is saturated.
-- vim.api.nvim_set_hl(0, 'LeapBackdrop', { link = 'Comment' })
vim.api.nvim_set_hl(0, 'LeapLabelPrimary', {
  link = 'Todo',
})
vim.api.nvim_set_hl(0, 'LeapLabelSecondary', {
  link = 'IncSearch',
})
