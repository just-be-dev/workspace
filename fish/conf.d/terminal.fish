# Default terminal emulator. macOS uses Rex; on Linux omarchy already exports
# TERMINAL (via uwsm), so leave it alone there.
if test (uname) = Darwin
    # Rex bundles its `rex` CLI inside the auto-updated server app; expose it so
    # $TERMINAL resolves to a real command.
    set -l rex_cli_dir "$HOME/Library/Application Support/com.superlogical.rex/RexServer/Versions/Current/Rex Server.app/Contents/MacOS"
    if test -x "$rex_cli_dir/rex"
        fish_add_path --global --append $rex_cli_dir
    end
    set -gx TERMINAL rex
end
