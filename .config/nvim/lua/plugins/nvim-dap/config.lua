-- nvim-dap uses four signs:
-- - `DapBreakpoint` which defaults to `B` for breakpoints
-- - `DapLogPoint` which defaults to `L` and is for log-points
-- - `DapStopped` which defaults to `→` and is used to indicate the position where
--   the debugee is stopped.
-- - `DapBreakpointRejected`, defaults to `R` for breakpoints which the debug
--   adapter rejected.
-- You can customize the signs by overriding the definition after you've loaded `dap`.
-- An example:
-- lua <<
-- require('dap')
-- vim.fn.sign_define('DapBreakpoint', {text='🛑', texthl='', linehl='', numhl=''})
-- EOF
-- - Some variables are supported:
--   - `${file}`: Active filename
--   - `${fileBasename}`: The current file's basename
--   - `${fileBasenameNoExtension}`: The current file's basename without extension
--   - `${fileDirname}`: The current file's dirname
--   - `${fileExtname}`: The current file's extension
--   - `${relativeFile}`: The current file relative to |getcwd()|
--   - `${relativeFileDirname}`: The current file's dirname relative to |getcwd()|
--   - `${workspaceFolder}`: The current working directory of Neovim
--   - `${workspaceFolderBasename}`: The name of the folder opened in Neovim
require('dap.c-like')
require('dap.node')
require('dap-go').setup()

vim.fn.sign_define('DapBreakpoint',{ text ='🟥', texthl ='', linehl ='', numhl =''})
vim.fn.sign_define('DapStopped',{ text ='▶️', texthl ='', linehl ='', numhl =''})

local map = require'utils'.map_key
local opts = { noremap = true, silent = true }

map('n', '<leader>dd', '<CMD>lua require("dap").continue()<CR>', opts)
map('n', '<leader>dt', '<CMD>lua require("dap").terminate()<CR>', opts)
map('n', '<leader>do', '<CMD>lua require("dap").step_over()<CR>', opts)
map('n', '<leader>dn', '<CMD>lua require("dap").step_into()<CR>', opts)
map('n', '<leader>dp', '<CMD>lua require("dap").step_out()<CR>', opts)
map('n', '<leader>db', '<CMD>lua require("dap").toggle_breakpoint()<CR>', opts)
