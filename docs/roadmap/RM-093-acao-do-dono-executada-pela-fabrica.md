---
id: RM-093
tipo: roadmap
titulo: Ação do dono executada pela fábrica
categoria: iniciativa
pai: RM-048
features: []
owner: Julio
atualizado_em: 2026-11-23T11:02:31-03:00
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

# RM-093 — Ação do dono executada pela fábrica

> **Em uma frase:** depois de uma resposta curta autenticada, a fábrica executa uma ação reservada ao dono com os parâmetros exatos apresentados na pergunta, fora da sessão do agente e com recibo e reversão.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** o dono ainda pode ser chamado a abrir um terminal para concluir uma ação que só depende de sua autorização. A decisão é humana; a execução repetitiva e a prova pertencem à fábrica.
- **Evidências e fonte:** requisito 005 do realinhamento aprovado pelo dono em 23/11/2026. O caso de aceite é responder `1a` no Telegram a uma pergunta de tag e receber o resultado sem abrir o terminal.
- **Objetivo/OKR:** separar a autorização humana da execução operacional, sem permitir que agente, repetição de mensagem ou pergunta genérica amplie o alcance autorizado.
- **Hipótese:** se a resposta autenticada ficar ligada a uma ação catalogada e a parâmetros imutáveis, então a fábrica executa uma vez e prova o resultado sem transferir trabalho operacional ao dono.
- **Métrica principal / linha de base / meta / janela / fonte:** razão entre ações autorizadas que terminam com recibo completo e autorizações válidas recebidas. A linha de base será medida no piloto; a fonte é o ledger e a prova do executor.
- **Métricas de proteção:** zero execução por resposta repetida; zero parâmetro diferente do apresentado; zero ação fora do catálogo; nenhuma alternativa recomendada contém comando de terminal.

## Escopo e validação

- **Incluído:** catálogo fechado; pergunta curta pelo padrão da [RM-048](RM-048-hitl-humano-no-centro.md); autorização pelo contrato único da [RM-092](RM-092-ratificacao-autenticada-de-contrato-publico-no-auto.md); execução fora da sessão do agente; chave de uso único; recibo no ledger; resultado e instrução de reversão.
- **Fora de escopo:** ação arbitrária; texto livre como programa; aprovação por argumento de ferramenta; execução dentro da sessão que formulou a pergunta; criação nesta página de nomes públicos de comandos, eventos ou schemas.
- **Entregáveis e critérios de aceite:** o dono responde `1a` no Telegram a uma pergunta de tag vinculada à versão e ao SHA, e a fábrica cria a tag sem pedir terminal; repetir a resposta não executa de novo; ação fora do catálogo é recusada com motivo; nenhum parâmetro pode ser trocado depois da pergunta; nenhuma recomendação ensina comando ao dono.
- **Piloto, medição e critérios de expansão/interrupção:** começar pela ação de tag em um repositório de teste. Expandir uma ação por vez quando autorização, idempotência, recibo e reversão forem provados. Interromper diante de execução duplicada, parâmetro divergente, autoria inconclusiva ou reversão ausente.

### Catálogo fechado inicial

| Ação reservada | Parâmetros presos à pergunta | Pré-condições conferidas pelo executor | Como desfazer |
| --- | --- | --- | --- |
| Criar tag de versão | versão, repositório e SHA | versão permitida, SHA existente e política de publicação atendida | remover ou substituir a referência conforme a política registrada |
| Integrar entrega | PR, HEAD fonte e HEAD destino | verify, CHECK e CI verdes no mesmo conteúdo | reverter a integração pelo fluxo da forja |
| Promover site | site, versão e ambiente | artefato aprovado e destino idêntico ao perguntado | restaurar a versão anterior |
| Reiniciar gateway | gateway e implantação | alvo permitido e estado observável | restaurar a implantação anterior ou repetir com a versão anterior |

Uma ação nova exige mudança explícita do catálogo no PLAN do item e ratificação do dono. Sem entrada no catálogo, a resposta é recusada e o motivo é registrado.

### Fatias

| Ordem | Fatia | Critério de aceite verificável |
| --- | --- | --- |
| F1 | Autorização de uso único | Pergunta, resposta, prova do canal, ação, parâmetros e validade compartilham a mesma impressão; alteração de qualquer campo invalida a autorização |
| F2 | Executor separado da sessão | A sessão do agente apenas formula a proposta; um executor do núcleo confere o recibo e realiza exatamente uma tentativa registrada |
| F3 | Tag de versão | O cenário do Telegram cria a tag no SHA apresentado, recusa replay e prova resultado e reversão sem instruir o dono a usar terminal |
| F4 | Demais ações catalogadas | Cada ação ganha guardas próprias, prova de pré-condições, resultado tipado, idempotência e caminho de reversão antes de ser habilitada |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** frente A do realinhamento aprovado em 23/11/2026; precede as ações que dependem de autorização operacional.
- **Horizonte / alvo / previsão / confiança / marcos:** Discovery; F1 a F4. Previsão será definida no PLAN da implementação.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-048](RM-048-hitl-humano-no-centro.md) para a pergunta; [RM-092](RM-092-ratificacao-autenticada-de-contrato-publico-no-auto.md) para autorização; verify, CHECK, CI, forja e transporte autenticado para as ações correspondentes. Owner: Julio; revisão antes do PLAN.
- **Premissas / riscos / mitigação:** resposta pode chegar duas vezes; a chave é consumida uma vez. Parâmetro pode mudar entre pergunta e execução; o executor compara a impressão completa. Agente pode tentar ampliar a ação; o catálogo e o executor recusam campos não apresentados. Reversão pode depender da forja ou do ambiente; a ação só habilita quando seu caminho de reversão estiver provado.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** o dono aprovou o resultado e o catálogo inicial no realinhamento de 23/11/2026. Nomes públicos e contratos de implementação serão ratificados no PLAN do item.

## Estado com evidências

O item está em Discovery. Esta página não declara implementação, teste, deploy ou habilitação.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-11-23 | Julio |
| Documentação | Rascunho | — | 2026-11-23 | Julio |
| Código | Não iniciado | — | 2026-11-23 | Julio |
| Testes | Não iniciados | — | 2026-11-23 | Julio |
| Deploy | Não implantado | — | 2026-11-23 | Julio |
| Exposição | Flag desligada | — | 2026-11-23 | Julio |
| Habilitação | Pendente | — | 2026-11-23 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: futura thread de implementação; A: Julio; C: segurança, operadores das ações e responsáveis pelos canais; I: builders que conduzem a fábrica.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO do realinhamento estruturou a página dentro do escopo aprovado; nenhuma ação foi executada e nenhum contrato público foi nomeado.
- **Próxima ação, responsável e prazo:** planejar F1 e a ação de tag depois da consolidação da RM-048 e da RM-092; responsável: futura thread; sem prazo declarado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-23 | Item criado em Discovery na frente A | Requisito 005 e realinhamento aprovado pelo dono | Julio aprovou o resultado; sessão GO estruturou a página |
