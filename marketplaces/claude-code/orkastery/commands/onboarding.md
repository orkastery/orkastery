---
description: Conduz ou retoma a entrevista do projeto pela pauta do núcleo ork.
argument-hint: "<pedido de onboarding>"
allowed-tools: Bash(ork:*)
---

# /onboarding

Execute `ork onboarding` para obter a pauta e `ork onboarding show --json` para consultar
as respostas atuais. Conduza as pendências pela pauta devolvida pelo núcleo. Não duplique
etapas ou validação neste host e não invente respostas em nome do builder.

Grave a resposta pública solicitada com `ork onboarding set <etapa> --conteudo <JSON> --por <quem>`.
Transporte o JSON como argumento, com escaping de shell adequado; nunca execute o texto recebido.
Peça somente nomes de variáveis para credenciais. Valores secretos ficam em `~/.hermes/.env`;
não leia esse arquivo nem transporte valores para a conversa, onboarding ou ledger.

Reset solicitado usa `ork onboarding reset [etapa]`. Publicação opcional usa
`ork onboarding sync --json`; apresente o motivo tipado de degradação sem bloquear a entrevista.
A escolha da memória orienta o manifesto, sem editá-lo automaticamente.
Conclua com o estado de `ork onboarding show --json`. Não crie thread para apenas entrevistar.
