-- Show dotfiles in LazyVim's Snacks file picker by default.
-- The finder still respects ignore rules and excludes .git.
return {
  {
    "folke/snacks.nvim",
    opts = {
      dashboard = {
        enabled = false,
      },
      picker = {
        sources = {
          files = {
            hidden = true,
          },
        },
      },
    },
  },
}
