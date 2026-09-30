---
name: orkastery-bootstrap
description: "Reconhece a frase exata orkastery maestro e conduz pedidos e retomadas do Maestro/Builder: consulta o panorama pelo ork e apresenta progresso, decisoes e entrega na conversa. Em sessao de fase ja despachada, retome essa fase sem abrir outra orquestracao."
bucket: core
roteia: "ork modos | ork thread new | ork thread status | ork phase list | ork pulse"
license: MIT
---

# Orkastery Bootstrap

## Papel na conversa

Um roteador fino para a conversa. A metodologia executavel mora no nucleo `ork`.

O dono traz objetivos e decisoes; o agente opera o `ork` e conduz o proximo passo autorizado.
Uma resposta com uma lista de comandos para o dono executar nao conclui um pedido de trabalho.
A metodologia, os modos, os gates e a verificacao continuam no nucleo. Esta skill traduz intencao e apresenta resultados; Adaptador que implementa a demanda no host quebra essa separacao.

Distinga o contexto antes de agir:

- **Sessao condutora:** recebe o pedido do dono, identifica ou abre a thread, despacha pelo `ork` e acompanha o resultado; nunca escreve codigo de produto no lugar da sessao despachada.
- **Sessao de fase ja despachada:** recebeu thread, fase, prompt e worktree do `ork`.
  Trabalhe nesse escopo pela skill da fase. Nao abra outra thread nem redespache a propria fase para fazer o trabalho que ja lhe foi atribuido.

## Comecar ou retomar

Quando a mensagem for **`orkastery maestro`**, em sessão limpa, descubra `ork_maestro`
no namespace real do host e consulte o projeto fixado pela instalação. O equivalente
de leitura no terminal é `ork maestro --json`; a frase conversacional não é um comando shell.
A consulta não cria demanda, thread, sessão ou aprovação. Projeto ausente retorna
`maestro.project.missing`; ambíguo retorna `maestro.project.ambiguous`: apresente os
candidatos permitidos e obtenha a seleção, sem varrer home nem escolher o primeiro.
Se já recebeu fase/thread/WT, continue esse bloco; a frase não abre outra orquestração. O projeto de cada consulta é explícito (RM-052): se o dono nomeou um, passe-o (`projeto` na ferramenta, `--projeto <nome>` no CLI) e leia "Projeto consultado" e "Não lido" antes de responder: board e panorama não leem o roadmap, e zero threads nunca é roadmap vazio.

Apresente o panorama com fontes, lacunas e próximas ações: demandas, threads, sessões,
impedimentos, leases, retries, HITL, SHIP e MASTER. Vazio difere de indisponível;
estado nativo desconhecido não prova sessão encerrada. Respeite `coverage.nextOffset`
para detalhes omitidos. Snapshot é leitura, não autorização; uma ação usa a operação
tipada existente, revalida precondições e tem readback. Conflito/stale exige nova leitura.

**Prioridade máxima: usabilidade HITL.** Na própria conversa, apresente tópicos curtos,
uma recomendação fundamentada e opções com rótulos claros. Mantenha UUIDs internos e
preserve resposta literal, texto livre e cancelamento. Só ofereça canal comprovadamente
disponível para aquele pedido/conexão. Telegram é opcional; falta de ingresso nativo
no canal escolhido é uma pendência explícita, sem fingir aprovação nem impor migração.
Mesma-harness exige sessões independentes comprovadas; o executor não revisa a si mesmo.

Use o manifesto, o pedido e o estado da thread. Se o dono informou thread/roadmap, retome esse trabalho; so pergunte qual thread quando a ambiguidade impedir uma escolha segura.
Nao repita onboarding, decisoes ou tarefas que ja estejam registrados.

Prefira MCP no projeto fixado pelo servidor, sem outro root/cwd. No Claude com servidor `orkastery`, use nomes completos expostos, como `mcp__orkastery__ork_thread_status`; em `ToolSearch`, selecione esse nome completo, nunca `select:ork_thread_status`. Em outros hosts, siga o namespace realmente descoberto.

| Acao | Ferramenta MCP | CLI quando a ferramenta nao esta disponivel |
|---|---|---|
| Estado/documentos/claims | `ork_thread_status`, `ork_phase_list`, `ork_artifact_read/write`, `ork_claims_list`, `ork_claim_add` | `ork thread status <thread>`, `ork phase list <thread>`, `ork claims` |
| Demanda nova | `ork_thread_new(nome, modo)` | `ork thread new "<nome>" --mode <modo> --worktree auto` |
| Despacho | `ork_phase_run(threadId, fase, prompt, runtime?, model?, effort?, dryRun?)` | `ork phase run <thread> GOAL --prompt "<pedido>"` |
| Progresso nativo | `ork_observe(threadId)` | `ork thread status <thread>` |
| Pendencia/decisao | `ork_hitl_pending`, `ork_request_decision(threadId, pedidoId)` | Consulte o ingresso suportado; nao fabrique resposta. |

Prefira `ork_git_commit` (HEAD atual, paths com claims), `ork_verify` e `ork_ship` (HEADs fonte/destino reais) para registrar, verificar e entregar. Autoria/commit nao e SHIP; retorno incomplete exige reconciliacao antes de repetir. Para demandas novas, use `ork modos --do-pedido "<pedido do dono>"` e `ork_preflight({modo})` (CLI: `ork doctor --modo <modo>`). A sonda por bloco não comprova autenticação, gates ou entrega.
Sem MCP e com mutacao em `.git` negada pelo sandbox, informe instalacao pendente do transporte nativo; nao repita o comando negado nem amplie o sandbox.

O modo de uma thread existente e o registrado nela. Preserve autorizacoes no escopo em que valem; nao solicite confirmacao rotineira para cada tarefa. Numa demanda nova, o nucleo resolve a #TAG, `conduction.default_mode` e `allowed_modes`. Nao refaca esse parse no host. Um bloqueio real do preflight impede o despacho dependente e deve ser explicado.

Antes do primeiro despacho, consulte `ork setup <modo>` e o bloco da fase: preserve seu runtime/modelo/esforco. O host da conversa nao impoe o runtime das fases.
Se o dono pediu outro runtime, use `--runtime R --model M --effort E` com trio coerente ja autorizado; nunca herde modelo de outro runtime nem altere defaults do projeto para um override pontual.
Se faltar escolha de modelo para esse runtime, obtenha apenas essa informacao. Edite `ork setup <modo> --bloco N` somente quando houver intencao de mudar a configuracao persistente.
Confira o trio/comando com `ork phase run ... --dry-run` no primeiro despacho ou apos mudanca relevante de configuracao; nao repita esse ensaio a cada status ou etapa sem mudanca.
Dry-run nao inicia modelo, mas pode gravar prompt/eventos. Confira o trio efetivo no resultado/ledger; doctor nao comprova modelo. O perfil filho `worktree` exige opt-in na instalacao: preserve o configurado, sem habilita-lo por toolargs nem para contornar bloqueio.

## Conducao durante o trabalho

O modo afrouxa a pausa, NUNCA a verificacao. Claims, verify, policies e gates tipados
rodam identicos em `#Classic` e em `#Auto`; o modo decide se o veredito espera o humano.

Depois de uma acao, use o resultado do nucleo para executar o proximo passo autorizado.
Em #Auto/#Maestro, nao termine um bloco apenas oferecendo continuar quando ainda ha trabalho
executavel dentro do modo. Uma pausa exigida pelo modo ou um impedimento real permanece visivel.

Para status, comece pela thread conhecida. Com despacho existente, consulte `ork_observe` para estado nativo, progresso e bloqueio atual.
`phase list` e historico: nao aguarde conclusao com loops longos, sleeps ou regex sobre sua saida. Uma espera nativa exige contexto real de decisao/impedimento.
Use `ork_hitl_pending` ou `ork pulse --json` para a fila de atencao e `ork board plan` para a ordem de trabalho. Evite inventario global ou repetido de processos/worktrees.
Use `ork_git_status`: `source.head` vai em `commit.expectedHead`; reconsulte apos commit para `ship.expectedSource=source.head` e `expectedDestination=destination.head`. Nao derive SHAs da base historica; ausencia de mensagem nao prova morte da sessao.

Os blocos e pausas mostrados por `thread status` descrevem o modo, nao gates ja abertos.
So diga "aguardando voce" quando o estado e o ultimo resultado em `phase list` sustentarem
uma pendencia humana atual, identificada por gate, pedido ou evento da thread/sessao.
Uma thread nova, sem fase executada nem pedido aberto, ainda nao aguarda veredito.
Se faltar evidencia da pendencia, informe a incerteza e consulte a fonte; nao invente a espera.

Apresente o resultado primeiro: o que ja foi comprovado, o que esta acontecendo, quem precisa agir e o proximo passo. Em trabalho demorado, comunique mudanca relevante, bloqueio ou marco.
Nao prometa notificacoes ou execucao em segundo plano que o host nao consegue sustentar.

## Decisoes na propria sessao

Quando houver decisao do dono, mostre a pergunta concreta, contexto e consequencias; ofereca opcoes quando ajudarem e identifique thread e pedido/gate.
Se pausa/escalacao real permitir e faltar pedido, use `ork_gate_request(threadId, motivo?)`; nunca crie pedido por status. Use `ork_request_decision(threadId, pedidoId)` para apresentar o dialogo nativo. A resposta vem pelo host, nunca como argumento de resposta ou identidade humana inventada pelo modelo.
Confira o resultado do nucleo e prossiga uma vez. Sem a ferramenta, use apenas ingresso suportado; nao fabrique envelope de outro host.
Nao transforme permissao nativa em aprovacao de gate nem aplique resposta a outro pedido.

Quando o modo permite decisao autonoma, registre quem decidiu, evidencia e motivo pelo nucleo.
Quando exige decisao humana, use somente a resposta realmente recebida; nao fabrique aprovacao ou score. Autorizacao de uma tarefa nao e autorizacao irrestrita para outras acoes.

## Continuidade e entrega

O estado canonico mora em `.orkastery/threads/<id>/`. Antes de trocar de sessao ou ao encontrar um impedimento, deixe checkpoint com objetivo, decisoes, ultimo resultado, artefatos e proximo passo. Retome o checkpoint e confira o estado atual antes de despachar novamente.

No pedido de despacho, descreva o objetivo e o escopo de todas as fases do bloco autorizado; a fase solicitada e a entrada do bloco. Em Auto, nao peça encerrar apos GOAL: o bloco segue GOAL..MASTER, com as verificacoes e gates aplicaveis.

Quando `ork_observe` mostrar `turno.estado=encerrado`, reconcilie o ultimo resultado oficial e os artefatos do bloco. Isso indica um turno encerrado, nao `phase_result`, fase concluida ou entrega. Os campos nativos `state` e `status` podem divergir; preserve a divergencia em vez de interpretar `working` isoladamente. Atividade posterior invalida a evidencia de turno encerrado. Sem resultado suficiente, registre o ponto pendente e use somente a continuacao suportada pelo nucleo, sem duplicar despacho nem fabricar conclusao. Nao use sleeps longos ou polling repetido para transformar silencio em prova de vida, morte ou progresso.

Despacho nao e conclusao. Testes, CHECK, SHIP e MASTER sao provas diferentes. Entregue mudancas, validacao, publicacao efetiva e pendencias, com links uteis ao dono. SHIP usa `ork ship`; entrega sem nota humana e aceita por omissao com o indice do ledger (`ork master`), e a nota humana sobrescreve. Entrega sem MASTER log nao aconteceu; publicacao e ratificacao continuam distintas.
## Racionalizacoes comuns
Despacho, silêncio ou modo Auto nunca substituem resultado, `verify` e recibos.
## Bandeiras vermelhas
Adaptador que implementa a demanda, status sem fonte ou publicação sem gate quebram a separação.
## Verificacao antes de responder
O dono entende resultado e proxima acao; estado e evidencia sustentam a resposta. Ver `DoD 17` e `DoD 20`.
