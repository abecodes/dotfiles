--[[
KEYMAPS

DEFAULT:
Smooth scrolling for ...

Half-window movements:      <C-U> and <C-D>
Page movements:             <C-B>, <C-F>, <PageUp> and <PageDown>

EXTRA:
Smooth scrolling for ...

Start/end of file:          gg and G
Line number:                [count]G
Start/end of line:          0, ^ and $
Paragraph movements:        { and }
Prev/next search result:    n, N, *, #, g* and g#
Prev/next cursor location:  <C-O> and <C-I>
Screen scrolling:           zz, zt, zb, z., z<CR>, z-, z^, z+, <C-Y> and <C-E>
Horizontal scrolling:       zH, zL, zs, ze, zh and zl

EXTENDED:
Smooth scrolling for ...

Up/down movements:          j, k, <Up> and <Down>
Left/right movements:       h, l, <Left> and <Right>
]]--

require('cinnamon').setup({
-- KEYMAPS:
default_keymaps = true,   -- Create default keymaps.
extra_keymaps = true,    -- Create extra keymaps.
extended_keymaps = false, -- Create extended keymaps.
override_keymaps = false, -- The plugin keymaps will override any existing keymaps.

-- OPTIONS:
always_scroll = false,    -- Scroll the cursor even when the window hasn't scrolled.
centered = true,          -- Keep cursor centered in window when using window scrolling.
default_delay = 2,        -- The default delay (in ms) between each line when scrolling.
hide_cursor = false,      -- Hide the cursor while scrolling. Requires enabling termguicolors!
horizontal_scroll = true, -- Enable smooth horizontal scrolling when view shifts left or right.
max_length = -1,          -- Maximum length (in ms) of a command. The line delay will be
                          -- re-calculated. Setting to -1 will disable this option.
scroll_limit = 100,       -- Max number of lines moved before scrolling is skipped. Setting
                          -- to -1 will disable this option.
})
