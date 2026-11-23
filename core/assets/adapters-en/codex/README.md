# Codex adapter

`ork adapter install codex` installs the catalog at
`.agents/skills/orkastery/` and prepares session guidance at
`.codex/hooks.json` and `.codex/hooks/ork-sessao.js`.

The installer does not create or change `.codex/config.toml`. The hook only carries
to `SessionStart` the guidance decided by the core; it grants no permissions,
does not change the sandbox and does not approve gates.
