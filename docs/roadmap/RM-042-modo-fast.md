---
id: RM-042
tipo: roadmap
titulo: "Modo #Fast: uma fase, sem cerimônia"
categoria: iniciativa
pai: null
features: [FEAT-002]
owner: Julio
atualizado_em: 2026-09-27T09:40:50-03:00
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
    commit: 80b366e
    pr: 26
sdlc:
  thread: ork-i42modofastu
  modo: "#Auto"
  fase: SHIP
  status: aberta
---

# RM-042 — Modo #Fast: uma fase, sem cerimônia

> **Em uma frase:** Para pedido pequeno e claro: uma fase só (reusa o GO), Sonnet com esforço alto, sem pausa, e sem autorizar push sozinho.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Piloto | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-002](../produto/FEAT-002-modos-de-conducao.md)
- **Thread:** `ork-i42modofastu`

## Problema e resultado

- **Problema:** pedido de cinco minutos pagava a cerimônia de seis fases.
- **Métrica:** o prompt da GO no `#Fast` é menor que o do `#Auto` na mesma fase, e a prova de um ajuste pequeno custa um teste focado, não a suíte inteira (medido no PLAN: 227,6 s contra cerca de 12 s).

## Escopo e validação

- **Incluído:** `#Fast` com `sonnet:high` e fallback `codex:gpt-5.6-terra:high`; prova mínima em três degraus (teste focado, claim de até dois comandos, `ork claims ausente`); fronteira de contrato público no commit MCP e no `ork ship`; prompt da GO sem as cinco fases que não roda; recusa de `--ciclo` que redesenha blocos.
- **Fora:** autorização de push pela própria #TAG (o merge pede `--autorizar-push`).

## Plano e decisões

- **Ordem acordada em 20/09/2026:** segundo, logo depois da limpeza e do HITL invertido.

## Estado com evidências

- Mesclado na `main` pelo PR #26, com o CI verde no SHA exato. O `ork` da fábrica já roda o `#Fast`, habilitado neste projeto em `conduction.allowed_modes`.
- Falta publicar o pacote npm 0.3.0 para quem instala pelo npm; até lá, a exposição é parcial.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-09-27 | Julio |
| Documentação | Em revisão | — | 2026-09-27 | Julio |
| Código | Mesclado | commit `80b366e` · PR #26 | 2026-09-27 | Julio |
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
| 2026-09-20 | thread aberta | thread `ork-i42modofastu` | Julio |
| 2026-09-27 | mesclado e em uso na fábrica; npm 0.3.0 pendente | PR #26, merge `80b366e` | Julio |
