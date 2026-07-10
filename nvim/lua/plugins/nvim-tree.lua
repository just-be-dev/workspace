-- nvim-tree.lua — file explorer sidebar.
-- Loaded on demand via commands or explorer keymaps.
return {
  {
    "nvim-tree/nvim-tree.lua",
    cmd = { "NvimTreeToggle", "NvimTreeFocus", "NvimTreeFindFile", "NvimTreeRefresh" },
    keys = {
      { "<leader>e", "<cmd>NvimTreeToggle<cr>", desc = "Explorer" },
      { "<leader>E", "<cmd>NvimTreeFindFile<cr>", desc = "Explorer Find File" },
    },
    dependencies = { "nvim-tree/nvim-web-devicons" },
    init = function()
      vim.g.loaded_netrw = 1
      vim.g.loaded_netrwPlugin = 1
    end,
    opts = {
      view = {
        width = 32,
      },
      renderer = {
        group_empty = true,
      },
      filters = {
        dotfiles = false,
      },
      git = {
        enable = true,
      },
      update_focused_file = {
        enable = true,
        update_root = false,
      },
    },
  },
}
