---
id: RM-045
tipo: roadmap
titulo: "Pulse enxuto: fila sem lixo e varredura dentro do teto"
categoria: melhoria
pai: null
features: [FEAT-010, FEAT-011, FEAT-014]
owner: Julio
atualizado_em: 2026-09-28T15:23:46-03:00
estado:
  ciclo: Concluído
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Geral
  habilitacao: Concluída
evidencias:
  codigo:
    commit: 10ca416
    pr: null
sdlc:
  thread: ork-i45pulseenxu
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-045 — Pulse enxuto: fila sem lixo e varredura dentro do teto

> **Em uma frase:** o resumo por hora só volta quando a varredura couber no teto de 240 s e a fila contar apenas o que é de fato do dono.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-010](../produto/FEAT-010-observacao-de-sessoes.md), [FEAT-011](../produto/FEAT-011-hitl-em-camadas.md), [FEAT-014](../produto/FEAT-014-monitor-board-e-pulse.md)
- **Thread:** `ork-i45pulseenxu`

## Problema e resultado

- **Problema:** em 24/09/2026 às 22h29, a primeira varredura do resumo em camadas estourou o teto de 240 s (`pulse falhou (código timeout)`).
- **Evidência de tempo:** `ork pulse --json` levou 9 min 30 s com 114% de CPU; o mesmo comando com `--sem-runtime` levou 30 s. O custo está em `claude agents logs`, chamado uma vez por sessão marcada como HITL.
- **Evidência de ruído:** a fila tinha 92 itens "precisa de humano agora": 37 sessões abandonadas, 14 scores pendentes da fila aposentada na I-43, 13 de estado desconhecido, 9 falhas e 19 de threads; 27 sem thread.
- **Hipótese:** Se o radar só ler a tela de sessão viva de thread aberta, com cache por sessão, e a fila parar de contar score aposentado e sessão abandonada de thread fechada, então a varredura cabe no teto e o resumo conta só o que é do dono, porque o custo e o ruído vêm das mesmas sessões antigas.
- **Métrica principal:** duração da varredura nesta VPS; meta abaixo de 60 s.
- **Métrica de proteção:** nenhuma sessão viva esperando o dono deixa de aparecer.
- **Linha de base:** 9 min 30 s e 92 itens (24/09/2026 22h).

## Escopo e validação

- **Incluído:** triagem das sessões abandonadas e sem thread, encerradas com motivo; pulse sem `score_pendente` da fila aposentada; cache da leitura de tela por sessão; orçamento de tempo com degradação tipada no lugar do timeout mudo.
- **Fora de escopo:** a tag que troca a cadência em conversa ([RM-039](RM-039-cadencia-do-pulse-por-tag.md)).
- **Critério de aceite:** varredura abaixo de 60 s nesta VPS com o cache cheio e resumo com só itens acionáveis; então o cron volta, de hora em hora. Atingido em 25/09/2026: 56 s e 6 itens.

## Plano e decisões

- **Decisão de 24/09/2026 22h50 (agente, a confirmar com Julio):** o cron do pulse continua desligado até este item; religá-lo agora daria timeout toda hora, ou um resumo de 92 itens quase todos antigos.
- **Prioridade:** o dono pediu para fazer já (25/09/2026 00h), antes da pausa de uso.
- **Decisões de implementação:**
  - o radar lê a tela pelo id que já tem, sem listar todas as sessões de novo a cada leitura (era o grosso do custo);
  - o cache só vale para sessão sem thread ou de thread fechada, com a chave `sessionId|início`, porque sessão de thread aberta pode ser retomada;
  - nesta VPS a sessão morta responde `connect ENOENT .../control.sock`, e só o cache usa esse sinal;
  - verificação reprovada de thread cujo código já está na base não fica com o dono (regra do primeiro merge do `ork docs`).

## Estado com evidências

- Implementado na thread `ork-i45pulseenxu` e medido no projeto real em 25/09/2026, de 00h40 a 01h02:
  - varredura com o cache vazio: 145 s, com 5 telas adiadas pelo orçamento para a rodada seguinte;
  - varredura com o cache cheio (34 sessões encerradas): 56 s. Antes: 9 min 30 s;
  - fila: 6 itens para o dono (antes 92) e 41 na faixa automática.
- Merge `3089738` (PR #23, 25/09/2026) pelo CI independente; `ork` de produção recompilado.
- Cron do pulse religado em 25/09/2026 às 01h33, de hora em hora: a primeira varredura levou 48 s e mandou um único resumo, com 6 itens.
- Os 6 que ficam: o gate de premissas da I-31 e duas verificações dela, a sessão parada da I-38, a thread `ork-i27gated1` do envelope aposentado (fechar exige o nome do dono) e as claims do PLAN da I-42, que caem no GO.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Concluído | — | 2026-09-28 | Julio |
| Documentação | Em revisão | — | 2026-09-28 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-28 | Julio |
| Testes | Aprovados | — | 2026-09-28 | Julio |
| Deploy | Produção | — | 2026-09-28 | Julio |
| Exposição | Geral | — | 2026-09-28 | Julio |
| Habilitação | Concluída | — | 2026-09-28 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-24 | proposto | varredura de 9 min 30 s e fila com 92 itens | Claude (agente), a confirmar com Julio |
| 2026-09-25 | feito e em produção, cron religado | pedido do dono ("faça agora"); PR #23, merge `3089738` | Julio |
| 2026-09-28 | concluído | em produção desde o merge; MASTER aceito por omissão em 27/09/2026 (score gravado 5/5) | Julio |
