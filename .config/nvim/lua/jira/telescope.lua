local ui = require('jira.ui')

local M = {}

M.is_available = function()
  return package.loaded.telescope ~= nil
end

M.pick_issue = function(issues, on_choice, on_refresh)
  if #issues == 0 then
    vim.notify('jira: no issues matched', vim.log.levels.INFO)
    return
  end
  local pickers    = require('telescope.pickers')
  local finders    = require('telescope.finders')
  local previewers = require('telescope.previewers')
  local conf       = require('telescope.config').values
  local actions    = require('telescope.actions')
  local action_state = require('telescope.actions.state')

  pickers.new({}, {
    prompt_title = 'Jira',
    finder = finders.new_table({
      results = issues,
      entry_maker = function(issue)
        local display = ui.format_item(issue)
        return {
          value   = issue,
          display = display,
          ordinal = (issue.key or '') .. ' ' .. ((issue.fields and issue.fields.summary) or ''),
        }
      end,
    }),
    sorter    = conf.generic_sorter({}),
    previewer = previewers.new_buffer_previewer({
      title = 'Jira issue',
      define_preview = function(self, entry)
        local bufnr = self.state.bufnr
        vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, ui.build_lines(entry.value))
        -- Start treesitter highlighting directly instead of setting
        -- `filetype = 'markdown'`. The latter fires FileType autocmds that
        -- attach LSP clients (e.g. marksman); each subsequent preview render
        -- triggers didChange traffic that accumulates and stalls the close.
        if not self.state.ts_started then
          pcall(vim.treesitter.start, bufnr, 'markdown')
          self.state.ts_started = true
        end
      end,
    }),
    attach_mappings = function(prompt_bufnr, map)
      actions.select_default:replace(function()
        local entry = action_state.get_selected_entry()
        actions.close(prompt_bufnr)
        if entry and entry.value and on_choice then
          on_choice(entry.value)
        end
      end)
      if on_refresh then
        local function trigger_refresh()
          actions.close(prompt_bufnr)
          on_refresh()
        end
        map('i', '<C-r>', trigger_refresh)
        map('n', '<C-r>', trigger_refresh)
      end
      return true
    end,
  }):find()
end

return M
