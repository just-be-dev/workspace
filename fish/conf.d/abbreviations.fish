# General abbreviations
abbr -a c clear
abbr -a e exit

abbr -a oc opencode

# Git abbreviations
abbr -a gco git checkout
abbr -a gcopr gh pr checkout

# Push the current branch and set upstream (branch resolved at expansion time)
function _abbr_gpu
    echo "git push origin "(git branch --show-current)" --set-upstream"
end
abbr -a gpu --function _abbr_gpu

# invoke nvim
abbr -a n nvim
abbr -a ai omp

# Git remove merged branches
abbr -a grmb git rm-merged

# Helpers for package manager interop
abbr -a a add
abbr -a ad add --dev
abbr -a i install
abbr -a u uninstall
abbr -a r run
abbr -a rd run dev

# Shorten atuin command given I can never remember how to spell it
abbr -a at atuin

# Use zoxide over cd
abbr -a cd z

# Rust
abbr -a cb cargo build

# Mise
abbr -a mr mise run
abbr -a mi mise install

abbr -a h herdr
abbr -a f fzf
