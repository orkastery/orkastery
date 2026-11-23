---
id: RM-094
tipo: roadmap
titulo: Caixa de intenções
categoria: iniciativa
pai: null
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

# RM-094 — Caixa de intenções

> **Em uma frase:** o dono registra uma ideia sem trocar de frente, preserva o texto e o contexto, continua o trabalho e só transforma a captura em item, fatia ou thread por promoção explícita.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** o dono formula ideias durante uma fase e precisa escolher entre interromper a frente atual ou confiar na memória. A captura deve caber no jeito em que ele já fala, sem autorizar trabalho novo.
- **Evidências e fonte:** requisito 001 do realinhamento aprovado em 23/11/2026: registrar três ideias durante um GO, continuar e recuperar as três com o contexto original, sem redigitar nem executar indevidamente.
- **Objetivo/OKR:** tornar a captura rápida, recuperável e separada de priorização, planejamento e execução.
- **Hipótese:** se o texto original e a origem forem imutáveis e a promoção exigir ato explícito, então ideias deixam de se perder sem desviar a thread em curso.
- **Métrica principal / linha de base / meta / janela / fonte:** proporção de capturas recuperadas com texto, origem e contexto íntegros. A linha de base será medida no piloto; a fonte é o registro da caixa e os recibos de captura.
- **Métricas de proteção:** captura nunca inicia fase, thread ou ação; proposta da IA nunca vira prova; texto livre nunca atravessa a rede coletiva; nenhuma colisão semântica com contratos existentes é publicada sem ratificação.

## Escopo e validação

- **Incluído:** texto original imutável; origem com canal, thread, fase, máquina e maestro; contexto; relações sugeridas; estados `capturada`, `triada`, `promovida`, `adiada` e `descartada`; promoção explícita para item, fatia ou thread; linha de status com contagem; triagem em lote; projeção mínima para a rede coletiva.
- **Fora de escopo:** executar a captura; substituir backlog ou roadmap; alterar silenciosamente o texto original; usar proposta organizada pela IA como evidência; publicar o texto livre na rede; definir nesta página nomes públicos de comandos ou schemas.
- **Entregáveis e critérios de aceite:** durante um GO, o dono registra três ideias por fala natural, continua a fase e depois recupera as três com texto e contexto sem redigitar; nenhuma captura abre trabalho; promoção exige confirmação explícita e deixa vínculo com o destino.
- **Piloto, medição e critérios de expansão/interrupção:** piloto no Telegram, no terminal e dentro de uma sessão. Expandir para a rede quando a [RM-054](RM-054-roadmaps-e-threads-da-rede.md) estiver habilitada. Interromper se houver execução sem promoção, alteração do texto original ou vazamento de texto livre.

### Registro e ciclo de vida

| Campo | Regra |
| --- | --- |
| Texto original | Imutável e preservado exatamente como entrou |
| Organização proposta | Sinal produzido pela IA, revisável e nunca usado como prova |
| Origem | Canal, thread, fase, máquina e maestro, sem dado privado na superfície pública |
| Contexto | Assunto em curso e referência necessária para entender a captura depois |
| Relações sugeridas | Itens e threads candidatos, sempre marcados como sugestão |
| Estado | Capturada, triada, promovida, adiada ou descartada, com histórico de transição |
| Promoção | Ato explícito que cria ou vincula item, fatia ou thread; a captura por si só não autoriza nada |

### Fatias

| Ordem | Fatia | Critério de aceite verificável |
| --- | --- | --- |
| F1 | Captura local sem troca de frente | As três capturas do caso de aceite permanecem recuperáveis e nenhuma muda o ciclo ou inicia execução |
| F2 | Status e triagem em lote | O status mostra uma linha com contagem por estado; o lote permite promover, adiar ou descartar cada captura sem perder o original |
| F3 | Projeção na rede coletiva | Com a RM-054 habilitada, a rede recebe somente id, estado, item relacionado e origem; o texto livre não aparece no transporte nem no cache |
| F4 | Promoção explícita | Item, fatia ou thread nascem com vínculo para a captura e recibo da confirmação; sugestão da IA sem confirmação não produz destino |

### Limites de linguagem e contratos existentes

`IntencaoLivre` e `ork_session_inbox` já usam “intenção” e “inbox” com outros sentidos no produto. O PLAN deve inventariar essas colisões e submeter qualquer nome público à ratificação do dono. Esta página descreve o resultado como “caixa de intenções”, mas não escolhe nomes de comando, tipo ou evento.

A RM-094 não repete a [RM-013](RM-013-maestro-objetivo.md). A RM-013 guardava um objetivo-envelope do modo Maestro e foi descontinuada por falta de uso. A caixa guarda múltiplas capturas sem alterar o objetivo corrente, sem envelope de execução e sem efeito até promoção explícita.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** frente B, depois das primeiras medidas da RM-071; aprovada pelo dono em 23/11/2026.
- **Horizonte / alvo / previsão / confiança / marcos:** F1 após RM-071 F1 e F2; F2 a F4 em seguida. Previsão será definida no PLAN.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-054](RM-054-roadmaps-e-threads-da-rede.md) habilitada para F3; [RM-089](RM-089-orkastery-network-coletiva-da-empresa.md) para projeção coletiva; [RM-048](RM-048-hitl-humano-no-centro.md) para confirmação curta de promoção. Owner: Julio; revisão antes do PLAN.
- **Premissas / riscos / mitigação:** captura pode parecer tarefa; toda superfície declara “sem execução”. Relação sugerida pode parecer fato; o campo carrega origem IA e estado de sugestão. Texto livre pode conter dado privado; somente a projeção fechada atravessa a rede. Vocabulário pode colidir; nomes públicos ficam para o PLAN e ratificação.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** o dono aprovou captura no fluxo natural, promoção explícita, linha no status e projeção mínima em 23/11/2026.

## Estado com evidências

O item está em Discovery. A RM-054 permanece dependência de habilitação para a projeção coletiva.

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

- **RACI (R / A / C / I):** R: futura thread de implementação; A: Julio; C: responsáveis por rede, privacidade e experiência; I: builders e maestros.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO do realinhamento estruturou a página e registrou colisões conhecidas; não criou contrato público nem execução.
- **Próxima ação, responsável e prazo:** habilitar a dependência de rede e planejar F1 com o caso das três capturas; responsável: futuras threads; sem prazo declarado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-23 | Item criado em Discovery na frente B | Requisito 001 e realinhamento aprovado pelo dono | Julio aprovou o resultado; sessão GO estruturou a página |
