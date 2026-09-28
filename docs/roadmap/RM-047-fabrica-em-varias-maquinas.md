---
id: RM-047
tipo: roadmap
titulo: Fábrica em várias máquinas, com threads em mais de um computador
categoria: iniciativa
pai: null
features: [FEAT-003, FEAT-026, FEAT-027]
owner: Julio
atualizado_em: 2026-09-27T23:46:57-03:00
estado:
  ciclo: Piloto
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
  thread: ork-i52setupporb
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-047 — Fábrica em várias máquinas, com threads em mais de um computador

> **Em uma frase:** o builder conduz threads do mesmo produto em vários computadores, e o resumo de atenção, as contas e o roadmap enxergam todas elas.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Piloto | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-003](../produto/FEAT-003-despacho-de-fase.md), [FEAT-026](../produto/FEAT-026-reservas-do-roadmap.md), [FEAT-027](../produto/FEAT-027-fabrica-compartilhada.md)
- **Thread:** `ork-i52setupporb` (fatia 3); fatias anteriores: `ork-i47reservas` e `ork-i51fabricaem`

## Problema e resultado

- **Problema:** o estado das threads vive no diretório `.orkastery/` da máquina que as criou. Uma thread aberta num computador não aparece no `ork board`, no `ork pulse` nem no resumo por hora de outro.
- **Evidência (26/09/2026):** na fábrica de referência, os planos das iniciativas abertas, a matriz de modelos por bloco (`setup.json`), o catálogo de portfólio e as respostas do onboarding existem só na máquina onde foram criados.
- **Hipótese:** Se o registro das threads e as decisões de configuração forem compartilhados entre as máquinas do builder, então ele pode dividir o trabalho entre computadores sem perder o resumo único de atenção, porque o `ork` passa a ler um estado comum.
- **Métrica principal:** uma thread aberta em qualquer máquina aparece no resumo por hora em até uma varredura.
- **Métrica de proteção:** nenhum segredo nem credencial sai da máquina onde foi criado.

## Escopo e validação

- **Fatia 1, reservas de item (27/09/2026):** `ork roadmap reservas`, `ork roadmap pegar` e `ork roadmap soltar`, e `ork thread new --roadmap RM-NNN`. A reserva é um arquivo por item na branch `ork/roadmap-reservas`, gravado por push atômico: duas máquinas não pegam o mesmo item ([FEAT-026](../produto/FEAT-026-reservas-do-roadmap.md)).
- **Fatia 2, visão compartilhada (27/09/2026):** cada máquina publica o retrato das próprias threads na branch `ork/fabrica-estado`; `ork board`, `ork fabrica` e o resumo do pulse mostram as outras; `ork fabrica entrar` e `ork fabrica sair`; a máquina em `thread_created` e `phase_dispatch`; o guia [Várias máquinas](../guias/varias-maquinas.md) ([FEAT-027](../produto/FEAT-027-fabrica-compartilhada.md)).
- **Fatia 3, setup versionado (27/09/2026):** `ork setup versionar` grava `orkastery.setup.json` na raiz do checkout; quando ele existe, vale para todas as máquinas e é o arquivo que o `ork setup` edita. O setup local passa a ser lido da raiz de estado ([FEAT-003](../produto/FEAT-003-despacho-de-fase.md)).
- **Fora de escopo:** compartilhar credenciais ou perfis de conta; cada máquina faz o próprio login.
- **Critério de aceite:** duas máquinas conduzem threads diferentes do mesmo produto, e `ork board` e o resumo por hora mostram as duas.

## Plano e decisões

- **Prioridade:** alta (proposta de 26/09/2026, a confirmar com Julio): o dono passa a desenvolver em mais de um computador.
- **Até o registro compartilhado:** cada máquina conduz as próprias threads e entrega por PR com o CI independente como portão. Antes de começar, a máquina reserva o item (`ork roadmap pegar`), e o `docs/roadmap` segue como o ponto comum dos fatos de merge.
- **Relacionado:** [RM-040](RM-040-estado-de-conta-compartilhado.md), estado de conta compartilhado entre projetos.
- **Registro compartilhado numa branch de estado, não no OrkMind (27/09/2026):** a branch usa o mesmo mecanismo das reservas, funciona em qualquer máquina com acesso ao remoto e não depende de banco acessível de fora da VPS.
- **Adesão por máquina, não pelo projeto:** o repositório vai a outras pessoas, e um clone não pode sair publicando estado. `ork fabrica entrar` grava nome e adesão em `~/.orkastery/maquina.json`, que o cron e os gateways também leem; o manifesto pode ligar para o time inteiro.
- **Máquina só nos eventos de condução:** `thread_created` e `phase_dispatch` levam a máquina; os eventos de HITL não mudam, para a prova de origem continuar byte a byte.
- **Entregue pelo git:** thread com `ship(<thread>)` na base aparece como entregue, mesmo sem MASTER.
- **O versionado vence o local, inteiro (fatia 3):** misturar os dois por bloco reabriria a divergência que o item existe para fechar. O local fica ignorado, e o `ork setup` diz isso na última linha.
- **Bug achado na fatia 3:** o setup local era lido a partir do checkout, não da raiz de estado. Fase despachada de dentro de uma worktree caía no default sem aviso. Corrigido junto.

## Estado com evidências

- Discovery: levantado em 26/09/2026 ao planejar o desenvolvimento fora da VPS de referência.
- Fatia 1 mesclada (PR #28) e em uso na fábrica desde 27/09/2026: reservas de item entre máquinas, provadas com dois clones do mesmo remoto, inclusive a corrida no meio do push. A primeira reserva real foi a RM-046.
- Fatia 2 na thread `ork-i51fabricaem` (27/09/2026): visão compartilhada provada com dois clones do mesmo remoto, board e resumo do pulse mostrando a outra máquina, e pergunta de outra máquina saindo na hora.
- Fatia 2 mesclada (PR #34) e em uso: a VPS entrou como `vps` em 27/09/2026, com 13 threads ativas e 25 entregues no primeiro retrato.
- Fatia 3 mesclada (PR #35) e em produção: o setup que o dono já usava foi versionado em `orkastery.setup.json`, e a worktree de produção passou a aplicá-lo (antes caía no default).
- Falta para Geral: as outras máquinas entrarem (`ork fabrica entrar`) e a publicação no npm.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-09-27 | Julio |
| Documentação | Em revisão | — | 2026-09-27 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-27 | Julio |
| Testes | Aprovados | — | 2026-09-27 | Julio |
| Deploy | Produção | — | 2026-09-27 | Julio |
| Exposição | Parcial | — | 2026-09-27 | Julio |
| Habilitação | Em andamento | — | 2026-09-27 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-26 | proposto | pedido do dono: desenvolver em outros computadores sem consumir a VPS | Julio |
| 2026-09-27 | fatia 1: reservas de item entre máquinas | pedido do dono: dois builders não podem pegar o mesmo item | Julio |
| 2026-09-27 | a reserva valida o item também contra a `main` | checkout em branch antiga recusava item que já existe | Julio |
| 2026-09-27 | fatia 2: visão compartilhada da fábrica | critério de aceite do item: board e resumo mostram as duas máquinas | Julio |
| 2026-09-27 | fatia 3: setup por bloco versionado no repositório | escopo do item: configuração de modos por bloco versionada | Julio |
| 2026-09-27 | as três fatias em produção na VPS de referência | merges `bab72d2`, `b491861` e `5c064e3`; VPS na fábrica como `vps`; setup do dono versionado | Julio |
