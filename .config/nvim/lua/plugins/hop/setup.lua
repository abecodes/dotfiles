local map = require'utils'.map

--[[ " The jump-to-word command.
command! HopWord lua require'hop'.hint_words()
command! HopWordBC lua require'hop'.hint_words({ direction = require'hop.hint'.HintDirection.BEFORE_CURSOR })
command! HopWordAC lua require'hop'.hint_words({ direction = require'hop.hint'.HintDirection.AFTER_CURSOR })

" The jump-to-pattern command.
command! HopPattern lua require'hop'.hint_patterns()
command! HopPatternBC lua require'hop'.hint_patterns({ direction = require'hop.hint'.HintDirection.BEFORE_CURSOR })
command! HopPatternAC lua require'hop'.hint_patterns({ direction = require'hop.hint'.HintDirection.AFTER_CURSOR })

" The jump-to-char-1 command.
command! HopChar1 lua require'hop'.hint_char1()
command! HopChar1BC lua require'hop'.hint_char1({ direction = require'hop.hint'.HintDirection.BEFORE_CURSOR })
command! HopChar1AC lua require'hop'.hint_char1({ direction = require'hop.hint'.HintDirection.AFTER_CURSOR })

" The jump-to-char-2 command.
command! HopChar2 lua require'hop'.hint_char2()
command! HopChar2BC lua require'hop'.hint_char2({ direction = require'hop.hint'.HintDirection.BEFORE_CURSOR })
command! HopChar2AC lua require'hop'.hint_char2({ direction = require'hop.hint'.HintDirection.AFTER_CURSOR })

" The jump-to-line command.
command! HopLine lua require'hop'.hint_lines()
command! HopLineBC lua require'hop'.hint_lines({ direction = require'hop.hint'.HintDirection.BEFORE_CURSOR })
command! HopLineAC lua require'hop'.hint_lines({ direction = require'hop.hint'.HintDirection.AFTER_CURSOR })

" The jump-to-line command.
command! HopLineStart   lua require'hop'.hint_lines_skip_whitespace()
command! HopLineStartBC lua require'hop'.hint_lines_skip_whitespace({ direction = require'hop.hint'.HintDirection.BEFORE_CURSOR })
command! HopLineStartAC lua require'hop'.hint_lines_skip_whitespace({ direction = require'hop.hint'.HintDirection.AFTER_CURSOR }) ]]

map('n', "<Leader><Leader>w", "<cmd>lua require'hop'.hint_words()<cr>",
    {silent = true})
map('n', "<Leader><Leader>l", "<cmd>lua require'hop'.hint_lines()<cr>",
    {silent = true})
map('n', "<Leader><Leader>p", "<cmd>lua require'hop'.hint_patterns()<cr>",
    {silent = true})
map('n', "<Leader><Leader>c", "<cmd>lua require'hop'.hint_char2()<cr>",
    {silent = true})

--[[ map("n", leader .. leader .. "w", ":HopWord<CR>")
map("n", leader .. leader .. "l", ":HopLine<CR>")
map("n", leader .. leader .. "p", ":HopPattern<CR>")
map("n", leader .. leader .. "c", ":HopChar2<CR>") ]]

--[[ map("n", leader .. leader, ":<C-u>exe v:count ? v:count . 'b' : 'b' . (bufloaded(0) ? '#' : 'n')<CR>")

map("n", leader .. "<C-o>", ":lua require 'buffers'.close_others()<CR>")

map("n", leader .. "q", ":lua require 'buffers'.close()<CR>")
map("n", leader .. "w", ":update<CR>")

map("n", leader .. "z", "1z=")

map("n", leader .. "rr", ":%s/\\v()")
map("x", leader .. "rr", ":s/\\v%V()")

map("n", leader .. "n", ":e %:h/")

map("n", "/", "<Plug>(incsearch-forward)", {noremap = false})
map("n", "?", "<Plug>(incsearch-backward)", {noremap = false})
map("n", "n", "<Plug>(incsearch-nohl-n)", {noremap = false})
map("n", "N", "<Plug>(incsearch-nohl-N)", {noremap = false})
map("n", "*", "<Plug>(incsearch-nohl-*)N", {noremap = false})
map("n", "#", "<Plug>(incsearch-nohl-#)", {noremap = false})
map("n", "g*", "<Plug>(incsearch-nohl-g*)N", {noremap = false})
map("n", "g#", "<Plug>(incsearch-nohl-g#)", {noremap = false})

map("n", "<UP>", ":lua require('lists').move('up')<CR>", {silent = true})
map("n", "<DOWN>", ":lua require('lists').move('down')<CR>", {silent = true})
map("n", "<LEFT>", ":lua require('lists').move('left')<CR>", {silent = true})
map("n", "<RIGHT>", ":lua require('lists').move('right')<CR>", {silent = true}) ]]
