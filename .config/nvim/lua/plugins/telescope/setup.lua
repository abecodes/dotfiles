local map = require'utils'.map_key

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
map('n', "<leader>td", "<CMD>lua require('telescope.builtin').diagnostics()<CR>",
{silent = true})
map('n', "<leader>te",
    "<CMD>lua require 'telescope'.extensions.file_browser.file_browser()<CR>", {silent = true})
map('n', "<leader>tE", "<CMD>lua require('telescope.builtin').symbols()<CR>",
		{silent = true})
map('n', "<leader>tf", "<CMD>lua require('telescope.builtin').find_files()<CR>",
    {silent = true})
map('n', "<leader>tF", "<CMD>lua require('telescope.builtin').live_grep()<CR>",
    {silent = true})
map('n', "<leader>tb", "<CMD>lua require('telescope.builtin').buffers()<CR>",
    {silent = true})
map('n', "<leader>tB", "<CMD>lua require('telescope.builtin').current_buffer_fuzzy_find()<CR>",
		{silent = true})
map('n', "<leader>tg", "<CMD>lua require('telescope.builtin').git_files()<CR>",
		{silent = true})
map('n', "<leader>th", "<CMD>lua require('telescope.builtin').help_tags()<CR>",
    {silent = true})
map('n', "<leader>tt", "<CMD>lua require('telescope.builtin').treesitter()<CR>",
		{silent = true})
map('n', "<leader>tq", "<CMD>lua require('telescope.builtin').quickfix()<CR>",
		{silent = true})
map('n', "<leader>ts", "<CMD>lua require('telescope.builtin').lsp_document_symbols()<CR>",
		{silent = true})
map('n', "<leader>tS", "<CMD>lua require('telescope.builtin').lsp_dynamic_workspace_symbols()<CR>",
		{silent = true})
map('n', "<leader>tR", "<CMD>lua require('telescope.builtin').lsp_references()<CR>",
	{silent = true})
map('n', "<leader>tI", "<CMD>lua require('telescope.builtin').lsp_implementations()<CR>",
	{silent = true})
-- require("telescope.builtin").spell_suggest(require("telescope.themes").get_cursor({}))
map('n', "<leader>tw", "<CMD>lua require('telescope.builtin').spell_suggest(vim.api.nvim_win_get_cursor(0))<CR>",
	{silent = true})
-- remap to open the Telescope refactoring menu in visual mode
map(
	"n",
	"<leader>tr",
	"<Esc><cmd>lua require('telescope').extensions.refactoring.refactors()<CR>",
	{ noremap = true }
)
map(
	"v",
	"<leader>tr",
	"<Esc><cmd>lua require('telescope').extensions.refactoring.refactors()<CR>",
	{ noremap = true }
)
-- remap to open the Telescope refactoring menu in visual mode
-- map(
-- 	"n",
-- 	"<leader>tm",
-- 	"<CMD>Telescope harpoon marks<CR>",
-- 	{ noremap = true }
-- )
