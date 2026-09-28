---
id: RM-032
tipo: roadmap
titulo: Bootstrap universal Maestro
categoria: iniciativa
pai: null
features: [FEAT-020]
owner: Julio
atualizado_em: 2026-09-24T21:33:13-03:00
estado:
  ciclo: Disponível
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
  thread: ork-i32bootstrap
  modo: "#Maestro"
  fase: MASTER
  status: fechada
---

# RM-032 — Bootstrap universal Maestro

> **Em uma frase:** `orkastery maestro` mostra o panorama canônico do projeto em qualquer host, com HITL no canal escolhido e paridade de entrada nos quatro hosts.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Disponível | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-020](../produto/FEAT-020-mcp-e-adaptadores.md)
- **Thread:** `ork-i32bootstrap`

## Problema e resultado

- **Problema:** cada host tinha uma porta de entrada diferente.
- **Resultado:** pacote de código com 8 de 12 critérios do GOAL atendidos.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Faltando:** prova de ativação em sessão nova por host e publicação dos pacotes dos dois sites (I32-C01, I32-C09, I32-C11, I32-C12).

## Plano e decisões

- **Instalação por host:** `ork adapter install <host>`, na [referência do CLI](../referencia/cli.md).

## Estado com evidências

- Merge `20e3835` (PR #13, 19/09/2026); score humano 3/5 ratificado em 19/09/2026.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Disponível | — | 2026-09-24 | Julio |
| Documentação | Em revisão | — | 2026-09-24 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-24 | Julio |
| Testes | Aprovados | — | 2026-09-24 | Julio |
| Deploy | Produção | — | 2026-09-24 | Julio |
| Exposição | Parcial | — | 2026-09-24 | Julio |
| Habilitação | Em andamento | — | 2026-09-24 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-19 | pacote de código entregue (8 de 12) | PR #13, merge `20e3835` | Julio |
