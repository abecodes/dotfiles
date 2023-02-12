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
map('n', '<A-h>', '<C-w>h', {silent = true})
map('n', '<A-j>', '<C-w>j', {silent = true})
map('n', '<A-k>', '<C-w>k', {silent = true})
map('n', '<A-l>', '<C-w>l', {silent = true})
map('i', '<A-h>', '<Esc><C-w>h', {silent = true})
map('i', '<A-j>', '<Esc><C-w>j', {silent = true})
map('i', '<A-k>', '<Esc><C-w>k', {silent = true})
map('i', '<A-l>', '<Esc><C-w>l', {silent = true})
map('v', '<A-h>', '<Esc><C-w>h', {silent = true})
map('v', '<A-j>', '<Esc><C-w>j', {silent = true})
map('v', '<A-k>', '<Esc><C-w>k', {silent = true})
map('v', '<A-l>', '<Esc><C-w>l', {silent = true})
map('t', '<A-h>', '<c-\\><c-n><C-w>h', {silent = true})
map('t', '<A-j>', '<c-\\><c-n><C-w>j', {silent = true})
map('t', '<A-k>', '<c-\\><c-n><C-w>k', {silent = true})
map('t', '<A-l>', '<c-\\><c-n><C-w>l', {silent = true})

-- indent
map('v', '<', '<gv', {silent = true})
map('v', '>', '>gv', {silent = true})

-- lines
map('n', '<A-Up>', ':m -2<CR>', {silent = true})
map('n', '<A-Down>', ':m +1<CR>', {silent = true})
map('v', '<A-Up>', ':m \'<-2<CR>gv=gv', {silent = true})
map('v', '<A-Down>', ':m \'>+1<CR>gv=gv', {silent = true})

-- leader
--- search and replace in current buffer
map('n', '<Leader>r', ':%s///g<Left><Left>', {silent = true})
map('n', '<Leader>rl', ':s///g<Left><Left>', {silent = true})
map('n', '<Leader>rc', ':%s///gc<Left><Left><Left>', {silent = true})
-- show/hide cursorline
map('n', '<Leader>c', '<cmd>set cursorline!<CR>', {silent = true})
--- screenshots
map('n', "<leader>S", "<CMD>Screenshot<CR>", {silent = true})
map('v', "<leader>S", ":'<,'>Screenshot<CR>", {silent = true})
