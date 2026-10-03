---
id: RM-058
tipo: roadmap
titulo: "Modo #Noctum: arcos autônomos de muitas threads e máquinas"
categoria: iniciativa
pai: null
features: [FEAT-002, FEAT-026, FEAT-031, FEAT-032]
owner: Julio
atualizado_em: 2026-10-03T14:45:00+00:00
estado:
  ciclo: Refinamento
  documentacao: Em revisão
  codigo: Não iniciado
  testes: Não iniciados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: null
  modo: null
---

# RM-058 — Modo #Noctum: arcos autônomos de muitas threads e máquinas

> **Em uma frase:** proposta de arcos de 6 a 12 horas em que o Orkastery conduz muitas threads, em uma ou mais máquinas autorizadas, com prova de qualidade e decisões do dono reunidas para a manhã.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Refinamento | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Proposta em refinamento.** Esta página planeja o #Noctum; o modo ainda não está implementado nem habilitado. As regras abaixo são requisitos futuros. A duração vem do pedido do dono, não de um ensaio de autonomia já aprovado.

Features relacionadas: [modos de condução](../produto/FEAT-002-modos-de-conducao.md), [reservas do roadmap](../produto/FEAT-026-reservas-do-roadmap.md), [Orkastery Network](../produto/FEAT-031-orkastery-network.md) e [roadmap da rede](../produto/FEAT-032-roadmap-da-rede.md). São bases existentes, não prova de execução autônoma entre máquinas.

## Problema e resultado

- **Público e problema:** product builder com roadmap priorizado e trabalho suficiente para avançar enquanto fica ausente por 6 a 12 horas. Hoje precisa vigiar a condução, recuperar sessões e coordenar contas, revisões e merges.
- **Evidências e fonte:** pedido do dono para a RM-058 e relato de uma condução manual na noite de 02 para 03/10/2026. As ocorrências relatadas estão em [Resiliência](#resiliência-ao-longo-de-horas), com suas limitações de evidência.
- **Objetivo:** conduzir um arco inteiro, da seleção de itens ao relatório final, sem solicitar intervenção humana durante a janela autorizada, mantendo os bloqueios de cada ação e a prova de cada entrega.
- **Hipótese:** se o núcleo persistir autorização, fila, limites, supervisão e retomada, o arco poderá continuar com trabalho independente quando uma thread falhar ou depender do dono, sem precisar de vigilância manual.
- **Métrica principal:** tempo de condução elegível sem intervenção humana, medido entre eventos do arco no ledger. Linha de base quantitativa ainda não medida; o relato manual não equivale a benchmark. Meta proposta: completar ensaios de 6 h e 12 h sem intervenção, se houver fila e orçamento. Janela: piloto de cada duração, com injeção de falhas e recibos por transição.
- **Métricas de proteção:** nenhuma operação fora do envelope, nenhum merge sem provas no SHA correto, nenhum dono ou revisor fictício, nenhuma duplicação de item entre máquinas e nenhuma ultrapassagem do teto autorizado.

| Aspecto | #Auto vigente | #Noctum proposto |
| --- | --- | --- |
| Unidade de condução | Uma thread e seu ciclo, sem pausas humanas previstas | Um arco com muitas threads, fila, prazo e orçamento comuns |
| Paralelismo | O projeto pode ter threads simultâneas | O arco planeja e limita a distribuição entre máquinas e contas |
| Decisão exclusiva do dono | Escalação tipada pausa a thread | A operação e seus dependentes ficam bloqueados; outras threads elegíveis seguem; a decisão vai ao lote |
| Fechamento | Evidências, entrega e MASTER da thread | Fechamento por thread mais reconciliação e relatório de todo o arco |

O #Noctum não reduzirá checks nem converterá `policy: block`, autenticação ausente ou escalação tipada em permissão. Se o impedimento afetar o arco inteiro, ele terminará com estado recuperável e relatório; continuidade não será promessa de progresso sem condições.

## Escopo e validação

**Incluído:** envelope anterior ao arco, fila persistente de itens autorizados, distribuição com reservas, supervisão, recuperação limitada, revisão independente, fila de operações pesadas, entrega com provas, controle de custo e relatório multicanal.

**Entregável desta etapa:** apenas o planejamento, sua posição proposta no [índice](README.md#prioridade-para-a-comunidade-de-product-builders) e a entrada documental no [CHANGELOG](../../CHANGELOG.md). A implementação futura terá as seis fatias abaixo. O bloco `sdlc` permanece sem thread de implementação para que o merge deste planejamento não declare o modo implementado.

**Validação documental:** `node core/dist/index.js docs sincronizar --escrever`, `ork docs verificar` e `core/node_modules/.bin/markdownlint-cli2 docs/roadmap/RM-058-modo-noctum.md docs/roadmap/README.md CHANGELOG.md`. A aprovação desses comandos confere documentação; não prova um arco Noctum.

### Envelope de autorização antes do arco

O dono deverá conceder um envelope por ingresso autenticado do host antes do início. O núcleo guardará sua versão e hash, recibo de origem humana, projetos e repositórios, branches de destino, itens elegíveis, máquinas, contas e runtimes permitidos, início, expiração, fuso, tetos, limites de concorrência e canal/horário do relatório. Não haverá autorização por silêncio nem renovação automática.

O registro ficará no estado governado pelo núcleo, referenciado por todo evento do arco, sem credenciais no documento ou no ledger. Cada executor terá de conferir a versão vigente, revogação, escopo, tempo e orçamento antes do despacho e imediatamente antes de um efeito externo. Um retrato da rede ou texto de um agente não substituirá esse recibo. O contrato persistente e seu transporte ainda serão definidos na fatia N1.

| Operação | Autorização que deverá constar | Conferência antes de executar |
| --- | --- | --- |
| Push e PR | Remotos, branches de trabalho e repositórios já existentes; permissão separada para criar/atualizar PR | Destino permitido, claims, identidade do executor, prazo e ausência de segredo; push direto na base continuará sujeito à policy |
| Merge | Branch de destino e exigência dos checks obrigatórios, revisão independente e verify aprovados | SHA fonte exato, base atual e candidato de integração; qualquer alteração invalida a prova afetada e exige nova rodada |
| Despacho de threads | Lista ou filtro fechado de itens do roadmap e dependências autorizadas | Item elegível, reserva ganha, capacidade disponível e gates satisfeitos; expansão do escopo vai ao lote |
| Rodízio de contas e runtime | Lista de perfis previamente autenticados, runtimes, modelos/esforços e política de provider admitidos | Saúde, saldo e concorrência da conta; mudança de runtime, inclusive Claude → Codex, somente entre opções já autorizadas |

**Nunca entrará no envelope geral:** tag e publicação de versão/pacote/site, atualização de produção sem autorização explícita própria, acesso ou circulação de segredos, ações destrutivas e criação de repositório público. Credenciais continuarão locais, consumidas apenas pelo mecanismo já autorizado do host. Nenhum agente poderá ampliar permissões, mudar sandbox, trocar identidade ou habilitar provider pago para recuperar o arco.

Uma implantação em produção exigirá autorização específica do dono e fluxo próprio; não será inferida de push, PR ou merge. Revogação ou expiração negará novos efeitos imediatamente. Trabalho em voo será interrompido ou encerrado em checkpoint seguro, conforme o limite do host, sem aproveitar uma ação iniciada antes do prazo para autorizar a seguinte.

### Sem HITL no meio, com decisões registradas

Dentro do envelope, uma dúvida delegável deverá virar decisão autônoma registrada por `ork decisao registrar <thread>` ou pela ferramenta correspondente do núcleo. O registro levará quem decidiu, alternativas, uma recomendada, razão, evidência, critério, como mudar e custo de reverter agora e depois. A recomendação escolhida dentro do envelope terá autoria do agente, nunca do dono.

O que só o dono resolverá entrará numa fila de lote durável, com ID estável, thread, ação impedida, dependentes, impacto e 3 a 5 alternativas, exatamente uma recomendada, conforme [RM-048](RM-048-hitl-humano-no-centro.md) e [RM-057](RM-057-hitl-por-alternativas.md). Não se abrirá pergunta interativa durante o arco. Sem resposta, a ação permanecerá bloqueada; a recomendação não será aplicada como resposta humana.

O agendador retirará apenas o trabalho inelegível da fila executável e continuará com itens independentes. `policy: block`, violação de custo e limite de tentativas manterão sua abrangência: se globais, pararão o arco; se locais, isolarão a thread ou conta. Uma violação de custo não receberá retry automático. O lote será entregue no relatório combinado, inclusive quando o arco terminar antecipadamente.

### Arco e fila

1. **Preparar:** conferir envelope, dependências, ferramentas disponíveis, baseline, reservas e panorama de [RM-054](RM-054-roadmaps-e-threads-da-rede.md). Fonte não lida será lacuna; não será tratada como fila vazia.
2. **Escolher:** filtrar os itens autorizados por dependências cumpridas, escopo claro e prova executável; ordenar pela prioridade ratificada, depois idade na fila e ID para desempate reproduzível. Itens novos descobertos durante o arco serão propostas para o lote.
3. **Reservar e distribuir:** ganhar a reserva antes de abrir a thread, conforme [RM-047](RM-047-fabrica-em-varias-maquinas.md); só despachar em máquina aderida, apta e autorizada. Capacidade anunciada será reconferida no executor.
4. **Fatiar:** cada tarefa deverá ter resultado pequeno, touch paths, claims, comando de aceite e commit próprio. Cada thread percorrerá GOAL → PLAN → GO → CHECK → SHIP → MASTER com os gates do núcleo.
5. **Limitar:** contabilizar sessões de execução e de revisão, incluindo outros projetos. Aplicar simultaneamente o teto da máquina e o teto global da conta entre máquinas; uma sessão só começa se ambos admitirem. Os limites serão explícitos no envelope, com margem reservada à revisão.
6. **Repor ou encerrar:** ao liberar capacidade, reler fatos e selecionar o próximo item. Fila realmente vazia encerrará antecipadamente; fila apenas bloqueada aguardará eventos até o prazo, com backoff, sem criar trabalho para ocupar contas. O relatório distinguirá vazio, bloqueado e fonte indisponível.

### Multimáquina

O [Orkastery Network, RM-053](RM-053-orkastery-network.md), fornecerá descoberta, identidade de instalação, capacidades e frescor. A RM-054 fornecerá o panorama e suas lacunas. Esses retratos não são um executor remoto: o transporte autenticado de ordens, recibos e cancelamento terá de ser implementado e testado na N3.

Haverá uma autoridade ativa para a fila do arco, com geração verificável e substituição controlada. Cada máquina conduzirá a thread na própria worktree. A reserva atômica por item impedirá duas máquinas de começar o mesmo trabalho; uma segunda thread do mesmo item aguardará liberação ou transferência registrada. Slots de conta compartilhada também precisarão de coordenação entre máquinas, além dos limites locais.

Cada máquina preparará a própria branch e PR. O merge passará pelo caminho oficial de entrega, com serialização por repositório/destino válida entre máquinas. Um lease apenas local não bastará: a N3 deverá provar coordenação compartilhada ou fila da forja, revalidando os HEADs após adquirir o direito de integrar. Perdeu a corrida ou mudou a base: atualizar, resolver conflitos e repetir as provas do novo candidato antes do merge. Push confirmado e reconciliação do remoto serão requisitos do recibo de entrega.

Se uma máquina perder batidas, o arco suspenderá novos despachos para ela, consultará sessão, controlador, reserva e remoto e preservará os checkpoints. Ausência de batida não provará morte nem liberará sozinha a reserva. Uma retomada em outra máquina só ocorrerá após revogar a geração anterior e impedir que o executor antigo volte a gravar ou integrar. Sem essa prova, o item ficará isolado para o lote; outros itens seguirão. Ao retornar, a máquina antiga reconciliará o estado e rejeitará ordens vencidas, sem executar a entrega em duplicidade.

### Resiliência ao longo de horas

**Origem:** relato do dono na abertura deste planejamento, sobre a condução manual de 02→03/10/2026. As quantidades abaixo são ocorrências relatadas, não métricas de um Noctum implementado. A correção do watcher foi indicada no [PR #117](https://github.com/orkastery/orkastery/pull/117); o [CHANGELOG](../../CHANGELOG.md#não-publicado) descreve a recuperação e explicita que a causa dos incidentes não ficou comprovada. O piloto deverá produzir medições reproduzíveis.

| Ocorrência relatada | Como o Noctum deverá detectar | O que deverá fazer sozinho |
| --- | --- | --- |
| Condutor parou duas vezes; foram necessários despertador a cada 30 min e vigias | Supervisor externo à sessão comparará batida e avanço do ledger com o prazo de cada fase e sondará controlador/runtime; pouca saída, sozinha, não provará travamento | Retomar do checkpoint com nova sessão vinculada e geração válida; preservar gates e tentativas; isolar falha repetida. A cadência proposta está em D3 |
| Contas atingiram teto de gasto e limite semanal; rodízio detectou tarde e foi preciso trocar Claude por Codex | Conferir consumo, saldo/reset declarados pelo runtime, recusas tipadas e idade da última leitura antes do despacho e durante a execução | Retirar conta esgotada da seleção; aguardar reset ou escolher perfil/runtime previamente autorizado; transferir contexto com proveniência, sem contornar teto do arco ou violação de custo |
| Watcher Codex morreu em sessão longa; condução ficou presa por até 12 h, com correção indicada no #117 | Vigia independente observará o próprio watcher, eventos terminais e recibos auditados; canário incluirá falha durante commit MCP e sessão sem novo rollout | Exigir instalação com a correção e canário aprovado; recuperar sob trava e só assumir condução após provar ausência das identidades anteriores. Não esperar expirar uma janela de horas para perceber watcher morto |
| Verify concorrente com build/testes produziu regressão falsa | Registrar ocupação, geração dos artefatos compilados e aquisição do recurso por worktree; comparar falha com a baseline em ambiente estável | Enfileirar verifies e builds/testes pesados por máquina e impedir escritores concorrentes no mesmo artefato; preservar a primeira falha e repetir de forma isolada dentro do orçamento. Nova falha consistente continuará bloqueando |
| PRs conflitaram no `CHANGELOG.md`; depois de uma versão, uma entrada pôde cair na seção errada | Após cada avanço da base, conferir conflito e posição semântica da entrada, inclusive se a seção de versão mudou sem conflito textual | Preservar ambas as entradas em conflito, pôr a mudança ainda não publicada em “Não publicado”, regenerar índices e repetir review, verify e CI no novo SHA; ambiguidade de conteúdo vai ao lote |
| Claims usaram `rg`, ausente no CI, e reprovaram | Validar comandos no ambiente do runner e conferir dependências declaradas antes da revisão | Usar ferramentas disponíveis, como `grep -E` ou Node, em comandos de claims; revisar equivalência da prova e executar novamente no CI, sem transformar ausência de ferramenta em sucesso |
| Cada fatia de código precisou de 2 a 4 rodadas de revisão independente | Contabilizar rodadas, achados recorrentes, identidade nativa dos revisores e vínculo com o SHA | Reservar capacidade de revisão; devolver achados ao GO e repetir CHECK independente. Planejar capacidade para até quatro rodadas não autorizará exceder o limite de tentativas do núcleo; ao atingi-lo, isolar e relatar |

Todos os relógios, tetos de tentativas e critérios de avanço deverão ser persistidos. Reiniciar condutor, trocar máquina ou mudar runtime não zerará o histórico nem renovará o envelope.

### Qualidade sem dono acordado

Uma fatia só poderá chegar à `main` com revisão independente obrigatória, claims executadas, verify contra baseline e CI obrigatório verde no SHA fonte exato, além da prova de integração com a base vigente. Autor e revisor poderão usar o mesmo runtime/modelo, mas terão IDs nativos distintos e vínculos comprovados pelo núcleo. Nome de papel no prompt e autoavaliação não contarão como CHECK.

Cada CHECK cobrirá correção, segurança, performance, manutenção e estilo, com revisão dos testes. Mutantes existentes deverão ser executados; guardas novas precisarão de prova negativa adequada ao risco. Ausência ou inaplicabilidade de mutantes/performance terá justificativa verificável, nunca porcentagem inventada. Documentação passará também por paridade e markdownlint.

Falha, revisão pendente, mutante sobrevivente relevante, segredo, baseline ausente ou check de outro SHA impedirão a integração. Um verde antigo não sobreviverá a ajuste de conflito, código, teste ou documentação no candidato. A fila de merge deverá impedir que duas máquinas integrem com a mesma prova de uma base já superada. O MASTER de cada thread registrará índice derivado do ledger; eventual nota humana será posterior e identificada como humana.

### Relatório da manhã

O envelope fixará horário e fuso, canal do dono e destinos habilitados: terminal, Telegram e OpenClaw deverão apresentar o mesmo conteúdo essencial. A composição partirá dos fatos do núcleo, segundo o formato aprovado na [RM-048](RM-048-hitl-humano-no-centro.md); o exemplo abaixo define conteúdo, sem afirmar números de uma execução.

- ✅ **Entregue:** um item por linha, com resultado, thread, PR/commit, prova do push e MASTER. Commit local ficará entre os trabalhos em curso.
- 🔄 **Em curso:** checkpoint, responsável pela retomada, próximo passo e reserva ainda ativa.
- ⏸️ **Impedido:** causa, alcance e ações tentadas; `#HITL` somente no que depender do dono, com ID estável e alternativas do lote.
- 🧭 **Decidi no envelope:** decisão, recomendação aplicada, razão, evidência e como reverter.
- 💰 **Custo e duração:** consumo medido por arco/conta, unidade, teto, lacunas e motivo do encerramento; assinatura não será tratada como uso ilimitado.
- 📝 **Correções:** “foi informado”, “fato confirmado agora”, fonte e impacto. Uma alegação errada durante o arco será corrigida explicitamente, sem apagar seu rastro nem repetir entrega não provada.
- 👤 **O que precisa de você:** decisões do lote com 3 a 5 alternativas e uma recomendada; se não houver, dizer “nada”; indicar também o próximo trabalho elegível.

O envio terá ID do arco e recibo por destino para evitar duplicação. Canal indisponível manterá o relatório durável para reenvio limitado e consulta no terminal; não será marcado como entregue sem recibo. Encerramento antecipado preservará a entrega no horário combinado. Revogação de acesso ao canal será respeitada.

### Custo e parada

Antes do início, o envelope deverá fixar teto total do arco, subtetos por conta, unidade e fonte de medição, margem para operações em voo e frequência de atualização. Gastos conhecidos e reservas de consumo das sessões ativas entrarão na decisão de admitir mais trabalho. Conta de assinatura terá limites de uso/reset separados do custo monetário; consumo desconhecido será lacuna, nunca zero.

Ao iniciar operação, reservar capacidade; ao concluir, reconciliar consumo. Rotação de conta não restaurará saldo global. Estimativa não será apresentada como gasto medido: se o runtime não oferecer limite ou medição suficiente para garantir o teto, ele não será elegível para esse regime até haver mecanismo comprovado. A decisão sobre regime está em D4.

| Condição | Comportamento proposto | Estado deixado para retomar |
| --- | --- | --- |
| Hora final ou envelope expirado/revogado | Parar admissões e novos efeitos; encerrar sessões de modo controlado | Checkpoints, motivos de interrupção e operações em voo reconciliadas |
| Fila vazia confirmada | Encerrar cedo; não abrir escopo novo | Retrato das fontes consultadas, itens concluídos e relatório agendado |
| Fila só com bloqueios ou fontes indisponíveis | Aguardar evento com backoff até o prazo, sem consumir sessões ociosas | Pendências e lacunas separadas de ausência de trabalho |
| Falha repetida ou escalação tipada | Aplicar o limite existente à unidade afetada; se o supervisor falhar repetidamente, parar o arco | Tentativas preservadas, diagnóstico e lote do dono |
| Teto do arco ou violação de custo | Parar globalmente, sem retry automático nem troca de conta para contornar | Consumo, reservas em voo e reconciliação pendente identificados |
| Conta sem capacidade, ainda dentro do teto global | Suspender a conta; só usar outra já admitida se policy e orçamento permitirem | Reset conhecido ou lacuna, sessões e saldo por conta |

O fechamento deverá deixar fila ordenada, envelope encerrado, decisões e evidências persistidas, branches/worktrees identificadas, PRs com estado real, resultados por SHA, reservas liberadas apenas onde for seguro e instrução de retomada. A próxima sessão exigirá envelope vigente e reconciliação; não repetirá cegamente commit, merge ou push cujo resultado tenha ficado incerto.

## Plano e decisões

- **Prioridade proposta:** posição 5, após RM-047 e antes de RM-037; aproxima a autonomia prolongada de sua base multimáquina, preservando as quatro primeiras posições. Método: dependências e impacto no trabalho sem supervisão; sem pontuação numérica inventada. Proposta de 2026-10-03, posição final de Julio.
- **Horizonte e confiança:** refinamento, sem previsão de lançamento. Confiança depende dos ensaios e da ratificação do envelope; marcos N1 a N6 abaixo.
- **Dependências e responsáveis:** RM-047 (reservas), RM-053 (rede), RM-054 (panorama), RM-048/RM-057 (decisões e status), [RM-037](RM-037-verify-rapido-e-confiavel.md) (verify), [RM-040](RM-040-estado-de-conta-compartilhado.md) e [RM-056](RM-056-perfil-por-thread-e-carga.md) (contas/capacidade), [RM-036](RM-036-maestro-multicanal.md) (condução). Owner de integração: Julio; executor a designar por fatia. Próxima revisão: antes de admitir N1, conferindo evidência de cada dependência, sem presumir conclusão pelo número do item.

### Fatias propostas

Os aceites abaixo são testes a construir durante a implementação; não são provas já executadas. A ordem respeitará dependências e a aprovação das escolhas de produto.

| Fatia | Resultado | Critério de aceite verificável | Dependências |
| --- | --- | --- | --- |
| N1 — Envelope e estado do arco | Contrato persistente de autorização, prazo, exclusões, orçamento e decisões em lote | Testes de ingresso negam origem sem prova, ação excluída, hash antigo, revogação e expiração imediatamente antes do efeito; restart mantém limites e não inventa resposta do dono | Decisões D1–D4; RM-048, RM-057 e policies vigentes |
| N2 — Fila local e capacidade | Seleção determinística e execução de muitas threads em uma máquina, com slots de revisão e recursos pesados | Fixture com itens independentes, dependência bloqueada e fila vazia prova ordem, progresso possível e encerramento; disputa entre dois processos nunca ultrapassa slots nem escreve no mesmo artefato compilado | N1; RM-037, RM-040, RM-056 |
| N3 — Coordenação entre máquinas | Transporte de ordens/recibos, reservas exclusivas, slots compartilhados e serialização de integração | Ensaio com dois executores prova um vencedor por item, limite global por conta e um integrador por destino; queda, partição e retorno do executor antigo não duplicam escrita ou entrega; base alterada invalida candidato | N2; RM-047, RM-053, RM-054 |
| N4 — Supervisão e recuperação | Vigia independente, checkpoints, rodízio autorizado e reconciliação após falha | Injetar parada do condutor/watcher, limite semanal, reset desconhecido, falha de autenticação e resultado incerto do push; provar recuperação limitada ou isolamento, sem renovar envelope nem trocar identidade | N2; N3 para retomada remota; correção indicada no #117 e canários da RM-036 |
| N5 — Qualidade e entrega | Revisão independente, mutantes aplicáveis, verify e CI por SHA antes da integração | Provas negativas recusam revisor sem vínculo, SHA alterado, CI vermelho/ausente, segredo e mutante relevante sobrevivente; conflito de changelog após versão preserva entradas na seção correta; falhas de build concorrente continuam registradas | N2 e N3; [CI independente](../produto/FEAT-005-ci-check-independente.md) e [SHIP](../produto/FEAT-006-ship-com-push-provado.md) |
| N6 — Fechamento, relatório e piloto | Parada por hora/custo/fila, retomada e relatório no canal combinado | Relógio controlado prova prazo/fuso, teto com sessões em voo, ausência de recibo e reenvio sem duplicação; ensaios de 6 h e 12 h mostram continuidade, falhas injetadas, prova de cada entrega e correção explícita de alegação errada | N1 a N5; RM-048, RM-054 e canais habilitados |

**Piloto e expansão:** começar em uma máquina com repositório de teste e falhas injetadas; depois repetir entre duas máquinas. Expansão exigirá aceites N1–N6, revisão independente e métricas com origem. Violação de envelope, duplicação de efeito, perda de evidência ou teto excedido interromperá o piloto. Tempo de recuperação e cadência serão medidos antes de afirmar um SLA.

### Riscos

| Risco | Probabilidade / impacto | Mitigação e contingência |
| --- | --- | --- |
| Autonomia interpretada como autorização irrestrita | A validar / crítico | Envelope conferido em cada efeito, exclusões explícitas e lote sem aprovação implícita |
| Partição da rede ou dois condutores ativos | A validar / alto | Autoridade por geração, reservas e isolamento do executor antigo; sem prova, não transferir o item |
| Consumo atrasado ou disputa pela mesma conta em projetos diferentes | A validar / alto | Slots globais, reservas de gasto, margem e recusa de admissão quando não for possível garantir o teto |
| Supervisor com a mesma falha do runtime observado | A validar / alto | Vigia externo, canários de morte do watcher e parada limitada com checkpoint |
| Pressa por entrega reduzir revisão ou mascarar regressão | A validar / alto | Revisão vinculada, SHA exato, baseline, fila pesada e histórico de falhas preservado |
| Fila do dono crescer sem resolução ou relatório não chegar | A validar / médio | IDs estáveis, dependentes isolados, lote priorizado e recibos/reenvio limitado por canal |

### Não-objetivos

- Implementar ou habilitar #Noctum nesta etapa documental, nem alterar os modos existentes.
- Garantir trabalho útil sem fila elegível, capacidade, autenticação, orçamento ou dependências disponíveis.
- Criar uma rede de equipe, compartilhar credenciais ou transformar a descoberta da RM-053 em autorização remota.
- Publicar versões, criar tags/repositórios públicos, executar ações destrutivas ou alterar produção por autorização genérica.
- Remover policies, aceitar autoavaliação como revisão ou obter nota humana durante o arco.

### Decisões para o dono

**Domicílio único das propostas:** D1–D4 abaixo. Cada uma tem quatro alternativas e exatamente uma recomendada pelo agente; nenhuma está ratificada. As recomendações orientaram este planejamento, não concedem permissão para execução. Julio revisará antes de autorizar o primeiro piloto.

| ID / decisão | A | B | C | D | Recomendação e razão |
| --- | --- | --- | --- | --- | --- |
| D1 — Alcance da entrega automática | Só commits locais | Push e PR, sem merge | Push, PR e merge com todas as provas no SHA exato | Escolher previamente por repositório entre A, B e C | **C — Recomendada:** atende ao arco com entregas completas, limitado ao destino autorizado e aos gates; se o núcleo não puder provar, a ação fica bloqueada |
| D2 — Entrada do multimáquina | Primeira implementação só local | Piloto local, seguido de piloto em duas máquinas antes de ampliar | Várias máquinas já no primeiro piloto | Só preparar PRs nas máquinas; integração concentrada em uma | **B — Recomendada:** prova a recuperação local antes de adicionar partição, exclusão mútua e retomada remota; preserva multimáquina no escopo |
| D3 — Janela e supervisão | Arcos fixos de 6 h | Arcos fixos de 12 h | Janela escolhida entre 6 e 12 h, vigia externo a cada 5 min e prazo de avanço por fase | Janela entre 6 e 12 h, vigia externo a cada 30 min | **C — Recomendada:** permite o período desejado com detecção mais frequente que o despertador manual; 5 min é parâmetro proposto, sujeito a medição de custo e falso alarme |
| D4 — Regime de custo e rodízio | Um runtime/conta, com teto | Vários perfis autenticados e runtimes de assinatura, com teto de arco e subtetos | Admitir também provider pago explicitamente autorizado, com limite imposto pelo provider | Sem rodízio automático; limite de conta encerra o arco | **B — Recomendada:** usa a capacidade já autorizada e permite trocar runtime sem ampliar provider; exige informar valores, unidades, margens e contas antes de iniciar, sem teto padrão ilimitado |

Como mudar: registrar a escolha do dono por ingresso autenticado e atualizar esta seção e o contrato afetado, mantendo o histórico. Custo agora: revisão documental. Depois de N1–N6: migração do contrato, ajuste de admissões e repetição dos ensaios relacionados. Prioridade final, horário/canal e valores de teto também deverão ser preenchidos pelo dono antes do piloto.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`. Código e testes referem-se ao modo proposto, não à existência desta página. A thread `ork-rm058planeja` prepara somente o planejamento; nenhum ensaio Noctum ou entrega do modo é alegado aqui.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Refinamento | — | 2026-10-03 | Julio |
| Documentação | Em revisão | — | 2026-10-03 | Julio |
| Código | Não iniciado | — | 2026-10-03 | Julio |
| Testes | Não iniciados | — | 2026-10-03 | Julio |
| Deploy | Não implantado | — | 2026-10-03 | Julio |
| Exposição | Flag desligada | — | 2026-10-03 | Julio |
| Habilitação | Pendente | — | 2026-10-03 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: fábrica Orkastery na elaboração e nas futuras fatias; A: Julio; C: revisores independentes designados por fatia; I: dono pelo canal autorizado.
- **Agentes envolvidos, atuação e autonomia:** agente Codex redigiu a proposta em #Auto, restrita à documentação. Revisão independente e ratificação de produto não são presumidas; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** Julio revisará prioridade e D1–D4 antes de autorizar N1; a fábrica deverá converter os aceites em contratos e testes por fatia, sem data de lançamento definida.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-03 | Proposta em Refinamento, seis fatias e posição 5 sugerida | Pedido do dono para planejar #Noctum; relato de condução manual e dependências documentadas acima | Codex propõe; Julio decide produto e prioridade |
