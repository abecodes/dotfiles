require('grug-far').setup({
  -- debounce milliseconds for issuing search while user is typing
  -- prevents excessive searching
  debounceMs = 500,

  -- minimum number of chars which will cause a search to happen
  -- prevents performance issues in larger dirs
  minSearchChars = 2,

  -- stops search after this number of matches as getting millions of matches is most likely pointless
  -- and can even freeze the search buffer sometimes
  -- can help prevent performance issues when searching for very common strings or when slowly starting
  -- to type your search string
  -- note that it can overshoot a little bit, but should not really matter in practice
  -- set to nil to disable
  maxSearchMatches = 2000,

  -- disable automatic debounced search and trigger search when leaving insert mode instead
  searchOnInsertLeave = false,

  -- max number of parallel replacements tasks
  maxWorkers = 4,

  -- search and replace engines configuration
  engines = {
    -- see https://github.com/BurntSushi/ripgrep
    ripgrep = {
      -- ripgrep executable to use, can be a different path if you need to configure
      path = 'rg',

      -- extra args that you always want to pass
      -- like for example if you always want context lines around matches
      extraArgs = '',

      -- placeholders to show in input areas when they are empty
      -- set individual ones to '' to disable, or set enabled = false for complete disable
      placeholders = {
        -- whether to show placeholders
        enabled = true,

        search = 'ex: foo    foo([a-z0-9]*)    fun\\(',
        replacement = 'ex: bar    ${1}_foo    $$MY_ENV_VAR ',
        filesFilter = 'ex: *.lua     *.{css,js}    **/docs/*.md',
        flags = 'ex: --help --ignore-case (-i) --replace= (empty replace) --multiline (-U)',
        paths = 'ex: /foo/bar   ../   ./hello\\ world/   ./src/foo.lua',
      },
    },
    -- see https://ast-grep.github.io
    astgrep = {
      -- ast-grep executable to use, can be a different path if you need to configure
      path = 'sg',

      -- extra args that you always want to pass
      -- like for example if you always want context lines around matches
      extraArgs = '',

      -- placeholders to show in input areas when they are empty
      -- set individual ones to '' to disable, or set enabled = false for complete disable
      placeholders = {
        -- whether to show placeholders
        enabled = true,

        search = 'ex: $A && $A()   foo.bar($$$ARGS)   $_FUNC($_FUNC)',
        replacement = 'ex: $A?.()   blah($$$ARGS)',
        filesFilter = 'ex: *.lua   *.{css,js}   **/docs/*.md   (filters via ripgrep)',
        flags = 'ex: --help (-h) --debug-query=ast --rewrite= (empty replace) --strictness=<STRICTNESS>',
        paths = 'ex: /foo/bar  ../  ./hello\\ world/  ./src/foo.lua',
      },
    },
  },

  -- search and replace engine to use.
  -- Must be one of 'ripgrep' | 'astgrep' | nil
  -- if nil, defaults to 'ripgrep'
  engine = 'ripgrep',

  -- specifies the command to run (with `vim.cmd(...)`) in order to create
  -- the window in which the grug-far buffer will appear
  -- ex (horizontal bottom right split): 'botright split'
  -- ex (open new tab): 'tabnew %'
  windowCreationCommand = 'vsplit',

  -- buffer line numbers + match line numbers can get a bit visually overwhelming
  -- turn this off if you still like to see the line numbers
  disableBufferLineNumbers = true,

  -- maximum number of search chars to show in buffer and quickfix list titles
  -- zero disables showing it
  maxSearchCharsInTitles = 30,

  -- static title to use for grug-far buffer, as opposed to the dynamically generated title.
  -- Note that nvim does not allow multiple buffers with the same name, so this option is meant more
  -- as something to be speficied for a particular instance as opposed to something set in the setup function
  -- nil or '' disables it
  staticTitle = nil,

  -- whether to start in insert mode,
  -- set to false for normal mode
  startInInsertMode = true,

  -- row in the window to position the cursor at at start
  startCursorRow = 3,

  -- whether to wrap text in the grug-far buffer
  wrap = true,

  -- whether or not to make a transient buffer which is both unlisted and fully deletes itself when not in use
  transient = false,

  -- by default, in visual mode, the visual selection is used to prefill the search
  -- setting this option to true disables that behaviour
  ignoreVisualSelection = false,

  -- shortcuts for the actions you see at the top of the buffer
  -- set to '' or false to unset. Mappings with no normal mode value will be removed from the help header
  -- you can specify either a string which is then used as the mapping for both normal and insert mode
  -- or you can specify a table of the form { [mode] = <lhs> } (ex: { i = '<C-enter>', n = '<localleader>gr'})
  -- it is recommended to use <localleader> though as that is more vim-ish
  -- see https://learnvimscriptthehardway.stevelosh.com/chapters/11.html#local-leader
  keymaps = {
    replace = { n = '<localleader>r' },
    qflist = { n = '<localleader>q' },
    syncLocations = { n = '<localleader>s' },
    syncLine = { n = '<localleader>l' },
    close = { n = '<localleader>c' },
    historyOpen = { n = '<localleader>t' },
    historyAdd = { n = '<localleader>a' },
    refresh = { n = '<localleader>f' },
    openLocation = { n = '<localleader>o' },
    gotoLocation = { n = '<enter>' },
    pickHistoryEntry = { n = '<enter>' },
    abort = { n = '<localleader>b' },
    help = { n = 'g?' },
    toggleShowCommand = { n = '<localleader>p' },
    swapEngine = { n = '<localleader>e' },
  },

  -- separator between inputs and results, default depends on nerdfont
  resultsSeparatorLineChar = '',

  -- highlight the results with TreeSitter, if available
  resultsHighlight = true,

  -- spinner states, default depends on nerdfont, set to false to disable
  spinnerStates = {
    '󱑋 ',
    '󱑌 ',
    '󱑍 ',
    '󱑎 ',
    '󱑏 ',
    '󱑐 ',
    '󱑑 ',
    '󱑒 ',
    '󱑓 ',
    '󱑔 ',
    '󱑕 ',
    '󱑖 ',
  },

  -- whether to report duration of replace/sync operations
  reportDuration = true,

  -- icons for UI, default ones depend on nerdfont
  -- set individual ones to '' to disable, or set enabled = false for complete disable
  icons = {
    -- whether to show icons
    enabled = true,

    actionEntryBullet = ' ',

    searchInput = ' ',
    replaceInput = ' ',
    filesFilterInput = ' ',
    flagsInput = '󰮚 ',
    pathsInput = ' ',

    resultsStatusReady = '󱩾 ',
    resultsStatusError = ' ',
    resultsStatusSuccess = '󰗡 ',
    resultsActionMessage = '  ',
    resultsEngineLeft = '⟪',
    resultsEngineRight = '⟫',
    resultsChangeIndicator = '┃',
    resultsAddedIndicator = '▒',
    resultsRemovedIndicator = '▒',
    resultsDiffSeparatorIndicator = '┊',
    historyTitle = '   ',
    helpTitle = ' 󰘥  ',
  },

  -- strings to auto-fill in each input area at start
  -- those are not necessarily useful as global defaults but quite useful as overrides
  -- when launching through the lua API. For example, this is how you would launch grug-far.nvim
  -- with the current word under the cursor as the search string
  --
  -- require('grug-far').grug_far({ prefills = { search = vim.fn.expand("<cword>") } })
  --
  prefills = {
    search = '',
    replacement = '',
    filesFilter = '',
    flags = '',
    paths = '',
  },

  -- search history settings
  history = {
    -- maximum number of lines in history file, end of file will be smartly truncated
    -- to remove oldest entries
    maxHistoryLines = 10000,

    -- directory where to store history file
    historyDir = vim.fn.stdpath('state') .. '/grug-far',

    -- configuration for when to auto-save history entries
    autoSave = {
      -- whether to auto-save at all, trumps all other settings below
      enabled = true,

      -- auto-save after a replace
      onReplace = true,

      -- auto-save after sync all
      onSyncAll = true,

      -- auto-save after buffer is deleted
      onBufDelete = true,
    },
  },

  -- unique instance name. This is used as a handle to refer to a particular instance of grug-far when
  -- toggling visibility, etc.
  -- As this needs to be unique per instance, this option is meant to be speficied for a particular instance
  -- as opposed to something set in the setup function
  instanceName = nil,

  -- folding related options
  folding = {
    -- whether to enable folding
    enabled = true,

    -- sets foldlevel, folds with higher level will be closed.
    -- result matche lines for each file have fold level 1
    -- set it to 0 if you would like to have the results initially collapsed
    -- See :h foldlevel
    foldlevel = 1,

    -- visual indicator of folds, see :h foldcolumn
    -- set to '0' to disable
    foldcolumn = '1',
  },
})
