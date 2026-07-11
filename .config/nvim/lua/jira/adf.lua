local log = require('logger')

local M = {}

local MAX_DEPTH = 32

local render_nodes

local function has_mark(node, name)
  if type(node.marks) ~= 'table' then return nil end
  for _, m in ipairs(node.marks) do
    if m.type == name then return m end
  end
  return nil
end

local function render_text(node)
  local text = node.text or ''
  if has_mark(node, 'code') then
    text = '`' .. text .. '`'
  end
  local link = has_mark(node, 'link')
  if link and link.attrs and link.attrs.href then
    text = ('%s (%s)'):format(text, link.attrs.href)
  end
  return text
end

local function render_paragraph(node, depth)
  depth = depth or 0
  local parts = {}
  for _, child in ipairs(node.content or {}) do
    if child.type == 'text' then
      table.insert(parts, render_text(child))
    elseif child.type == 'hardBreak' then
      table.insert(parts, '\n')
    elseif child.type == 'inlineCard' and child.attrs and child.attrs.url then
      table.insert(parts, child.attrs.url)
    elseif child.type == 'mention' and child.attrs and child.attrs.text then
      table.insert(parts, child.attrs.text)
    elseif child.type == 'emoji' and child.attrs and (child.attrs.shortName or child.attrs.text) then
      table.insert(parts, child.attrs.text or child.attrs.shortName)
    else
      if child.content then
        table.insert(parts, render_nodes(child.content, depth + 1))
      end
    end
  end
  return table.concat(parts, '')
end

-- codeBlock content is a sequence of `text` and `hardBreak` nodes. Using
-- render_paragraph here risks recursing into unknown children and joining
-- with '\n\n', which mangles multi-line code. Handle only the two node
-- types the ADF spec allows inside codeBlock.
local function render_code_block(node)
  local parts = {}
  for _, child in ipairs(node.content or {}) do
    if child.type == 'text' then
      table.insert(parts, child.text or '')
    elseif child.type == 'hardBreak' then
      table.insert(parts, '\n')
    end
  end
  return table.concat(parts)
end

local function render_list(node, ordered, depth)
  depth = depth or 0
  local lines = {}
  local idx = 1
  for _, item in ipairs(node.content or {}) do
    if item.type == 'listItem' then
      local prefix = ordered and (idx .. '. ') or '- '
      local rendered = render_nodes(item.content or {}, depth + 1)
      for i, line in ipairs(vim.split(rendered, '\n', { plain = true })) do
        if i == 1 then
          table.insert(lines, prefix .. line)
        else
          table.insert(lines, string.rep(' ', #prefix) .. line)
        end
      end
      idx = idx + 1
    end
  end
  return table.concat(lines, '\n')
end

render_nodes = function(nodes, depth)
  depth = depth or 0
  if depth > MAX_DEPTH then return '[depth exceeded]' end
  local out = {}
  for _, node in ipairs(nodes) do
    local t = node.type
    if t == 'paragraph' then
      table.insert(out, render_paragraph(node, depth + 1))
    elseif t == 'heading' then
      local level = (node.attrs and node.attrs.level) or 1
      table.insert(out, string.rep('#', level) .. ' ' .. render_paragraph(node, depth + 1))
    elseif t == 'bulletList' then
      table.insert(out, render_list(node, false, depth + 1))
    elseif t == 'orderedList' then
      table.insert(out, render_list(node, true, depth + 1))
    elseif t == 'codeBlock' then
      local lang = (node.attrs and node.attrs.language) or ''
      table.insert(out, '```' .. lang .. '\n' .. render_code_block(node) .. '\n```')
    elseif t == 'rule' then
      table.insert(out, '---')
    elseif t == 'blockquote' then
      local inner = render_nodes(node.content or {}, depth + 1)
      local quoted = {}
      for _, line in ipairs(vim.split(inner, '\n', { plain = true })) do
        table.insert(quoted, '> ' .. line)
      end
      table.insert(out, table.concat(quoted, '\n'))
    elseif t == 'text' then
      table.insert(out, render_text(node))
    elseif node.content then
      table.insert(out, render_nodes(node.content, depth + 1))
    else
      log.debug('[adf] unsupported node type: ' .. tostring(t))
    end
  end
  return table.concat(out, '\n\n')
end

M.flatten = function(doc)
  if type(doc) == 'string' then return doc end
  if type(doc) ~= 'table' or type(doc.content) ~= 'table' then return '' end
  return render_nodes(doc.content, 0)
end

M.text_to_adf = function(text)
  local paragraphs = {}
  for _, line in ipairs(vim.split(text, '\n', { plain = true })) do
    if line == '' then
      table.insert(paragraphs, { type = 'paragraph' })
    else
      table.insert(paragraphs, {
        type    = 'paragraph',
        content = { { type = 'text', text = line } },
      })
    end
  end
  return { type = 'doc', version = 1, content = paragraphs }
end

return M
