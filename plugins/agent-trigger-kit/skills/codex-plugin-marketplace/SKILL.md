---
name: codex-plugin-marketplace
description: Use when creating, installing, updating, or troubleshooting Codex local or Git plugin marketplaces and plugin skill discovery.
---

# Codex Plugin Marketplace

Codex marketplaces can be local paths, `owner/repo[@ref]`, HTTPS Git URLs, or SSH URLs. A project-local marketplace normally uses `.agents/plugins/marketplace.json`.

## Manifest Pattern

```json
{
  "name": "my-marketplace",
  "interface": {
    "displayName": "My Marketplace"
  },
  "plugins": [
    {
      "name": "my-plugin",
      "version": "0.1.0",
      "source": {
        "source": "local",
        "path": "./plugins/my-plugin"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity",
      "description": "Short plugin description"
    }
  ]
}
```

## Install And Verify

```bash
codex plugin marketplace add <path-or-git-source>
codex debug prompt-input "test"
```

In the prompt input, confirm the expected `plugin-name:skill-name` entries appear.

## Troubleshooting

- If skills do not appear, check `~/.codex/config.toml` for marketplace and plugin enabled entries.
- If a local source uses a marketplace manifest, point Codex at the marketplace root, not the plugin directory.
- If a single-plugin repo has `.codex-plugin/plugin.json` at root, point Codex at that plugin root.
- Codex skills are not Claude slash commands; do not expect `/command` entries from Codex plugin metadata.
