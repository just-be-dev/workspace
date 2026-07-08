-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

local function get_visual_selection()
  local current_mode = vim.fn.mode()
  local start_pos
  local end_pos

  if current_mode == "v" or current_mode == "V" or current_mode == "\22" then
    start_pos = vim.fn.getpos("v")
    end_pos = vim.fn.getpos(".")
  else
    start_pos = vim.fn.getpos("'<")
    end_pos = vim.fn.getpos("'>")
  end

  local start_line, start_col = start_pos[2], start_pos[3]
  local end_line, end_col = end_pos[2], end_pos[3]

  if start_line == 0 or end_line == 0 then
    return nil
  end

  if start_line > end_line or (start_line == end_line and start_col > end_col) then
    start_line, end_line = end_line, start_line
    start_col, end_col = end_col, start_col
  end

  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  if #lines == 0 then
    return nil
  end

  local mode = vim.fn.visualmode()
  if current_mode == "v" or current_mode == "V" or current_mode == "\22" then
    mode = current_mode
  end

  if mode ~= "V" and mode ~= "\22" then
    if #lines == 1 then
      lines[1] = lines[1]:sub(start_col, end_col)
    else
      lines[#lines] = lines[#lines]:sub(1, end_col)
      lines[1] = lines[1]:sub(start_col)
    end
  end

  return table.concat(lines, "\n"), start_line, end_line
end

local function build_omp_prompt(instruction, selection, start_line, end_line)
  local abs_file = vim.fn.expand("%:p")
  local file = vim.fn.fnamemodify(abs_file, ":.")
  local ft = vim.bo.filetype ~= "" and vim.bo.filetype or "text"

  return string.format(
    [[%s

Context from nvim selection:

File: %s
Lines: %d-%d

Please inspect the file directly if needed; don't rely only on this snippet.

```%s
%s
```]],
    instruction,
    file,
    start_line,
    end_line,
    ft,
    selection
  )
end

local function copy_selection_for_omp()
  local selection, start_line, end_line = get_visual_selection()
  if not selection or selection == "" then
    vim.notify("No visual selection found", vim.log.levels.WARN)
    return
  end

  vim.ui.input({ prompt = "Instructions: " }, function(instruction)
    if not instruction or instruction == "" then
      return
    end

    local prompt = build_omp_prompt(instruction, selection, start_line, end_line)
    vim.fn.setreg("+", prompt)
    vim.notify("Copied selection as OMP prompt")
  end)
end

_G.omp_copy_selection_for_omp = copy_selection_for_omp

vim.keymap.set("x", "<leader>as", ":<C-U>lua _G.omp_copy_selection_for_omp()<CR>", {
  desc = "Copy selection as OMP prompt",
  silent = true,
})

vim.keymap.set("x", "<leader>ai", ":<C-U>Ai selection<CR>", {
  desc = "Ask AI about selection",
  silent = true,
})
