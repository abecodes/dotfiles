-- :checkhealth pack — read-only diagnostics for the pack.loader pipeline.
-- Uses state exposed on pack.loader after M.setup completes.

local M = {}

local function spec_src(spec)
  return type(spec) == 'string' and spec or spec.src
end

local function is_local_src(src)
  local c = src:sub(1, 1)
  return c == '/' or c == '~'
end

local function plugin_name(spec)
  if type(spec) == 'table' and spec.name then return spec.name end
  local src = spec_src(spec)
  local name = type(src) == 'string' and src:match('[^/]+$') or tostring(src)
  return (name:gsub('%.nvim$', ''):gsub('%.vim$', ''))
end

-- Disk/pack name (un-stripped). Mirrors `pack_name` in `pack.loader`.
-- Used to locate the plugin's `pack/*/opt/<name>` directory.
local function pack_name(spec)
  if type(spec) == 'table' and spec.name then return spec.name end
  local src = spec_src(spec)
  return type(src) == 'string' and src:match('[^/]+$') or tostring(src)
end

local function as_list(v)
  if type(v) == 'table' then return v end
  return { v }
end

local function collect_deps(spec)
  if type(spec) ~= 'table' then return {} end
  local deps = {}
  for _, field in ipairs({ 'requires', 'wants', 'after' }) do
    if spec[field] then
      for _, dep in ipairs(as_list(spec[field])) do
        table.insert(deps, dep)
      end
    end
  end
  return deps
end

local function detect_cycles(plugins, dep_idx)
  local visited = {}
  local cycles = {}
  local function visit(spec)
    local src = spec_src(spec)
    if visited[src] == 'in_progress' then
      table.insert(cycles, plugin_name(spec))
      return
    end
    if visited[src] == 'done' then return end
    visited[src] = 'in_progress'
    for _, dep in ipairs(collect_deps(spec)) do
      local dep_spec = dep_idx[dep]
      if dep_spec then visit(dep_spec) end
    end
    visited[src] = 'done'
  end
  for _, spec in ipairs(plugins) do visit(spec) end
  return cycles
end

function M.check()
  local h = vim.health
  local ok, loader = pcall(require, 'pack.loader')
  if not ok then
    h.start('pack.loader')
    h.error('failed to require pack.loader: ' .. tostring(loader))
    return
  end

  local plugins = loader._plugins
  if not plugins then
    h.start('pack.loader')
    h.error('loader not initialised — pack.loader.setup has not run yet')
    return
  end

  -- ---------------------------------------------------------------
  h.start('pack.loader — specs')
  h.ok(('%d spec(s) loaded'):format(#plugins))

  -- ---------------------------------------------------------------
  h.start('pack.loader — dependencies')
  local dep_idx = loader._dep_idx or {}
  local missing = 0
  for _, spec in ipairs(plugins) do
    if type(spec) == 'table' then
      local name = plugin_name(spec)
      if spec.requires then
        for _, dep in ipairs(as_list(spec.requires)) do
          if not dep_idx[dep] then
            h.error(name .. ': missing required dep `' .. dep .. '`')
            missing = missing + 1
          end
        end
      end
      if spec.wants then
        for _, dep in ipairs(as_list(spec.wants)) do
          if not dep_idx[dep] then
            h.warn(name .. ': missing wanted dep `' .. dep .. '`')
          end
        end
      end
      if spec.after then
        for _, dep in ipairs(as_list(spec.after)) do
          if not dep_idx[dep] then
            h.error(name .. ': missing `after` dep `' .. dep .. '`')
            missing = missing + 1
          end
        end
      end
    end
  end
  if missing == 0 then h.ok('no missing required/after deps') end

  local cycles = detect_cycles(plugins, dep_idx)
  if #cycles > 0 then
    h.error('circular deps detected involving: ' .. table.concat(cycles, ', '))
  else
    h.ok('no circular deps')
  end

  -- ---------------------------------------------------------------
  h.start('pack.loader — local specs')
  local local_issues = 0
  for _, spec in ipairs(plugins) do
    if type(spec) == 'table' and is_local_src(spec.src) then
      if spec.install_command then
        h.warn(plugin_name(spec) ..
          ': install_command on local spec is ignored (PackChanged never fires)')
        local_issues = local_issues + 1
      end
      if spec.version then
        h.warn(plugin_name(spec) ..
          ': version on local spec is ignored (vim.pack is skipped)')
        local_issues = local_issues + 1
      end
    end
  end
  if local_issues == 0 then h.ok('no local-spec anomalies') end

  -- ---------------------------------------------------------------
  h.start('pack.loader — lazy split')
  local lazy_set = loader._lazy_set or {}
  local needs_init = loader._needs_init or {}
  local lazy_n, eager_n, init_promoted = 0, 0, {}
  for _, spec in ipairs(plugins) do
    local src = spec_src(spec)
    if lazy_set[src] then
      lazy_n = lazy_n + 1
      if needs_init[src] then
        table.insert(init_promoted, plugin_name(spec))
      end
    else
      eager_n = eager_n + 1
    end
  end
  h.info(('lazy: %d, eager: %d'):format(lazy_n, eager_n))
  if #init_promoted > 0 then
    h.info(('needs_init (mixed-bundle rdeps → on_init safety net, '
      .. 'loads at VimEnter not on user demand): %s'):format(
      table.concat(init_promoted, ', ')))
  end

  -- ---------------------------------------------------------------
  -- Lazy leak check: every spec the loader has marked lazy AND not yet
  -- loaded this session must satisfy:
  --   • non-local: `pack/*/opt/<pack_name>` is NOT on rtp.
  --   • non-local: `package.loaded[<plugin_name>]` is falsy. Heuristic —
  --     uses the same `.nvim`/`.vim` strip as plugin_name; some plugins
  --     don't follow the convention but the check still catches the
  --     common case where a plugin/* file calls `require('<name>')`.
  --   • local: `vim.fn.expand(src)` is NOT on rtp, with one exception
  --     for `stdpath('config')` which is unconditionally on rtp.
  --
  -- The `_loaded` filter prevents false positives — once a trigger has
  -- fired, the spec is legitimately loaded and is excluded from the
  -- check.
  h.start('pack.loader — lazy leak check')
  local loaded_set = loader._loaded or {}
  local opt_dir = vim.fs.joinpath(vim.fn.stdpath('data'), 'site', 'pack', 'core', 'opt')
  local config_dir = vim.fn.stdpath('config')
  local rtp_set = {}
  for _, p in ipairs(vim.api.nvim_list_runtime_paths()) do rtp_set[p] = true end

  local leaks = 0
  for _, spec in ipairs(plugins) do
    local src = spec_src(spec)
    if lazy_set[src] and not loaded_set[src] then
      if is_local_src(src) then
        local path = vim.fn.expand(src)
        if path ~= config_dir and rtp_set[path] then
          h.warn(plugin_name(spec) .. ' (local): on rtp before any trigger fired')
          leaks = leaks + 1
        end
      else
        local pname = pack_name(spec)
        local opt_path = vim.fs.joinpath(opt_dir, pname)
        if rtp_set[opt_path] then
          h.warn(plugin_name(spec) ..
            ': pack/opt path on rtp before any trigger fired')
          leaks = leaks + 1
        end
        local mod = pname:gsub('%.nvim$', ''):gsub('%.vim$', '')
        if package.loaded[mod] then
          h.warn(plugin_name(spec) ..
            ': module `' .. mod .. '` is loaded — `plugin/*` self-sourced ' ..
            'or another module require()d it')
          leaks = leaks + 1
        end
      end
    end
  end
  if leaks == 0 then
    h.ok('no lazy leaks (all unloaded specs are off rtp & not require()d)')
  end

  -- ---------------------------------------------------------------
  h.start('pack.loader — CLI deps')
  local cli_deps = loader._cli_deps or {}
  if #cli_deps == 0 then
    h.info('no CLI deps configured')
  else
    local cli_missing = 0
    for _, dep in ipairs(cli_deps) do
      if type(dep) == 'table' and type(dep.cmd) == 'string' and dep.cmd ~= '' then
        if vim.fn.executable(dep.cmd) == 0 then
          h.warn(('missing `%s` (required by %s) — %s'):format(
            dep.cmd, tostring(dep.req), tostring(dep.hint)))
          cli_missing = cli_missing + 1
        end
      end
    end
    if cli_missing == 0 then
      h.ok(('%d CLI dep(s) present'):format(#cli_deps))
    end
  end

  -- ---------------------------------------------------------------
  h.start('pack.loader — maintenance')
  local hash_path = loader._hash_path
  local current = loader._spec_hash
  if not hash_path or not current then
    h.info('maintenance state not exposed (loader may not have finished setup)')
  else
    local ok_read, lines = pcall(vim.fn.readfile, hash_path)
    local stored = (ok_read and lines[1]) or ''
    if stored == current then
      h.ok('spec hash in sync — no maintenance pending')
    elseif stored == '' then
      h.info('no stored hash yet — maintenance will run at next UIEnter')
    else
      h.info('spec hash changed since last write — maintenance scheduled for next UIEnter (or run :PackSync)')
    end
  end

  -- NOTE: vim.pack.get() spawns one `git` subprocess per plugin (~500 ms
  -- cumulative on this config) — not worth blocking :checkhealth for.
  -- `:checkhealth vim.pack` already reports lockfile / plugin-dir / git state.
end

return M
