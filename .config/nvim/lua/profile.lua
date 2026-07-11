local M = {}

-- Profile is resolved once at startup from NVIM_PROFILE; defaults to 'private'.
-- Changing the env var mid-session has no effect until restart.
M.current = vim.env.NVIM_PROFILE or 'private'

function M.is_enabled(name)
	return M.current == name
end

return M
