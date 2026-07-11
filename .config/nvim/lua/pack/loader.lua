-- Lazy-loading loader built on top of vim.pack.
-- See lua/pack/ARCHITECTURE.md for the full design (phase ordering,
-- propagation rules, stub semantics, maintenance gating).

local log = require('logger')
local profile = require('profiler')
local current_profile = require('profile').current
local proc = require('utils.proc')
local cmd_util = require('utils.cmd')
local as_list = require('utils.tbl').as_list

-- ============================================================
-- Helpers
-- ============================================================
local function plugin_name(spec)
  if type(spec) == 'table' and spec.name then return spec.name end
  local src = type(spec) == 'string' and spec or spec.src
  local name = type(src) == 'string' and src:match('[^/]+$') or nil
  if not name or name == '' then
    error('[vim.pack] plugin_name: cannot derive name from src `' .. tostring(src) ..
      '`; set spec.name explicitly')
  end
  return name:gsub('%.nvim$', ''):gsub('%.vim$', '')
end

-- Disk/pack name for `:packadd` and vim.pack tracking. Must match the
-- on-disk directory name in `pack/*/opt/<name>` — `:packadd` searches
-- packpath for that exact directory and silently does nothing if no
-- match is found (no error raised). vim.pack derives the same trailing
-- path component when no explicit `spec.name` is given, so this stays
-- in sync with what vim.pack installed.
--
-- Distinct from `plugin_name` because `plugin_name` strips
-- `.nvim`/`.vim` suffixes for use as Lua module path components
-- (`require('plugins.<plugin_name>.setup')`) and for the per-plugin
-- config dir layout (`lua/plugins/<plugin_name>/`). Disk dirs keep the
-- suffix; module paths drop it.
local function pack_name(spec)
  if type(spec) == 'table' and spec.name then return spec.name end
  local src = type(spec) == 'string' and spec or spec.src
  local name = type(src) == 'string' and src:match('[^/]+$') or nil
  if not name or name == '' then
    error('[vim.pack] pack_name: cannot derive name from src `' .. tostring(src) ..
      '`; set spec.name explicitly')
  end
  return name
end

-- Plugin-config files live at a fixed path under stdpath('config'); memoized
-- by (name, filename) so each unique pair pays one fs_stat ever.
local config_plugins_dir = vim.fn.stdpath('config') .. '/lua/plugins/'
local file_cache = require('cache').new()
local function has_file(name, filename)
  local key = name .. '/' .. filename
  return file_cache.get(key, function()
    return vim.uv.fs_stat(config_plugins_dir .. key .. '.lua') ~= nil
  end)
end

-- Prefer the profile-suffixed variant, fall back to the base filename. Returns
-- the filename to require (without `.lua`), or nil if neither exists. Used for
-- per-plugin `config` / `setup` / `keys` so a `setup_work.lua` replaces
-- `setup.lua` when NVIM_PROFILE=work. See README "Profiles" section.
local function resolve_file(name, kind)
  local variant = kind .. '_' .. current_profile
  if has_file(name, variant) then return variant end
  if has_file(name, kind) then return kind end
  return nil
end

local function is_local(spec)
  local src = type(spec) == 'string' and spec or spec.src
  return src:sub(1, 1) == '/' or src:sub(1, 1) == '~'
end

-- :packadd-equivalent for local specs (which aren't `pack/*/opt/<name>`
-- dirs and so don't work with `:packadd`). Mirrors what `:packadd` does
-- for vim.pack-managed plugins:
--   1. Prepend the path to 'runtimepath'.
--   2. Source plugin/*.{lua,vim} and ftdetect/*.{lua,vim}.
--   3. Source after/plugin/** post-startup. (During startup, Neovim's
--      own rtp scan picks up after/plugin from any path on rtp; once
--      vim_did_enter is 1 we have to source these explicitly. Same
--      pattern vim.pack uses internally — see runtime/lua/vim/pack.lua
--      `pack_add` post-startup branch.)
--
-- Used inside `load_plugin` for lazy local specs, whose install-phase
-- `rtp:prepend` is deliberately skipped so `plugin/*` does not auto-source
-- at startup. Eager local specs `rtp:prepend` in the install phase as
-- before; their `plugin/*` is sourced by Neovim's startup rtp scan.
local function local_packadd(path)
  vim.opt.rtp:prepend(path)
  for _, p in ipairs(vim.fn.glob(path .. '/plugin/*.lua', false, true)) do
    vim.cmd.source({ p, magic = { file = false } })
  end
  for _, p in ipairs(vim.fn.glob(path .. '/plugin/*.vim', false, true)) do
    vim.cmd.source({ p, magic = { file = false } })
  end
  for _, p in ipairs(vim.fn.glob(path .. '/ftdetect/*.{vim,lua}', false, true)) do
    vim.cmd.source({ p, magic = { file = false } })
  end
  if vim.v.vim_did_enter == 1 then
    for _, p in ipairs(vim.fn.glob(path .. '/after/plugin/**/*.{vim,lua}', false, true)) do
      vim.cmd.source({ p, magic = { file = false } })
    end
  end
end

local LAZY_FIELDS = { 'ft', 'on_event', 'on_init', 'on_cmd', 'on_key' }

local function is_lazy_spec(spec)
  if type(spec) ~= 'table' then return false end
  for _, f in ipairs(LAZY_FIELDS) do
    if spec[f] then return true end
  end
  return false
end

-- Fields vim.pack.Spec accepts (see :h vim.pack.Spec). Custom keys
-- (ft/on_event/on_cmd/on_key/on_init/requires/wants/after/eager/install_command)
-- are filtered out by omission; adding a new custom key needs no change here.
local PACK_FIELDS = { src = true, name = true, version = true, data = true }

local function pack_spec(spec)
  if type(spec) == 'string' then return spec end
  local s = {}
  for k, v in pairs(spec) do
    if PACK_FIELDS[k] then s[k] = v end
  end
  return s
end

local function spec_src(spec)
  return type(spec) == 'string' and spec or spec.src
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

-- First-match-wins index over '/'-terminated suffixes of each spec's src, so
-- dep lookups become O(1). See ARCHITECTURE.md → "Dependency resolution".
local function build_dep_index(plugin_list)
  local idx = {}
  for _, spec in ipairs(plugin_list) do
    local src = spec_src(spec)
    local pos = 0
    while true do
      local nxt = src:find('/', pos + 1, true)
      if not nxt then break end
      local key = src:sub(nxt + 1)
      if idx[key] == nil then idx[key] = spec end
      pos = nxt
    end
  end
  return idx
end

local function find_spec_by_dep(idx, dep)
  return idx[dep]
end

local function validate_deps(plugin_list, idx)
  for _, spec in ipairs(plugin_list) do
    if type(spec) == 'table' then
      local name = plugin_name(spec)
      if spec.requires then
        for _, dep in ipairs(as_list(spec.requires)) do
          if not find_spec_by_dep(idx, dep) then
            log.error('[vim.pack] ' .. name .. ': missing required dep `' .. dep .. '`')
          end
        end
      end
      if spec.wants then
        for _, dep in ipairs(as_list(spec.wants)) do
          if not find_spec_by_dep(idx, dep) then
            log.warn('[vim.pack] ' .. name .. ': missing wanted dep `' .. dep .. '`')
          end
        end
      end
      if spec.after then
        for _, dep in ipairs(as_list(spec.after)) do
          if not find_spec_by_dep(idx, dep) then
            log.error('[vim.pack] ' .. name .. ': missing after dep `' .. dep .. '`')
          end
        end
      end
    end
  end
end

local function topo_sort(plugin_list, idx)
  local visited = {}
  local result = {}

  local function visit(spec)
    local src = spec_src(spec)
    if visited[src] == 'in_progress' then
      log.error('[vim.pack] circular dep involving: ' .. plugin_name(spec))
      return
    end
    if visited[src] == 'done' then return end
    visited[src] = 'in_progress'
    for _, dep in ipairs(collect_deps(spec)) do
      local dep_spec = find_spec_by_dep(idx, dep)
      if dep_spec then visit(dep_spec) end
    end
    visited[src] = 'done'
    table.insert(result, spec)
  end

  for _, spec in ipairs(plugin_list) do
    visit(spec)
  end
  return result
end

-- Stable string key for a spec's trigger bundle; used to detect whether a
-- plugin's reverse-deps share identical triggers. See ARCHITECTURE.md.
local function bundle_key(spec)
  if type(spec) ~= 'table' then return '' end
  local parts = {}
  for _, f in ipairs(LAZY_FIELDS) do
    if spec[f] ~= nil then
      local v = spec[f]
      if type(v) == 'table' then
        local items = {}
        for _, x in ipairs(v) do
          if type(x) == 'table' then
            table.insert(items, (x.mode or 'n') .. ':' .. tostring(x.lhs or ''))
          else
            table.insert(items, tostring(x))
          end
        end
        table.sort(items)
        table.insert(parts, f .. '=' .. table.concat(items, ','))
      else
        table.insert(parts, f .. '=' .. tostring(v))
      end
    end
  end
  return table.concat(parts, '|')
end

-- Returns:
--   lazy_set   : src → true
--   needs_init : src → true  (mixed-bundle rdeps → on_init safety net)
-- See ARCHITECTURE.md → "Lazy propagation" for the four rules.
local function propagate_lazy(plugin_list, idx)
  local lazy_set, needs_init = {}, {}
  for _, spec in ipairs(plugin_list) do
    if is_lazy_spec(spec) then lazy_set[spec_src(spec)] = true end
  end

  local rdeps = {}
  for _, spec in ipairs(plugin_list) do
    for _, dep in ipairs(collect_deps(spec)) do
      local dep_spec = find_spec_by_dep(idx, dep)
      if dep_spec then
        local dep_src = spec_src(dep_spec)
        rdeps[dep_src] = rdeps[dep_src] or {}
        table.insert(rdeps[dep_src], spec)
      end
    end
  end

  local changed = true
  while changed do
    changed = false
    for _, spec in ipairs(plugin_list) do
      local src = spec_src(spec)
      if not lazy_set[src] and not (type(spec) == 'table' and spec.eager) then
        local rev = rdeps[src]
        if rev and #rev > 0 then
          local all_lazy = true
          local bundle, mixed = nil, false
          for _, r in ipairs(rev) do
            if not lazy_set[spec_src(r)] then
              all_lazy = false
              break
            end
            local key = bundle_key(r)
            if bundle == nil then
              bundle = key
            elseif bundle ~= key then
              mixed = true
            end
          end
          if all_lazy then
            lazy_set[src] = true
            changed = true
            if mixed then
              needs_init[src] = true
              log.warn('[vim.pack] ' .. plugin_name(spec) ..
                ': rdeps have mismatched lazy triggers → promoted to on_init '
                .. '(loads at VimEnter, not on user demand)')
            else
              log.debug('[vim.pack] auto-promoting to lazy: ' .. plugin_name(spec))
            end
          end
        end
      end
    end
  end

  return lazy_set, needs_init
end

-- ============================================================
-- Public API
-- ============================================================
local M = {}

---Set up the vim.pack lazy-loading loader.
---@param plugins table   List of plugin specs (see schema in lua/plugins.lua)
---@param opts    table?  { cli_deps = { { cmd, req, hint }, ... } }
function M.setup(plugins, opts)
  opts = opts or {}

  -- Shape validation — reject malformed specs up front so downstream code can
  -- assume every spec is either a URL string or a table with a non-empty src.
  -- Misconfigs are logged and skipped; the loader never aborts (so one bad
  -- entry doesn't take out the whole editor).
  do
    local valid = {}
    for _, spec in ipairs(plugins) do
      if type(spec) == 'string' and spec ~= '' then
        table.insert(valid, spec)
      elseif type(spec) == 'table' and type(spec.src) == 'string' and spec.src ~= '' then
        table.insert(valid, spec)
      else
        log.error('[vim.pack] invalid spec (missing or empty `src`): ' ..
          vim.inspect(spec))
      end
    end
    plugins = valid
  end

  -- CLI dep advisory checks (warn if a required external tool is missing).
  for i, dep in ipairs(opts.cli_deps or {}) do
    if type(dep) ~= 'table' or type(dep.cmd) ~= 'string' or dep.cmd == '' then
      log.error('[vim.pack] cli_deps[' .. i .. ']: missing or invalid `cmd`')
    elseif vim.fn.executable(dep.cmd) == 0 then
      log.warn('[vim.pack] missing CLI tool: `' .. dep.cmd ..
        '` (required by ' .. tostring(dep.req) .. ')  →  ' .. tostring(dep.hint))
    end
  end

  -- Validate → topo-sort → rebuild index (topo reorder changes first-match-wins
  -- output) → propagate lazy.
  local dep_idx = build_dep_index(plugins)
  profile.time('plugins: validate_deps', validate_deps, plugins, dep_idx)
  profile.time('plugins: topo_sort', function() plugins = topo_sort(plugins, dep_idx) end)
  dep_idx = build_dep_index(plugins)
  local lazy_set, needs_init = profile.time('plugins: propagate_lazy', propagate_lazy, plugins, dep_idx)

  -- ----------------------------------------------------------
  -- Post-install/update hooks — User PackChanged dispatcher.
  -- Keyed on spec.src (see ARCHITECTURE.md → "PackChanged dispatcher").
  -- ----------------------------------------------------------
  local install_hooks = {}
  for _, spec in ipairs(plugins) do
    if type(spec) == 'table' and spec.install_command then
      -- Local specs skip vim.pack.add entirely, so PackChanged never fires for
      -- them. An install_command would be silently dead — warn and drop.
      if is_local(spec) then
        log.warn('[vim.pack] ' .. plugin_name(spec) ..
          ': install_command on local spec is ignored (PackChanged never fires)')
      else
        install_hooks[spec_src(spec)] = spec
      end
    end
  end

  vim.api.nvim_create_autocmd('User', {
    pattern = 'PackChanged',
    callback = function(ev)
      local d = ev.data
      if d.kind ~= 'install' and d.kind ~= 'update' then return end
      local spec = install_hooks[d.spec.src]
      if not spec then return end
      local name = plugin_name(spec)
      local cmd = spec.install_command

      if type(cmd) == 'string' then
        log.info('[vim.pack] ' .. name .. ' ' .. d.kind .. 'd — running :' .. cmd)
        vim.schedule(function()
          if not d.active then
            vim.cmd.packadd(pack_name(spec))
          end
          vim.cmd(cmd)
        end)
      elseif type(cmd) == 'table' then
        log.info('[vim.pack] ' .. name .. ' ' .. d.kind .. 'd — running ' ..
          table.concat(cmd, ' ') .. ' in ' .. d.path)
        proc.run_async(cmd, {
          cwd = d.path,
          on_exit = function(_, code)
            if code == 0 then
              log.info('[vim.pack] ' .. name .. ': ' .. cmd[1] .. ' succeeded')
            else
              log.error('[vim.pack] ' .. name .. ': ' .. cmd[1] ..
                ' failed (exit ' .. code .. ')')
            end
          end,
        })
      else
        log.warn('[vim.pack] ' .. name .. ': install_command has unsupported type ' ..
          type(cmd))
      end
    end,
  })

  -- ----------------------------------------------------------
  -- Config pass — runs for ALL plugins before any load, so globals set here
  -- (e.g. vim.g.coq_settings) exist before the plugin reads them on load.
  -- ----------------------------------------------------------
  do
    local stop = profile.section('plugins: config pass')
    for _, spec in ipairs(plugins) do
      local name = plugin_name(spec)
      local f = resolve_file(name, 'config')
      if f then require('plugins.' .. name .. '.' .. f) end
    end
    stop()
  end

  -- ----------------------------------------------------------
  -- Install phase — eager plugins load now; lazy plugins are installed but
  -- kept off the rtp (load = function() end) until their trigger fires.
  --
  -- `load = false` is NOT enough: it maps to `:packadd!`, which adds the
  -- plugin path to 'runtimepath' during init. Neovim then auto-sources
  -- `pack/*/opt/<name>/plugin/*.lua` for paths added during init at the
  -- `vim_did_enter` 0→1 transition — defeating the lazy contract for any
  -- plugin whose `plugin/*` file does meaningful work (e.g.
  -- nvim-treesitter-context's `plugin/treesitter-context.lua` calls
  -- `require('treesitter-context').setup()` with defaults, which then
  -- pre-empts our user `setup.lua` until the first trigger fires).
  --
  -- The callable form short-circuits inside vim.pack BEFORE the `:packadd`
  -- branch (see `runtime/lua/vim/pack.lua` ~ pack_add: callable check
  -- returns early), so the path is never registered to rtp at install
  -- time. `load_plugin` later runs the real `:packadd` (no bang) on
  -- trigger fire, which is the only point at which `plugin/*` sources.
  -- ----------------------------------------------------------
  local eager_pack, lazy_pack = {}, {}
  for _, spec in ipairs(plugins) do
    local src = spec_src(spec)
    if is_local(spec) then
      -- `version` is a vim.pack field; local specs skip vim.pack entirely, so
      -- the pin would silently do nothing.
      if type(spec) == 'table' and spec.version then
        log.warn('[vim.pack] ' .. plugin_name(spec) ..
          ': version on local spec is ignored (vim.pack is skipped)')
      end
      -- Eager-only prepend; lazy local specs defer rtp + plugin/ sourcing
      -- to load_plugin via local_packadd, so plugin/* and ftdetect/* are
      -- not auto-sourced at startup by Neovim's rtp scan.
      if not lazy_set[src] then
        vim.opt.rtp:prepend(vim.fn.expand(src))
      end
    elseif lazy_set[src] then
      table.insert(lazy_pack, pack_spec(spec))
    else
      table.insert(eager_pack, pack_spec(spec))
    end
  end

  profile.time('plugins: vim.pack.add eager (load=true)', function()
    vim.pack.add(eager_pack, { load = true })
  end)
  if #lazy_pack > 0 then
    profile.time('plugins: vim.pack.add lazy (load=noop)', function()
      vim.pack.add(lazy_pack, { load = function() end })
    end)
  end

  -- ----------------------------------------------------------
  -- Pack maintenance — src-reconcile + prune, hash-gated on UIEnter.
  -- See ARCHITECTURE.md → "Maintenance hash gating".
  -- ----------------------------------------------------------
  local pack_hash_path = vim.fs.joinpath(vim.fn.stdpath('state'), 'pack-spec-hash')

  local function compute_spec_hash()
    local parts = {}
    for _, spec in ipairs(plugins) do
      if type(spec) == 'string' then
        table.insert(parts, spec)
      else
        -- install_command must be part of the hash: PackChanged only fires it
        -- on install/update, so changing it on an existing plugin without
        -- bumping src/name/version must force a maintenance re-run.
        table.insert(parts, table.concat({
          spec.src, spec.name or '', spec.version or '',
          vim.json.encode(spec.install_command or vim.NIL),
        }, '|'))
      end
    end
    table.sort(parts)
    return vim.fn.sha256(table.concat(parts, '\n'))
  end

  local function read_prev_hash()
    local ok, lines = pcall(vim.fn.readfile, pack_hash_path)
    return (ok and lines[1]) or ''
  end

  local function write_hash(h)
    pcall(vim.fn.mkdir, vim.fn.fnamemodify(pack_hash_path, ':h'), 'p')
    pcall(vim.fn.writefile, { h }, pack_hash_path)
  end

  -- Returns true when the whole body ran without error. Hash is only written
  -- on success, so a transient failure is retried on next startup. Individual
  -- update/del calls are pcall-wrapped so one bad plugin doesn't abort the rest.
  local function run_maintenance()
    local stop = profile.section('plugins: deferred maintenance')
    local ok, err = pcall(function()
      local pack_list = vim.pack.get()

      local lock_path = vim.fs.joinpath(vim.fn.stdpath('config'), 'nvim-pack-lock.json')
      local ok_read, lines = pcall(vim.fn.readfile, lock_path)
      if ok_read then
        local ok_json, lock = pcall(vim.json.decode, table.concat(lines, '\n'))
        if not ok_json then
          log.warn('[vim.pack] nvim-pack-lock.json is corrupt: ' .. tostring(lock))
        end
        if ok_json and lock and lock.plugins then
          for _, x in ipairs(pack_list) do
            if x.active then
              local locked = lock.plugins[x.spec.name]
              if locked ~= nil and locked.src ~= x.spec.src then
                log.info('[vim.pack] src changed for ' .. x.spec.name .. ', updating')
                local ok_upd, upd_err = pcall(vim.pack.update, { x.spec.name })
                if not ok_upd then
                  log.error('[vim.pack] update failed for ' .. x.spec.name ..
                    ': ' .. tostring(upd_err))
                end
              end
            end
          end
        end
      end

      for _, x in ipairs(pack_list) do
        if not x.active then
          log.warn('[vim.pack] pruning unused plugin (removing from disk): ' .. x.spec.name)
          local ok_del, del_err = pcall(vim.pack.del, { x.spec.name })
          if not ok_del then
            log.error('[vim.pack] prune failed for ' .. x.spec.name ..
              ': ' .. tostring(del_err))
          end
        end
      end
    end)
    stop()
    if not ok then
      log.error('[vim.pack] maintenance aborted: ' .. tostring(err))
      return false
    end
    return true
  end

  local current_hash = compute_spec_hash()
  if current_hash ~= read_prev_hash() then
    vim.api.nvim_create_autocmd('UIEnter', {
      once = true,
      callback = function()
        vim.schedule(function()
          if run_maintenance() then
            write_hash(current_hash)
          end
        end)
      end,
    })
  end

  cmd_util.new_cmd('PackSync', function()
    if run_maintenance() then
      write_hash(current_hash)
    end
  end, { desc = 'Run vim.pack maintenance (src-reconcile + prune) now' })

  -- Auto-register keymaps from plugins/<name>/keys.lua after setup.lua runs.
  -- Every call site of utils.keys.register(require('plugins.<name>.keys'), ...)
  -- previously duplicated this boilerplate; centralizing makes `silent = true`
  -- the convention and cuts ~11 lines of repetition across setup.lua files.
  -- Opt-out: a keys.lua can set `_no_auto = true` on its returned table.
  -- pcall-guarded so a broken keys module doesn't abort the plugin load.
  local function auto_register_keys(name)
    local f = resolve_file(name, 'keys')
    if not f then return end
    local ok, keys = pcall(require, 'plugins.' .. name .. '.' .. f)
    if not ok or type(keys) ~= 'table' or keys._no_auto then return end
    require('utils.keys').register(keys, { opts = { silent = true } })
  end

  -- ----------------------------------------------------------
  -- Setup pass — eager plugins run setup now; lazy plugins run setup inside
  -- load_plugin() after packadd.
  -- ----------------------------------------------------------
  do
    local stop = profile.section('plugins: eager setup pass')
    for _, spec in ipairs(plugins) do
      if not lazy_set[spec_src(spec)] then
        local name = plugin_name(spec)
        local f = resolve_file(name, 'setup')
        if f then require('plugins.' .. name .. '.' .. f) end
        auto_register_keys(name)
      end
    end
    stop()
  end

  -- ----------------------------------------------------------
  -- Lazy loader — idempotent; packadds transitive lazy deps first (topo order)
  -- then the plugin itself, then runs its setup.
  -- ----------------------------------------------------------
  local loaded = {}

  local function load_plugin(spec)
    local src = spec_src(spec)
    if loaded[src] then return end
    loaded[src] = true

    for _, dep_slug in ipairs(collect_deps(spec)) do
      local dep_spec = find_spec_by_dep(dep_idx, dep_slug)
      if dep_spec and lazy_set[spec_src(dep_spec)] then
        load_plugin(dep_spec)
      end
    end

    local name = plugin_name(spec)
    -- vim.pack specs use Neovim's `:packadd` (un-stripped `pack_name` —
    -- `:packadd` searches `pack/*/opt/<name>` for the literal directory
    -- name and silently no-ops on a miss; `plugin_name` strips
    -- `.nvim`/`.vim` for Lua-module paths and would not match the dir).
    --
    -- Lazy local specs skipped install-phase `rtp:prepend`; do the
    -- equivalent of `:packadd` (rtp + plugin/ + ftdetect) now via
    -- `local_packadd`. Eager local specs were already prepended at
    -- install time and have nothing to do here.
    if is_local(spec) then
      if lazy_set[spec_src(spec)] then
        local_packadd(vim.fn.expand(spec_src(spec)))
      end
    else
      vim.cmd.packadd(pack_name(spec))
    end
    local f = resolve_file(name, 'setup')
    if f then require('plugins.' .. name .. '.' .. f) end
    auto_register_keys(name)
  end

  -- ----------------------------------------------------------
  -- Trigger wiring — one autocmd per spec so one spec's trigger doesn't drag
  -- in another. See ARCHITECTURE.md → "Trigger wiring".
  -- ----------------------------------------------------------

  -- on_init: single shared VimEnter once-autocmd; vim.schedule defers each
  -- load. Covers explicit on_init=true AND propagation-promoted needs_init.
  local init_specs = {}
  for _, spec in ipairs(plugins) do
    local src = spec_src(spec)
    local explicit = type(spec) == 'table' and spec.on_init
    if lazy_set[src] and (explicit or needs_init[src]) then
      table.insert(init_specs, spec)
    end
  end
  if #init_specs > 0 then
    vim.api.nvim_create_autocmd('VimEnter', {
      once = true,
      callback = function()
        profile.tick('on_init: VimEnter autocmd fired')
        vim.schedule(function()
          local stop = profile.section('on_init: schedule')
          for _, spec in ipairs(init_specs) do
            load_plugin(spec)
          end
          stop()
        end)
      end,
    })
  end

  -- on_event
  for _, spec in ipairs(plugins) do
    if type(spec) == 'table' and spec.on_event then
      vim.api.nvim_create_autocmd(spec.on_event, {
        once = true,
        callback = function() load_plugin(spec) end,
      })
    end
  end

  -- on_cmd: stub command; first invocation removes the stub, loads the plugin,
  -- then re-dispatches preserving args/bang/range/mods. `-range` and `-count`
  -- are mutually exclusive in Vim; `-register` is omitted deliberately (it
  -- eats the first arg char). See ARCHITECTURE.md for the full caveat list.
  for _, spec in ipairs(plugins) do
    if type(spec) == 'table' and spec.on_cmd then
      for _, cmd in ipairs(spec.on_cmd) do
        cmd_util.new_cmd(cmd, function(opts_)
          pcall(vim.api.nvim_del_user_command, cmd)
          load_plugin(spec)

          -- The real command may accept a narrower attr set than the stub —
          -- look it up (buf-local takes precedence) so we only forward
          -- range/bang when the target actually accepts them.
          local buf_cmds = vim.api.nvim_buf_get_commands(0, {})
          local real = buf_cmds[cmd] or vim.api.nvim_get_commands({})[cmd]

          local dispatch = {
            cmd  = cmd,
            args = opts_.fargs,
            mods = opts_.smods,
          }
          if opts_.bang and (not real or real.bang) then
            dispatch.bang = true
          end
          if opts_.range > 0 and (not real or real.range) then
            dispatch.range = { opts_.line1, opts_.line2 }
          end
          vim.cmd(dispatch)
        end, { nargs = '*', bang = true, range = true })
      end
    end
  end

  -- on_key: stub mapping; first press removes the stub, loads the plugin
  -- (which defines the real mapping), then feeds the key back. <leader>/
  -- <localleader> aren't expanded by replace_termcodes; substitute manually.
  -- Shape:
  --   on_key = { '<leader>X', { mode = 'v', lhs = '<leader>Y' }, ... }
  --     legacy list form, stubs carry no desc.
  --   on_key = true
  --     auto-discover from `lua/plugins/<name>/keys.lua`; stubs carry
  --     `opts.desc` (shows up in which-key / :map / telescope keymaps).
  local function resolve_leader(s)
    return (s:gsub('<[Ll]eader>', vim.g.mapleader or '\\')
             :gsub('<[Ll]ocal[Ll]eader>', vim.g.maplocalleader or '\\'))
  end

  for _, spec in ipairs(plugins) do
    if type(spec) == 'table' and spec.on_key then
      local entries
      if spec.on_key == true then
        local name = plugin_name(spec)
        local f = resolve_file(name, 'keys')
        if f then
          entries = require('plugins.' .. name .. '.' .. f)
        else
          log.warn('[vim.pack] ' .. name ..
            ': on_key = true but no keys file found (looked for keys_' ..
            current_profile .. '.lua and keys.lua) — no stubs registered; plugin will never load')
        end
      else
        entries = spec.on_key
      end
      if type(entries) == 'table' then
        for _, key in ipairs(entries) do
          local lhs, mode, desc
          if type(key) == 'string' then
            lhs, mode = key, 'n'
          else
            lhs  = key.lhs
            mode = key.mode or 'n'
            desc = key.opts and key.opts.desc
          end
          -- register one stub per mode (a `mode = {'n','v'}` entry fans out)
          local modes = type(mode) == 'table' and mode or { mode }
          for _, m in ipairs(modes) do
            vim.keymap.set(m, lhs, function()
              pcall(vim.keymap.del, m, lhs)
              load_plugin(spec)
              vim.api.nvim_feedkeys(
                vim.api.nvim_replace_termcodes(resolve_leader(lhs), true, false, true),
                'm', false
              )
            end, desc and { desc = desc } or nil)
          end
        end
      end
    end
  end

  -- ft: one FileType once-autocmd per spec (not shared) so spec A's ft match
  -- doesn't drag in spec B.
  for _, spec in ipairs(plugins) do
    if type(spec) == 'table' and spec.ft then
      vim.api.nvim_create_autocmd('FileType', {
        pattern = spec.ft,
        once = true,
        callback = function() load_plugin(spec) end,
      })
    end
  end

  -- Internal state exposed for :checkhealth pack (lua/pack/health.lua).
  M._plugins       = plugins
  M._dep_idx       = dep_idx
  M._lazy_set      = lazy_set
  M._needs_init    = needs_init
  M._loaded        = loaded
  M._cli_deps      = opts.cli_deps or {}
  M._spec_hash     = current_hash
  M._hash_path     = pack_hash_path
end

return M
