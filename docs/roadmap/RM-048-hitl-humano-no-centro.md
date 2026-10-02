---
id: RM-048
tipo: roadmap
titulo: "HITL humano no centro: decisão curta, clara e com recomendação em qualquer canal"
categoria: melhoria
pai: null
features: [FEAT-011, FEAT-014, FEAT-015, FEAT-021]
owner: Julio
atualizado_em: 2026-10-01T02:24:38-03:00
estado:
  ciclo: Em validação
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: 8d47740
    pr: 19
  testes:
    ci: verde no push do merge (run 36562093369) e no da v0.5.0 (run 36815186450)
  deploy:
    release: v0.5.0, @orkastery/cli 0.5.0 no npm
sdlc:
  thread: ork-hitlhumanono
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-048 — HITL humano no centro: decisão curta, clara e com recomendação em qualquer canal

> **Em uma frase:** toda decisão que chega ao dono sai como um bloco curto, com contexto, opções rotuladas e uma recomendação, igual em qualquer canal, para um humano com dezenas de atividades em paralelo decidir em segundos.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em validação | Mesclado | Aprovados | Produção | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** o dono do projeto, que conduz o Orkastery em paralelo com o resto do dia. Hoje ele só consegue decidir se decorar e digitar a gramática exata do ingresso; texto em prosa, que é como qualquer humano responde, não registra nada.
- **Evidências e fonte (origem: pedido direto do dono, 27/09/2026, no Telegram):**
  - o dono respondeu "1. I-31. Aprovar, 2. D2 ..." em prosa e **nada foi registrado no ledger**: a resposta caiu no assistente, não no ingresso;
  - a linha que o dono recebeu virou pó sozinha: o pedido `5fdcb00b` (código `DE6H`) foi substituído por `3b2c4b61` (código `SNS5`) em menos de quatro horas; o mesmo aconteceu com o pedido da I-38 (`cb046d9a`/`C7M2` → `0ce3e378`/`XY96`);
  - o resumo do pulse chegou a 3 blocos longos de "decidi sem te perguntar" com parágrafos corridos, e a pergunta real ficou escondida no fim do texto.
- **Objetivo/OKR:** o dono decide em segundos, sem decorar código, UUID, número de opção nem sintaxe, e sem reler mensagem grande. Menos erro humano e menos ida e volta.
- **Hipótese:** se todo pedido HITL sair num único contrato de apresentação (tópicos, ícones, resumo, opções rotuladas e uma recomendação) e o núcleo aceitar a resposta em linguagem natural quando ela for inequívoca, então o dono deixa de errar e de perder prazo, porque a causa do erro de hoje é o formato exigido, não a decisão.
- **Métrica principal / linha de base / meta / janela / fonte:** quantidade de pedidos em que o dono responde e o ledger **não** registra. Linha de base: 1 em 27/09/2026 (I-31). Meta: zero. Fonte: ledger `human_gate` versus mensagens do dono no canal.
- **Métricas de proteção:** nenhum veredito humano pode ser inventado pelo agente; o registro continua exigindo prova do canal autenticado (a defesa do ingresso permanece); pedido longo nunca substitui pedido claro.

## Escopo e validação

- **Incluído:**
  1. **Contrato único de apresentação, canal-agnóstico:** resumo em uma frase, o que trava, há quanto tempo/custo, no máximo quatro opções rotuladas (a, b, c, d), **uma** marcada como recomendada com o porquê em uma linha, e uma última linha dizendo exatamente como responder.
  2. **Resposta em linguagem natural registra:** "aprovar", "sim", "pode seguir", "a", "1", "B", "1. B, 2. A" casam o pedido vigente quando não houver ambiguidade. Ambíguo volta como pergunta, com as opções reais, nunca como veredito chutado.
  3. **Fim da dependência de código/UUID rotativo:** identificador estável por pedido, ou resolução automática pelo pedido vigente da thread, para que a linha recebida não vença em uma hora.
  4. **Teto de tamanho:** pedido curto por padrão; o detalhe profundo (artefato, claims, riscos, diff) fica a um pedido de distância.
  5. **Formatação por canal:** ícones e tópicos padronizados em Telegram, terminal e OpenClaw, com o mesmo conteúdo essencial em todos.
  6. **Separação explícita do que é do humano e do que é do orquestrador**, para o dono não ser chamado a decidir impedimento técnico.
  7. **Status report único do roadmap:** um comando do núcleo gera o relatório no formato aprovado pelo dono em 27/09/2026 (grupos com ícones, um item por linha, `#HITL` no que depende dele, e o fecho com o que precisa dele e o que vem a seguir), e todo canal chama esse comando em vez de escrever o próprio.
  8. **Nota do MASTER com prova de origem humana:** ferramenta de host que grava nota em nome de uma pessoa (hoje a `ork_master` recebe o nome como parâmetro) passa pela mesma prova de canal que o gate já exige.
- **Fora de escopo:** exclusividade de um canal; a cadência do resumo ([RM-039](RM-039-cadencia-do-pulse-por-tag.md)); o tamanho da fila e o teto da varredura ([RM-045](RM-045-pulse-enxuto.md)); a camada de atenção já entregue em `FEAT-011` ([FEAT-011](../produto/FEAT-011-hitl-em-camadas.md)).
- **Entregáveis e critérios de aceite:** (a) um pedido real respondido em prosa pelo dono é registrado no ledger sem ele reescrever nada, nos quatro hosts; (b) todo pedido de gate e de sessão sai no formato único, com recomendação e com o "como responder" em uma linha; (c) nenhum pedido passa de 15 linhas por padrão; (d) pedido ambíguo devolve pergunta, nunca aprovação.
- **Piloto, medição e critérios de expansão/interrupção:** piloto no canal Telegram desta máquina, por uma semana, medindo erro humano e tempo até a decisão; expande se o registro em prosa funcionar sem abrir exceção na defesa do ingresso; interrompe se algum veredito for registrado sem prova de canal.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** alta. É o caminho pelo qual todo o resto do produto é aprovado; cada erro de formato aqui custa dias de thread parada. Pedido do dono em 27/09/2026.
- **Dependências e bloqueios (ID, owner, próxima revisão):** depende do ingresso HITL do núcleo ([RM-003](RM-003-hitl-bidirecional-telegram.md)) e da camada de atenção ([FEAT-011](../produto/FEAT-011-hitl-em-camadas.md)); precisa de decisão do dono sobre aceitar linguagem natural como resposta válida (classe 1).
- **Premissas / riscos / mitigação:** premissa, é possível decidir ambiguidade sem heurística frágil; risco, aceitar prosa abrir caminho para o agente "interpretar" o dono; mitigação, quando houver mais de um pedido aberto na mesma thread, a resposta em prosa é recusada e a pergunta volta com as opções.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** registrada a decisão de evoluir o HITL para humano no centro (Julio, 27/09/2026). Alternativa descartada: manter a gramática atual e apenas documentá-la melhor.

## Estado com evidências

- Os oito itens na `main` pelo PR #19 (merge `8d47740`), com o CI verde no push do merge (run 36562093369).
- Em produção na versão 0.5.0: tag `v0.5.0` (merge `2418a4e`, PR #36), `@orkastery/cli` 0.5.0 no npm, CI verde no push da versão (run 36815186450).
- Em validação: o piloto de uma semana no Telegram ainda não tem medição registrada nesta página.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em validação | — | 2026-10-01 | Julio |
| Documentação | Em revisão | — | 2026-10-01 | Julio |
| Código | Mesclado | commit `8d47740` · PR #19 | 2026-10-01 | Julio |
| Testes | Aprovados | ci: verde no push do merge (run 36562093369) e no da v0.5.0 (run 36815186450) | 2026-10-01 | Julio |
| Deploy | Produção | release: v0.5.0, @orkastery/cli 0.5.0 no npm | 2026-10-01 | Julio |
| Exposição | Flag desligada | — | 2026-10-01 | Julio |
| Habilitação | Pendente | — | 2026-10-01 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: agentes do Orkastery · A: Julio · C: — · I: —
- **Agentes envolvidos, atuação, autonomia e revisor humano:** Hermes registrou a demanda a pedido do dono; execução virá por thread no modo do núcleo; a decisão final é de Julio.
- **Próxima ação, responsável e prazo:** o piloto de uma semana no Telegram desta máquina, medindo resposta sem registro no ledger. O merge do PR da thread já aconteceu (PR #19), e o item está na versão 0.5.0.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-27 | item criado | pedido do dono no Telegram: HITL precisa ser resumido, claro, com opções e recomendação, pensado para quem tem TDAH e dezenas de atividades em paralelo | Julio |
| 2026-09-28 | decisões do dono: texto livre inequívoco registra, ambíguo volta como pergunta; padrão curto em todo canal; status report único; nota do MASTER com prova de canal; linha que não vence em uma hora | pedido direto do dono, thread `ork-hitlhumanono` | Julio |
| 2026-09-28 | os 8 itens entregues na branch da thread (contrato `ork.hitl-curto/v1`, texto livre, linha estável, "Conosco", `ork roadmap status`, `ork master pedir`) | thread `ork-hitlhumanono`, #Auto, decisões D3 a D9 no ledger | agente condutor; decisão final de Julio |
| 2026-09-29 | os 8 itens mesclados na `main` | PR #19, merge `8d47740` | Julio |
| 2026-10-01 | em produção na versão 0.5.0; o piloto segue em aberto | tag `v0.5.0` (PR #36), `@orkastery/cli` 0.5.0 no npm | Julio |
