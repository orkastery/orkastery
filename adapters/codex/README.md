# Adaptador Codex

`ork adapter install codex` instala o catálogo em
`.agents/skills/orkastery/` e prepara a orientação de sessão em
`.codex/hooks.json` e `.codex/hooks/ork-sessao.js`.

O instalador não cria nem altera `.codex/config.toml`. O hook apenas transporta
ao `SessionStart` a orientação decidida pelo núcleo; ele não concede permissões,
não muda o sandbox e não aprova gates.
