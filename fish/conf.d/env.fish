# Shell environment (ported from zephish's init.fish)
set -g fish_greeting ""

set -gx GPG_TTY (tty)
set -gx EDITOR nvim

for dir in ~/go/bin ~/.cargo/bin ~/.bin ~/.local/bin
    test -d $dir; and fish_add_path --global $dir
end
if test (uname) = Darwin
    test -d /Applications/Obsidian.app/Contents/MacOS; and fish_add_path --global --append /Applications/Obsidian.app/Contents/MacOS
end
