function add_history_entry --description "Adds a command to the shell history"
    set -l cmd (string join ' ' -- $argv)
    history append -- $cmd
    if type -q atuin
        atuin history start -- $cmd >/dev/null
    end
end
