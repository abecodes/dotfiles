-- local g = vim.g
-- {
--   geometry = {
--     height = 0.8,
--     title = 'An awesome window title',
--     wrap  = false
--   },
--   on_keystroke = {
--     -- delay expresses the delay before the peekup window closes automatically,
--     -- after selecting the register. Obviously, autoclose set to false prevents
--     -- such behaviour (and the user must close the window manually).
--     -- delay can be set to the empty string to not delay at all
--     delay = '300ms',
--     autoclose = false,
--     paste_reg = '"',
--   }
-- }
-- or like require('nvim-peekup.config').on_keystroke["delay"] = '300ms'
-- change open shortcut
-- g.peekup_open = '<leader>"'
-- If you want to directly paste before or after the current cursor position
-- (without having to issue p after the selection) simply specify values for the options
-- g.peekup_paste_before = '<leader>P'
-- g.peekup_paste_after = '<leader>p'
require('nvim-peekup.config').on_keystroke["autoclose"] = true
