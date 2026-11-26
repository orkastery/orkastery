# Roadmap

> **Em uma frase:** por que mudar, o que entregar e em que pé está cada item — com o estado provado pelo git, não declarado.

- **Padrão:** [roadmap de produto](../padroes/roadmap-de-produto.md) · **Complemento:** [documentação de produto](../produto/README.md)
- **Um arquivo por item:** `RM-000-assunto.md`, com o estado no frontmatter
- **Novo item:** copie [o modelo](_modelo-item.md) e rode `ork docs verificar`
- **Quem está com cada item:** `ork roadmap reservas`; antes de começar, `ork thread new ... --roadmap RM-NNN` reserva o item para a sua máquina ([FEAT-026](../produto/FEAT-026-reservas-do-roadmap.md))
- **Histórico:** este repositório começa em 27/09/2026, na versão 0.3.0. Os SHAs de merge e os números de PR citados nos itens antes dessa data são do histórico de construção, que fica num arquivo privado. A evidência de código desses itens aponta para o primeiro commit público.

## Prioridade aprovada em 23/11/2026

A tabela única substitui as listas anteriores e ordena o realinhamento pelas frentes A a D. As frentes A e B começam em paralelo. Dentro da frente C, a RM-071 decide a ordem entre RM-064, RM-076 e RM-077 pelo gargalo medido. A [RM-089](RM-089-orkastery-network-coletiva-da-empresa.md) F7 continua em curso sem disputar essa ordem.

| Ordem | Frente | Itens | Resultado que libera a próxima etapa |
| --- | --- | --- | --- |
| 0 | Issues de usuários (ordem do dono em 24/11/2026) | [RM-096](RM-096-nucleo-portatil-no-macos.md) e [RM-080](RM-080-saida-completa-e-causa-tipada-no-verify.md) F0 | O pacote instalado percorre o primeiro ciclo no macOS; infraestrutura ausente produz diagnóstico tipado e nunca um verde falso |
| 1 | A — decisão e execução do dono | [RM-093](RM-093-acao-do-dono-executada-pela-fabrica.md) e [RM-048](RM-048-hitl-humano-no-centro.md), com [RM-092](RM-092-ratificacao-autenticada-de-contrato-publico-no-auto.md) | Pergunta curta segue um padrão único; autorização autenticada fica presa ao escopo, à validade, ao canal e à prova; a fábrica executa a ação reservada sem pedir terminal ao dono |
| 1 | B — medição do fluxo | [RM-071](RM-071-relatorio-da-esteira-do-sdlc.md) F1 e F2 | Espera ganha motivo tipado e vazão útil passa a ter fórmula e origem, em paralelo à frente A |
| 2 | B — ritmo, fluidez, qualidade e intenção | [RM-071](RM-071-relatorio-da-esteira-do-sdlc.md) F3 a F6 e [RM-094](RM-094-caixa-de-intencoes.md) F1 | O fluxo mostra ritmo, intervenções, qualidade e gargalo semanal; a caixa captura intenção sem autorizar execução |
| 3 | C — habilitação medida | [RM-083](RM-083-estado-do-roadmap-acompanha-a-entrega.md), depois habilitar [RM-075](RM-075-fim-de-fase-lido-pelo-resultado.md), [RM-078](RM-078-recibo-valido-enquanto-nada-muda.md) e [RM-081](RM-081-check-por-qualquer-runner.md) | O PR leva o estado pós-merge e cada capacidade pronta é habilitada com medição antes e depois |
| 3 | C — desobstrução conforme o gargalo | [RM-064](RM-064-conta-esgotada-nao-para-a-fase.md) fatia 4 e T6, [RM-076](RM-076-fila-pesada-com-prioridade.md) e [RM-077](RM-077-revisao-independente-pelo-construtor-do-head.md) | A thread continua entre runtimes e máquinas, a vaga pesada segue a prioridade e o CHECK encontra revisor elegível pelo construtor do HEAD |
| 3 | C — diagnóstico e continuidade | [RM-080](RM-080-saida-completa-e-causa-tipada-no-verify.md), [RM-082](RM-082-credenciais-redigidas-em-toda-superficie.md) e [RM-084](RM-084-sessao-continua-com-muitos-objetos-soltos-do-git.md) | O verify explica a causa e guarda a saída inteira; superfícies redigem credenciais e a sessão preserva a continuidade do repositório |
| 3 | C — rede para a caixa | habilitar [RM-054](RM-054-roadmaps-e-threads-da-rede.md) antes da [RM-094](RM-094-caixa-de-intencoes.md) F3 | A rede expõe somente identificador, estado, item relacionado e origem da intenção |
| 4 | D — resultado alimenta planejamento | [RM-095](RM-095-resultado-de-producao-vira-proposta.md) F1 e a nova fatia da [RM-008](RM-008-loop-de-aprendizado.md) | Regressão, reversão e issue de bug viram proposta; nada entra na caixa sem confirmação do dono |
| 4 | D — previsão e custo | [RM-071](RM-071-relatorio-da-esteira-do-sdlc.md) F7 e F8 | Cada item recebe faixa de probabilidade e custo de entrega por cota e tokens |
| 5 | D — adoção posterior | [RM-091](RM-091-ork-mesh-no-site-para-empresas-e-times.md), [RM-086](RM-086-kimi-code-homologado.md) e [RM-087](RM-087-opencode-homologado.md) | O site é replanejado a partir de estados verdadeiros; novos runtimes entram depois da política comum de contas |

A [RM-058](RM-058-modo-noctum.md) mantém os pilotos depois da frente B. #Noctum segue em desenvolvimento, não anunciado.

## Itens estacionados

| Item | Gatilho de retorno |
| --- | --- |
| [RM-066](RM-066-google-antigravity-homologado.md) | Volta quando houver conta apta e os termos aplicáveis tiverem sido lidos |
| [RM-070](RM-070-grok-bot-como-camada-de-conducao.md) | Volta depois da entrega da RM-093 |
| [RM-073](RM-073-modelos-de-decisao-no-ork-e-no-orkmind.md) | Volta quando a RM-071 tiver dados suficientes para treinar e medir o resultado |

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
| [RM-008](RM-008-loop-de-aprendizado.md) | Loop de aprendizado | Piloto | Mesclado | Aprovados | Produção | 2026-11-23 |
| [RM-009](RM-009-playbook-dos-runtimes.md) | Playbook dos runtimes | Concluído | Mesclado | Aprovados | Produção | 2026-09-27 |
| [RM-012](RM-012-ci-check-independente.md) | CI como CHECK independente | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-013](RM-013-maestro-objetivo.md) | Maestro Mode B7: objetivo e envelope | Descontinuado | Mesclado | Aprovados | Não implantado | 2026-09-24 |
| [RM-015](RM-015-onboarding-do-nucleo.md) | Onboarding do núcleo | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |
| [RM-016](RM-016-experiencia-do-builder.md) | Experiência do builder em Claude Code e Codex | Concluído | Mesclado | Aprovados | Produção | 2026-10-27 |
| [RM-018](RM-018-ontologia-de-portfolio.md) | Ontologia de portfólio | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |
| [RM-019](RM-019-catalogo-multi-repositorio.md) | Catálogo multi-repositório | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |
| [RM-025](RM-025-company-brain-fundacao.md) | Company Brain: fundação | Em desenvolvimento | Mesclado | Aprovados | Produção | 2026-11-23 |
| [RM-026](RM-026-workspace-empresarial.md) | Workspace empresarial e Maestro | Em desenvolvimento | Mesclado | Aprovados | Produção | 2026-10-27 |
| [RM-031](RM-031-grafo-de-codigo.md) | Grafo determinístico de código e artefatos | Em desenvolvimento | Mesclado | Aprovados | Produção | 2026-11-23 |
| [RM-032](RM-032-bootstrap-maestro.md) | Bootstrap universal Maestro | Disponível | Mesclado | Aprovados | Produção | 2026-10-01 |
| [RM-033](RM-033-rotacao-de-contas.md) | Rotação de contas e perfis dos runtimes | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |
| [RM-034](RM-034-conclusao-claude-bg.md) | Conclusão nativa das sessões claude-bg | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |
| [RM-035](RM-035-horario-do-dono.md) | Horário do dono em toda superfície humana | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-036](RM-036-maestro-multicanal.md) | Condução multicanal do Maestro no núcleo | Piloto | Mesclado | Aprovados | Produção | 2026-10-03 |
| [RM-037](RM-037-verify-rapido-e-confiavel.md) | Verify rápido e confiável | Piloto | Mesclado | Aprovados | Produção | 2026-11-23 |
| [RM-038](RM-038-busca-semantica-na-memoria.md) | Busca semântica na memória | Em validação | Mesclado | Aprovados | Produção | 2026-11-23 |
| [RM-039](RM-039-cadencia-do-pulse-por-tag.md) | Cadência do pulse por tag em qualquer canal | Piloto | Mesclado | Aprovados | Produção | 2026-10-03 |
| [RM-040](RM-040-estado-de-conta-compartilhado.md) | Estado de conta compartilhado entre projetos | Piloto | Mesclado | Aprovados | Produção | 2026-09-27 |
| [RM-041](RM-041-hitl-invertido.md) | HITL invertido: decisão tomada, lote e pergunta rara | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-042](RM-042-modo-fast.md) | Modo #Fast: uma fase, sem cerimônia | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-043](RM-043-aposentadoria.md) | Aposentadoria de cinco mecanismos | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-044](RM-044-documentacao-como-codigo.md) | Documentação como código com paridade | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-045](RM-045-pulse-enxuto.md) | Pulse enxuto: fila sem lixo e varredura dentro do teto | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-046](RM-046-go-to-open-source.md) | GoToOpenSource, o Orkastery aberto, seguro e fácil de adotar | Concluído | Mesclado | Aprovados | Produção | 2026-09-28 |
| [RM-047](RM-047-fabrica-em-varias-maquinas.md) | Fábrica em várias máquinas, com threads em mais de um computador | Piloto | Mesclado | Aprovados | Produção | 2026-10-27 |
| [RM-048](RM-048-hitl-humano-no-centro.md) | HITL humano no centro: decisão curta, clara e com recomendação em qualquer canal | Em validação | Mesclado | Aprovados | Produção | 2026-11-23 |
| [RM-049](RM-049-lancamento.md) | Lançamento do Orkastery, com documentação no site, marketplaces e anúncio | Em desenvolvimento | Mesclado | Aprovados | Produção | 2026-10-03 |
| [RM-050](RM-050-guia-de-contribuicao.md) | Guia de contribuição nos repositórios e nos sites | Piloto | Mesclado | Aprovados | Produção | 2026-10-10 |
| [RM-051](RM-051-pacote-de-experiencia.md) | Pacote de experiência de orquestração | Disponível | Mesclado | Aprovados | Produção | 2026-10-01 |
| [RM-052](RM-052-projeto-alvo-explicito.md) | Projeto-alvo explícito e resposta honesta nos hosts | Em validação | Mesclado | Aprovados | Produção | 2026-11-23 |
| [RM-053](RM-053-orkastery-network.md) | Orkastery Network, as máquinas de uma pessoa em rede | Em desenvolvimento | Mesclado | Em execução | Não implantado | 2026-10-03 |
| [RM-054](RM-054-roadmaps-e-threads-da-rede.md) | Roadmaps e threads da rede visíveis a todo agente e runtime | Em desenvolvimento | Mesclado | Aprovados | Não implantado | 2026-11-23 |
| [RM-055](RM-055-impedimento-do-dono-vira-hitl.md) | Impedimento que só o dono resolve vira pedido a ele | Em desenvolvimento | Mesclado | Em execução | Não implantado | 2026-11-23 |
| [RM-056](RM-056-perfil-por-thread-e-carga.md) | Perfil por thread, rodízio por carga e sessões dos perfis | Em desenvolvimento | Mesclado | Em execução | Não implantado | 2026-10-02 |
| [RM-057](RM-057-hitl-por-alternativas.md) | HITL de condução por alternativas: de 3 a 5 opções, uma recomendada, nunca texto colado | Em desenvolvimento | Mesclado | Em execução | Não implantado | 2026-11-23 |
| [RM-058](RM-058-modo-noctum.md) | Modo #Noctum: arcos autônomos de muitas threads e máquinas | Em desenvolvimento | Mesclado | Em execução | Não implantado | 2026-11-23 |
| [RM-059](RM-059-conducao-dentro-do-claude-code.md) | Condução dentro do Claude Code: dez mods para ver, decidir, destravar, entregar e pontuar sem sair do terminal | Em desenvolvimento | Mesclado | Não iniciados | Produção | 2026-10-27 |
| [RM-060](RM-060-site-como-produto.md) | Site como produto: os dois sites públicos com o mesmo rigor do núcleo | Em desenvolvimento | Mesclado | Não iniciados | Não implantado | 2026-10-12 |
| [RM-061](RM-061-cli-em-ingles-e-pt-br.md) | CLI em inglês e pt-BR | Em desenvolvimento | Mesclado | Em execução | Produção | 2026-10-29 |
| [RM-062](RM-062-repositorio-publico-sem-dado-privado.md) | Repositório público sem dado privado | Em desenvolvimento | Mesclado | Em execução | Produção | 2026-11-23 |
| [RM-063](RM-063-fabrica-que-nao-para.md) | Fábrica que não para | Em desenvolvimento | Mesclado | Em execução | Produção | 2026-11-23 |
| [RM-064](RM-064-conta-esgotada-nao-para-a-fase.md) | Conta esgotada não para a fase | Em desenvolvimento | Mesclado | Em execução | Produção | 2026-11-23 |
| [RM-065](RM-065-gitlab-com-paridade-ao-github.md) | GitLab com paridade ao GitHub | Disponível | Mesclado | Aprovados | Produção | 2026-10-27 |
| [RM-066](RM-066-google-antigravity-homologado.md) | Google Antigravity homologado ao lado de Codex e Claude Code | Backlog | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-067](RM-067-grok-build-homologado.md) | Grok Build homologado ao lado de Codex e Claude Code | Em desenvolvimento | Mesclado | Aprovados | Não implantado | 2026-11-23 |
| [RM-068](RM-068-security-scan-no-check.md) | Security scan no CHECK | Disponível | Mesclado | Aprovados | Produção | 2026-10-27 |
| [RM-069](RM-069-dsn-fora-do-ambiente-dos-agentes.md) | DSN com senha fora do ambiente dos agentes | Disponível | Mesclado | Aprovados | Produção | 2026-10-27 |
| [RM-070](RM-070-grok-bot-como-camada-de-conducao.md) | Grok Bot como camada de condução do Orkastery | Backlog | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-071](RM-071-relatorio-da-esteira-do-sdlc.md) | Fluxo da fábrica por item | Discovery | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-072](RM-072-check-cinco-vezes-mais-rapido.md) | Agile Check e Classic Check: o CHECK rápido como padrão, sem perder cobertura | Disponível | Mesclado | Aprovados | Produção | 2026-10-27 |
| [RM-073](RM-073-modelos-de-decisao-no-ork-e-no-orkmind.md) | Modelos de decisão no ork e no OrkMind | Backlog | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-074](RM-074-agile-check-tres-vezes-mais-rapido.md) | Agile Check mais rápido que o Classic pelo paralelismo, sem perder cobertura | Concluído | Mesclado | Aprovados | Produção | 2026-11-23 |
| [RM-075](RM-075-fim-de-fase-lido-pelo-resultado.md) | Fim de fase lido pelo resultado: sessão que termina sem pergunta não vira espera humana | Em desenvolvimento | Mesclado | Em execução | Produção | 2026-11-23 |
| [RM-076](RM-076-fila-pesada-com-prioridade.md) | Fila pesada com prioridade e reserva de vaga | Discovery | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-077](RM-077-revisao-independente-pelo-construtor-do-head.md) | Revisão independente medida pelo construtor do HEAD | Discovery | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-078](RM-078-recibo-valido-enquanto-nada-muda.md) | Recibo de verify e de revisão válido enquanto HEAD, claims e plano não mudam | Em desenvolvimento | Mesclado | Em execução | Não implantado | 2026-11-23 |
| [RM-079](RM-079-claims-que-a-correcao-passa.md) | Claims de revisão que a correção passa e retirada tipada com substituta | Em desenvolvimento | Mesclado | Em execução | Não implantado | 2026-11-07 |
| [RM-080](RM-080-saida-completa-e-causa-tipada-no-verify.md) | Verify diz a causa e guarda a saída inteira | Em desenvolvimento | Branch criada | Em execução | Não implantado | 2026-11-25 |
| [RM-081](RM-081-check-por-qualquer-runner.md) | CHECK que entende qualquer runner de teste e só roda de novo o necessário | Em desenvolvimento | Mesclado | Em execução | Produção | 2026-11-23 |
| [RM-082](RM-082-credenciais-redigidas-em-toda-superficie.md) | Credenciais redigidas em toda superfície de comando, motivo e detalhe | Discovery | Não iniciado | Não iniciados | Não implantado | 2026-11-07 |
| [RM-083](RM-083-estado-do-roadmap-acompanha-a-entrega.md) | Estado do roadmap acompanha a entrega | Discovery | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-084](RM-084-sessao-continua-com-muitos-objetos-soltos-do-git.md) | Sessão continua com muitos objetos soltos do Git | Discovery | Não iniciado | Não iniciados | Não implantado | 2026-11-07 |
| [RM-085](RM-085-verify-com-escopo-causal-mensagem-de-assercao-e-check-fast.md) | Verify com escopo causal, mensagem de asserção e CHECK independente no #Fast | Descontinuado | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-086](RM-086-kimi-code-homologado.md) | Kimi Code homologado ao lado de Codex e Claude Code | Discovery | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-087](RM-087-opencode-homologado.md) | OpenCode homologado ao lado de Codex e Claude Code | Discovery | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-088](RM-088-versao-mais-antiga-nunca-vira-a-latest-do-npm.md) | Versão mais antiga nunca vira a latest do npm | Concluído | Mesclado | Aprovados | Produção | 2026-11-23 |
| [RM-089](RM-089-orkastery-network-coletiva-da-empresa.md) | Orkastery Network coletiva da empresa, com uso obrigatório | Em desenvolvimento | Mesclado | Em execução | Produção | 2026-11-23 |
| [RM-090](RM-090-telemetria-opentelemetry-para-sdlc-analytics.md) | Telemetria compatível com OpenTelemetry e Grafana para SDLC Analytics | Concluído | Mesclado | Aprovados | Produção | 2026-11-23 |
| [RM-091](RM-091-ork-mesh-no-site-para-empresas-e-times.md) | Ork Mesh no site, para empresas e times | Em desenvolvimento | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-092](RM-092-ratificacao-autenticada-de-contrato-publico-no-auto.md) | Autorização autenticada com escopo, validade, canal e prova | Discovery | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-093](RM-093-acao-do-dono-executada-pela-fabrica.md) | Ação do dono executada pela fábrica | Discovery | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-094](RM-094-caixa-de-intencoes.md) | Caixa de intenções | Discovery | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-095](RM-095-resultado-de-producao-vira-proposta.md) | Resultado de produção vira proposta | Discovery | Não iniciado | Não iniciados | Não implantado | 2026-11-23 |
| [RM-096](RM-096-nucleo-portatil-no-macos.md) | Núcleo portátil no macOS | Em desenvolvimento | Branch criada | Em execução | Não implantado | 2026-11-25 |
| [RM-097](RM-097-resolucao-de-tipos-no-security-scan.md) | Resolução de tipos no worktree do security scan | Discovery | Não iniciado | Não iniciados | Não implantado | 2026-11-25 |
| [RM-100](RM-100-fundacao-do-nucleo.md) | Fundação do núcleo: blocos B0 a B6 | Concluído | Mesclado | Aprovados | Produção | 2026-09-24 |

<!-- ork-docs:indice:fim -->
