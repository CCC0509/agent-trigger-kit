## Trigger Rules

Main routing remains `{{canonicalPlaybook}}`. If the repo-local `{{pluginName}}` plugin is installed, Codex may prefer `{{pluginName}}:*` skills. If it is not installed, follow this pointer and the playbook manually; do not block work just because the plugin is absent.

`docs/agent-skills/*/SKILL.md` files, plugin skills, Claude commands, and Cursor rules are trigger layers only. The playbook remains canonical.
