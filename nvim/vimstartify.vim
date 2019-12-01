" 'Most Recent Files' number
let g:startify_files_number           = 10

" Update session automatically as you exit vim
let g:startify_session_persistence    = 1

" Simplify the startify list to just recent files and sessions
let g:startify_lists = [
  \ { 'type': 'dir',       'header': ['   Recent files'] },
  \ { 'type': 'sessions',  'header': ['   Saved sessions'] },
  \ ]

" Fancy custom header
let g:startify_custom_header = [
  \ "  ",
  \ '   ┏━┓ ┏┓  ┏━━   ┏━━ ┏━┓ ━━┓ ┏━━ ┏━━',
  \ '   ┃—┃ ┃┗┓ ┃—    ┃   ┃ ┃   ┃ ┃—  ┗━┓',
  \ '   ╹ ╹ ┗━┛ ┗━━ ◊ ┗━━ ┗━┛ ━━┛ ┗━━ ━━┛',
  \ '   ',
  \'                         ,-------.                  /',
  \'                       ,"         `.           ,--"',
  \'                     ,"             `.      ,-;--        _.- ',
  \'               pow! /                 \ ---;-"  _.=.---""',
  \'  +-------------+  ;    X        X     ---=-----'' _.------- ',
  \'  |    -----    |--|                   \-----=---:i- ',
  \'  +XX|"i:````````  :                   ;`--._ ""---":---- ',
  \'  /X+-)             \   \         /   /      ""--._  `- ',
  \' .XXX|)              `.  `.     ,"  ,"            .""---. ',
  \'   X\/)                `.  "---"  ,"                     `- ',
  \'     \                   `---+---` ',
  \'      \                      | ',
  \'       \.                    | ',
  \'         `-------------------+ ',
  \ ]
