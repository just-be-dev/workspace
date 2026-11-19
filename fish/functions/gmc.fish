function gmc --description "Move git commit to another branch"
    if test (count $argv) -lt 1
        echo "Usage: gmc <target_branch_name> [base_branch]"
        echo
        set_color brblack
        echo "Copies the last git commit onto the target branch, creating it if it doesn't exist"
        set_color normal
        return 1
    end

    set -l current_branch (git branch --show-current)
    set -l new_branch $argv[1]
    set -l base_branch main
    if test (count $argv) -ge 2
        set base_branch $argv[2]
    end

    # Resolve the commit before switching branches
    set -l commit (git rev-parse $current_branch)

    if git show-ref --verify --quiet refs/heads/$new_branch
        if test (count $argv) -ge 2
            echo "Error: Branch '$new_branch' already exists and base branch was specified"
            return 1
        end
        git checkout $new_branch; or return 1
    else
        if not git show-ref --verify --quiet refs/heads/$base_branch
            # Fall back to master when the default main doesn't exist
            if test $base_branch = main; and git show-ref --verify --quiet refs/heads/master
                set base_branch master
            else
                echo "Error: Base branch '$base_branch' does not exist"
                return 1
            end
        end
        git checkout -b $new_branch $base_branch; or return 1
    end

    git cherry-pick $commit
end
