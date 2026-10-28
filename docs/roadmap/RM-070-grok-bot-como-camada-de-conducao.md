---
id: RM-070
tipo: roadmap
titulo: Grok Bot como camada de condução do Orkastery
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-21T11:00:00-03:00
estado:
  ciclo: Discovery
  documentacao: Rascunho
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

# RM-070: Grok Bot como camada de condução do Orkastery

> **Em uma frase:** o Grok Bot (o agente da xAI) conduz o `ork` por conversa, de ponta a ponta, como o Hermes e o OpenClaw: status, pulse, despacho, entrega, gate, HITL e autorização do `#Noctum`, esta só com a prova de que foi o dono.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Pedido do dono de 20/10/2026:** "Adicione também no roadmap incluir o Grok Bot como possível camada de orquestração do orkastery, podendo ser utilizado pra conduzir o ork." Esta página é só planejamento: nenhum código nem teste foi escrito, e os critérios de aceite abaixo são o que cada fatia terá de provar.

**Decisão do dono de 21/10/2026 (D1 = a, com o escopo completo):** "2.a (não quero só leitura, quero completo)".

- O Grok conduz o `ork` pelo MCP do `ork` exposto por HTTP com autenticação, com a condução completa: status, pulse, gates e HITL, despacho de fase, entrega e a autorização do `#Noctum`.
- O que o dono pediu a mais que a alternativa a original (que era leitura primeiro) está nas fatias abaixo.
- O que **não** muda: o que exige prova de que foi o dono (aprovação de gate, autorização de arco) segue a regra da [RM-057](RM-057-hitl-por-alternativas.md), uma resposta curta presa à pergunta pendente, com a prova pelo canal.
- O que o Grok ainda não oferece para essa prova continua dito como lacuna (H5), sem presumir.

**Condução não é runtime.** Aqui o Grok é o **host condutor**: quem conversa com o dono e chama o `ork` (status, gate, despacho). Isso é diferente de ser o **runtime**, o agente CLI que executa uma fase dentro da worktree, tema da [RM-067](RM-067-grok-build-homologado.md) (o Grok Build). Os dois são independentes: dá para conduzir pelo Grok Bot com Codex ou Claude Code executando as fases, e dá para executar fases com o Grok Build conduzido pelo Telegram.

**O que é "camada de condução" no Orkastery:** o host que conduz o `ork` por conversa, como o Hermes (Telegram, [RM-003](RM-003-hitl-bidirecional-telegram.md)) e o OpenClaw ([RM-036](RM-036-maestro-multicanal.md), [RM-059](RM-059-conducao-dentro-do-claude-code.md)). Ele pede status, despacha fase, apresenta o gate e o HITL ([RM-048](RM-048-hitl-humano-no-centro.md), [RM-057](RM-057-hitl-por-alternativas.md)), recebe o pulse e o relatório, e só registra uma decisão do dono quando o ingresso autenticado prova a origem humana.

**Nome:** "Grok Bot" designa hoje o agente da xAI de que trata a documentação em `docs.x.ai/grok-bot` (G2), um agente de computador com nuvem própria, também chamado de "digital teammates" no anúncio (G1). A xAI tem outras superfícies com o nome Grok, que a página trata como alternativas e não confunde com ele: o Grok no app e na web (`grok.com`), com conectores e Automations (G9, G11); a API, com MCP remoto e chamada de função (G12, G16); e a conta `@grok` no X, que a documentação do Grok Bot cita (G10). O pedido do dono diz "Grok Bot"; a página segue a documentação e põe as demais superfícies como alternativas na decisão D1.

## Problema e resultado

- **Público e problema/oportunidade:** o dono que já conduz o `ork` por Telegram, OpenClaw, Claude Code ou Codex e quer, também, conduzi-lo a partir do assistente que usa no dia a dia, o Grok Bot. Hoje o `ork` só reconhece esses quatro canais e a lista é fechada: um host novo sem canal não compila em `core/src/hitl-canais.ts`, e um canal sem identidade, correlação e recibo "não pode responder".
- **Evidências e fonte:** o pedido do dono de 20/10/2026; a leitura do código e das páginas citadas acima; a pesquisa de 20/10/2026 nas fontes da seção "Fontes", reconferidas na mesma data.
- **Objetivo/OKR:** o dono acompanha e conduz o `ork` pelo Grok Bot com o mesmo contrato dos outros canais: nenhuma decisão sua é registrada sem prova do canal, e nenhum agente, o Grok inclusive, responde no lugar dele.
- **Hipótese:** se o Orkastery expuser ao Grok um servidor MCP por HTTP, com autenticação e escopo enumerado de ferramentas, e mantiver o ingresso humano como a única via de decisão, então o Grok Bot conduz status, pulse, despacho e entrega, e apresenta o gate, sem enfraquecer nenhum deles, porque o MCP remoto do Grok cobre o transporte e o contrato do `ork` já separa quem chama de quem decide.
- **Métrica principal / linha de base / meta / janela / fonte:** conversas de condução concluídas pelo Grok Bot (status, gate respondido, fase despachada) com o recibo do canal no ledger. Linha de base: zero, porque o `ork` não tem esse canal. Meta, janela e piloto: A definir pelo dono (a D1 está decidida; falta a meta). Fonte: ledger.
- **Métricas de proteção:** nenhum gate, HITL, autorização de `#Noctum` ou nota de MASTER registrado a partir de texto que o modelo escreveu; nenhum segredo do `ork` no repositório, na conversa ou na nuvem de terceiro; o contrato dos quatro canais atuais não muda; nenhuma ferramenta de escrita exposta sem escopo enumerado.

## Escopo e validação

- **Incluído:** um servidor MCP do `ork` por HTTP com autenticação e escopo enumerado; a leitura de status e pulse; o despacho de fase e a entrega, com escopo enumerado e recusa tipada no servidor; a apresentação de gate e HITL e a resposta por ingresso autenticado, se o Grok oferecer identidade provável; a autorização do `#Noctum` pelo mesmo ingresso; o ensaio real de homologação.
- **Fora de escopo:** o Grok como runtime de fase (é a [RM-067](RM-067-grok-build-homologado.md)); trocar ou aposentar Telegram, OpenClaw, Claude Code ou Codex; qualquer aprovação de gate, nota ou autorização que o Grok dê em nome do dono; contornar a política de uso do fornecedor; comprar plano ou criar conta, que continua com o dono; rodar o `ork` dentro do computador na nuvem do Bot (a decisão D1 de 21/10/2026 não o autorizou).
- **Entregáveis e critérios de aceite:** as cinco fatias da seção "Plano e decisões", cada uma com a prova listada.
- **Piloto, medição e critérios de expansão/interrupção:** A definir pelo dono (a D1 está decidida; falta o piloto). Interrompe se a política de uso do fornecedor passar a proibir o modo escolhido. Se o Grok não oferecer identidade provável, F2 e F4 param e voltam ao dono, e a condução de F1 e F3 (status, pulse, despacho, entrega) segue, sem registrar decisão do dono.

### O que o Orkastery exige de um host condutor e o que o Grok oferece

A coluna "o que o Grok oferece" cita a fonte entre parênteses (lista em "Fontes"). **Não confirmado** quer dizer que a fonte não diz ou que não foi possível ler.

| # | O que o Orkastery exige (onde está hoje) | O que o Grok oferece | Lacuna |
| --- | --- | --- | --- |
| H1 | Transporte para as ferramentas do `ork`: o `ork mcp serve` é stdio, por projeto, e o `host` aceito é `claude-code` ou `codex` (`core/src/mcp-server.ts`, `docs/referencia/cli.md`) | O Grok no app aceita um conector MCP próprio, com a URL do servidor, que "must be reachable over the public internet" (G9). O Grok Bot usa "the same MCP servers, plugins, and skills as Cursor" (G7), e um relato da comunidade fala em Streamable HTTP ou SSE por URL HTTPS pública (G14, fonte de comunidade). A API aceita MCP remoto só por Streamable HTTP e SSE (G12) | O `ork` não tem transporte HTTP nem `host` para o Grok. Escrever o servidor HTTP, e decidir onde ele roda, porque a URL precisa ser pública e as worktrees ficam na máquina do dono |
| H2 | Quem chama o servidor está autenticado, e o segredo nunca entra no repositório (`docs/referencia/fronteira-de-confianca.md`) | API: `authorization` vira o cabeçalho `Authorization` e `headers` leva outros (G12). Cursor: OAuth, `headers` estáticos e cliente OAuth fixo (G13). Conector do app: "complete any required authentication", sem dizer como (G9). O Grok Bot não aparece na página de MCP do Cursor (G13) | Não confirmado qual esquema o conector do Grok Bot e o do Grok no app aceitam em produção. O servidor do `ork` precisa de uma autenticação própria e de rotação de credencial |
| H3 | Escopo enumerado de ferramentas: o filho só recebe as ferramentas que o perfil lista | API: `allowed_tools` restringe as ferramentas, e sem ele todas entram no contexto do modelo (G12). Conector no Grok Bot é da conta, e vale para todos os Bots dela (G4). Restrição equivalente no app e no Bot: não confirmado | O servidor do `ork` tem de impor o escopo do lado dele. Nunca confiar que o cliente filtra |
| H4 | Pulse e relatório: o `ork` empurra o pulse ao host por um transporte determinístico, sem chamar modelo (`adapters/hermes/bin/ork-pulse-enviar.py`) | Automations: tarefa agendada ou disparada por e-mail, com entrega por e-mail ou notificação do app (G11). Rotinas do Bot: agenda com intervalo mínimo de cinco minutos, até 50 por Bot, resultado na conversa, e o texto não descreve push nem e-mail (G5). Mensagem do Bot ao dono sem pedido: não confirmado (G8) | O `ork` empurra e o Grok só puxa por rotina ou por pedido. Sem canal de entrega do pulse, F1 fica em leitura por consulta, e o aviso de gate parado depende de uma rotina do Bot que releia o `ork_hitl_pending` |
| H5 | Resposta de gate e HITL só com prova do canal: identidade, correlação e recibo; texto que um agente cole num argumento de ferramenta é autoaprovação e é recusado (`core/src/hitl-canais.ts`). A resposta de gate pelo Telegram é assinada pelo gateway ([RM-003](RM-003-hitl-bidirecional-telegram.md)) | O Bot "acts as the signed-in member", entra com a conta do Cursor e pode ter SSO (G6). A documentação não descreve como o remetente de uma mensagem ao Bot é autenticado nem se há evento assinado por mensagem para um servidor externo (G6). O `@bot` no X vincula a conta do X ao Grok, sem verificação à parte (G10) | **A lacuna crítica.** Sem um evento humano assinado, entregue a um servidor do `ork`, a chamada de ferramenta vem do modelo, e o modelo não é o dono. O Grok não pode ser canal de decisão antes de resolver isso (F2) |
| H6 | Despacho de fase com uma execução por worktree, lease e idempotência ([RM-036](RM-036-maestro-multicanal.md)) | O Bot tem navegador, arquivos e terminal numa nuvem persistente (G4). Instalar e rodar o `ork` nela: não confirmado, e a página fala em "manually installed packages" como descartáveis (G4) | Pelo MCP remoto, o servidor roda onde estão as worktrees. Pelo terminal do Bot, o repositório e as credenciais ficariam na nuvem de um terceiro, o que esta página não propõe |
| H7 | A decisão é um gate do `ork`, nunca uma confirmação do host | O Bot tem aprovação por ação e o Auto Review, "an independent model", que "does not review every side effect" (G6). A API não suporta `require_approval` (G12) | A aprovação do Grok não substitui o gate. As ferramentas de escrita têm de se proteger no servidor |
| H8 | Autorização do `#Noctum` só por ingresso autenticado, nunca por comando no terminal (`docs/referencia/cli.md`, [RM-058](RM-058-modo-noctum.md)) | Mesma lacuna de H5 | Resolvida só se H5 for resolvida |
| H9 | Termos que permitam um humano conduzir um sistema por um agente | A documentação do Grok Bot não traz política de uso para automação (G3). A política de uso da xAI de 26/06/2026 lista "bots" entre os acessos vedados, segundo um resultado de busca; a página oficial recusou o leitor e o texto não foi lido (G15) | Não confirmado. A leitura jurídica e a decisão são do dono |
| H10 | Disponibilidade estável para o dono | O Grok Bot entra em SuperGrok, SuperGrok Plus e Heavy, Cursor Pro, Pro+, Ultra e Teams, com a versão para empresas em fila de espera, e tem um pool de uso próprio (G1). O `@bot` no X não está disponível para contas no Reino Unido, na União Europeia e na Austrália (G10). O anúncio de ampliação de planos é de 26/08/2026, e a data de início de 11/08/2026 só aparece em fontes de terceiros | Sem prova de que o contrato do produto esteja estável. O adaptador precisa de teste de contrato e de recusa quando o formato mudar |

O que **existe**: conector MCP próprio no Grok e na API; rotinas e Automations agendadas; terminal na nuvem do Bot; conta com SSO. O que **não existe, ou não foi confirmado**: servidor HTTP do `ork` para a condução (o da F4c da [RM-067](RM-067-grok-build-homologado.md) só serve a sessão filha do Grok Build, em `127.0.0.1` e com token por despacho, sem nenhuma ferramenta do dono); identidade assinada por mensagem para um servidor externo; API ou webhook do Bot (G8); mensagem proativa do Bot ao dono; canal do Grok no registro de canais do `ork`; permissão expressa da política de uso para esse modo.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** A definir pelo dono. A posição no índice de prioridade do roadmap é decisão dele; esta página não a propõe.
- **Horizonte / alvo / previsão / confiança / marcos:** sem data. As fatias abaixo são propostas, na ordem, e cada uma só começa depois da anterior mesclada. A D1 está decidida (21/10/2026), então a F1 pode começar quando o dono priorizar o item.
- **Dependências e bloqueios (ID, owner, próxima revisão):** a decisão D1 (superfície), decidida pelo dono em 21/10/2026; [RM-003](RM-003-hitl-bidirecional-telegram.md), [RM-048](RM-048-hitl-humano-no-centro.md) e [RM-057](RM-057-hitl-por-alternativas.md) (o contrato do ingresso e do HITL); [RM-036](RM-036-maestro-multicanal.md) (condução multicanal e lease); [RM-058](RM-058-modo-noctum.md) (o envelope e a autorização, para F4). Próxima revisão: Julio, após ler esta página.

### Fatias propostas

| Fatia | O que entrega | Critério de aceite (a provar) |
| --- | --- | --- |
| F1 Condução de status, pulse e despacho | Servidor MCP do `ork` por HTTP com autenticação e escopo enumerado, com as ferramentas de leitura (estado da thread, panorama, roadmap, pedidos de HITL pendentes) e a ferramenta de despacho de fase, com a mesma recusa tipada da [RM-036](RM-036-maestro-multicanal.md); a rotina do Bot que relê os pendentes e avisa o dono. Não é só leitura. As ferramentas de decisão (gate, HITL, `#Noctum`) ficam fora do escopo até F2 e F4 | Teste: chamada sem credencial ou com credencial inválida é recusada com erro tipado; a lista de ferramentas é exatamente a enumerada e uma ferramenta fora dela chamada pelo nome é recusada; o servidor não aceita outra raiz de projeto que a fixada; nenhum segredo no ledger nem na saída; o canal `grok` é declarado sem autoridade (como o dos outros hosts); um segundo despacho na mesma worktree recebe `conducao.em-andamento` com as três ações; o mesmo pedido repetido não abre sessão nova; despacho sem escopo é recusado. Os testes do stdio passam sem alteração |
| F2 Resposta de gate e HITL pelo ingresso autenticado | O Grok apresenta o gate no formato da [RM-057](RM-057-hitl-por-alternativas.md) (3 a 5 alternativas, uma recomendada); a decisão só é registrada com prova de origem humana do canal: resposta curta presa à pergunta pendente, com a prova pelo canal, como na RM-057 | Teste: uma chamada de ferramenta com a resposta escrita pelo modelo, sem a prova do canal, é recusada e não grava `human_gate` (o canário `fx-blanket-approve` vale para este host); só uma resposta com identidade, correlação e recibo no contrato `ork.hitl-canais/v1` registra. A fatia só começa se o Grok oferecer essa prova (H5), com o contrato de canal ampliado por decisão registrada |
| F3 Entrega | Ferramenta de entrega (`ork ship`) no escopo do servidor, com os HEADs de origem e destino conferidos pelo núcleo; o Grok conduz a entrega, o merge e o push seguem as regras do `ork` | Teste: entrega sem escopo é recusada; entrega com HEAD diferente do esperado é recusada com erro tipado; retorno `incomplete` não é repetido sem reconciliar estado e remoto; a mesma entrega repetida não duplica o merge; o canal `grok` não aprova gate por esta via |
| F4 Autorização do #Noctum | O envelope e a revogação do `#Noctum` pelo mesmo ingresso, por resposta curta presa à pergunta pendente e com a prova pelo canal (regra da RM-057); começa só se o Grok oferecer essa prova (H5) | Teste: um "autorizar" escrito pelo modelo não cria envelope; só o ingresso com o recibo `ork.noctum-ingresso/v1` cria. Nenhum arco é autorizado por esta fatia, e o modo segue sem habilitação |
| F5 Homologação com ensaio real | Uma thread `#Fast` conduzida do pedido ao fecho pelo Grok Bot, com credencial que o dono autoriza | O ensaio fecha com o ledger sem auto-relato como prova, o recibo do canal em cada decisão do dono e o `ork verify` verde. Se o Grok ainda não oferecer a prova de F2, o ensaio cobre só o que não é decisão do dono e a lacuna fica declarada no relatório do ensaio. Se o fornecedor não autorizar o modo, a fatia para e volta ao dono |

- **Premissas / riscos / mitigação:**
  - **Identidade sem prova (H5):** o maior risco. Se o Grok não entrega um evento humano assinado, ele conduz status, pulse, despacho e entrega, mas nunca registra decisão do dono. Mitigação: F1 e F3 não dependem disso, F2 e F4 só começam com a prova, e a lacuna segue dita enquanto a prova não existir.
  - **Servidor público:** o conector exige URL pública (G9). Expor o `ork` à internet aumenta a superfície. Mitigação: escopo enumerado imposto no servidor, autenticação própria com rotação, recusa tipada e idempotência nas ferramentas de escrita (despacho e entrega), nenhuma ferramenta de decisão sem o ingresso, e a [fronteira de confiança](../referencia/fronteira-de-confianca.md) como contrato.
  - **Política de uso (H9):** o texto vigente não foi lido. Mitigação: a decisão é do dono, e F5 para se o fornecedor não autorizar.
  - **Produto novo e mutável (H10):** o produto é recente e o formato do conector não está confirmado. Mitigação: teste de contrato no servidor e recusa explícita do formato desconhecido.
  - **Computador compartilhado entre Bots:** "Do not use separate Bots as a security boundary" (G3, G6). Mitigação: nenhum segredo do `ork` e nenhuma worktree no computador do Bot.
  - **Lista de canais fechada:** acrescentar um canal muda o contrato de `hitl-canais.ts`. Mitigação: o contrato muda por decisão registrada, com teste que reprove canal sem os três atributos.
- **Não-objetivos:** só leitura (o dono pediu a condução completa); trocar o canal do dono; deixar o Grok aprovar gate, dar nota ou autorizar arco; rodar o `ork` na nuvem do Bot; prometer paridade de experiência com o Telegram.

### Decisões

**D1. Por qual superfície o Grok conduz o `ork`. Decidida pelo dono em 21/10/2026: alternativa a, com a condução completa.** O texto do dono: "2.a (não quero só leitura, quero completo)". Consequência: a alternativa a deixa de ser "leitura primeiro" e passa a ser o MCP do `ork` por HTTP com autenticação e escopo enumerado conduzindo status, pulse, despacho, entrega, gate, HITL e `#Noctum`. A prova de que foi o dono continua exigida para gate e `#Noctum` (RM-057), e a lacuna H5 segue aberta. As alternativas b e c ficam como foram propostas, não escolhidas.

Contexto da decisão, como estava quando foi pedida: A fonte confirma o transporte (MCP remoto por HTTP) e não confirma a identidade assinada por mensagem (H5), que é o que decide se o Grok pode ser canal de decisão. Nada disso foi presumido.

| Alternativa | O que significa | Custo e risco |
| --- | --- | --- |
| **a (escolhida pelo dono, com o escopo ampliado)** | O MCP do `ork` por HTTP com autenticação e escopo enumerado. Na proposta original, leitura primeiro (F1), com gate, HITL e `#Noctum` só pelo ingresso que já existe (Telegram, OpenClaw, host nativo) e F2 em diante só se o Grok passasse a oferecer identidade provável. O dono ampliou: condução completa | Custo: um servidor HTTP novo e a autenticação dele, e mais superfície exposta, porque o despacho e a entrega ficam no escopo. O Grok não decide nada pelo dono: gate e `#Noctum` só com a prova |
| b | Um gateway próprio, como o do Hermes, que recebe o que o Grok enviar e assina o ingresso | Não há entrada documentada do Grok Bot para um gateway ouvir (API ou webhook, não confirmado), e um canal novo muda o contrato de `hitl-canais.ts`. Serviço público a construir e manter |
| c | Esperar o recurso oficial: API ou webhook do Grok Bot com identidade assinada | Sem risco de segurança e sem custo agora. O Grok não conduz nada até lá; só esta página existe |

**Decisão da condutora, registrada no ledger (20/10/2026):** a página cita a [RM-067](RM-067-grok-build-homologado.md) só para separar condução de runtime, porque o pedido do dono pede essa distinção por escrito.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-10-21 | Julio |
| Documentação | Rascunho | — | 2026-10-21 | Julio |
| Código | Não iniciado | — | 2026-10-21 | Julio |
| Testes | Não iniciados | — | 2026-10-21 | Julio |
| Deploy | Não implantado | — | 2026-10-21 | Julio |
| Exposição | Flag desligada | — | 2026-10-21 | Julio |
| Habilitação | Pendente | — | 2026-10-21 | Julio |

<!-- ork-docs:estado:fim -->

### Fontes

Consultadas em 20/10/2026. Cada fato da página que depende de fornecedor aponta para uma delas.

- G1: <https://x.ai/news/grok-bot-more-plans> (26/08/2026): planos, pool de uso, fila de espera de empresas
- G2: <https://docs.x.ai/grok-bot>: visão geral, computador na nuvem, navegador e terminal, o `@bot` no X, índice da documentação
- G3: <https://docs.x.ai/grok-bot/faq>: um computador por conta, conta do Cursor, planos, "Do not use separate Bots as a security boundary", sem política de uso para automação
- G4: <https://docs.x.ai/grok-bot/computer-and-apps>: conectores como plugins, da conta, linha de comando e credenciais compartilhadas
- G5: <https://docs.x.ai/grok-bot/skills-routines-and-automations>: rotinas, agenda de no mínimo cinco minutos, limite de 50, resultado na conversa
- G6: <https://docs.x.ai/grok-bot/security>: "Bots act as the signed-in member", aprovações e Auto Review, SSO; o remetente da mensagem não é descrito
- G7: <https://x.ai/bot/guides/grok-bot-101>: "the same MCP servers, plugins, and skills as Cursor"; rotinas e gatilhos
- G8: <https://docs.x.ai/grok-bot/bots>: conversas em grupo; API, webhook e mensagem proativa: não cobertos
- G9: <https://docs.x.ai/grok/connectors>: conector MCP próprio no Grok, URL pública
- G10: <https://docs.x.ai/grok-bot/tag-on-x>: o `@bot` no X, vínculo de conta, regiões sem suporte
- G11: <https://x.ai/news/grok-automations> (16/07/2026): Automations, agendas, gatilho de e-mail, entrega
- G12: <https://docs.x.ai/developers/tools/remote-mcp>: MCP remoto na API, Streamable HTTP e SSE, `authorization`, `allowed_tools`, sem `require_approval`
- G13: <https://cursor.com/docs/mcp>: transportes, OAuth e cabeçalhos estáticos; o Grok Bot não é citado
- G14: <https://forum.cursor.com/t/grokbot-custom-connectors/169965> (30/08/2026): resposta da comunidade, não da xAI, sobre adicionar um conector pedindo ao Bot
- G15: <https://x.ai/legal/acceptable-use-policy>: a página oficial negou acesso ao leitor automático; o conteúdo da versão de 26/06/2026 vem de um resultado de busca, sem leitura do texto
- G16: <https://docs.x.ai/developers/tools/function-calling>: na API, a chamada de função roda no código do cliente, nunca no do modelo

Pontos que a página não confirma: o esquema de autenticação do conector do Grok Bot; se o Bot entrega um evento assinado de mensagem humana a um servidor externo; se o `ork` roda no computador do Bot; a mensagem proativa do Bot; o texto atual da política de uso; a data de 11/08/2026 para o início do Grok Bot, que só aparece em fontes de terceiros.

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: condutor da thread `ork-grokbot`, só para esta página; A: Julio; C: A definir; I: A definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a página foi redigida por agente em #Fast, a partir do pedido do dono e das fontes citadas; revisor humano: Julio. Nenhum código foi escrito.
- **Próxima ação, responsável e prazo:** Julio decide a posição do item no índice de prioridade e a meta e o piloto; a D1 está decidida; sem prazo definido.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-20 | Item criado em Discovery, com cinco fatias propostas e a decisão D1 aberta | Pedido do dono de 20/10/2026; fontes reconferidas na mesma data | Julio |
| 2026-10-21 | D1 decidida: alternativa a com a condução completa, não só leitura; F1 passa a incluir o despacho, a entrega vira F3, e a prova de que foi o dono segue a RM-057 para gate e `#Noctum` | Resposta do dono no terminal ao resumo das 07h: "2.a (não quero só leitura, quero completo)". O item segue em Discovery, sem código nem teste | Julio |
