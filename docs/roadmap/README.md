# Roadmap

> **Em uma frase:** por que mudar, o que entregar e em que pé está cada item — com o estado provado pelo git, não declarado.

- **Padrão:** [roadmap de produto](../padroes/roadmap-de-produto.md) · **Complemento:** [documentação de produto](../produto/README.md)
- **Um arquivo por item:** `RM-000-assunto.md`, com o estado no frontmatter
- **Novo item:** copie [o modelo](_modelo-item.md) e rode `ork docs verificar`
- **Quem está com cada item:** `ork roadmap reservas`; antes de começar, `ork thread new ... --roadmap RM-NNN` reserva o item para a sua máquina ([FEAT-026](../produto/FEAT-026-reservas-do-roadmap.md))
- **Histórico:** este repositório começa em 27/09/2026, na versão 0.3.0. Os SHAs de merge e os números de PR citados nos itens antes dessa data são do histórico de construção, que fica num arquivo privado. A evidência de código desses itens aponta para o primeiro commit público.

## Prioridade para a comunidade de product builders

Proposta de 26/09/2026, a confirmar pelo dono. Ordem por impacto em quem constrói produto com agentes.

| # | Item | Por que nesta posição |
| --- | --- | --- |
| 1 | [RM-046](RM-046-go-to-open-source.md) GoToOpenSource | Sem repositório público, release atual e página, ninguém adota o resto |
| 2 | [RM-042](RM-042-modo-fast.md) Modo #Fast | Tira a cerimônia do pedido pequeno, que é o primeiro contato de quem chega |
| 3 | [RM-047](RM-047-fabrica-em-varias-maquinas.md) Fábrica em várias máquinas | Builder usa notebook, desktop e servidor; hoje cada um é uma ilha |
| 4 | [RM-037](RM-037-verify-rapido-e-confiavel.md) Verify rápido e confiável | Confiança na prova em qualquer máquina, inclusive a de quem contribui |
| 5 | [RM-040](RM-040-estado-de-conta-compartilhado.md) Estado de conta compartilhado | Quem tem vários projetos não bate duas vezes na mesma conta esgotada |
| 6 | [RM-036](RM-036-maestro-multicanal.md) Condução multicanal | Conduzir do celular e do terminal como uma conversa só |
| 7 | [RM-039](RM-039-cadencia-do-pulse-por-tag.md) Cadência do pulse por tag | O dono controla quando é interrompido, em conversa |
| 8 | [RM-031](RM-031-grafo-de-codigo.md) Grafo de código | Menos contexto gasto por fase em bases grandes |
| 9 | [RM-038](RM-038-busca-semantica-na-memoria.md) Busca semântica na memória | Memória útil sem depender de etiqueta |
| 10 | [RM-008](RM-008-loop-de-aprendizado.md) Loop de aprendizado | A fábrica melhora a cada entrega, sem ninguém lembrar a lição |
| 11 | [RM-032](RM-032-bootstrap-maestro.md) e [RM-012](RM-012-ci-check-independente.md) | Fechamentos: ativação por host e proteção da `main`, que o repositório público destrava |
| 12 | [RM-025](RM-025-company-brain-fundacao.md) e [RM-026](RM-026-workspace-empresarial.md) Company Brain | Produto principal é o OrkMind; entra depois da adoção do núcleo |
| 13 | [RM-050](RM-050-guia-de-contribuicao.md) Guia de contribuição | Quem é convidado a colaborar chega ao primeiro PR verde sem perguntar |

## Itens

Gerado por `ork docs sincronizar` a partir do frontmatter de cada item.

<!-- ork-docs:indice:inicio -->

| ID | Resultado | Ciclo | Código | Testes | Deploy | Atualizado |
| --- | --- | --- | --- | --- | --- | --- |
| [RM-001](RM-001-radar-ork-pulse.md) | Radar ork pulse e cron determinístico | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |
| [RM-002](RM-002-higiene-de-runtime.md) | Higiene de runtime e governança de sessões | Concluído | Mesclado | Aprovados | Produção | 2026-09-27 |
| [RM-003](RM-003-hitl-bidirecional-telegram.md) | HITL bidirecional no Telegram | Concluído | Mesclado | Aprovados | Produção | 2026-09-27 |
| [RM-004](RM-004-sensores-por-hooks.md) | Sensores por hooks e watcher do codex | Concluído | Mesclado | Aprovados | Produção | 2026-09-27 |
| [RM-005](RM-005-master-e-digest.md) | MASTER ratificado e digest semanal | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |
| [RM-006](RM-006-orkmind-na-fabrica.md) | OrkMind ligado na fábrica | Concluído | Mesclado | Aprovados | Produção | 2026-09-27 |
| [RM-007](RM-007-telemetria-economica.md) | Telemetria econômica no ledger | Concluído | Mesclado | Aprovados | Produção | 2026-09-27 |
| [RM-008](RM-008-loop-de-aprendizado.md) | Loop de aprendizado | Piloto | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-009](RM-009-playbook-dos-runtimes.md) | Playbook dos runtimes | Concluído | Mesclado | Aprovados | Produção | 2026-09-27 |
| [RM-012](RM-012-ci-check-independente.md) | CI como CHECK independente | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-013](RM-013-maestro-objetivo.md) | Maestro Mode B7: objetivo e envelope | Descontinuado | Mesclado | Aprovados | Não implantado | 2026-09-24 |
| [RM-015](RM-015-onboarding-do-nucleo.md) | Onboarding do núcleo | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |
| [RM-016](RM-016-experiencia-do-builder.md) | Experiência do builder em Claude Code e Codex | Concluído | Mesclado | Aprovados | Produção | 2026-09-27 |
| [RM-018](RM-018-ontologia-de-portfolio.md) | Ontologia de portfólio | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |
| [RM-019](RM-019-catalogo-multi-repositorio.md) | Catálogo multi-repositório | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |
| [RM-025](RM-025-company-brain-fundacao.md) | Company Brain: fundação | Em desenvolvimento | Mesclado | Aprovados | Produção | 2026-10-01 |
| [RM-026](RM-026-workspace-empresarial.md) | Workspace empresarial e Maestro | Em desenvolvimento | Mesclado | Aprovados | Produção | 2026-10-01 |
| [RM-031](RM-031-grafo-de-codigo.md) | Grafo determinístico de código e artefatos | Em desenvolvimento | Mesclado | Aprovados | Produção | 2026-10-01 |
| [RM-032](RM-032-bootstrap-maestro.md) | Bootstrap universal Maestro | Disponível | Mesclado | Aprovados | Produção | 2026-09-24 |
| [RM-033](RM-033-rotacao-de-contas.md) | Rotação de contas e perfis dos runtimes | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |
| [RM-034](RM-034-conclusao-claude-bg.md) | Conclusão nativa das sessões claude-bg | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |
| [RM-035](RM-035-horario-do-dono.md) | Horário do dono em toda superfície humana | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-036](RM-036-maestro-multicanal.md) | Condução multicanal do Maestro no núcleo | Piloto | Mesclado | Aprovados | Produção | 2026-09-27 |
| [RM-037](RM-037-verify-rapido-e-confiavel.md) | Verify rápido e confiável | Piloto | Mesclado | Aprovados | Produção | 2026-10-01 |
| [RM-038](RM-038-busca-semantica-na-memoria.md) | Busca semântica na memória | Em validação | Mesclado | Aprovados | Produção | 2026-10-01 |
| [RM-039](RM-039-cadencia-do-pulse-por-tag.md) | Cadência do pulse por tag em qualquer canal | Piloto | Mesclado | Aprovados | Produção | 2026-09-27 |
| [RM-040](RM-040-estado-de-conta-compartilhado.md) | Estado de conta compartilhado entre projetos | Piloto | Mesclado | Aprovados | Produção | 2026-09-27 |
| [RM-041](RM-041-hitl-invertido.md) | HITL invertido: decisão tomada, lote e pergunta rara | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-042](RM-042-modo-fast.md) | Modo #Fast: uma fase, sem cerimônia | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-043](RM-043-aposentadoria.md) | Aposentadoria de cinco mecanismos | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-044](RM-044-documentacao-como-codigo.md) | Documentação como código com paridade | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-045](RM-045-pulse-enxuto.md) | Pulse enxuto: fila sem lixo e varredura dentro do teto | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-046](RM-046-go-to-open-source.md) | GoToOpenSource, o Orkastery aberto, seguro e fácil de adotar | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-047](RM-047-fabrica-em-varias-maquinas.md) | Fábrica em várias máquinas, com threads em mais de um computador | Piloto | Mesclado | Aprovados | Produção | 2026-09-27 |
| [RM-048](RM-048-hitl-humano-no-centro.md) | HITL humano no centro: decisão curta, clara e com recomendação em qualquer canal | Em validação | Mesclado | Aprovados | Produção | 2026-10-01 |
| [RM-049](RM-049-lancamento.md) | Lançamento do Orkastery, com documentação no site, marketplaces e anúncio | Em desenvolvimento | Mesclado | Aprovados | Produção | 2026-10-01 |
| [RM-050](RM-050-guia-de-contribuicao.md) | Guia de contribuição nos repositórios e nos sites | Em desenvolvimento | Mesclado | Aprovados | Produção | 2026-10-01 |
| [RM-051](RM-051-pacote-de-experiencia.md) | Pacote de experiência de orquestração | Disponível | Mesclado | Aprovados | Produção | 2026-10-01 |
| [RM-052](RM-052-projeto-alvo-explicito.md) | Projeto-alvo explícito e resposta honesta nos hosts | Em validação | Mesclado | Aprovados | Produção | 2026-10-01 |
| [RM-054](RM-054-roadmaps-e-threads-da-rede.md) | Roadmaps e threads da rede visíveis a todo agente e runtime | Em desenvolvimento | Mesclado | Aprovados | Produção | 2026-10-01 |
| [RM-100](RM-100-fundacao-do-nucleo.md) | Fundação do núcleo: blocos B0 a B6 | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |

<!-- ork-docs:indice:fim -->
