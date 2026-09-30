# Documentação de produto

> **Em uma frase:** o que o produto é e faz hoje, uma página por entidade, conferida contra o código a cada PR.

- **Padrão:** [documentação de produto](../padroes/documentacao-de-produto.md) · **Complemento:** [roadmap](../roadmap/README.md)
- **Hierarquia:** plataforma (`PLAT`) → sistema (`SYS`) → módulo (`MOD`) → feature (`FEAT`)
- **Nova página:** copie [o modelo](_modelo-feature.md) e rode `ork docs verificar`

## Índice

Gerado por `ork docs sincronizar` a partir do frontmatter de cada página.

<!-- ork-docs:indice:inicio -->

| ID | Nome | Tipo | Estado | Pai | Verificado |
| --- | --- | --- | --- | --- | --- |
| [PLAT-01](PLAT-01-orkastery.md) | Orkastery | plataforma | vigente | — | 2026-09-24 |
| [SYS-01](SYS-01-nucleo-ork.md) | Núcleo ork | sistema | vigente | PLAT-01 | 2026-09-24 |
| [SYS-02](SYS-02-hosts-e-canais.md) | Hosts e canais | sistema | vigente | PLAT-01 | 2026-09-24 |
| [MOD-01](MOD-01-conducao-de-threads.md) | Condução de threads | modulo | vigente | SYS-01 | 2026-09-24 |
| [MOD-02](MOD-02-verdade-e-entrega.md) | Verdade e entrega | modulo | vigente | SYS-01 | 2026-09-24 |
| [MOD-03](MOD-03-runtimes-e-contas.md) | Runtimes e contas | modulo | vigente | SYS-01 | 2026-09-24 |
| [MOD-04](MOD-04-atencao-humana.md) | Atenção humana | modulo | vigente | SYS-01 | 2026-09-24 |
| [MOD-05](MOD-05-memoria-e-registro.md) | Memória e registro | modulo | vigente | SYS-01 | 2026-09-24 |
| [MOD-06](MOD-06-integracao-com-hosts.md) | Integração com hosts | modulo | vigente | SYS-02 | 2026-09-24 |
| [FEAT-001](FEAT-001-thread-e-seis-fases.md) | Thread e ciclo de seis fases | feature | vigente | MOD-01 | 2026-09-24 |
| [FEAT-002](FEAT-002-modos-de-conducao.md) | Modos de condução | feature | vigente | MOD-01 | 2026-09-27 |
| [FEAT-003](FEAT-003-despacho-de-fase.md) | Despacho de fase para o runtime | feature | vigente | MOD-01 | 2026-09-27 |
| [FEAT-004](FEAT-004-claims-e-verify.md) | Claims e verify no HEAD real | feature | vigente | MOD-02 | 2026-09-27 |
| [FEAT-005](FEAT-005-ci-check-independente.md) | CI como CHECK independente | feature | vigente | MOD-02 | 2026-09-24 |
| [FEAT-006](FEAT-006-ship-com-push-provado.md) | Ship com push provado | feature | vigente | MOD-02 | 2026-09-27 |
| [FEAT-007](FEAT-007-worktree-e-leases.md) | Worktree e leases por thread | feature | vigente | MOD-02 | 2026-09-24 |
| [FEAT-008](FEAT-008-rodizio-de-contas.md) | Rodízio de contas dos runtimes | feature | vigente | MOD-03 | 2026-09-27 |
| [FEAT-009](FEAT-009-retry-tipado.md) | Retry tipado e fila de rate limit | feature | vigente | MOD-03 | 2026-09-24 |
| [FEAT-010](FEAT-010-observacao-de-sessoes.md) | Observação de sessões e sensores | feature | vigente | MOD-03 | 2026-09-24 |
| [FEAT-011](FEAT-011-hitl-em-camadas.md) | HITL em camadas: resumo, consentimento e lote | feature | vigente | MOD-04 | 2026-09-27 |
| [FEAT-012](FEAT-012-decisao-tomada.md) | Decisão tomada com prestação de contas | feature | vigente | MOD-04 | 2026-09-24 |
| [FEAT-013](FEAT-013-horario-do-dono.md) | Horário do dono em toda superfície humana | feature | vigente | MOD-04 | 2026-09-24 |
| [FEAT-014](FEAT-014-monitor-board-e-pulse.md) | Monitor, board e pulse de atenção | feature | vigente | MOD-04 | 2026-09-24 |
| [FEAT-015](FEAT-015-entrega-e-indice-master.md) | Entrega e índice de condução (MASTER) | feature | vigente | MOD-04 | 2026-09-24 |
| [FEAT-016](FEAT-016-handoff-e-recall.md) | Handoff triado e recall tardio | feature | vigente | MOD-05 | 2026-09-24 |
| [FEAT-017](FEAT-017-memoria-orkmind.md) | Memória no OrkMind com degradação honesta | feature | vigente | MOD-05 | 2026-09-24 |
| [FEAT-018](FEAT-018-documentacao-como-codigo.md) | Documentação como código | feature | vigente | MOD-05 | 2026-09-24 |
| [FEAT-019](FEAT-019-telemetria-do-ledger.md) | Telemetria econômica do ledger | feature | vigente | MOD-05 | 2026-09-24 |
| [FEAT-020](FEAT-020-mcp-e-adaptadores.md) | Servidor MCP e instalação de adaptadores | feature | vigente | MOD-06 | 2026-09-24 |
| [FEAT-021](FEAT-021-ingresso-hitl-telegram.md) | Ingresso HITL pelo Telegram | feature | vigente | MOD-06 | 2026-09-24 |
| [FEAT-022](FEAT-022-auditoria-e-divida.md) | Auditoria periódica e board de dívida | feature | vigente | MOD-02 | 2026-09-24 |
| [FEAT-023](FEAT-023-onboarding-do-projeto.md) | Onboarding do projeto | feature | vigente | MOD-01 | 2026-09-24 |
| [FEAT-024](FEAT-024-company-brain-no-cli.md) | Company Brain no CLI | feature | vigente | MOD-05 | 2026-09-28 |
| [FEAT-025](FEAT-025-catalogo-de-portfolio.md) | Catálogo de portfólio | feature | vigente | MOD-01 | 2026-09-24 |
| [FEAT-026](FEAT-026-reservas-do-roadmap.md) | Reservas de item do roadmap entre máquinas | feature | vigente | MOD-01 | 2026-09-27 |
| [FEAT-027](FEAT-027-fabrica-compartilhada.md) | Fábrica compartilhada entre máquinas | feature | vigente | MOD-01 | 2026-09-27 |
| [FEAT-028](FEAT-028-loop-de-aprendizado.md) | Loop de aprendizado | feature | vigente | MOD-05 | 2026-09-27 |
| [FEAT-029](FEAT-029-conducao-multicanal.md) | Condução multicanal da thread | feature | vigente | MOD-01 | 2026-09-27 |
| [FEAT-030](FEAT-030-pacote-de-experiencia.md) | Pacote de experiência de orquestração | feature | em desenvolvimento | MOD-06 | 2026-09-29 |

<!-- ork-docs:indice:fim -->
