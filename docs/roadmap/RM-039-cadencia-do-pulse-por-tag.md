---
id: RM-039
tipo: roadmap
titulo: Cadência do pulse por tag em qualquer canal
categoria: melhoria
pai: null
features: [FEAT-011]
owner: Julio
atualizado_em: 2026-10-03T06:52:15-03:00
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
    commit: d3ae643
    pr: null
    cadencia: "8480ba1, PR #33; aviso do doctor em d3ae643b, PR #56"
  deploy:
    release: Cadência publicada no npm, inclusive nas versões 0.5.0 e 0.5.1; aviso do doctor ainda em Não publicado
sdlc:
  thread: ork-doctoracusap
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
- **Thread:** `ork-i50cadencia`; aviso do doctor na `ork-doctoracusap`

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
- **Aviso do doctor:** com `.orkastery/monitor/pulse-host.json`, o `ork doctor` lê o `crontab -l` e avisa, sem bloquear, a linha da varredura ausente, o crontab inexistente ou a batida mais lenta que 15 minutos, com a linha do template pronta. O doctor nunca edita o crontab.
- **Fora:** cadência por thread ou por projeto dentro da mesma fábrica; ferramenta MCP para a tag.
- **Validação:** `core/test/pulse-cadencia.test.ts` (forma da tag, janelas no fuso do dono, a batida do cron, o prazo, o ingresso autenticado e a CLI), os testes de ingresso dos dois adaptadores e `core/test/rm039-doctor-cron.test.ts` (o aviso do doctor: sem `pulse-host.json`, `*/15`, `0 * * * *`, linha ausente, crontab inexistente e paridade com o template).

## Plano e decisões

- **Origem:** proposta registrada na I-41 (20/09/2026).
- **Batida de 15 minutos, não de 5:** 15 é a menor cadência das tags, e a varredura leva perto de um minuto nesta VPS. Pergunta nova espera no máximo 15 minutos.
- **A cadência é opção da varredura:** só a entrada do cron liga. Chamada direta (terminal, testes, canários) entrega toda novidade na hora, como antes.
- **A troca não é gate:** é preferência de entrega. Pelo Telegram, quem troca é o remetente autenticado; pelo terminal, `--por` ou o usuário do sistema.

## Estado com evidências

- Implementado na thread `ork-i50cadencia` e mesclado em 27/09/2026 (PR #33).
- O aviso do doctor entrou na thread `ork-doctoracusap` (03/10/2026): uma instalação rodava sem pulse nenhum, e nada acusava.
- Em produção na VPS de referência desde 27/09/2026 às 08h22: a linha do cron passou de `0 * * * *` para `*/15 * * * *`, e os adaptadores do Telegram foram reinstalados.
- No npm desde a versão 0.4.1 (28/09/2026), para as outras máquinas também: o código `10ca416` está na tag (`git merge-base --is-ancestor 10ca416 v0.4.1`). As versões 0.5.0 e 0.5.1 também estão publicadas no npm, conforme confirmação da condução; publicar a cadência não é uma pendência. O aviso do doctor (`d3ae643b`) ainda está em "Não publicado" no [CHANGELOG](../../CHANGELOG.md).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-10-03 | Julio |
| Documentação | Em revisão | — | 2026-10-03 | Julio |
| Código | Mesclado | commit `d3ae643` · cadencia: 8480ba1, PR #33; aviso do doctor em d3ae643b, PR #56 | 2026-10-03 | Julio |
| Testes | Aprovados | — | 2026-10-03 | Julio |
| Deploy | Produção | release: Cadência publicada no npm, inclusive nas versões 0.5.0 e 0.5.1; aviso do doctor ainda em Não publicado | 2026-10-03 | Julio |
| Exposição | Parcial | — | 2026-10-03 | Julio |
| Habilitação | Em andamento | — | 2026-10-03 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-20 | proposto | PLAN da `ork-i41hitlinver` | Julio |
| 2026-09-27 | implementado | tags pelo Telegram e pelo terminal, cron de 15 em 15 minutos, pergunta nova fora da janela | Julio |
| 2026-09-27 | em produção na VPS de referência | merge `8480ba1` (PR #33); cron do pulse em `*/15`, adaptadores do Telegram reinstalados; npm pendente | Julio |
| 2026-10-03 | `ork doctor` acusa a varredura ausente ou de hora em hora | Thread `ork-doctoracusap` (#Auto); `core/test/rm039-doctor-cron.test.ts` | Claude (agente, #Auto), revisão de Julio pendente |
| 2026-10-03 | o texto deixa de dizer que falta o npm | o código `10ca416` está na `v0.4.1` (`git merge-base --is-ancestor 10ca416 v0.4.1`); thread `ork-b3fatosdoroa`, item B3 | Claude (agente, #Auto), revisão de Julio pendente |
| 2026-10-03 | Publicação da cadência concluída; aviso do doctor segue separado | Cadência: `8480ba1` (PR #33), incluída nas versões 0.5.0 (`2418a4e7`, PR #36) e 0.5.1 (`681cb413`); npm confirmado pela condução. Doctor: `d3ae643b`, em Não publicado | Codex (agente, #Fast), revisão pendente |
