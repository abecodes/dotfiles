local map = require'utils'.map

local opts = {silent = true, noremap = true}

-- Move to previous/next
-- map('n', "<A-,>", "<Plug>(cokeline-focus-prev)", opts)
map('n', "<A-,>", "<Cmd>lua require'cokeline/mappings'.by_step('focus', -1)<CR>", opts)
-- map('n', "<A-.>", "<Plug>(cokeline-focus-next)", opts)
map('n', "<A-.>", "<Cmd>lua require'cokeline/mappings'.by_step('focus', 1)<CR>", opts)


-- Re-order to previous/next
-- map('n', "<A-<>", "<Plug>(cokeline-switch-prev)", opts)
map('n', "<A-<>", "<Cmd>lua require'cokeline/mappings'.by_step('switch', -1)<CR>", opts)
-- map('n', "<A->>", "<Plug>(cokeline-switch-next)", opts)
map('n', "<A->>", "<Cmd>lua require'cokeline/mappings'.by_step('switch', 1)<CR>", opts)

-- Goto buffer in position...
for i = 1,9 do
  -- map('n', ('<A-%s>'):format(i),      ('<Plug>(cokeline-focus-%s)'):format(i),  { silent = true })
  map('n', ('<A-%s>'):format(i),      ('<Cmd>lua require"cokeline/mappings".by_index("focus", %s)<CR> '):format(i),  { silent = true })
  -- map('n', ('<Leader>%s'):format(i), ('<Plug>(cokeline-switch-%s)'):format(i), { silent = true })
end

-- Close commands
-- map('n', "<A-c>", "<Plug>(cokeline-pick-close)", opts)
map('n', "<A-c>", '<Cmd>lua require"cokeline/mappings".pick("close")<CR>', opts)

-- Magic buffer-picking mode
-- map('n', "<A-s>", "<Plug>(cokeline-pick-focus)", opts)
map('n', "<A-s>", '<Cmd>lua require"cokeline/mappings".pick("focus")<CR>', opts)
