-- {
--   filetypes = {
--     'html', 'javascript', 'javascriptreact', 'typescriptreact', 'svelte', 'vue'
--   }
--   skip_tags = {
--     'area', 'base', 'br', 'col', 'command', 'embed', 'hr', 'img', 'slot',
--     'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr','menuitem'
--   }
-- }
require('nvim-ts-autotag').setup {
  filetypes = { 'html' , 'javascriptreact', 'typescriptreact' },
}
