-- require('leap').create_default_mappings()
vim.keymap.set({'n', 'x', 'o'}, 's', '<Plug>(leap-forward)')
vim.keymap.set({'n', 'x', 'o'}, 's', '<Plug>(leap-backward)')
vim.keymap.set({'n', 'x', 'o'}, 'gs', '<Plug>(leap-from-window)')

-- Define equivalence classes for brackets and quotes, in addition to
-- the default whitespace group.
require('leap').opts.equivalence_classes = { ' \t\r\n', '([{', ')]}', '\'"`' }

-- Override some old defaults - use backspace instead of tab (see issue #165).
-- require('leap').opts.special_keys.prev_target = '<backspace>'
-- require('leap').opts.special_keys.prev_group = '<backspace>'
-- require('leap').opts.special_keys.next_target = '<space>'
-- require('leap').opts.special_keys.next_group = '<space>'
-- require('leap').opts.special_keys.prev_target = '<S-space>'
-- require('leap').opts.special_keys.prev_group = '<S-space>'

-- Use the traversal keys to repeat the previous motion without explicitly
-- invoking Leap.
-- require('leap.user').set_repeat_keys('<enter>', '<backspace>')
