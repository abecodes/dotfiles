local excludes = {
  "", -- help files
  "alpha",
  "dashboard",
  "help",
  "lir",
	"no-neck-pain",
  "NeogitConsole",
  "neogitstatus",
  "NvimTree",
  "Outline",
  "packer",
  "spectre_panel",
  "startify",
  "TelescopePrompt",
  "toggleterm",
  "Trouble",
}

local needs_tab = {
  "make",
}

return function()
	if vim.tbl_contains(excludes, vim.bo.filetype) then
    return
  end

  if vim.api.nvim_get_option('tabstop') == 2 and
    -- vim.api.nvim_get_option('tabstop') == 8 and
    vim.api.nvim_get_option('shiftwidth') == 2 and
    vim.api.nvim_get_option('softtabstop') == -1 and
    vim.api.nvim_get_option('smartindent') == true and
    vim.api.nvim_get_option('expandtab') == not vim.tbl_contains(needs_tab, vim.bo.filetype) then
      return
  end

  -- print("setting tabs for", vim.bo.filetype)
  -- vim.opt.tabstop = 8 -- recommended default
  vim.opt.tabstop = 2
  vim.opt.softtabstop = -1 -- if negative, it uses the shiftwidth value
  vim.opt.shiftwidth = 2
  vim.opt.smartindent = true
  vim.opt.expandtab = not vim.tbl_contains(needs_tab, vim.bo.filetype)
  -- vim.cmd('retab')
end
