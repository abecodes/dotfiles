local M = {}

---Border fallback: respects vim.o.winborder, else 'rounded'.
function M.border()
  return vim.o.winborder ~= '' and vim.o.winborder or 'rounded'
end

---Scratch buffer with bufhidden=wipe by default.
---@param opts? { buftype?: string, filetype?: string, bufhidden?: string }
function M.scratch_buf(opts)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].bufhidden = (opts and opts.bufhidden) or 'wipe'
  if opts then
    if opts.buftype  then vim.bo[buf].buftype  = opts.buftype  end
    if opts.filetype then vim.bo[buf].filetype = opts.filetype end
  end
  return buf
end

---Row/col for a {width, height} float centered in the editor. Row is shifted
---up 1 to compensate for the statusline.
---If a caller ever needs a different offset, switch this to
---`M.center(width, height, row_offset)` with row_offset defaulting to 0, and
---pass -1 from current callers.
---@return integer row, integer col
function M.center(width, height)
  return
    math.floor((vim.o.lines   - height) / 2) - 1,
    math.floor((vim.o.columns - width)  / 2)
end

---Full-screen dim layer behind a picker.
---@return integer win
function M.make_backdrop()
  local buf = M.scratch_buf()
  local win = vim.api.nvim_open_win(buf, false, {
    relative  = 'editor',
    width     = vim.o.columns,
    height    = vim.o.lines,
    row = 0, col = 0,
    style     = 'minimal',
    focusable = false,
    zindex    = 59,
  })
  vim.wo[win].winblend     = 80
  vim.wo[win].winhighlight = 'Normal:NormalFloat'
  return win
end

return M
