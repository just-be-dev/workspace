# Shell integrations for CLI tools (replaces zephish's omf zoxide/starship setup)
status is-interactive; or return

# zoxide provides `z` / `zi` (the `cd` abbreviation expands to `z`)
if type -q zoxide
    zoxide init fish | source
end

if type -q starship
    starship init fish | source
end
