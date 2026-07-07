-- Set leader keys before loading lazy.nvim/LazyVim so plugin keymaps use them.
vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- bootstrap lazy.nvim, LazyVim and your plugins
require("config.lazy")
