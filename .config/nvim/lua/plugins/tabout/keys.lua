-- Source of truth for tabout keymaps. <Plug> RHS requires recursive mapping —
-- utils.keys.register defaults to noremap=true, so each entry opts out.
return {
	{ mode = 'i', lhs = '<A-x>', rhs = '<Plug>(TaboutMulti)',     opts = { noremap = false } },
	{ mode = 'i', lhs = '<A-z>', rhs = '<Plug>(TaboutBackMulti)', opts = { noremap = false } },
}
