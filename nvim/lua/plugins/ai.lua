return {
  {
    dir = vim.fn.expand("~/Code/ai.nvim"),
    name = "ai.nvim",
    cmd = "Ai",
    config = function()
      require("ai").setup()
    end,
  },
}
