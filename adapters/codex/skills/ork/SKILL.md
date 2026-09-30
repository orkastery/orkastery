---
name: ork
description: "Reconhece orkastery maestro em sessão limpa: consulta panorama, retoma threads e apresenta decisões nativas na conversa Codex com o Maestro/Builder."
license: MIT
---

# Orkastery no Codex

Ao receber literalmente `orkastery maestro`, descubra `ork_maestro` no namespace
efetivamente exposto e consulte o projeto fixado pelo MCP. A frase pede panorama,
sem abrir trabalho. Sem projeto nomeado, ofereça também o panorama da rede
(`ork_network_roadmap`, ou `ork network roadmap` no CLI), com fontes, frescor e lacunas.
Siga a seleção de contexto e os limites do bootstrap comum.
Sem MCP, a consulta `ork maestro --json` continua somente leitura se o CLI estiver
disponível; mutações sem transporte nativo permanecem pendentes. Nunca use Bash Git
ou mudança de sandbox como substitutos. Sessão filha continua a fase recebida.

HITL tem prioridade máxima na apresentação: tópicos curtos, recomendação e opções
com rótulos claros; UUID interno. Use `ork_request_decision` na condutora e preserve
a resposta literal/cancelamento da elicitation. Não use pergunta genérica do agente
como aprovação de gate nem texto em toolargs como identidade humana.

Use a skill `orkastery-bootstrap` do mesmo catalogo instalado para conduzir o pedido.
O dono conversa sobre o objetivo; voce opera o nucleo `ork` e apresenta o resultado e o proximo
passo. Preserve o modo e as autorizacoes da thread. Se ja recebeu uma fase do Orkastery,
execute essa fase no escopo recebido, sem redespachar a si mesmo.

Quando descobertas, prefira as ferramentas MCP vinculadas ao projeto pelo servidor:
`ork_thread_status`, `ork_phase_list`, `ork_hitl_pending`, `ork_thread_new(nome, modo)`,
`ork_phase_run(threadId, fase, prompt, runtime?, model?, effort?, dryRun?)`, `ork_observe(threadId)`
e `ork_request_decision(threadId, pedidoId)`. Use o namespace efetivamente exposto, sem supor outro projeto.

- Pedido novo: resolva o modo pelo `ork`, confira preflight e abra/despache a thread.
- Retomada: leia `ork thread status <thread>` e o ultimo resultado em `ork phase list <thread>`;
  continue o trabalho autorizado sem repetir onboarding, aprovacao ou implementacao.
- Status do roadmap: use `ork_network_roadmap` (ou `ork network roadmap --projeto <nome>`) e mostre o
  texto como vem, com as threads de todas as maquinas, as fontes e as lacunas; `ork_roadmap_status` e
  so desta maquina. Nao escreva relatorio proprio de roadmap: lacuna nunca e roadmap vazio.
- Status: apresente a evidencia da thread; `ork pulse --json` mostra quem precisa agir.
  As pausas dos blocos do modo sao previstas: so diga "aguardando voce" com pendencia
  humana atual comprovada no estado/ultimo resultado, identificando gate, pedido ou evento.
  Uma thread nova sem fase executada nem pedido aberto ainda nao aguarda veredito.
- Despacho existente: consulte `ork_observe` para progresso ou bloqueio nativo atual;
  nao espere conclusao com loops longos de `phase list`, sleeps ou regex sobre historico.
- Decisao: se pausa/escalacao real permitir e faltar pedido, use `ork_gate_request(threadId, motivo?)`;
  nunca crie pedido por status. Correlacione thread/pedido e use `ork_request_decision` para apresentar
  o dialogo nativo. A resposta e fornecida pelo dono ao host; nunca invente identidade humana
  nem passe resposta como argumento do modelo. Permissao nativa nao aprova outro gate.
- Entrega: distinga o que foi implementado, validado, publicado e o que ainda esta pendente.

As fases, verificacoes e gates pertencem ao nucleo. As skills de fase e as checklists do
catalogo acompanham esta entrada. Se a skill comum estiver ausente, informe instalacao
incompleta em vez de inventar outra metodologia.

Use o executavel `ork` do projeto. Se nao estiver no PATH da sessao, o instalador registrou
este caminho: `{{ork_bin}}`. Nao altere configuracao global para resolver o PATH.

Sem MCP e com `.git` protegido pelo sandbox, informe instalacao pendente do transporte
nativo; nao repita a mutacao negada, nao crie a thread por fora e nao amplie o sandbox.

Nao ha monitor em segundo plano criado por esta skill. Acompanhe enquanto a sessao estiver
ativa e deixe checkpoint para a retomada, com ultimo resultado e proximo passo comprovados.
