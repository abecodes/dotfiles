-- Nerd-font icons for the completion popup. Material Design Icons (md-*)
-- in the U+F0xxx range — same family as lua/winbar/icons.lua, which is
-- proven-rendering in the user's terminal font. Lspkind's "default" preset
-- uses codicons (U+EAxx) for some kinds; those don't render in this font,
-- so we fall back to md-* alternatives (semantic match is approximate).
-- Look up codepoints at https://www.nerdfonts.com/cheat-sheet.

return {
  -- LSP CompletionItemKind names. Codepoints from lspkind's "default"
  -- preset where they're md-*; fallbacks (marked) for codicon-only kinds.
  Text          = vim.fn.nr2char(0xF027F),  -- 󰉿  md-text-short
  Method        = vim.fn.nr2char(0xF01A7),  -- 󰆧  md-cube
  Function      = vim.fn.nr2char(0xF0295),  -- 󰊕  md-function
  Constructor   = vim.fn.nr2char(0xF0295),  --     fallback: reuse Function
  Field         = vim.fn.nr2char(0xF0722),  -- 󰜢  md-tag
  Variable      = vim.fn.nr2char(0xF002B),  -- 󰀫  md-alpha-v-circle
  Class         = vim.fn.nr2char(0xF0831),  -- 󰠱  md-cube-unfolded
  Interface     = vim.fn.nr2char(0xF0558),  -- 󰕘  md-shape-outline       (winbar-confirmed)
  Module        = vim.fn.nr2char(0xF03D6),  -- 󰏖  md-package             (winbar-confirmed)
  Property      = vim.fn.nr2char(0xF0722),  --     reuse Field
  Unit          = vim.fn.nr2char(0xF046D),  -- 󰑭  md-numeric
  Value         = vim.fn.nr2char(0xF03A0),  -- 󰎠  md-value
  Enum          = vim.fn.nr2char(0xF0557),  -- 󰕗  md-format-list-bulleted (winbar-confirmed)
  Keyword       = vim.fn.nr2char(0xF030B),  -- 󰌋  md-key-variant
  Snippet       = vim.fn.nr2char(0xF030B),  --     fallback: reuse Keyword
  Color         = vim.fn.nr2char(0xF03D8),  -- 󰏘  md-palette
  File          = vim.fn.nr2char(0xF0219),  -- 󰈙  md-file
  Reference     = vim.fn.nr2char(0xF0207),  -- 󰈇  md-link
  Folder        = vim.fn.nr2char(0xF024B),  -- 󰉋  md-folder
  EnumMember    = vim.fn.nr2char(0xF0722),  --     fallback: reuse Field
  Constant      = vim.fn.nr2char(0xF03FF),  -- 󰏿  md-pi
  Struct        = vim.fn.nr2char(0xF0645),  -- 󰙅  md-cube-outline
  Event         = vim.fn.nr2char(0xF0295),  --     fallback: reuse Function (events are callable)
  Operator      = vim.fn.nr2char(0xF0195),  -- 󰆕  md-equal
  TypeParameter = vim.fn.nr2char(0xF002B),  --     fallback: reuse Variable

  -- Non-LSP sources. Distinct so a buffer-only word reads as different
  -- from an LSP File / Variable.
  Buffer        = vim.fn.nr2char(0xF026B),  -- 󰉫  md-format-header-pound (winbar-confirmed)
  Treesitter    = vim.fn.nr2char(0xF0317),  -- 󰌗  md-shape               (winbar-confirmed)

  -- Fallback for unknown kinds.
  default       = vim.fn.nr2char(0xF0207),  -- 󰈇  md-link
}
