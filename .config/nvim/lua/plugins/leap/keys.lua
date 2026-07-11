-- Source of truth for leap keymaps. <Plug> RHS requires recursive mapping —
-- utils.keys.register defaults to noremap=true, so each entry opts out.
return {
	{ mode = { 'n', 'x', 'o' }, lhs = 's',  rhs = '<Plug>(leap-forward)',     opts = { noremap = false } },
	{ mode = { 'n', 'x', 'o' }, lhs = 'S',  rhs = '<Plug>(leap-backward)',    opts = { noremap = false } },
	{ mode = { 'n', 'x', 'o' }, lhs = 'gs', rhs = '<Plug>(leap-from-window)', opts = { noremap = false } },
}
