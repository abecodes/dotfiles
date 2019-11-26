scriptencoding utf-8

source ~/.config/nvim/plugins.vim
source ~/.config/nvim/functions.vim
source ~/.config/nvim/keybindings.vim
source ~/.config/nvim/nerdtree.vim
source ~/.config/nvim/denite.vim
source ~/.config/nvim/syntastic.vim
source ~/.config/nvim/devicons.vim
source ~/.config/nvim/lightline.vim
source ~/.config/nvim/nuake.vim
source ~/.config/nvim/coc.vim

" neovim settings
set number relativenumber

" if hidden is not set, TextEdit might fail.
set hidden

" Some servers have issues with backup files, see #649
set nobackup
set nowritebackup

" Better display for messages
set cmdheight=2

" You will have bad experience for diagnostic messages when it's default 4000.
set updatetime=300

" don't give |ins-completion-menu| messages.
set shortmess+=c

" always show signcolumns
set signcolumn=yes

" Don't show last command
set noshowcmd

" Yank and paste with the system clipboard
set clipboard=unnamed

" Change number of spaces that a <Tab> counts for during editing ops
set softtabstop=2

" Change vertical split character to be a space (essentially hide it)
set fillchars+=vert:.

" Set preview window to appear at bottom
set splitbelow

" Don't dispay mode in command line (lightline already shows it)
set noshowmode

" ignore case when searching
set ignorecase

" if the search string has an upper case letter in it, the search will be case sensitive
set smartcase

" Automatically re-read file if a change was detected outside of vim
set autoread

if (has("termguicolors"))
 set termguicolors
endif

syntax on
let g:oceanic_next_terminal_bold = 1
let g:oceanic_next_terminal_italic = 1
colorscheme OceanicNext

