-- Winbar + statusline wiring.
--
-- Order matters:
--   1. `bar` installs its redraw autocmds and the 60s clock timer.
--   2. The two section modules register their sections with `bar`.
--   3. `vim.o.winbar` / `vim.o.statusline` are set to the `%!` expressions
--      that Neovim evaluates on each redraw.
--
-- See ARCHITECTURE.md for how to add a new section.

require('winbar.bar').setup_autocmds()
require('winbar.winbar')
require('winbar.statusbar')

vim.o.winbar     = "%!v:lua.require('winbar.winbar').render()"
vim.o.statusline = "%!v:lua.require('winbar.statusbar').render()"
