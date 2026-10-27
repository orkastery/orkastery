---
id: RM-059
tipo: roadmap
titulo: "Condução dentro do Claude Code: dez mods para ver, decidir, destravar, entregar e pontuar sem sair do terminal"
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-27T00:50:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Não iniciados
  deploy: Produção
  exposicao: Parcial
  habilitacao: Em andamento
evidencias:
  codigo:
    commit: "8087442"
    pr: null
  deploy:
    release: v0.6.0 (Mensageiro de Sessões e Ritual do MASTER), @orkastery/cli no npm
sdlc:
  thread: ork-rm059erm060p
  modo: "#Fast"
  fase: GO
  status: fechada
---

# RM-059: Condução dentro do Claude Code

> **Em uma frase:** levar a condução da fábrica para dentro da sessão do Claude Code em que o product builder já trabalha, com dez mods, para ver, decidir, destravar, entregar e pontuar sem sair do terminal.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Não iniciados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

**Item recém-aberto.** A fundação (onda 0) começa agora, em paralelo com o resto do roadmap. Nenhum dos dez mods existe ainda; a tabela e as ondas abaixo são o escopo planejado, não entrega. A fonte é o plano pesquisado da thread `ork-modsorquestr`, que só planejou e não implementou nada.

Mod é um plugin de *function hooks* do Claude Code 2.1.287 ou mais novo: handlers JS/TS que rodam dentro do cliente, reagem a eventos da sessão e desenham painéis, faixas e avisos.

## Problema e resultado

- **Público e problema:** product builder que conduz a fábrica de uma sessão do Claude Code, mas depende do Telegram para decidir, de um cron externo para disparar a fase seguinte e de vários comandos soltos para entregar e dar a nota do MASTER. Cada volta ao celular ou ao terminal de outra thread custa contexto.
- **Evidências e fonte:** plano da thread `ork-modsorquestr`, que mediu o ledger das threads existentes até um corte de data fixo. Os sintomas medidos são: pedidos HITL sem resposta registrada, espera entre fases #Auto, bloqueios tipados sem reação, MASTER fechado por omissão, entregas que demoram do CHECK ao `ship_done` e claims que quebram sem o GO perceber. Os números dependem dos dados daquela instalação e daquele corte; esta página não os repete (ver [Como medir](#como-medir)).
- **Resultado:** o dono vê a fábrica, decide, destrava, entrega e pontua dentro do terminal em que já trabalha. O Telegram continua como canal e não repete o que o dono já viu no terminal. Os quatro canais homologados seguem os mesmos: Telegram (Hermes), OpenClaw, Claude Code e Codex.
- **Hipótese:** se a sessão do dono mostrar a fábrica inteira, trouxer cada decisão com a recomendação na frente e disparar a fase seguinte na hora, então a espera humana e o retrabalho caem, porque o núcleo continua sendo a única fonte de estado e de prova e os mods apenas o desenham e encaminham.
- **Métrica principal:** reação a bloqueio tipado e espera entre fases #Auto, medidas pelo ledger antes e depois. Linha de base e metas por mod ficam no plano da thread `ork-modsorquestr` e são recalculadas na thread de cada mod, com corte móvel.
- **Métricas de proteção:** nenhum mod aprova gate, permissão, nota do MASTER, push ou tag pelo dono; nenhuma claim, verify ou policy muda de semântica; nada no núcleo passa a depender de mod.

## Escopo e validação

**Incluído:** os dez mods abaixo, a fundação que eles compartilham e os contratos novos que o núcleo precisa oferecer a eles. Os dez entram no escopo de uma vez; a sequência só respeita dependência.

**Fora de escopo:** fork ou patch do Claude Code; troca do Telegram; mudança na semântica de gates, policies, claims e verify; adaptadores do Codex, OpenClaw e Hermes, exceto a convivência com o condutor; qualquer mod que aprove gate, dê nota ou responda permissão em nome do dono.

### Os dez mods, na ordem do índice de impacto

A ordem é a do índice do plano (alcance × impacto × confiança). O esforço não entra na ordem; só define a sequência das fatias dentro de cada onda. P é uma tarefa, M duas ou três, G quatro ou mais ou qualquer tarefa no núcleo.

| # | Mod | O que muda para o dono | Evento principal | Esforço |
| --- | --- | --- | --- | --- |
| 1 | Freio de Lote (`ork-freio`) | O GO para de quebrar claims sem perceber | `classic.PostToolBatch` | M |
| 2 | Sentinela do Condutor (`ork-sentinela`) | Uma fase termina e a seguinte começa na hora; o que parou vira aviso com o comando | `classic.FileChanged` | G |
| 3 | Torre de Controle (`ork-torre`) | A fábrica inteira num painel, com o próximo passo de cada thread | `ui.render` (`Pane`) | M |
| 4 | Mesa do Dono (`ork-mesa`) | Tudo que espera você, com a recomendação na frente e a decisão em dois toques | `ui.press` | M |
| 5 | Portão de Tarefas (`ork-portao`) | O GO vira um quadro de tarefas em paralelo, e tarefa só fecha com o verify verde | `classic.TaskCompleted` | G |
| 6 | Clima de Cota (`ork-clima`) | A previsão de quando a cota acaba, antes de a fase morrer no meio | `turn.complete` | M |
| 7 | Pista de Entrega (`ork-pista`) | Do CHECK verde ao merge, cada passo tem um botão e uma prova | `ui.render` (`Pane`) | G |
| 8 | Ritual do MASTER (`ork-ritual`) | Ver a prova e dar a nota de 0 a 5 sem sair do terminal | `ui.press` | G |
| 9 | Mensageiro de Sessões (`ork-mensageiro`) | A resposta do dono chega à sessão de fase travada sem perder o contexto | `session.receive` | G |
| 10 | Radar de Colisão (`ork-radar`) | O conflito com a `main`, ou entre threads, aparece antes do SHIP | `command.run` | M |

### Ondas

- **Onda 0, fundação:** a ponte `ork-ponte` (namespace `$.ork` e leitura do núcleo), o papel da sessão (`dono`, `fase` ou `dormente`), as guardas de autoridade (varredura estática e recusa em tempo de execução), a distribuição dos mods para a sessão de fase, o marketplace pelo gerador, o CI com o canário de eventos, a conferência pontual de claims no sandbox do verify e o pedido guardado na criação da thread. Começa pela prova de que um mod carrega numa sessão `claude --bg`.
- **Onda 1:** Torre de Controle, Freio de Lote, Radar de Colisão e Clima de Cota.
- **Onda 2:** Mesa do Dono e Sentinela do Condutor.
- **Onda 3:** Pista de Entrega, Ritual do MASTER, Mensageiro de Sessões e Portão de Tarefas.

O Freio só começa depois da prova da onda 0 e da conferência pontual de claims. A Sentinela também espera a decisão sobre o papel do cron. Cada mod da onda 3 espera a decisão do dono que o libera.

### Regras que valem para todos os mods

- **Nenhum mod responde pelo dono:** não há hook em `classic.Elicitation`, `classic.ElicitationResult` ou `classic.PermissionRequest`, nem `tool.check` que devolva `allow`, nem texto enviado como se fosse do dono, nem argv de `gate answer`, nota do `ork master`, `ship --autorizar-push`, `git push` ou `gh`. A resposta humana passa pelo diálogo nativo do host (`ork_request_decision`) ou pelo Telegram assinado.
- **Dados só pelo núcleo:** a leitura vai pelas ferramentas MCP do servidor `orkastery` e pelos comandos `ork ... --json` de leitura. O estado em `.orkastery/` só muda pelo `ork`.
- **Ação com efeito só pelo `ork`:** despacho, sincronização, publicação e registro de PR acontecem por comando ou ferramenta do núcleo, e publicação só no modo que já autoriza push.
- **Claim e verify só no sandbox do núcleo:** nenhum mod roda comando de claim por conta própria.
- **Papel da sessão:** o mod só liga os hooks do papel da sessão e fica dormente sem `orkastery.yaml` na raiz.

### Validação

Cada mod passa por `claude plugin validate --strict`, `claude plugin test` e pelo `node core/scripts/checar-mods.cjs <mod>` no CI. Este item, em sua etapa documental, valida com `node core/dist/index.js docs verificar` e markdownlint; isso confere a documentação, não os mods.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** ordem dos mods pelo índice de impacto do plano; a posição deste item entre os demais é decisão do dono. Sem pontuação numérica inventada nesta página.
- **Horizonte / alvo / previsão / confiança / marcos:** a onda 0 começa agora, em paralelo. Sem previsão de entrega; a confiança de cada mod sobe com a prova da onda 0, e os marcos são as quatro ondas.
- **Dependências e bloqueios:** [RM-057](RM-057-hitl-por-alternativas.md) e [RM-055](RM-055-impedimento-do-dono-vira-hitl.md) (pedidos que a Mesa mostra), [RM-040](RM-040-estado-de-conta-compartilhado.md) (contas do Clima), [RM-036](RM-036-maestro-multicanal.md) (condução e retrato do Maestro) e [RM-048](RM-048-hitl-humano-no-centro.md). Bloqueio conhecido: nenhuma fonte confirma ainda mod carregado em sessão `--bg`; a prova da onda 0 decide o plano B do Freio.
- **Premissas:** a API de mods está em acesso antecipado; o cliente mínimo é o 2.1.287; mods rodam com as permissões do usuário, na mesma fronteira de confiança do cliente.

### Decisões do dono (11/10/2026)

- **M1:** a proposta vira este item de roadmap.
- **M2:** começa já, em paralelo com o resto do roadmap.
- **M3:** os dez mods entram de uma vez no escopo.
- **M4:** o mod pode decidir pelo dono quando a decisão é óbvia, pelo teste das quatro condições: critério já escrito; alternativas estritamente piores por esse critério; reversível antes da entrega; erro barato e detectável. A decisão é registrada como decisão autônoma no ledger, com critério e evidência, e chega ao dono no lote seguinte com o custo de reverter. Fora disso, o mod nunca aprova gate, permissão, nota do MASTER, push ou tag pelo dono: decisão irreversível, que gasta dinheiro ou muda escopo continua sendo pergunta.
- **M5:** o Telegram continua, sem repetir o que o dono já viu no terminal.

### Decisões pela recomendada do plano (o dono pode reverter)

- **Nota do MASTER:** pelo diálogo nativo do host, com ferramenta nova do núcleo que recebe só o `threadId`.
- **Resposta de sessão por mod:** a entrega pelo Mensageiro só depois da prova da onda 0 sobre o modo de permissão das sessões de fase.
- **Publicação de branch e PR:** por um comando do núcleo, `ork ship publicar`, no lugar do push cru do script do condutor, só no modo que já autoriza push.
- **Cron do condutor:** cede quando a Sentinela conduz e fica como reserva nas horas sem sessão do dono.
- **Instalação e distribuição:** escopo de projeto e marketplace próprio até a onda 2.
- **Agent teams no GO:** só em piloto, com teto de teammates e de custo.
- **Contestação de decisão autônoma pela Mesa:** depois da onda 2, com a métrica da Mesa medida.

Como mudar: registrar outra decisão que reverta a anterior, no ledger da thread do mod afetado, e atualizar esta seção. Custo agora: revisão documental. Custo depois: refazer a fatia do mod afetado e repetir a prova dele.

### Riscos

| Risco | Mitigação e contingência |
| --- | --- |
| API de mods em acesso antecipado: pode mudar entre versões | Versão mínima por mod; `claude plugin validate` e `claude plugin test` no CI; canário que procura no binário instalado cada evento usado e reprova se um sumir |
| Mods não têm sandbox e rodam como o usuário | Guarda estática (melhor esforço) e recusa em tempo de execução na `ork-ponte`; nenhum mod guarda credencial nem fala pelo dono |
| Dois condutores despachando a mesma fase (Sentinela e cron) | Todo despacho passa pelo núcleo, que é idempotente e recusa com `conducao.em-andamento`; lease de condução; a Sentinela nunca usa `ork conducao assumir`; o cron cede |
| Mods desligados de fora (3 quedas do worker, desligamento remoto ou política da organização) | Nada no núcleo depende de mod; o Telegram e o cron continuam como reserva; se uma fatia tornar um mod obrigatório para conduzir, ela é recusada |
| Mod carregando onde não deve (escopo de usuário carrega em todo repositório) | Papel da sessão por `ORK_DISPATCH_ID` e por `orkastery.yaml`; sem eles, o mod fica dormente |
| Custo de polling do CLI | Reler só quando o `stat` do ledger muda, com cache; leitura por MCP no lugar de processo novo |

### Não-objetivos

- Substituir o Telegram, o OpenClaw ou o Codex como canais.
- Aprovar gate, permissão, nota, push ou tag em nome do dono.
- Tornar a condução dependente de mod.

### Como medir

Cada meta do plano é medida pelo ledger de cada thread (`.orkastery/threads/<thread>/ledger.jsonl`), antes e depois de o mod ligar, com corte de data móvel e por máquina. O código de medida só lê ledger e POSTMORTEM; cada fatia grava a função da sua métrica na thread do próprio mod, antes do GO. Não entra telemetria nova fora do ledger. As métricas, por mod:

| Mod | Métrica (nome) |
| --- | --- |
| Freio de Lote | bloqueios `claims.failed` e `verify.regression` por thread com GO |
| Sentinela do Condutor | espera entre o fim de uma fase e o despacho da seguinte, nas threads #Auto, e reação a bloqueio tipado |
| Torre de Controle | reação a bloqueio tipado com a sessão do dono aberta |
| Mesa do Dono | pedidos HITL sem resposta registrada no prazo e tempo até a resposta |
| Portão de Tarefas | duração do GO em planos com tarefas independentes e `claims.failed` por thread |
| Clima de Cota | bloqueios `runtime.quota-exhausted` por thread despachada |
| Pista de Entrega | tempo do CHECK concluído até `ship_done` |
| Ritual do MASTER | fração de fechamentos por omissão, sem nota humana |
| Mensageiro de Sessões | respostas com alvo `session` entregues com recibo (`session_answered`) |
| Radar de Colisão | bloqueios `tree.blocked` descobertos pela primeira vez no CHECK ou depois |

Para uma primeira aproximação da linha de base de uma thread, conte as linhas do `ledger.jsonl` dela que citam o código do bloqueio, por exemplo `grep -c 'claims.failed' .orkastery/threads/<thread>/ledger.jsonl`; a medida por evento, com mediana e p90, é a função gravada na thread de cada mod. Os valores iniciais do plano valem para o corte em que foram medidos e não são metas desta página.

## Estado com evidências

- Em produção na versão 0.6.0 (tag `v0.6.0` e `@orkastery/cli` 0.6.0 no npm, publicado em 27/10/2026): o Mensageiro de Sessões (onda 3, PR #159) e o Ritual do MASTER com a nota pelo diálogo nativo (F8, PR #160); os mods das ondas anteriores já estavam no código da `v0.5.6`. O resto dos dez mods segue.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-27 | Julio |
| Documentação | Em revisão | — | 2026-10-27 | Julio |
| Código | Mesclado | commit `8087442` | 2026-10-27 | Julio |
| Testes | Não iniciados | — | 2026-10-27 | Julio |
| Deploy | Produção | release: v0.6.0 (Mensageiro de Sessões e Ritual do MASTER), @orkastery/cli no npm | 2026-10-27 | Julio |
| Exposição | Parcial | — | 2026-10-27 | Julio |
| Habilitação | Em andamento | — | 2026-10-27 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: fábrica Orkastery, uma thread por fatia; A: Julio; C: revisores independentes designados por fatia; I: dono pelo canal autorizado.
- **Agentes envolvidos, atuação e autonomia:** o plano foi pesquisado pela thread `ork-modsorquestr` em #Auto, só documentação. Esta página foi aberta pela thread `ork-rm059erm060p` em #Fast, só documentação. Revisor humano: Julio.
- **Próxima ação, responsável e prazo:** abrir a thread da onda 0, começando pela prova de mod em sessão `claude --bg`; responsável: fábrica, com revisão independente; sem data definida.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-11 | Proposta vira item de roadmap; começa já, com os dez mods no escopo | Decisões M1 a M5 do dono sobre o plano da thread `ork-modsorquestr` | Julio |
| 2026-10-12 | Página aberta em Em desenvolvimento, código Em andamento | Thread `ork-rm059erm060p` | Fábrica propõe; Julio decide |
| 2026-10-27 | Em produção na 0.6.0, com o Mensageiro de Sessões e o Ritual do MASTER; exposição Parcial e habilitação Em andamento, porque o resto dos mods segue | Tag `v0.6.0`, com os merges `d9c5ca6c` (#159) e `22fbf9bf` (#160) na tag; seção 0.6.0 do CHANGELOG, de 26/10/2026 | thread `ork-docsda060emp` (#Fast), pelo pedido do dono |
