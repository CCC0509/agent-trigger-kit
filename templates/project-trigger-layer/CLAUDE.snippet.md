## Trigger Rules

Main routing remains `{{canonicalPlaybook}}`. If the repo-local `{{pluginName}}` plugin is installed, Claude Code may prefer plugin skills and slash command shims from `plugins/{{pluginName}}/commands/**`.

Install or update:

```bash
claude plugin validate <repo-root>
claude plugin marketplace add <repo-root> --scope user
claude plugin install {{pluginName}}@{{pluginName}} --scope user
claude plugin update {{pluginName}}@{{pluginName}} --scope user
```

Restart Claude Code after install or update. If commands do not appear, inspect the plugin cache and version using the Claude plugin lifecycle workflow.
