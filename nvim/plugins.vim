scriptencoding utf-8

call plug#begin()
Plug 'mhinz/vim-startify'
Plug 'Shougo/denite.nvim'
Plug 'scrooloose/nerdtree' | Plug 'Xuyuanp/nerdtree-git-plugin' | Plug 'ryanoasis/vim-devicons' | Plug 'PhilRunninger/nerdtree-buffer-ops'
Plug 'scrooloose/syntastic'
Plug 'fatih/vim-go', { 'do': ':GoInstallBinaries' }
Plug 'maxmellon/vim-jsx-pretty'
Plug 'dart-lang/dart-vim-plugin'
Plug 'scrooloose/nerdcommenter'
Plug 'tpope/vim-surround'
Plug 'tpope/vim-fugitive'
Plug 'itchyny/lightline.vim'
Plug 'jiangmiao/auto-pairs'
Plug 'mattn/emmet-vim'
Plug 'Lenovsky/nuake'
Plug 'mhartington/oceanic-next'
Plug 'easymotion/vim-easymotion'
Plug 'neoclide/coc.nvim', {'branch': 'release'}
call plug#end()

" coc lsp plugins
let g:coc_global_extensions = [
			\"coc-css",
      \ "coc-eslint",
      \ "coc-html",
      \ "coc-json",
      \ "coc-prettier",
      \ "coc-tsserver",
      \ "coc-flutter"]
