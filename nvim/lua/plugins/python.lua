-- Overrides for the `lang.python` extra, which is imported in config/lazy.lua so
-- it stays ahead of these user plugins in lazy.nvim's import order.
return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        pyright = {
          -- Standalone pyright has no interpreter provider, so it defaults to the
          -- `python` on PATH -- system 3.9 in a monorepo whose root pins none.
          -- Bind each client to the venv at its own root_dir instead; this also
          -- gives pyright the right stdlib version to check against.
          -- Mutated in place: the client captures `config.settings` by reference at
          -- construction, which happens before `before_init` runs, so replacing the
          -- table would strand the update.
          before_init = function(_, config)
            local python = config.root_dir and (config.root_dir .. "/.venv/bin/python")
            if python and vim.uv.fs_stat(python) then
              config.settings = config.settings or {}
              config.settings.python = config.settings.python or {}
              config.settings.python.pythonPath = python
            end
          end,
        },
      },
    },
  },
}
