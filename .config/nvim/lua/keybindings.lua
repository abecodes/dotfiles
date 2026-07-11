local keys = require('utils.keys')
local map = keys.map_key

vim.g.mapleader = ','
vim.g.maplocalleader = ','

-- bind terminal ESC to exit terminal mode
map('t', '<Esc>', '<C-\\><C-n>', { silent = true, desc = 'Exit terminal mode' })

-- keep cursor position after yanking
map('v', 'y', 'ygv<ESC>', { silent = true, desc = 'Yank (keep cursor)' })

-- Center the viewport before entering insert mode. Yes, this fires on
-- every single `a/A/i/I/o/O` press — that is deliberate. The cursor
-- always starts typing at roughly the vertical middle of the window,
-- which keeps context visible above and below no matter where the line
-- was before.
map('n', 'a', 'zza', { silent = true, desc = 'Append (centered)' })
map('n', 'A', 'zzA', { silent = true, desc = 'Append at line end (centered)' })
map('n', 'i', 'zzi', { silent = true, desc = 'Insert (centered)' })
map('n', 'I', 'zzI', { silent = true, desc = 'Insert at line start (centered)' })
map('n', 'o', 'zzo', { silent = true, desc = 'Open line below (centered)' })
map('n', 'O', 'zzO', { silent = true, desc = 'Open line above (centered)' })

-- navigate the quickfix window
map('n', '[q', ':cp<CR>', { silent = true, desc = 'Quickfix prev' })
map('n', ']q', ':cn<CR>', { silent = true, desc = 'Quickfix next' })
map('n', 'qo', ':copen<CR>', { silent = true, desc = 'Quickfix open' })
map('n', 'qc', ':ccl<CR>', { silent = true, desc = 'Quickfix close' })

-- better split movement
local split_nav = {
	{ lhs = '<A-Left>',  rhs = { n = '<C-w>h', i = '<Esc><C-w>h', v = '<Esc><C-w>h', t = '<c-\\><c-n><C-w>h' }, desc = 'Focus split left' },
	{ lhs = '<A-Down>',  rhs = { n = '<C-w>j', i = '<Esc><C-w>j', v = '<Esc><C-w>j', t = '<c-\\><c-n><C-w>j' }, desc = 'Focus split below' },
	{ lhs = '<A-Up>',    rhs = { n = '<C-w>k', i = '<Esc><C-w>k', v = '<Esc><C-w>k', t = '<c-\\><c-n><C-w>k' }, desc = 'Focus split above' },
	{ lhs = '<A-Right>', rhs = { n = '<C-w>l', i = '<Esc><C-w>l', v = '<Esc><C-w>l', t = '<c-\\><c-n><C-w>l' }, desc = 'Focus split right' },
}
for _, entry in ipairs(split_nav) do
	keys.map_per_mode(entry.lhs, entry.rhs, { silent = true, desc = entry.desc })
end

-- indent
map('v', '<', '<gv', { silent = true, desc = 'Indent left (keep selection)' })
map('v', '>', '>gv', { silent = true, desc = 'Indent right (keep selection)' })

-- lines
-- move lines up an down
map('n', '<A-S-Up>', ':m -2<CR>', { silent = true, desc = 'Move line up' })
map('n', '<A-S-Down>', ':m +1<CR>', { silent = true, desc = 'Move line down' })
map('v', '<A-S-Up>', ':m \'<-2<CR>gv=gv', { silent = true, desc = 'Move selection up' })
map('v', '<A-S-Down>', ':m \'>+1<CR>gv=gv', { silent = true, desc = 'Move selection down' })

-- leader
--- search and replace in current buffer
map('n', '<Leader>rr', ':%s///g<Left><Left><Left>', { silent = true, desc = 'in file' })
map('n', '<Leader>rl', ':s///g<Left><Left><Left>', { silent = true, desc = 'in line' })
map('n', '<Leader>rc', ':%s///gc<Left><Left><Left><Left>', { silent = true, desc = 'in file with confirmation' })
map('v', '<Leader>rr', ":s///g<Left><Left><Left>", { silent = true, desc = 'in selection' })
map('v', '<Leader>rc', ":%s///gc<Left><Left><Left><Left>", { silent = true, desc = 'in selection with confirmation' })
-- show/hide cursorline
map('n', '<Leader>c', '<cmd>set cursorline!<CR>', { silent = true, desc = 'Toggle cursorline' })
--- screenshots
map('n', "<leader>S", "<CMD>Screenshot<CR>", { silent = true, desc = 'Screenshot' })
map('v', "<leader>S", ":'<,'>Screenshot<CR>", { silent = true, desc = 'Screenshot' })

-- toggle comment (built-in gc operator, replaces vim-commentary)
map('n', '<leader>/', 'gcc', { remap = true, silent = true, desc = 'Toggle line comment' })
map('x', '<leader>/', 'gc', { remap = true, silent = true, desc = 'Toggle line comment' })

-- window/buffer shortcuts
map('n', '<leader>n', '<cmd>enew<CR>', { silent = true, desc = 'New empty buffer' })
map('n', '<leader>s', '<cmd>Startify<CR>', { silent = true, desc = 'Startscreen' })
map('n', '<leader>j', '<C-W>s', { silent = true, desc = 'Split below' })
map('n', '<leader>l', '<C-W>v', { silent = true, desc = 'Split side' })

-- notes
map('n', '<Leader>pn', function() require('notes.notes').open_branch() end, { silent = true, desc = 'Branch notes' })
map('n', '<Leader>pN', function() require('notes.notes').open_project() end, { silent = true, desc = 'Project notes' })
map('n', '<Leader>pt', function() require('notes.todo').add('branch') end, { silent = true, desc = 'Add branch todo' })
map('n', '<Leader>pT', function() require('notes.todo').add('project') end, { silent = true, desc = 'Add project todo' })
map('n', '<Leader>px', function()
	require('notes.todo').delete_current()
	require('notes.sticky').invalidate()
end, { silent = true, desc = 'Done: current todo' })
map('n', '<Leader>pr', function() require('notes.todo').review('branch') end,
	{ silent = true, desc = 'Review branch todos' })
map('n', '<Leader>pR', function() require('notes.todo').review('project') end,
	{ silent = true, desc = 'Review project todos' })
