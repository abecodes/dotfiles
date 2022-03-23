local map = require'utils'.map

--[[ <C-n>/<Down>	Next item
<C-p>/<Up>	Previous item
j/k	Next/previous (in normal mode)
<cr>	Confirm selection
<C-x>	go to file selection as a split
<C-v>	go to file selection as a vsplit
<C-t>	go to a file in a new tab
<C-u>	scroll up in preview window
<C-d>	scroll down in preview window
<C-c>	close telescope
<Esc>	close telescope (in normal mode) ]]

--[[ builtin.find_files	Lists files in your current working directory, respects .gitignore
builtin.git_files	Fuzzy search through the output of git ls-files command, respects .gitignore, optionally ignores untracked files
builtin.grep_string	Searches for the string under your cursor in your current working directory
builtin.live_grep	Search for a string in your current working directory and get results live as you type (respecting .gitignore)
builtin.file_browser	Lists files and folders in your current working directory, open files, navigate your filesystem, and create new files and folders ]]

-- Find files using Telescope command-line sugar.
--[[ map('n', "<leader>ff", "<CMD>Telescope find_files<CR>", {silent = true})
map('n', "<leader>fg ", "<CMD>Telescope live_grep<CR>", {silent = true})
map('n', "<leader>fb", "<CMD>Telescope buffers<CR>", {silent = true})
map('n', "<leader>fh", "<CMD>Telescope help_tags<CR>", {silent = true}) ]]

-- Using Lua functions
map('n', "<leader>e",
    "<CMD>lua require 'telescope'.extensions.file_browser.file_browser()<CR>", {silent = true})
map('n', "<leader>ff", "<CMD>lua require('telescope.builtin').find_files()<CR>",
    {silent = true})
map('n', "<leader>fg", "<CMD>lua require('telescope.builtin').live_grep()<CR>",
    {silent = true})
map('n', "<leader>fb", "<CMD>lua require('telescope.builtin').buffers()<CR>",
    {silent = true})
map('n', "<leader>fh", "<CMD>lua require('telescope.builtin').help_tags()<CR>",
    {silent = true})
-- remap to open the Telescope refactoring menu in visual mode
map(
	"v",
	"<leader>rr",
	"<Esc><cmd>lua require('telescope').extensions.refactoring.refactors()<CR>",
	{ noremap = true }
)
