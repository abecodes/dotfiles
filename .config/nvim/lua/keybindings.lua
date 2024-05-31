local map = require'utils'.map_key

vim.g.mapleader = ','

-- bind terminal ESC to exit terminal mode
map('t', '<Esc>', '<C-\\><C-n>', {silent = true})

-- center screen before typing
map('n', 'a', 'zza', {silent = true})
map('n', 'A', 'zzA', {silent = true})
map('n', 'i', 'zzi', {silent = true})
map('n', 'I', 'zzI', {silent = true})
map('n', 'o', 'zzo', {silent = true})
map('n', 'O', 'zzO', {silent = true})

-- navigate the quickfix window
map('n', 'q[', ':cn<CR>', {silent = true})
map('n', 'q]', ':cp<CR>', {silent = true})
map('n', 'qo', ':copen<CR>', {silent = true})
map('n', 'qc', ':ccl<CR>', {silent = true})

-- better split movement
-- TODO: create mapAll util function
map('n', '<A-Left>', '<C-w>h', {silent = true})
map('n', '<A-Down>', '<C-w>j', {silent = true})
map('n', '<A-Up>', '<C-w>k', {silent = true})
map('n', '<A-Right>', '<C-w>l', {silent = true})
map('i', '<A-Left>', '<Esc><C-w>h', {silent = true})
map('i', '<A-Down>', '<Esc><C-w>j', {silent = true})
map('i', '<A-Up>', '<Esc><C-w>k', {silent = true})
map('i', '<A-Right>', '<Esc><C-w>l', {silent = true})
map('v', '<A-Left>', '<Esc><C-w>h', {silent = true})
map('v', '<A-Down>', '<Esc><C-w>j', {silent = true})
map('v', '<A-Up>', '<Esc><C-w>k', {silent = true})
map('v', '<A-Right>', '<Esc><C-w>l', {silent = true})
map('t', '<A-Left>', '<c-\\><c-n><C-w>h', {silent = true})
map('t', '<A-Down>', '<c-\\><c-n><C-w>j', {silent = true})
map('t', '<A-Up>', '<c-\\><c-n><C-w>k', {silent = true})
map('t', '<A-Right>', '<c-\\><c-n><C-w>l', {silent = true})

-- indent
map('v', '<', '<gv', {silent = true})
map('v', '>', '>gv', {silent = true})

-- lines
map('n', '<A-S-Up>', ':m -2<CR>', {silent = true})
map('n', '<A-S-Down>', ':m +1<CR>', {silent = true})
map('v', '<A-S-Up>', ':m \'<-2<CR>gv=gv', {silent = true})
map('v', '<A-S-Down>', ':m \'>+1<CR>gv=gv', {silent = true})

-- leader
--- search and replace in current buffer
map('n', '<Leader>rr', ':%s///g<Left><Left><Left>', {silent = true})
map('n', '<Leader>rl', ':s///g<Left><Left><Left>', {silent = true})
map('n', '<Leader>rc', ':%s///gc<Left><Left><Left><Left>', {silent = true})
map('v', '<Leader>rr', ":s///g<Left><Left><Left>", {silent = true})
map('v', '<Leader>rc', ":%s///gc<Left><Left><Left><Left>", {silent = true})
-- show/hide cursorline
map('n', '<Leader>c', '<cmd>set cursorline!<CR>', {silent = true})
--- screenshots
map('n', "<leader>S", "<CMD>Screenshot<CR>", {silent = true})
map('v', "<leader>S", ":'<,'>Screenshot<CR>", {silent = true})
