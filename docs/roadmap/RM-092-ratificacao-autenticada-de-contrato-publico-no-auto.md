---
id: RM-092
tipo: roadmap
titulo: "Ratificação autenticada de contrato público no #Auto"
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-12T03:17:59-03:00
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

# RM-092 — Ratificação autenticada de contrato público no #Auto

> **Em uma frase:** um contrato público novo só segue no `#Auto` depois que o dono ratifica seus nomes exatos por um canal autenticado e o CHECK confere o recibo, sem ampliar seu alcance por inferência.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Origem

Pedido do dono no terminal, em 12/11/2026. A condução apresentou alternativas para a ratificação dos nomes públicos da RM-090 F3, e o dono respondeu "1a", escolhendo esta:

> "Vale a ratificação de hoje: faço o merge da F3 e abro no roadmap uma fatia que dá ao Orkastery um pedido de ratificação autenticado."

Esta página registra a evolução futura. A resposta não escolhe o nome do pedido, do recibo, de um comando ou de qualquer outro contrato público da implementação.

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz uma thread em `#Auto` precisa interromper somente a parte que depende de uma decisão humana de classe 2, apresentar os nomes públicos propostos e obter uma resposta cuja autoria o CHECK consiga conferir. Hoje a resposta pode chegar ao condutor, mas não existe um recibo autenticado próprio para ratificação de contrato público.
- **Evidências e fonte:** a lista fechada de escaladas humanas está em `core/src/hitl-gates.ts:214-215`: `policy.violation`, `cost.violation`, `retry.max_tentativas`, `hitl.credencial`, `runtime.unavailable` e `claims.retirada-sem-substituta`. Fora de uma pausa do modo ou dessas escaladas, o `#Auto` não abre um pedido ao dono. O `gate approve` está aposentado em `docs/referencia/cli.md`, e a palavra `ratificar` do Pulse atende a nota do MASTER, não nomes de um contrato público.
- **Casos que tornaram a lacuna observável:** o CHECK independente da RM-090 F3 registrou B2 porque a decisão de classe 2 não tinha ratificação humana autenticada. Na RM-090 F5, B6 e B7 exigiram separar os nomes efetivamente ratificados dos nomes adicionais e impedir que a ratificação fosse estendida por inferência. A condução registrou respostas do dono no ledger, mas esse registro feito pela própria condução não prova ao CHECK quem respondeu.
- **Objetivo/OKR:** permitir que a condução abra um pedido curto de ratificação para nomes de contrato público, receba a escolha pelo ingresso humano autenticado e produza um recibo que o CHECK valide contra os nomes exatos da mudança.
- **Hipótese:** se pergunta, resposta e recibo forem ligados à mesma proposta e ao mesmo ingresso autenticado, então o CHECK consegue distinguir ratificação humana de relato da condução e bloquear somente os nomes que ainda esperam decisão.
- **Métrica principal / linha de base / meta / janela / fonte:** proporção de nomes públicos novos aceitos pelo CHECK com recibo autenticado que cite o mesmo nome. A linha de base e a meta serão medidas na fatia de implementação, sem número inventado nesta página. A fonte será o ledger e os casos do CHECK.
- **Métricas de proteção:** nenhum agente assume a identidade do dono; nenhum recibo cobre nome ausente; uma mudança na proposta invalida a resposta anterior; a falta de resposta não paralisa trabalho independente.

## Escopo e validação

- **Incluído:** pedido tipado com nomes, alternativas e recomendação; resposta pelo ingresso autenticado já existente; recibo no ledger com autor, canal, horário, proposta e nomes exatos; leitura do recibo pelo CHECK; espera parcial no `#Auto`; apresentação no formato curto do HITL.
- **Fora de escopo:** substituir a classificação de decisões; reativar `gate approve`; usar a ratificação da nota do MASTER como ratificação genérica; aceitar texto de agente como autoria humana; mudar os recibos de CI e de forja da RM-089; decidir nesta página os nomes públicos da implementação.
- **Entregáveis e critérios de aceite:** as quatro fatias abaixo, cada uma com prova executável na futura thread de implementação.
- **Piloto, medição e critérios de expansão/interrupção:** o piloto deve usar nomes públicos ainda não publicados e um canal autenticado já homologado. A expansão para outro canal para se houver recibo sem autoria conferível, nome aceito fora da lista, resposta reaproveitada depois de a proposta mudar ou bloqueio de fase independente.

### Fluxo pretendido

1. A condução classifica a decisão como classe 2 e monta uma proposta com os nomes exatos, as alternativas e uma recomendação.
2. O núcleo abre um pedido curto e o entrega pelo canal autenticado; no Telegram, a resposta usa o código curto associado ao pedido.
3. O ingresso confere a origem da resposta e grava no ledger autor, canal, horário, identificador da proposta, alternativa e nomes cobertos.
4. O CHECK compara cada nome público do diff com o recibo. Nome ausente, diferente ou acrescentado depois continua sem ratificação.
5. Sem resposta no `#Auto`, a fase que depende desses nomes espera; trabalho que não depende deles continua.

### Fatias

| Ordem | Fatia | Critério de aceite verificável |
| --- | --- | --- |
| F1 | Contrato do pedido e do recibo | Testes de contrato provam que o pedido contém proposta, nomes exatos, alternativas e uma recomendação; o recibo contém autor, canal, horário, escolha e vínculo com a mesma proposta; campo ausente ou proposta alterada é recusado |
| F2 | Resposta pelo ingresso autenticado | Um caso pelo Telegram entrega o pedido curto, aceita o código ligado à mensagem e grava o recibo com a identidade conferida pelo gateway; mensagem de outra conta, outro pedido ou agente da sessão é recusada; o mesmo conjunto de casos vale para cada canal acrescentado |
| F3 | Guarda de contrato público no CHECK | Um teste de diff aceita somente os nomes citados no recibo e reprova nome novo, grafia diferente, prefixo semelhante ou nome acrescentado depois; o CHECK aponta o pedido correspondente sem atribuir a decisão ao agente |
| F4 | Espera parcial no `#Auto` | Um cenário com duas tarefas prova que a dependente do nome permanece em espera sem resposta e que a independente avança; ao chegar o recibo válido, somente a dependente é retomada e o rastro preserva a ordem dos eventos |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** item aberto por decisão direta do dono em 12/11/2026; prioridade e pontuação ainda não definidas.
- **Horizonte / alvo / previsão / confiança / marcos:** Discovery; marcos F1 a F4; sem previsão de entrega nesta página.
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-048, RM-089, RM-090, ingresso autenticado e classificação de decisões; owner: Julio; próxima revisão antes de abrir a thread de implementação.
- **Premissas / riscos / mitigação:** um recibo genérico pode autorizar nomes não vistos; a F3 compara strings exatas. O canal pode transportar uma resposta sem provar sua origem; a F2 exige o ingresso homologado e não confia no texto. Uma espera pode congelar a thread inteira; a F4 separa dependências. O próprio nome do novo contrato é público; D1 exige ratificação antes de ser publicado.

### Relações com o roadmap e o MASTER

- **[RM-048](RM-048-hitl-humano-no-centro.md):** fornece a pergunta curta, as alternativas, a recomendação e a prova de origem humana que esta página especializa para contrato público.
- **[RM-089](RM-089-orkastery-network-coletiva-da-empresa.md):** define recibos conferidos na fronteira do Git e da forja. A ratificação desta página autoriza nomes; não substitui o recibo de execução, verify ou CHECK exigido pela política empresarial.
- **[RM-090](RM-090-telemetria-opentelemetry-para-sdlc-analytics.md):** originou os casos B2, B6 e B7 e fornece o cenário em que cada nome de evento ou atributo precisa de cobertura explícita.
- **MASTER:** a nota já tem pedido por código curto e recibo do canal autenticado. Esse caminho é a referência de ingresso e autoria, mas sua ação `ratificar` continua limitada à nota e às classes do MASTER.

### Decisões abertas para o dono

As recomendações abaixo orientam a futura ratificação; não são decisões tomadas por esta página.

**D1 — contrato público do pedido e do recibo**

- **A. Contrato próprio e versionado para ratificação de nomes — Recomendação.** Separa a autorização de contrato público de gates e da nota do MASTER e permite ao CHECK validar um schema específico.
- **B. Especialização do contrato de HITL existente.** Reutiliza mais campos, mas mistura decisão de condução com recibo de contrato público.
- **C. Evento genérico de decisão no ledger.** Exige menos estrutura nova, mas não resolve a prova de autoria nem a cobertura exata dos nomes.

**D2 — vínculo e validade da ratificação**

- **A. Lista exata de nomes ligada à impressão da proposta — Recomendação.** Continua válida enquanto proposta e nomes forem idênticos; qualquer alteração exige nova resposta.
- **B. Um recibo separado por nome.** Torna o alcance explícito, mas multiplica pedidos e respostas para uma única proposta.
- **C. Recibo válido pela fase inteira.** É mais curto, mas pode alcançar por inferência um nome que o dono não viu.

**D3 — canais da primeira entrega**

- **A. Telegram e diálogo nativo do host pelo mesmo ingresso — Recomendação.** Reaproveita canais autenticados já usados pelo HITL e mantém a resposta perto de onde o dono está.
- **B. Somente Telegram no piloto.** Reduz a primeira superfície, mas faz a ratificação depender de um canal.
- **C. Somente diálogo nativo do host no piloto.** Evita transporte externo, mas não atende a condução móvel.

## Fontes oficiais externas

- Telegram: a [Bot API](https://core.telegram.org/bots/api) define os objetos `Update` e `Message`, a identidade informada do remetente e as referências entre mensagens. Esses dados são primitivas do transporte; a política de contas autorizadas e a assinatura do ingresso continuam sendo responsabilidade do Orkastery.
- GitHub: [rulesets e status checks obrigatórios](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets), usados pela relação com os recibos de forja da RM-089.
- GitLab: [external status checks](https://docs.gitlab.com/user/project/merge_requests/status_checks/), usados pela mesma relação de paridade da RM-089.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-11-12 | Julio |
| Documentação | Rascunho | — | 2026-11-12 | Julio |
| Código | Não iniciado | — | 2026-11-12 | Julio |
| Testes | Não iniciados | — | 2026-11-12 | Julio |
| Deploy | Não implantado | — | 2026-11-12 | Julio |
| Exposição | Flag desligada | — | 2026-11-12 | Julio |
| Habilitação | Pendente | — | 2026-11-12 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: futura thread de implementação; A: Julio; C: CHECK, segurança e responsáveis pelos canais autenticados; I: builders que usam `#Auto`.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO da thread `ork-rm092ratific`, em `#Auto`, criou somente esta página e o índice. As decisões D1 a D3 permanecem com o dono.
- **Próxima ação, responsável e prazo:** o dono prioriza o item e ratifica as decisões públicas quando a implementação for planejada; sem prazo definido nesta página.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-12 | RM-092 criada em Discovery, sem fatia implementada | Pedido do dono no terminal e resposta `1a`; incidentes B2, B6 e B7 da RM-090 | Julio abriu o item; sessão GO estruturou a página |
