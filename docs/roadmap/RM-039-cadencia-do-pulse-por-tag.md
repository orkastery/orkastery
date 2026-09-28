---
id: RM-039
tipo: roadmap
titulo: Cadência do pulse por tag em qualquer canal
categoria: melhoria
pai: null
features: [FEAT-011]
owner: Julio
atualizado_em: 2026-09-27T23:46:57-03:00
estado:
  ciclo: Piloto
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Parcial
  habilitacao: Em andamento
evidencias:
  codigo:
    commit: 10ca416
    pr: null
sdlc:
  thread: ork-i50cadencia
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-039 — Cadência do pulse por tag em qualquer canal

> **Em uma frase:** O dono troca a cadência do resumo em conversa, com uma tag (#OrkPulseOn, -15m, -30m, -60m), sem editar o crontab.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Piloto | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-011](../produto/FEAT-011-hitl-em-camadas.md)
- **Thread:** `ork-i50cadencia`

## Problema e resultado

- **Problema:** trocar a cadência hoje é editar o crontab da máquina.
- **Resultado:** o dono manda a tag no canal em que recebe o resumo e a cadência nova vale na batida seguinte do cron.
- **Métrica:** zero edição de crontab para trocar a cadência; zero pergunta nova esperando a janela da cadência.

## Escopo e validação

- **Incluído:**
  - as tags `#OrkPulseOff` (8h, às 08h, 16h e 00h do fuso do dono), `#OrkPulseOn` (2h) e `#OrkPulseOn-15m`, `-30m` e `-60m` (a padrão);
  - pelo Telegram, como terceira forma de `GRAMATICA_DO_PULSE`, reconhecida pelos ingressos do Hermes e do OpenClaw com a prova de sempre;
  - pelo terminal, `ork pulse cadencia [<tag>]`;
  - a cadência durável em `.orkastery/monitor/pulse-cadencia.json` (contrato `ork.pulse-cadencia/v1`), com quem trocou, o canal e a hora;
  - o template do cron batendo de 15 em 15 minutos.
- **Regras:**
  - pergunta nova ao dono sai na batida seguinte, qualquer que seja a tag;
  - o status periódico sai no máximo uma vez por janela da cadência, e a novidade que esperou continua não vista até sair;
  - a tag só vale sozinha na mensagem; no meio de uma frase, continua conversa com o assistente;
  - a cadência curta não encurta o prazo para responder ao resumo, que nunca fica abaixo de 60 minutos.
- **Fora:** cadência por thread ou por projeto dentro da mesma fábrica; ferramenta MCP para a tag.
- **Validação:** `core/test/pulse-cadencia.test.ts` (forma da tag, janelas no fuso do dono, a batida do cron, o prazo, o ingresso autenticado e a CLI) e os testes de ingresso dos dois adaptadores.

## Plano e decisões

- **Origem:** proposta registrada na I-41 (20/09/2026).
- **Batida de 15 minutos, não de 5:** 15 é a menor cadência das tags, e a varredura leva perto de um minuto nesta VPS. Pergunta nova espera no máximo 15 minutos.
- **A cadência é opção da varredura:** só a entrada do cron liga. Chamada direta (terminal, testes, canários) entrega toda novidade na hora, como antes.
- **A troca não é gate:** é preferência de entrega. Pelo Telegram, quem troca é o remetente autenticado; pelo terminal, `--por` ou o usuário do sistema.

## Estado com evidências

- Implementado na thread `ork-i50cadencia` e mesclado em 27/09/2026 (PR #33).
- Em produção na VPS de referência desde 27/09/2026 às 08h22: a linha do cron passou de `0 * * * *` para `*/15 * * * *`, e os adaptadores do Telegram foram reinstalados. Falta a publicação no npm para as outras máquinas.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-09-27 | Julio |
| Documentação | Em revisão | — | 2026-09-27 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-27 | Julio |
| Testes | Aprovados | — | 2026-09-27 | Julio |
| Deploy | Produção | — | 2026-09-27 | Julio |
| Exposição | Parcial | — | 2026-09-27 | Julio |
| Habilitação | Em andamento | — | 2026-09-27 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-20 | proposto | PLAN da `ork-i41hitlinver` | Julio |
| 2026-09-27 | implementado | tags pelo Telegram e pelo terminal, cron de 15 em 15 minutos, pergunta nova fora da janela | Julio |
| 2026-09-27 | em produção na VPS de referência | merge `8480ba1` (PR #33); cron do pulse em `*/15`, adaptadores do Telegram reinstalados; npm pendente | Julio |
