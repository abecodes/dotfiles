local M = {}

M.map = function(mode, lhs, rhs, opts)
    local options = {noremap = true}
    if opts then options = vim.tbl_extend('force', options, opts) end
    vim.api.nvim_set_keymap(mode, lhs, rhs, options)
end

M.split = function(s, delimiter)
    local result = {};
    for match in (s .. delimiter):gmatch("(.-)" .. delimiter) do
        table.insert(result, match);
    end
    return result;
end

M.replace = function(str)
    return vim.api.nvim_replace_termcodes(str, true, true, true)
end

M.git_branch = function()
    return vim.fn.system("git rev-parse --abbrev-ref HEAD") or ''
end

return M
