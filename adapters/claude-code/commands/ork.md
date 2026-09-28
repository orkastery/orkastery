---
description: Reconhece orkastery maestro e conduz pedidos, retomadas e status na conversa com o Maestro/Builder.
argument-hint: "[pedido em linguagem natural|thread|status|board|plan|doctor|modos]"
allowed-tools: Bash(ork:*), Read, mcp__orkastery__ork_thread_status, mcp__orkastery__ork_phase_list, mcp__orkastery__ork_hitl_pending, mcp__orkastery__ork_observe, mcp__orkastery__ork_artifact_read, mcp__orkastery__ork_claims_list, mcp__orkastery__ork_git_status, mcp__orkastery__ork_thread_new, mcp__orkastery__ork_phase_run, mcp__orkastery__ork_preflight
---

# /orkastery:ork

Entrada nativa do plugin ativado no projeto: `/orkastery:ork`. A copia dos arquivos pelo
instalador ainda exige ativacao nativa; `/ork` sozinho nao e um alias garantido.

Esta entrada ja esta carregada pela invocacao do dono. Nao invoque `Skill(orkastery:ork)`
nem outro comando para recarregar estas instrucoes. Conduza o pedido com as ferramentas
ja permitidas.
As oito consultas MCP e criar/despachar thread desta entrada valem no turno da invocacao;
nao persistem por si nas proximas mensagens. Criar/despachar exige demanda e escopo autorizados
pelo dono, modo resolvido e preflight do nucleo. Nao recarregue a skill para obter permissoes.
Esses grants nao ativam MCP, nao autorizam outras mutacoes nem aprovam gates ou respostas humanas.

Leia o contrato comum com `Read`, sem chamar `Skill` para carregar o bootstrap:
@${CLAUDE_PLUGIN_ROOT}/skills/core/orkastery-bootstrap/SKILL.md

Se o contrato ja estiver no contexto, use-o sem reler. Se o arquivo estiver ausente,
informe instalacao incompleta; nao invente outro fluxo.

Entrada conversacional do Orkastery. Use o contrato comum para conduzir a intencao do dono pelo nucleo. Nao limite um pedido de execucao a indicar outro
slash command. Se recebeu um pedido e possui as ferramentas necessarias, execute o roteamento.
Os comandos de fase continuam disponiveis como atalhos; o dono nao precisa conhece-los.

## Reconhecer a intencao

A frase literal `orkastery maestro`, em sessão limpa, pede leitura do panorama.
Descubra a ferramenta com `ToolSearch` em `select:mcp__orkastery__ork_maestro`,
então consulte o projeto fixado. Não abre thread nem despacho por consulta.
Projeto ausente/ambíguo exige resolver o contexto permitido pelo núcleo.
Se já recebeu fase/thread/worktree, execute o bloco recebido, sem recursão.
MCP ausente ou autenticação negada permanece impedimento; não troque runtime,
provider ou sandbox. A consulta CLI `ork maestro --json` não concede mutações.

Usabilidade HITL é prioridade máxima: tópicos, recomendação e opções rotuladas,
UUID interno e cancelamento preservado. A condutora usa
`mcp__orkastery__ork_request_decision`; o filho nunca responde em nome do dono.

| Pedido do dono | Acao do agente |
|---|---|
| Demanda nova | Resolva o modo pelo nucleo, confira o preflight e abra/despache a thread correspondente. |
| "Continue" ou thread/roadmap existente | Leia o estado e o ultimo resultado; retome o proximo passo autorizado, sem duplicar despacho. |
| "Como esta?" ou status | Consulte a thread conhecida; apresente progresso comprovado, impedimento e proximo passo. |
| Decisao ou resposta | Correlacione com o pedido/gate apresentado, transporte pelo caminho suportado e confira o resultado. |
| Onboarding | Use a pauta de `ork onboarding` e retome as etapas existentes. |
| board, plan, doctor ou modos | Execute a consulta correspondente e interprete o resultado para a intencao do dono. |

## Fontes do nucleo

Priorize as ferramentas MCP do Orkastery quando descobertas nesta sessao, com o projeto
fixado pelo servidor. No Claude, o servidor instalado `orkastery` expoe nomes completos como
`mcp__orkastery__ork_thread_status`. Se houver ferramentas adiadas, use `ToolSearch` com
`select:mcp__orkastery__ork_thread_status,mcp__orkastery__ork_artifact_read` para essas leituras;
para outra operacao, selecione seu nome completo realmente exposto. Nao tente `select:ork_thread_status`
nem adivinhe outro namespace. Ativacao inicial do MCP e consentimento do dono continuam nativos. `ork_thread_status`, `ork_phase_list` e `ork_hitl_pending` leem
estado; `ork_thread_new` e `ork_phase_run` abrem/despacham; `ork_observe` consulta a sessao
nativa despachada. Quando pausa/escalacao real permitir e faltar pedido, use
`ork_gate_request(threadId, motivo?)`; nunca crie pedido para uma consulta de status.
`ork_request_decision(threadId, pedidoId)` apresenta o dialogo ao dono:
a resposta vem pelo host, nunca por argumento de resposta ou identidade inventada pelo modelo.

As consultas CLI abaixo continuam uteis quando a ferramenta correspondente nao esta disponivel:

```bash
ork thread status <thread>
ork phase list <thread>
ork pulse --json
ork board plan
ork doctor
ork modos
ork master --batch
```

Use apenas as consultas necessarias. Nao rode todas a cada mensagem. O preflight pertence ao
inicio de despacho ou a uma mudanca relevante de ambiente; uma pergunta de status nao reinicia
onboarding nem trabalho. Se a thread estiver ambigua, esclareca antes de alterar seu estado.
Pausas listadas nos blocos do modo sao previstas. Para dizer que o dono precisa responder
agora, identifique uma pendencia atual no estado/ultimo resultado da thread, com gate,
pedido ou evento correspondente. Uma thread nova sem fase executada nao aguarda premissas
so porque o bloco f12 do modo preve essa pausa.

## Continuidade

Preserve modo, decisoes e autorizacoes da thread/sessao. Prossiga com trabalho autorizado em
vez de encerrar com "posso continuar?". Pergunte quando o modo ou uma ambiguidade real exigir
intervencao do dono e explique o que a resposta destrava. Nao aprove gates em nome dele.

Com despacho existente, consulte `ork_observe` e trate a espera nativa atual. Nao substitua
observacao por loops longos de `phase list`, sleeps ou regex de conclusao sobre historico.
Se faltar MCP e o sandbox impedir `.git`, informe instalacao pendente do transporte nativo;
nao repita a mutacao negada nem altere o sandbox. Diferencie permissao nativa de gate do Ork.

Antes do despacho, use `ork_preflight({modo})`; alternativa CLI: `ork doctor --modo <modo>`. A sonda segue setup por bloco, sem inventário global, e não comprova autenticação, gates ou entrega.
Para HEADs e estado Git, consulte `ork_git_status`; nao invente SHAs nem substitua o transporte por Bash Git.
O perfil filho `worktree` e opt-in da instalacao do projeto; nao o habilite por argumento de ferramenta
ou edicao de configuracao para contornar bloqueio. Preserve o perfil configurado e as permissoes nativas.

A sessao condutora despacha e acompanha; uma sessao que ja recebeu uma fase executa essa fase,
sem redespachar a si mesma. O nucleo continua validando fases, evidencias e gates.

Mostre o resultado, o ultimo progresso confirmado e o que acontece agora. Registre checkpoint
antes de uma retomada futura; nao prometa notificacao fora das capacidades da sessao.
Conclua com entrega e validacao efetivas, distinguindo o que ainda depende de CHECK, SHIP ou
score humano. A lista de comandos executados e diagnostico auxiliar, nao a experiencia do dono.
