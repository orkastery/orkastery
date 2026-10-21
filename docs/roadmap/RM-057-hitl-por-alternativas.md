---
id: RM-057
tipo: roadmap
titulo: "HITL de condução por alternativas: de 3 a 5 opções, uma recomendada, nunca texto colado"
categoria: melhoria
pai: RM-048
features: []
owner: Julio
atualizado_em: 2026-10-21T06:01:38-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: 7266df6
    pr: 49
sdlc:
  thread: ork-rm057respost
  modo: "#Auto"
  fase: GO
  status: aberta
---

# RM-057 — HITL de condução por alternativas: de 3 a 5 opções, uma recomendada, nunca texto colado

> **Em uma frase:** todo HITL de condução que parte do Orkastery chega ao maestro humano como uma seleção entre 3 e 5 alternativas, uma delas com o selo "Recomendação" do ork, e nunca depende de o humano colar ou digitar texto livre para a fábrica seguir.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** o product builder maestro humano conduz várias threads em paralelo. Quando a fábrica para e pede uma confirmação em texto livre, a condução fica parada até ele voltar, ler e redigir uma resposta, e o paralelismo da AI Factory cai a zero.
- **Evidências e fonte:** na noite de 01/10 para 02/10/2026, o agente que conduzia o Orkastery na maquina-b recebeu como texto colado o pedido do dono (threads RM-032, RM-056, RM-053, RM-040 e RM-055, com push e merge autorizados até 02/10 às 12h). Ele parou para pedir um "confirmo" em texto livre e a condução ficou mais de 10 horas sem produzir. O texto colado tinha sido pedido pelo próprio fluxo de condução.
- **Objetivo/OKR:** autonomia é ROI. A fábrica só para quando a decisão é de fato do humano, e mesmo assim ele decide com um clique, em segundos, de qualquer canal.
- **Hipótese:** Se todo HITL de condução sair como seleção de 3 a 5 alternativas com uma recomendada, então o tempo entre o pedido e a decisão cai e nenhuma thread fica parada esperando texto, porque escolher uma opção pronta custa segundos e pode ser feito do celular.
- **Métrica principal / linha de base / meta / janela / fonte:** tempo parado por HITL de condução; linha de base: mais de 10 h na noite de 01→02/10; meta: nenhum HITL de condução em texto livre fora da exceção técnica, e mediana de resposta abaixo de 5 min; janela de 30 dias; fonte: ledger e `ork pulse`.
- **Métricas de proteção:** nenhuma decisão irreversível (push, merge, release, apagar dados) tomada sem a autorização que o dono deu; a alternativa recomendada não pode virar padrão silencioso quando o dono não respondeu.

## Escopo e validação

- **Incluído:**
  - Todo HITL de condução que o ork abre (gate, pausa, pedido de autorização, dúvida de escopo) sai como seleção, com no mínimo 3 e no máximo 5 alternativas.
  - O ork escolhe as alternativas mais compatíveis com o cenário da decisão e com o propósito do produto, projeto ou iniciativa, e marca exatamente uma com o selo "Recomendação".
  - A mesma forma vale em todo canal (Claude Code, OpenClaw, Telegram, pulse), na linha da [RM-048](RM-048-hitl-humano-no-centro.md).
  - Os adaptadores e os prompts de condução passam a proibir o pedido de confirmação em texto livre e o pedido para colar texto.
  - Um pedido do dono que chega como texto colado, pedido pelo próprio fluxo, vale como instrução do dono, dentro da autorização que ele declara.
  - **Requisito de 12/10/2026, linguagem simples:** todo passo que depende do dono chega como pergunta com 3 alternativas e uma recomendada, em linguagem simples, nunca como lista de comandos crus nem com termo técnico sem explicação. O caso que motivou: "o comando da tag v0.5.5" mandado ao dono sem dizer o que é uma tag. A recomendada, quando possível, é a que o dono responde com uma palavra e a fábrica executa o resto com a autorização dele.
  - **Requisito de 20/10/2026, o dono aprova onde estiver:** aprovar não depende de um canal nem de copiar uma linha. Toda pergunta que pede aprovação nasce com um código curto e alternativas, e o dono responde "a", "sim", "1a" ou "autorizo" em qualquer canal com prova de que foi ele: o Telegram (Hermes e OpenClaw), o terminal do Claude Code numa sessão interativa e o diálogo nativo do host. O núcleo resolve a resposta contra a pergunta pendente e, com mais de uma e a resposta ambígua, pergunta qual, sem adivinhar. A sessão que o `ork` despachou nunca vale como dono, e a prova vem da origem da sessão, não do texto. O caso que motivou: duas propostas do piloto do #Noctum venceram em 20/10/2026 porque autorizar exigia copiar `/ork noctum <arco> autorizar <sha256>` no Telegram.
- **Fora de escopo:** a única exceção ao texto livre é a dependência técnica que a fábrica não consegue resolver sozinha com os runtimes disponíveis e que exige que o maestro humano rode um comando no terminal (um login interativo, por exemplo). Nesse caso o pedido traz o comando exato, pronto para copiar.
- **Entregáveis e critérios de aceite:**
  - Contrato do HITL de condução com 3 a 5 alternativas e um selo "Recomendação" → teste que reprova um pedido com menos de 3 ou mais de 5 opções, ou com nenhuma ou mais de uma recomendada.
  - Lint de prompt e de adaptador → `ork prompt lint` reprova um template que peça confirmação em texto livre ou que o humano cole texto.
  - Exceção técnica → o pedido em texto só passa com o motivo tipado de dependência técnica e o comando a rodar.
  - Canário do incidente de 01/10 → um pedido colado com autorização explícita segue sem parar.
- **Piloto, medição e critérios de expansão/interrupção:** piloto na condução do próprio Orkastery por 7 dias, medindo no ledger o tempo parado por HITL; expande para todos os hosts se nenhum HITL em texto livre passar fora da exceção.

### Fatia 5: a resposta curta, onde o dono estiver

Implementada na thread `ork-rm057respost` (modo #Auto), pelo requisito de 20/10/2026. O primeiro alvo é a pergunta que mais travou: a autorização e a revogação do arco do #Noctum ([RM-058](RM-058-modo-noctum.md#a-autorização-pela-resposta-curta-rm-057)).

Corrigida pelo GO-FIX 1, depois do CHECK independente, que mostrou a resposta curta casando com a pergunta errada ou vindo de quem não era o dono, e pelo GO-FIX 2, depois da segunda rodada do CHECK, que mostrou a palavra solta em reply a outra mensagem autorizando o arco e o agente da própria sessão do dono passando a cadeia do terminal: o terminal ficou desligado.

- **A pergunta:** o contrato curto (`ork.hitl-curto/v1`) ganha a última linha "Responda a, b ou c" (no terminal, "Responder: a, b ou c no Telegram, ou pela janela de confirmação do host"), com as letras reais e o detalhe a um pedido de distância (`<código> detalhes`), e o título com o número quando a pergunta foi servida no canal. A proposta do arco nasce como pergunta com código curto, três alternativas (a recomendada primeiro) e o hash guardado nela, nunca na resposta. O vocabulário fechado ganha "autorizo" (e as variações) para aprovar e "adiar" para esperar.
- **No Telegram** (Hermes e OpenClaw): o dono responde em reply à mensagem da pergunta só com a letra ou a palavra. O reply só vale para a mensagem em que a pergunta foi entregue: o transporte do canal devolve o id dela, o núcleo o guarda com a pergunta servida, e o gateway assina no endereço `resposta:<código>:<id>` o código, tirado do título da pergunta (`🔔 N. arco <arco> · <código>`), e o id da mensagem respondida, passados por `--em-resposta-a`. A confirmação do "b", a recusa, o lembrete e a mensagem de outra pessoa nunca são a pergunta, mesmo com o código, e em reply a resposta vale só para a pergunta respondida: a letra, a palavra que cai numa alternativa dela, o código ou o número dela. A palavra solta em reply a qualquer mensagem que não é a pergunta (a confirmação de um gate, a mensagem de outra pessoa do grupo, a do assistente) nunca vira palavra solta: com a janela aberta, o gateway a assina em `resposta:outra` e o núcleo a recusa dizendo por onde responder, sem gravar nada; com a janela fechada, ela segue ao assistente. Vale também o código com a letra de qualquer chat autorizado, o número com a letra (em reply ou não, porque dizem a pergunta) e a palavra solta sem reply quando só uma pergunta espera no chat em que ela saiu, nunca com a mensagem de antes de ela sair. Uma mensagem assinada responde a uma pergunta só, em qualquer arco. O reply à mensagem curta de um gate não vale: o lote sai como resposta do gateway, e o núcleo não guarda o id dela; o gate segue pelo número e pelo código.
- **No terminal do Claude Code, desligado (GO-FIX 2, D22):** o hook `UserPromptSubmit` do plugin leva a resposta curta ao núcleo (`ork noctum terminal --hook-stdin`), e o núcleo não grava nada: devolve a recusa `noctum.terminal.desligado`, e o dono vê o aviso de responder pelo Telegram (em reply à mensagem da pergunta ou com o código e a letra) ou pela janela de confirmação do Claude Code (o diálogo nativo, um clique). Por quê: o Claude Code instalado (2.1.306) não manda o campo `source` do evento, então nada do dono gravaria; e o agente da própria sessão do dono, pela ferramenta Bash, troca o shell pelo núcleo com `exec`, tira a marca `AI_AGENT` e forja o evento com `source` igual a `user`, de modo que a cadeia de processos e o guard do plugin são lombadas, não prova. O que falta para voltar, numa fatia própria: o Claude Code mandar a origem humana do evento, uma prova de que o evento veio do hook do harness e não de um processo do mesmo usuário e, para a palavra solta, a pergunta mostrada exigida como a linha que o núcleo monta para ela, ou só o código com a letra. Ligado, a fronteira segue a conta do sistema: um processo do mesmo usuário que abra uma sessão interativa nova do Claude Code fora da árvore de processos do agente (com `setsid` e um terminal virtual, por exemplo) e digite nela passa, e o agente da própria sessão também. O código do ingresso (a origem do prompt e da sessão, a cadeia nascida do hook, a palavra solta só logo depois da pergunta) segue no núcleo atrás da chave `TERMINAL_LIGADO`, desligada, com os testes que a ligam; o terminal puro segue recusado: nenhum comando autoriza.
- **Negativos provados:** a sessão despachada pelo `ork` que digita "sim", o prompt injetado pela máquina na sessão do dono, a resposta sem pergunta pendente, a ambígua com duas pendentes, a palavra solta de outro chat, o chat fora da lista, depois do prazo, a mesma mensagem de novo ou em outro arco, a mensagem de antes da pergunta, outra chave, a referência trocada, a proposta que mudou, o "ok" em reply à confirmação do "b", o "ok" e o "sim" em reply à confirmação de um gate ou à mensagem de outra pessoa (com o plugin real do Hermes e o OpenClaw real), o "1a" em reply à mensagem de outra pergunta, o "sim" dito ao modelo depois de outra pergunta dele e, no terminal desligado, a resposta com a origem perfeita e o evento que o agente da sessão forja (o S15 do CHECK, pelo CLI real); nenhum deles grava nada.
- **Limites ditos:** a fronteira do diálogo nativo é a conta do sistema: qualquer cliente MCP do mesmo usuário que declare o formulário passa, sem chave, e um teste fixa o limite. No OpenClaw, o SDK só entrega o reply quando a visibilidade do contexto do grupo o mostra (`contextVisibility`, `all` por padrão): com uma visibilidade que esconde a mensagem de quem não está na lista, o reply a ela chega como mensagem sem reply, e a palavra solta vale como sem reply. As recusas na borda do Hermes (usuário ou chat fora da lista, mensagem de mais de 60 s ou que volta com outro texto) saem caladas, de propósito: o bot não conversa com quem não é o dono nem responde a mensagem atrasada.
- **Próxima fatia proposta (D1 da thread):** o canal `terminal` no registro fechado de canais (`ork.hitl-canais/v1` vira `v2`) e a origem nova na prova do gate, para o "sim" no terminal responder também a um gate. É contrato e pede a ratificação do dono.

Evidência: `core/test/hitl-curto.test.ts` e `hitl-texto-livre.test.ts` (os testes "RM-057 resposta curta:"), `noctum-pergunta.test.ts` (NP1 a NP26), `noctum-resposta-curta.test.ts` (RC1 a RC28), `noctum-terminal.test.ts` (TM1 a TM30), `claude-hook-resposta.test.ts` (HK1 a HK10), `noctum-pergunta-cli.test.ts` (PQ1 a PQ6), `noctum-gateways.test.ts` (GW6 a GW13) e `noctum-ensaio-piloto.test.ts` (EP12), que rodam em `npm --prefix core test`, e os testes do reply dos dois gateways. As reproduções do CHECK viraram testes, e as guardas da correção têm mutante que os testes matam.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** Alta; pedido do dono; uma noite inteira de fábrica parada por um HITL em texto livre; 2026-10-02.
- **Horizonte / alvo / previsão / confiança / marcos:** próxima versão depois da 0.5.1; marcos: contrato, lint, adaptadores, canário.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-048](RM-048-hitl-humano-no-centro.md) (forma do bloco de decisão), [RM-041](RM-041-hitl-invertido.md) (HITL invertido).
- **Premissas / riscos / mitigação:** risco de a fábrica decidir sozinha algo irreversível. Mitigação: a alternativa recomendada só é aplicada com a escolha do humano ou dentro da autorização que ele já deu; dúvida dentro da autorização vai para `ork decisao registrar`, sem parar a thread.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** regra definida por Julio em 2026-10-02.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-21 | Julio |
| Documentação | Em revisão | — | 2026-10-21 | Julio |
| Código | Mesclado | commit `7266df6` · PR #49 | 2026-10-21 | Julio |
| Testes | Em execução | — | 2026-10-21 | Julio |
| Deploy | Não implantado | — | 2026-10-21 | Julio |
| Exposição | Flag desligada | — | 2026-10-21 | Julio |
| Habilitação | Pendente | — | 2026-10-21 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: fábrica Orkastery / A: Julio / C: — / I: —
- **Agentes envolvidos, atuação, autonomia e revisor humano:** Claude Code redigiu o item a pedido do dono; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** depois do merge da fatia 3, o piloto de 7 dias na condução do próprio Orkastery, lendo o tempo parado no `ork pulse` e no `ork roadmap status` (`hitlDeConducao`, mediana de 7 dias) ou em `ork ledger stats --desde 7d`; a reinstalação da extensão do OpenClaw e da skill do Hermes nos hosts fica com o dono; responsável: Julio. Depois do merge da fatia 5, a reinstalação do plugin do Claude Code e dos dois gateways (`ork adapter install`) leva o hook da resposta curta e o reply aos hosts, e a D1 da thread `ork-rm057respost` é a próxima fatia proposta; o terminal só volta a gravar numa fatia própria, quando o Claude Code mandar a origem humana do evento (D22).

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-02 | Item criado com prioridade alta | Incidente da noite de 01→02/10: mais de 10 h de condução parada por um HITL em texto livre | Julio |
| 2026-10-02 | Fatia 1 na thread ork-rm057alterna: contrato de 3 a 5 com uma Recomendação no registro, dependência técnica tipada, letras a-e, selo no texto ao dono, lint `hitl-texto-livre` e a regra nos adaptadores do Claude Code e do Codex | Recorte registrado com `ork decisao registrar` na thread | Julio |
| 2026-10-02 | Fatia 1 mesclada | PR 49, merge 7266df6 | Julio |
| 2026-10-03 | Fatia 2 na thread ork-rm057fatia2c: canário `fx-pedido-colado` (o pedido colado com autorização explícita segue sem parar), a regra nas descrições das tools do OpenClaw e na skill do Hermes, e o tempo parado por HITL de condução no `ork ledger stats` (`hitlDeConducao`, mediana contra a meta de 5 min) | Recorte registrado com `ork decisao registrar` na thread; o pulse e o piloto ficam para depois | Claude (agente, #Auto), revisão de Julio pendente |
| 2026-10-03 | Fatia 2 mesclada | PR 52, merge 66b7ee3 | Julio |
| 2026-10-03 | Fatia 3 na thread ork-rm057fatia3t: o tempo parado por HITL de condução no `ork pulse` e no `ork roadmap status` (`hitlDeConducao`: abertas com há quanto tempo, mediana de 7 dias), com uma linha no resumo do pulse só acima da meta de 5 min | Recorte registrado com `ork decisao registrar` na thread; campo aditivo opcional nos contratos que já existem, sem contrato novo | Claude (agente, #Auto), revisão de Julio pendente |
| 2026-10-03 | Fatia 4 na thread ork-rm057regrada, defeitos do ensaio isolado da reinstalação do OpenClaw: a regra também em `ork_network_roadmap` e `ork_network_status`, as únicas tools visíveis no perfil `coding` (o perfil não foi ampliado), e o `ork adapter install` apontando a extensão para o `ork` em execução, com aviso quando o do PATH é outro | Ensaio de 03/10: no `coding` o modelo do Telegram nunca lia a regra; pelo tarball, a extensão 0.5.2 chamava o `ork` 0.4.3 global. `tools.alsoAllow` fica como decisão do dono | Claude (agente, #Auto), revisão de Julio pendente |
| 2026-10-12 | Requisito novo: todo passo que depende do dono chega como pergunta com 3 alternativas e uma recomendada, em linguagem simples, sem lista de comandos crus nem termo técnico sem explicação | Caso do dono: "o comando da tag v0.5.5" mandado sem dizer o que é uma tag; thread `ork-rm062privado` | Julio |
| 2026-10-20 | Requisito novo: o dono aprova onde estiver, com resposta curta; aprovar não depende do Telegram nem de copiar uma linha | Decisão do dono de 20/10/2026, depois de duas propostas do piloto do #Noctum vencerem esperando a linha com o hash | Julio |
| 2026-10-21 | Fatia 5 na thread ork-rm057respost: a resposta curta à pergunta do arco do #Noctum em qualquer canal com prova de que foi o dono (o Telegram do Hermes e do OpenClaw com o reply, o código, o número e a palavra solta; o terminal do Claude Code pelo hook `UserPromptSubmit`, com a origem da sessão provada; o diálogo nativo com três alternativas), a pergunta no padrão "responda a, b ou c" e o reply também para os gates no Telegram; o gate pelo terminal fica como a próxima fatia proposta (D1) | Decisões D1 a D13 registradas com `ork decisao registrar` na thread; os formatos do #Noctum seguem sem ratificação | Claude (agente, #Auto), revisão de Julio pendente |
| 2026-10-21 | GO-FIX 1 da fatia 5, depois do CHECK independente: o terminal só grava o prompt que o dono digitou (`source` igual a `user`), logo depois da pergunta mostrada, só para dizer "a", e com a cadeia de processos nascida do hook; o reply do Telegram só vale para a mensagem em que a pergunta foi entregue, e só para ela; uma mensagem responde a uma pergunta só; o reply a um gate deixa de valer; os limites dos dois canais locais ficam ditos como são | CHECK da thread (achados 1 a 10), testes NP18 a NP23, RC15 a RC25, TM18 a TM27, HK8 e GW10 a GW11, e os mutantes da correção mortos | Claude (agente, #Auto), revisão de Julio pendente |
| 2026-10-21 | GO-FIX 2 da fatia 5, depois da segunda rodada do CHECK: a palavra solta em reply a uma mensagem que não é a pergunta (a confirmação de um gate, a mensagem de outra pessoa) vai ao núcleo marcada (`resposta:outra`) e é recusada com o porquê; o ingresso do terminal fica desligado até o Claude Code mandar a origem humana do evento, e o hook só diz ao dono por onde responder; as guardas que os mutantes da rodada 2 mostraram sem teste ganham teste | CHECK da thread, rodada 2 (achados R1 a R5), decisões D22 e D23, testes RC26 a RC28, GW12 e GW13, TM28 a TM30, NP24 a NP26, HK9 e HK10, e os mutantes da correção mortos | Claude (agente, #Auto), revisão de Julio pendente |
