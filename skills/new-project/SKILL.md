---
name: new-project
description: Create a new project (app, site, service) for Justin, or bring an existing repo onto his deploy platform. Use whenever the user asks to create, start, scaffold, or spin up a new project, especially "from the cafe stack" or another template, or to import, deploy, or link a repo on projects.just-be.dev. New projects go through the projects MCP, never `gh repo create --template` or a hand-copied template.
---

# New project

Justin's projects live on **projects.just-be.dev**, a deploy platform reached through the `projects` MCP server. Creating a project there does things a plain GitHub repo can't:

- creates the project's **Desk project** (desk.just-be.dev, the system of record for projects)
- creates its **vault** in the secrets manager (secrets.just-be.dev)
- gives it a git remote, `https://projects.just-be.dev/<project>.git`, where every push to `main` deploys prod (`https://<project>.just-be.dev` for the templates) and every other branch deploys a preview

So a new project **always** starts with the projects MCP. Don't use `gh repo create --template`, don't copy a template checkout, and don't treat `~/Code/cafe-stack` as the thing to clone. "The cafe stack" means the platform's `cafe-stack` template.

## Finding the tools

The tools are named `mcp__projects__*` (`list_templates`, `create_project`, `import_project`, `link_github`, `get_link`, `list_projects`, `get_deploy`, `get_logs`, `push_token`, …). They may not be in your direct tool list. In pi they're reachable through codemode: `await searchTools("projects create_project")`, then `await tools.mcp__projects__create_project({...})`. Look before concluding they're unavailable. If they really are missing, stop and tell the user; don't fall back to GitHub.

## Creating a project from a template

1. `list_templates` to confirm the template name (e.g. `cafe-stack`, `vite`, `hono`).
2. Pick a name: lowercase letters, digits, and hyphens only, at most 30 characters. A domain-style name like `just-be.tv` becomes `just-be-tv`. Settle it before creating, since it names the Desk project, the vault, the deploy identity, and the prod hostname.
3. Check `mcp__desk__list_projects` for an existing Desk project this belongs to, and pass it as `deskProject`. Otherwise a new Desk project is created.
4. `create_project({ name, template, deskProject? })`. Creating a project **starts a prod deploy**, so confirm the name with the user first if there's any doubt.
5. Clone it: `git clone https://projects.just-be.dev/<project>.git ~/Code/<project>`. The global git credential helper (`mise run git:setup` in `~/Code/projects`) mints tokens automatically. Without it, clone and push with `git -c http.extraHeader="Authorization: Bearer <token>"` using the token `create_project` or `push_token` returns.
6. Run the template's own setup (for cafe-stack: `mise trust && mise install`, then follow its README's "Starting a new project" steps: rename the package, page title, and app name, and add a product section to `AGENTS.md`). Run `mise run check` and commit.
7. Pushing to `main` deploys prod. Use `get_deploy` / `get_logs` / `list_projects` to report the result and the prod URL.

## Adding a GitHub repo

If the user wants the project on GitHub too (the default for public projects):

1. Create an **empty** repo: `gh repo create just-be-dev/<repo> --public` (no template, no README, no license). An empty repo just gets a fast-forward push.
2. `link_github({ kind: "project", name, repo: "just-be-dev/<repo>" })`. The platform pushes the project's `main` to GitHub, then polls both every 5 minutes.
3. Commits made on GitHub reach the project only after the owner approves them in a browser (`get_link` → `approval.approveUrl`). Nothing on MCP can approve, so give the user the URL.

## Bringing in an existing repo

- `import_project({ source: "owner/repo", name?, link: true })` keeps a GitHub repo as the source of truth, linked. The project starts empty, and GitHub's history plus the first prod deploy wait for the owner's approval. Call `sync_now` and then `get_link` to get the `approveUrl`, and hand it to the user.
- Without `link`, a public repo's history is copied in and prod deploys right away.

## Custom domains

Templates serve prod at `<project>.just-be.dev`. Another domain (e.g. `just-be.tv`) needs its zone in Cloudflare and the stack's `PROJECT_HOST` / `PROJECT_ZONE` settings. Mention it; don't set it up unasked.

## Don't

- Don't create projects with `gh repo create --template`, `git init`, or by copying a local template checkout.
- Don't delete projects, destroy prod, or approve anything for the user. Deletion and GitHub sync both need the owner's browser approval by design.
