---
id: RM-071
tipo: roadmap
titulo: Relatório da esteira do SDLC no status do roadmap
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-21T11:00:00-03:00
estado:
  ciclo: Discovery
  documentacao: Rascunho
  codigo: Branch criada
  testes: Não iniciados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: ork-relatoriosdl
  modo: "#Fast"
  fase: GO
  status: aberta
---

# RM-071: Relatório da esteira do SDLC no status do roadmap

> **Em uma frase:** quando o maestro pede o status do roadmap, o agente pergunta se ele quer o relatório padrão ou o relatório com a esteira do SDLC, com tokens, contas, tempo, testes, rodadas e bugs por fase, tudo medido no ledger e nos runtimes. Além do pedido, o relatório da esteira sai sozinho toda segunda-feira às 07h, no fuso e no canal do dono.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Branch criada | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Pedido do dono (21/10/2026):** uma opção de relatório de roadmap mais robusta que o padrão, que dê visibilidade ao SDLC: quanto token cada fase consome e de quais contas, os ciclos de teste, os tipos de teste de cada thread e item, bugs, correções e o tempo de cada fase.

**Decisão do dono de 21/10/2026 (alternativa a, mais a cadência):** "3.a (e além disso um report semanal toda segunda feira 7h da manhã.)". O relatório da esteira sai quando o dono pede (o agente pergunta "padrão ou esteira?") e também toda segunda-feira às 07h no fuso do dono, no canal dele, sem pedido. A fatia F6 abaixo entrega a segunda-feira, com o critério de aceite verificável.

## Problema e resultado

- **Público e problema/oportunidade:** o product builder (maestro humano) que conduz várias threads em paralelo. O relatório padrão do `ork roadmap status` ([RM-048](RM-048-hitl-humano-no-centro.md)) diz o que está pronto, em andamento e parado, e o que depende dele. Não diz **como a esteira está andando**: quanto a fábrica gasta, onde ela gira em círculo (rodadas de GO-FIX e de CHECK), o que foi realmente testado e em que fase o tempo vai embora. Sem isso, o dono decide prioridade, conta e modo às cegas.
- **Evidências e fonte:** o núcleo já grava a maior parte do material, espalhada. O ledger de cada thread tem `phase_dispatch`, `phase_result`, `verify_run`, `go_fix_opened`, `check_reverify`, `gate_blocked`, `ship_done` e `master_done`. O `ork ledger stats` ([RM-007](RM-007-telemetria-economica.md)) soma tokens, tempo de execução e espera humana. A medição do arco da [RM-058](RM-058-modo-noctum.md) (`noctum-medicao.ts`) lê minutos de sessão, tokens das transcrições do Claude Code e dos rollouts do Codex e o percentual da cota. O `ork fix list` e o `ork decisao placar` listam rodadas e decisões. Nenhum canal junta isso numa leitura só, e o status do roadmap não lê nada disso.
- **Lacuna medida (amostra local de ledgers, 21/10/2026):** dos 150 `phase_result` do `claude-bg` nenhum traz `tokens`; dos 126 do `codex`, 72 trazem `tokens` medido do rollout e 54 não. O relatório da esteira só pode ser honesto se mostrar essa lacuna como lacuna, e a F2 existe para fechá-la.
- **Objetivo/OKR:** o dono responde "como está a esteira?" com número medido, por item do roadmap e por thread, sem abrir ledger nem somar à mão.
- **Hipótese:** se o status do roadmap oferecer, por pergunta curta, um relatório da esteira montado só de fatos do ledger e dos runtimes, então o dono passa a ajustar conta, modo e prioridade com base em consumo e retrabalho reais, porque hoje o retrabalho (rodadas, bugs achados no CHECK, quedas de CI) e o consumo por fase só aparecem se ele for atrás.
- **Métrica principal / linha de base / meta / janela / fonte:** fração dos números do relatório da esteira com fonte medida (campo do ledger ou leitura do runtime), contra lacuna declarada. Linha de base: não medida (o relatório não existe); a lacuna de tokens do `claude-bg` acima é o ponto de partida. Meta: 100% dos números com fonte nomeada, nenhum estimado, e a lacuna de tokens do `claude-bg` fechada para as sessões cujo transcrito existe. Janela: o relatório de cada pedido. Fonte: o próprio relatório e a tabela abaixo.
- **Métricas de proteção:** o relatório padrão não muda (mesmo texto, mesmos grupos, mesmo custo); a montagem do relatório da esteira é leitura pura (não grava ledger nem abre pedido, e a leitura não toca a rede), e só o envio semanal usa o canal, pelo transporte do pulse; nenhum número estimado aparece como medido; nenhum dado privado (nome de máquina, de conta, caminho) sai do relatório; a pergunta e o envio semanal nunca param a fábrica; nenhum envio semanal duplicado.

## Escopo e validação

- **Incluído:**
  - **A pergunta.** Ao receber o pedido de status do roadmap, o agente pergunta no formato de alternativas da [RM-057](RM-057-hitl-por-alternativas.md), com resposta curta: (1) relatório padrão, (2) relatório com a esteira do SDLC, (3) só a esteira de um item ou de uma thread. Sem resposta, vale o padrão: a pergunta é de leitura e nunca bloqueia thread, pulse ou cron.
  - **O relatório da esteira**, por item do roadmap e por thread, com:
    - tokens e minutos de sessão por fase e por conta, no Claude e no Codex, e o percentual da cota onde o runtime a expõe;
    - rodadas de GO-FIX e de CHECK de cada thread, e o motivo de cada uma;
    - os tipos de teste de cada thread (unitário, integração, snapshot, mutante, ensaio, suíte inteira) e o resultado;
    - bugs achados pelo CHECK, por gravidade, e quantos foram corrigidos e reverificados;
    - tempo de cada fase e tempo de fila;
    - decisões autônomas e as que o dono revisou;
    - quedas de CI e a causa;
    - o que travou esperando o dono, e por quanto tempo.
  - **Lacuna como lacuna.** Dado que o núcleo ainda não mede aparece como `lacuna: <motivo>`, nunca como zero e nunca como estimativa.
  - **A entrega semanal.** Toda segunda-feira às 07h no fuso do dono, o `ork` envia o relatório da esteira ao canal do dono, sem pedido, pelo transporte determinístico do pulse (sem chamar modelo). Cobre os últimos sete dias e, havendo relatório anterior, a diferença para ele. Medida incompleta não cancela o envio: a lacuna aparece no corpo, como em qualquer relatório da esteira.
  - **Contrato** `ork.sdlc-report/v1`, o mesmo pelo CLI, pelo MCP e pelos canais, como o `ork.roadmap-status/v1`.
- **Fora de escopo:** custo em dinheiro (o `ork ledger stats` só tem tarifa de referência estimada, e o relatório não mostra estimativa); qualquer item que o `ork` não conduz; relatório de produto (uso do produto pelos clientes finais); mudar o relatório padrão; gráficos e painel web; benchmark entre contas ou entre pessoas.
- **Entregáveis e critérios de aceite:** por fatia, na seção abaixo. O critério do item é que cada número do relatório da esteira aponte para um campo do ledger ou para uma leitura de runtime, e que um teste reprove o relatório que mostre número sem fonte.
- **Piloto, medição e critérios de expansão/interrupção:** piloto na condução do próprio Orkastery, comparando o relatório de uma thread fechada com o que se soma à mão no ledger dela. Expande para os canais se os totais batem; interrompe se algum número do relatório não puder ser reproduzido pelo ledger ou pelo runtime. O envio semanal entra no piloto na primeira segunda-feira depois da F6, e o dono confere o recibo do canal.

### O dado, onde o núcleo já o tem e o que falta medir

| O dado | Onde o núcleo já o tem | O que falta medir |
| --- | --- | --- |
| Tokens por fase | `phase_result.tokens` (`input`, `cachedInput`, `output`, `total`, `fonte`) no `codex`, lido do rollout. `noctum-medicao.ts` lê o `message.usage` das transcrições do Claude Code, uma vez por `message.id`. `ork ledger stats` soma e declara a cobertura. | O `phase_result` do `claude-bg` não grava `tokens` (0 de 150 na amostra local). A leitura da transcrição hoje é por arco, não por fase. Falta a agregação por fase e por conta. |
| Minutos de sessão por fase e conta | `phase_dispatch` (com `runtime`, `model`, `effort`) até o primeiro `phase_result` da sessão; `phase_result.duracaoMs`; `perfil` no despacho. `noctum-medicao.ts` arredonda para cima por sessão. | Agregação por fase e por conta; sessão em voo sai parcial; despacho sem `perfil` fica sem conta. |
| Percentual da cota | `rate_limits` do rollout do `codex` e o evento `runtime_quota_detected`. | O Claude Code só mostra a cota dentro da sessão: para `claude-bg` é sempre lacuna. O valor do `codex` é teto superior (inclui outros projetos na janela). |
| Rodadas de GO-FIX e o motivo | `go_fix_opened` (`rodada`, `motivos`, `correcoes`, `temTipoB`), `ork fix list`. | O motivo é tipado por gate, mas a causa raiz em linguagem do dono não é campo. |
| Rodadas de CHECK | `check_reverify` (`rodada`, `cobertura`, `veredito`); `phase_result` do CHECK (`veredito`, `eixos`). | A contagem de CHECKs por thread não é um campo único: junta o `phase_result` do CHECK e os `check_reverify`. |
| Tipos de teste e resultado | `verify_run.comandos` (nome, `ok`, `code`), `baseline`, `regressoes`; `phase_result` do CHECK (`testes`: base e head, `afrouxamento`); as claims da thread, e os mutantes quando registrados como claim. | O **tipo** do teste (unitário, integração, snapshot, mutante, ensaio, suíte inteira) não é campo: hoje sai do nome do comando ou do texto da claim. Falta uma taxonomia tipada na claim e no manifesto. |
| Bugs achados pelo CHECK, por gravidade | `phase_result.achados` (`total`, `bloqueador`, `aviso`, `sugestao`, `tipoA`, `tipoB`). | O achado não tem id estável: ligar "achado" a "correção" e a "reverificado" hoje é por rodada, não por achado. |
| Bugs corrigidos | `go_fix_opened.correcoes` e o `veredito` do `check_reverify`. | Vínculo achado, correção e prova por id. |
| Tempo de cada fase | `phase_dispatch` (instante) e `phase_result` (`duracaoMs`, `duracaoFonte`). | Fase que mudou de sessão no meio (rotação, retry) soma sessões; falta regra única de soma. |
| Tempo de fila | `lease_queued`, `lease_dequeued`, `slot_refused`, `rate_limit_queued`, `rate_limit_resumed`. | A fila de recurso pesado (`ork.fila-pesada/v1`) não grava a espera no ledger. |
| Decisões autônomas e revistas | `autonomous_decision`, `ork decisao placar` (decididas, informadas, perguntas, revertidas) e a taxa de reversão. | Decisão que o dono revisou sem reverter não é campo distinto. |
| Quedas de CI e causa | `verify_run.motivos` e `gate_blocked.motivo`/`detalhe` (verify local e bundle). | A queda do CI **remoto** (runner, job, causa) não vai ao ledger: precisa de leitura da forja e de tipo de causa (código, instabilidade, infraestrutura). |
| O que travou esperando o dono | `human_gate`, `gate_blocked`, `hitl-tempo-parado.ts` (campo `hitlDeConducao`, mediana contra a meta de 5 min da RM-057), `esperaHumana` do `ork ledger stats`. | Espera por impedimento do dono que não passou por pedido tipado. |
| Consumo por conta | `ork accounts` e o perfil no despacho; `noctum-medicao.ts` por conta. | Nome da conta é dado privado: o relatório usa rótulo genérico (`conta A`, `conta B`) e o mapa fica fora do relatório. |
| Custo em dinheiro | `custoReferencia` do `ork ledger stats`, natureza `estimated_reference`. | Fora de escopo: é estimativa, e o relatório só mostra medido. |

## Fatias propostas

Cada fatia é um PR com teste hermético e uma linha no `CHANGELOG.md`. Nenhuma começa antes da decisão do dono registrada em "Plano e decisões".

| Fatia | Entrega | Critério de aceite verificável |
| --- | --- | --- |
| F1 | A pergunta "padrão ou esteira" e o relatório da esteira no terminal, montado só do que o ledger já grava (fases, minutos, rodadas de GO-FIX e de CHECK, achados por gravidade, decisões, espera do dono). | Teste que, dado um ledger de fixture, reproduz cada número do relatório e reprova o relatório com número sem fonte; teste que prova que sem resposta vale o padrão e que o relatório padrão sai idêntico ao de hoje. |
| F2 | Tokens, minutos e cota por fase e por conta, com a leitura das transcrições do Claude Code e dos rollouts do Codex reaproveitando a medição da RM-058 e gravando no `phase_result` do `claude-bg`. | Teste com transcrição e rollout de fixture: totais batem com a soma do `message.usage` por `message.id` e com o `total_tokens` do rollout; sessão sem transcrição vira `lacuna` com motivo, nunca zero; rótulo de conta genérico. |
| F3 | Tipos de teste e ciclos de CHECK por thread: taxonomia tipada na claim e no manifesto, id estável de achado, vínculo achado, correção e reverificação. | Teste que, dada uma thread com 2 rodadas de CHECK e 1 de GO-FIX, lista os tipos de teste rodados, os achados por gravidade e o fechamento de cada um; `ork claims` aceita o tipo e rejeita tipo fora da taxonomia. |
| F4 | O mesmo relatório nos canais (Telegram e OpenClaw) em páginas curtas, pelo mesmo contrato `ork.sdlc-report/v1`. | Teste de contrato que prova que os três canais transportam o mesmo texto e os mesmos números do CLI, e que a página respeita o limite de tamanho do canal sem cortar número no meio. |
| F5 | Tendência entre relatórios: a diferença para o relatório anterior (consumo, rodadas, tempo por fase). | Teste com dois retratos de fixture: a variação sai com o sinal certo; sem retrato anterior o relatório diz "sem comparação" e não inventa linha de base. |
| F6 | A entrega semanal: toda segunda-feira às 07h no fuso do dono, o relatório da esteira vai ao canal do dono sem pedido, pelo transporte determinístico do pulse. Usa o que F1 a F5 já medem; o que ainda não medem sai como lacuna. | Teste com relógio injetado e fuso configurado: segunda-feira às 07h00 gera exatamente um envio e o recibo do canal vai ao ledger; outro dia ou outra hora não envia; reinício do pulse na mesma semana não duplica o envio (chave da semana). Medida incompleta (por exemplo, tokens do `claude-bg` sem transcrito): o relatório sai no horário com `lacuna: <motivo>` no corpo e nunca com zero ou estimativa. Falha total de leitura: sai uma mensagem curta dizendo que o relatório não pôde ser montado e por quê, nunca silêncio. Falha do canal: sem recibo, o ledger registra o envio como não entregue e a janela seguinte do pulse tenta de novo sem duplicar. O envio não bloqueia thread, pulse nem cron. O corpo passa pelo mesmo filtro de dado privado dos outros canais |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** pedido direto do dono, sem pontuação RICE; 21/10/2026.
- **Horizonte / alvo / previsão / confiança / marcos:** F1 a F6 em ordem; a F6 depende de F1 e do contrato de canal de F4, e usa F2 e F5 quando já estiverem prontas. Sem previsão de entrega: o item está em Discovery e nada de código foi iniciado.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-048](RM-048-hitl-humano-no-centro.md) (formato único do status), [RM-057](RM-057-hitl-por-alternativas.md) (a pergunta por alternativas), [RM-007](RM-007-telemetria-economica.md) (telemetria do ledger), [RM-058](RM-058-modo-noctum.md) (medição de consumo; a F2 reaproveita a leitura, sem depender de o modo existir), [RM-037](RM-037-verify-rapido-e-confiavel.md) (verify, baseline e suíte, de onde vêm os tipos de teste), [RM-062](RM-062-repositorio-publico-sem-dado-privado.md) (o que não pode sair do relatório). Nenhum bloqueio aberto.
- **Premissas / riscos / mitigação:**
  - Risco: ler transcrições grandes é caro. Mitigação: leitura incremental por sessão com cache do total já lido, e prazo por relatório; passando o prazo, o número sai como `lacuna: leitura parcial`, nunca truncado em silêncio.
  - Risco: dado privado no relatório (nome de máquina, de conta, caminho). Mitigação: rótulos genéricos, caminhos relativos ao projeto, e o relatório passa pelo mesmo filtro da [RM-062](RM-062-repositorio-publico-sem-dado-privado.md) antes de sair por qualquer canal; um teste procura nome de conta, de máquina e caminho absoluto na saída.
  - Risco: o relatório parecer mais exato do que é. Mitigação: cada número leva a fonte e a cobertura (medidas contra sem medida), e a lacuna aparece no corpo, não em nota de rodapé.
  - Risco: o envio semanal falhar em silêncio ou chegar duplicado. Mitigação: um envio por semana, com chave da semana no ledger, recibo do canal gravado e nova tentativa na janela seguinte do pulse sem duplicar; falha sem recibo aparece no ledger, nunca vira "enviado".
  - Risco: a pergunta virar atrito a cada status. Mitigação: resposta curta de uma palavra, padrão sem resposta, e a decisão do dono abaixo diz com que frequência perguntar.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  - **Decisão do dono de 21/10/2026: como o relatório da esteira chega.** Escolheu a alternativa 1 (só quando pedido) e acrescentou: "3.a (e além disso um report semanal toda segunda feira 7h da manhã.)". Resultado: o status padrão segue padrão, o agente pergunta no pedido de status, e o relatório da esteira também sai toda segunda-feira às 07h, sem pedido (F6). A alternativa 3 original dependia de F2 e F5 prontas; a decisão do dono não impõe essa espera, e a F6 envia com a lacuna declarada (registrado no ledger como decisão desta thread). Alternativas como foram propostas:
    1. **Só quando pedido (escolhida, com a cadência semanal do dono por cima).** O status padrão segue padrão; o agente pergunta no pedido de status e o relatório da esteira só sai quando o dono escolhe. Custo mínimo (nenhuma leitura de transcrição sem pedido), nenhuma mudança no que ele já recebe e a lacuna de tokens fica visível só para quem pediu.
    2. **Por padrão.** Todo status de roadmap já traz a esteira. Dá visibilidade sempre, mas aumenta o custo de cada status (leitura de transcrições) e o tamanho da mensagem nos canais curtos, e esconde o relatório padrão que o dono aprovou.
    3. **Numa cadência (o dono pediu a semanal, por cima da alternativa 1).** Além da pergunta, o `ork pulse` envia a esteira em dia fixo (por exemplo, semanal). Cria o hábito e dá tendência (F5), mas depende de F2 e F5 prontas e de o dono querer receber sem pedir.
  - Registrada por esta thread, sem pergunta ao dono: a pergunta usa o formato de alternativas da RM-057 e, sem resposta, vale o padrão (a leitura não é gate); o relatório só mostra número medido; a lacuna é parte do relatório.

## Estado com evidências

O item está em Discovery: só esta página existe. Não há código, teste nem PR de implementação.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-10-21 | Julio |
| Documentação | Rascunho | — | 2026-10-21 | Julio |
| Código | Branch criada | — | 2026-10-21 | Julio |
| Testes | Não iniciados | — | 2026-10-21 | Julio |
| Deploy | Não implantado | — | 2026-10-21 | Julio |
| Exposição | Flag desligada | — | 2026-10-21 | Julio |
| Habilitação | Pendente | — | 2026-10-21 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: agente de condução do Orkastery; A: Julio; C: nenhum; I: nenhum.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** agente de código na redação desta página, em `#Fast`; revisor humano: Julio, no PR.
- **Próxima ação, responsável e prazo:** Julio decide a posição do item no índice de prioridade; a decisão de como o relatório chega está tomada (21/10/2026); sem prazo.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-21 | Item criado em Discovery | Pedido do dono de uma opção de relatório de roadmap com a esteira do SDLC; thread `ork-relatoriosdl` | Julio |
| 2026-10-21 | Decisão registrada: relatório da esteira sob pedido (alternativa 1) mais o envio semanal toda segunda-feira às 07h no fuso e no canal do dono; entra a fatia F6 com critério de aceite verificável | Resposta do dono no terminal ao resumo das 07h: "3.a (e além disso um report semanal toda segunda feira 7h da manhã.)". O item segue em Discovery; thread `ork-decisoes0700` | Julio |
