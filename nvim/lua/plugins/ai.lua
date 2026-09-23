local dir = vim.fn.expand("~/Code/ai.nvim")

if vim.fn.isdirectory(dir) == 0 then
  return {}
end

return {
  {
    dir = dir,
    name = "ai.nvim",
    cmd = "Ai",
    config = function()
      require("ai").setup()
    end,
  },
}
