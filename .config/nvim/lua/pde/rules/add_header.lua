-- Walks the top of the buffer and returns the line index after the last
-- copyright-style comment line. Treats `//go:` / `// +build` as terminators
-- because those directives belong BELOW the copyright, not inside it.
local function leading_comment_block_end(bufnr)
	local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
	local total = #lines
	local i = 0
	while i < total do
		local trimmed = (lines[i + 1] or ''):match('^%s*(.*)$') or ''

		if trimmed:match('^//go:') or trimmed:match('^// ?%+build ') then
			return i
		end

		if trimmed:sub(1, 2) == '//' then
			i = i + 1
		elseif trimmed:sub(1, 2) == '/*' then
			if trimmed:find('*/', 3, true) then
				i = i + 1
			else
				i = i + 1
				while i < total do
					local inner = lines[i + 1] or ''
					i = i + 1
					if inner:find('*/', 1, true) then break end
				end
			end
		else
			return i
		end
	end

	return i
end

return function(header)
	local lines = vim.split(header, '\n', { plain = true })
	while #lines > 0 and lines[#lines] == '' do
		table.remove(lines)
	end

	local replacement = {}
	for _, l in ipairs(lines) do
		table.insert(replacement, l)
	end
	table.insert(replacement, '')

	return function()
		local bufnr = vim.api.nvim_get_current_buf()
		local k = leading_comment_block_end(bufnr)

		if k > 0 and k < vim.api.nvim_buf_line_count(bufnr) then
			local next_line = vim.api.nvim_buf_get_lines(bufnr, k, k + 1, false)[1] or ''
			if next_line == '' then k = k + 1 end
		end

		local existing = vim.api.nvim_buf_get_lines(bufnr, 0, k, false)
		if #existing == #replacement then
			local same = true
			for i = 1, #replacement do
				if existing[i] ~= replacement[i] then
					same = false
					break
				end
			end
			if same then return end
		end

		vim.api.nvim_buf_set_lines(bufnr, 0, k, false, replacement)
	end
end
