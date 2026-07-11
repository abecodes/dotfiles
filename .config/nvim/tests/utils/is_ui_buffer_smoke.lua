-- Headless smoke tests for utils.ui_buffer.is_ui_buffer + pde/ui/line_numbers.
-- Verifies the FT/buftype classification and that lineNumbers.show/hide
-- no-op on UI buffers but apply on regular file buffers.
--
-- Run from the nvim config root:
--   nvim --headless -u NONE -l tests/utils/is_ui_buffer_smoke.lua
--
-- Or from anywhere with an absolute path:
--   nvim --headless -u NONE -l <abs>/tests/utils/is_ui_buffer_smoke.lua
--
-- Exits 0 on success, 1 if any assertion fails.

local script      = debug.getinfo(1, 'S').source:sub(2)
local config_root = vim.fn.fnamemodify(script, ':p:h:h:h')
vim.opt.rtp:prepend(config_root)

local buf = require('utils.ui_buffer')
local ln  = require('pde.ui.line_numbers')

----------------------------------------------------------------------
-- Test harness
----------------------------------------------------------------------

local failed, total, passed = false, 0, 0

local function record(ok, label, note)
  total = total + 1
  if ok then passed = passed + 1 else failed = true end
  local tag = ok and 'PASS' or 'FAIL'
  io.write(('%s  %s%s\n'):format(tag, label, (not ok and note) and ('  — ' .. note) or ''))
end

local function assert_eq(label, got, want)
  record(got == want, label, ('got %s, want %s'):format(tostring(got), tostring(want)))
end

----------------------------------------------------------------------
-- ui_filetypes / ui_buftypes tables
----------------------------------------------------------------------

assert_eq('ui_filetypes has NeogitStatus (correct case)',    buf.ui_filetypes['NeogitStatus'], true)
assert_eq('ui_filetypes does NOT have neogitstatus (typo)',  buf.ui_filetypes['neogitstatus'], nil)
assert_eq('ui_filetypes does NOT have empty FT',             buf.ui_filetypes[''],             nil)
assert_eq('ui_buftypes has nofile',                          buf.ui_buftypes['nofile'],        true)
assert_eq('ui_buftypes has terminal',                        buf.ui_buftypes['terminal'],      true)

----------------------------------------------------------------------
-- is_ui_buffer across buffer shapes
----------------------------------------------------------------------

-- Current buffer is a fresh file-like buffer (ft='', bt='') → not UI.
assert_eq('fresh empty buffer is not ui', buf.is_ui_buffer(0), false)

-- Scratch buffer (create_buf(_, true) sets buftype=nofile) → ui.
local scratch = vim.api.nvim_create_buf(false, true)
assert_eq('nofile buftype is ui', buf.is_ui_buffer(scratch), true)

-- Listed file-like buffer with correct-cased NeogitStatus filetype → ui.
local neogit_buf = vim.api.nvim_create_buf(true, false)
vim.bo[neogit_buf].filetype = 'NeogitStatus'
assert_eq('listed buf with NeogitStatus FT is ui', buf.is_ui_buffer(neogit_buf), true)

-- Listed file-like buffer with lowercase typo → NOT ui (casing is enforced).
local typo_buf = vim.api.nvim_create_buf(true, false)
vim.bo[typo_buf].filetype = 'neogitstatus'
assert_eq('listed buf with lowercase typo is NOT ui', buf.is_ui_buffer(typo_buf), false)

-- prompt buftype (settable without :terminal) → ui.
local prompt_buf = vim.api.nvim_create_buf(true, false)
vim.bo[prompt_buf].buftype = 'prompt'
assert_eq('prompt buftype is ui', buf.is_ui_buffer(prompt_buf), true)

-- Invalid bufnr → safe default: treat as ui (caller should skip).
assert_eq('invalid buf treated as ui', buf.is_ui_buffer(999999), true)

-- Runtime extension: adding a custom FT must be honored.
buf.ui_filetypes['MyCustomPanel'] = true
local custom = vim.api.nvim_create_buf(true, false)
vim.bo[custom].filetype = 'MyCustomPanel'
assert_eq('runtime-added ui_filetype honored', buf.is_ui_buffer(custom), true)
buf.ui_filetypes['MyCustomPanel'] = nil

----------------------------------------------------------------------
-- lineNumbers.show / .hide
----------------------------------------------------------------------

-- On a regular file buffer, show/hide must apply.
local file_buf = vim.api.nvim_create_buf(true, false)
vim.api.nvim_set_current_buf(file_buf)
ln.show()
assert_eq('ln.show sets number on file buf',         vim.wo.number,         true)
assert_eq('ln.show sets relativenumber on file buf', vim.wo.relativenumber, true)
ln.hide()
assert_eq('ln.hide clears number on file buf',         vim.wo.number,         false)
assert_eq('ln.hide clears relativenumber on file buf', vim.wo.relativenumber, false)

-- On a UI buffer (prompt), show/hide must be a no-op.
vim.api.nvim_set_current_buf(prompt_buf)
vim.wo.number = false
vim.wo.relativenumber = false
ln.show()
assert_eq('ln.show NO-OP on ui buf (number)',         vim.wo.number,         false)
assert_eq('ln.show NO-OP on ui buf (relativenumber)', vim.wo.relativenumber, false)

vim.wo.number = true
vim.wo.relativenumber = true
ln.hide()
assert_eq('ln.hide NO-OP on ui buf (number)',         vim.wo.number,         true)
assert_eq('ln.hide NO-OP on ui buf (relativenumber)', vim.wo.relativenumber, true)

-- set(mode) dispatch.
local file_buf2 = vim.api.nvim_create_buf(true, false)
vim.api.nvim_set_current_buf(file_buf2)
ln.set('show')
assert_eq('set("show") routes to show',  vim.wo.number, true)
ln.set('hide')
assert_eq('set("hide") routes to hide',  vim.wo.number, false)
ln.set('bogus')
assert_eq('set(<unknown>) is no-op',     vim.wo.number, false)

----------------------------------------------------------------------
-- Summary
----------------------------------------------------------------------

io.write(('\n%d/%d assertions passed\n'):format(passed, total))
if failed then os.exit(1) end
