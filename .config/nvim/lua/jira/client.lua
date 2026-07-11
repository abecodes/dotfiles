-- HTTP client for Jira Cloud.
--
-- Why `vim.system` + curl instead of `vim.net.request`:
-- Neovim 0.12.1 ships `vim.net.request` but its opts are limited to
-- { verbose, retry, outpath, outbuf }. It does GET only, with no way to set
-- headers, change method, or send a body. Jira Cloud requires an
-- `Authorization: Basic ...` header on every call and POST with a JSON body
-- for `/search/jql`, so the builtin does not fit yet. When it grows
-- header/method/body opts (likely 0.13+), this file should collapse to a
-- thin wrapper around it.

local config = require('jira.config')
local adf    = require('jira.adf')

local M = {}

local function encode_fields(fields)
  local parts = {}
  for _, f in ipairs(fields) do table.insert(parts, vim.uri_encode(f)) end
  return table.concat(parts, ',')
end

local function decode_json(str)
  local ok, decoded = pcall(vim.json.decode, str)
  if not ok then return nil, 'invalid JSON: ' .. tostring(decoded) end
  return decoded, nil
end

local function build_error_message(res)
  local stdout = res.stdout or ''
  if stdout ~= '' then
    local decoded = select(1, decode_json(stdout))
    if type(decoded) == 'table' then
      local parts = {}
      if type(decoded.errorMessages) == 'table' then
        for _, m in ipairs(decoded.errorMessages) do
          table.insert(parts, tostring(m))
        end
      end
      if type(decoded.errors) == 'table' then
        for k, v in pairs(decoded.errors) do
          table.insert(parts, tostring(k) .. ': ' .. tostring(v))
        end
      end
      if #parts > 0 then return table.concat(parts, '; ') end
    end
    -- Defense in depth: if a proxy/WAF ever echoes the request back in HTML,
    -- strip the Basic-auth header before it lands in `vim.notify`. Cap length
    -- so multi-KB error pages don't flood the UI.
    stdout = stdout:gsub('[Aa]uthorization:[^\n]*', 'Authorization: <redacted>')
    if #stdout > 400 then stdout = stdout:sub(1, 400) .. '…' end
    return stdout
  end
  if res.stderr and res.stderr ~= '' then return res.stderr end
  return 'curl exit ' .. res.code
end

---@param method string  'GET' | 'POST' | 'PUT' | 'DELETE'
---@param path string  API path appended to `cfg.base_url` (e.g. '/rest/api/3/myself')
---@param body table|nil  JSON-encodable body, or nil for bodyless requests
---@param cb fun(err: string|nil, decoded: table|nil)
local function request(method, path, body, cb)
  local cfg = config.get()
  if not cfg then cb('not configured', nil) return end

  local auth = config.auth_header()
  if not auth then cb('missing auth', nil) return end

  local args = {
    'curl', '-sS', '--fail-with-body',
    '-K', '-',
    '-X', method,
    '-H', 'Accept: application/json',
  }
  if body ~= nil then
    table.insert(args, '-H')
    table.insert(args, 'Content-Type: application/json')
    table.insert(args, '--data-binary')
    table.insert(args, vim.json.encode(body))
  end
  table.insert(args, cfg.base_url .. path)

  -- Auth goes via `-K -` (config from stdin) so the token never lands in
  -- argv / `/proc/<pid>/cmdline` / `ps`. Base64 payload contains no chars
  -- that need quote-escaping inside the config file.
  local stdin = 'header = "Authorization: ' .. auth .. '"\n'

  -- 30s ceiling so a hung endpoint can't keep the curl child alive forever
  -- (the UI spinner otherwise spins indefinitely and stacks on re-entry).
  vim.system(args, { text = true, stdin = stdin, timeout = 30000 }, function(res)
    vim.schedule(function()
      if res.code ~= 0 then
        cb(build_error_message(res), nil)
        return
      end
      local stdout = res.stdout or ''
      if stdout == '' then
        cb(nil, {})
        return
      end
      local decoded, err = decode_json(stdout)
      if err then cb(err, nil) return end
      cb(nil, decoded)
    end)
  end)
end

M.search = function(jql, cb)
  local cfg = config.get()
  if not cfg then cb('not configured', nil) return end

  local all = {}
  local PAGE_LIMIT = 20  -- safety cap: stop after N pages to avoid runaway loops

  local function fetch_page(token, pages_done)
    local body = {
      jql        = jql,
      fields     = cfg.fields,
      maxResults = cfg.max_results,
    }
    if token then body.nextPageToken = token end

    request('POST', '/rest/api/3/search/jql', body, function(err, decoded)
      if err or not decoded then cb(err, nil) return end
      for _, issue in ipairs(decoded.issues or {}) do
        table.insert(all, issue)
      end
      local next_token = decoded.nextPageToken
      if next_token and pages_done < PAGE_LIMIT then
        fetch_page(next_token, pages_done + 1)
      else
        if next_token then
          -- Cap reached with more results server-side. Surface it so the
          -- user knows results are partial and can refine their JQL.
          require('logger').warn(
            ('jira: search truncated at %d pages (%d issues); refine JQL for full results'):format(PAGE_LIMIT, #all)
          )
        end
        cb(nil, all)
      end
    end)
  end

  fetch_page(nil, 1)
end

M.get_issue = function(key, cb)
  if not key or not key:match('^[A-Z][A-Z0-9_]*%-[0-9]+$') then
    cb('invalid issue key', nil) return
  end

  local cfg = config.get()
  if not cfg then cb('not configured', nil) return end

  local fields = vim.list_extend({}, cfg.fields)
  if not vim.tbl_contains(fields, 'comment') then
    table.insert(fields, 'comment')
  end
  request('GET', ('/rest/api/3/issue/%s?fields=%s'):format(vim.uri_encode(key), encode_fields(fields)), nil, cb)
end

M.myself = function(cb)
  request('GET', '/rest/api/3/myself', nil, cb)
end

M.get_transitions = function(key, cb)
  request('GET', ('/rest/api/3/issue/%s/transitions'):format(vim.uri_encode(key)), nil, function(err, decoded)
    if err or not decoded then cb(err, nil) return end
    cb(nil, decoded.transitions or {})
  end)
end

M.do_transition = function(key, transition_id, cb)
  request('POST', ('/rest/api/3/issue/%s/transitions'):format(vim.uri_encode(key)),
    { transition = { id = tostring(transition_id) } }, cb)
end

M.assign = function(key, account_id, cb)
  request('PUT', ('/rest/api/3/issue/%s/assignee'):format(vim.uri_encode(key)), { accountId = account_id }, cb)
end

M.get_priorities = function(cb)
  request('GET', '/rest/api/3/priority', nil, cb)
end

M.set_priority = function(key, priority_id, cb)
  request('PUT', ('/rest/api/3/issue/%s'):format(vim.uri_encode(key)),
    { fields = { priority = { id = tostring(priority_id) } } }, cb)
end

M.add_comment = function(key, text, cb)
  request('POST', ('/rest/api/3/issue/%s/comment'):format(vim.uri_encode(key)), { body = adf.text_to_adf(text) }, cb)
end

M.search_assignable = function(key, query, cb)
  local path = ('/rest/api/3/user/assignable/search?issueKey=%s&query=%s&maxResults=20'):format(
    vim.uri_encode(key),
    vim.uri_encode(query or '')
  )
  request('GET', path, nil, cb)
end

return M
