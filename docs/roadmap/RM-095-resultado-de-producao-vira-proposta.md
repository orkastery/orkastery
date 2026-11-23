---
id: RM-095
tipo: roadmap
titulo: Resultado de produção vira proposta
categoria: iniciativa
pai: RM-008
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

# RM-095 — Resultado de produção vira proposta

> **Em uma frase:** sinais conferíveis da produção voltam ao dono como proposta ligada à entrega, e só entram na caixa de intenções ou nos casos de regressão depois de confirmação explícita.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** resultados observados depois da entrega podem mudar a próxima intenção, mas hoje dependem de alguém notar, reconstruir o vínculo e registrar manualmente a proposta.
- **Evidências e fonte:** requisito 002 do realinhamento aprovado em 23/11/2026. O primeiro incremento usa sinais que já existem: regressão no CI da `main` depois de merge, merge revertido e issue marcada como bug.
- **Objetivo/OKR:** transformar resultado de produção em proposta rastreável para triagem do product builder humano, sem criar trabalho ou hipótese por conta própria.
- **Hipótese:** se um sinal confiável chegar ligado à versão, ao PR, à thread e ao item, então o dono consegue decidir a próxima intenção sem reconstruir o contexto e sem aceitar automação indevida.
- **Métrica principal / linha de base / meta / janela / fonte:** razão entre propostas triadas e sinais elegíveis apresentados. A linha de base será observada no piloto; as fontes são CI, forja, ledger e item de roadmap.
- **Métricas de proteção:** nenhuma proposta entra na caixa sem “sim” do dono; sinais ausentes ou inconclusivos viram lacuna; deploy e incidente alimentam DORA sem duplicar ou reinterpretar os eventos da RM-090.

## Escopo e validação

- **Incluído:** regressão na `main` depois de merge; merge revertido; issue marcada como bug; vínculo exato com versão, PR, thread e item; proposta de intenção ou caso de regressão; confirmação curta; depois, sinal de uso por adesão e revisão da hipótese após publicação.
- **Fora de escopo:** criar captura automaticamente; inferir satisfação pelo volume de eventos; reclassificar issue sem fonte; substituir triagem humana; criar fórmula DORA própria; inventar nomes públicos de comando ou evento nesta página.
- **Entregáveis e critérios de aceite:** cada um dos três sinais iniciais produz uma proposta com fonte e vínculos; o dono aceita ou recusa em linguagem curta; sem “sim”, nada entra na caixa e nenhum caso é aberto; resposta repetida não duplica o destino.
- **Piloto, medição e critérios de expansão/interrupção:** piloto com sinais históricos reproduzíveis. Expandir para adesão quando a fonte e o segmento estiverem definidos. Interromper se a proposta não puder provar o evento de origem, se o vínculo apontar para outra entrega ou se uma ausência for tratada como resultado.

### Fatias

| Ordem | Fatia | Critério de aceite verificável |
| --- | --- | --- |
| F1 | Três sinais de entrega | Regressão pós-merge, reversão e issue de bug geram propostas ligadas à versão, PR, thread e item; ausência de vínculo bloqueia somente a proposta |
| F2 | Triagem humana e destino | A confirmação cria uma captura na RM-094 ou um caso de regressão; recusa e silêncio não criam destino; replay não duplica |
| F3 | Sinais de uso por adesão | A proposta informa fonte, segmento e cobertura; não usa volume bruto como prova de valor e não publica dado privado |
| F4 | Revisão da hipótese | Depois da publicação, o item recebe proposta de manter, revisar ou rejeitar a hipótese com a evidência ligada, sempre para decisão humana |
| F5 | Deploy, incidente e DORA | Eventos de deploy e incidente são encaminhados ao canal da [RM-090](RM-090-telemetria-opentelemetry-para-sdlc-analytics.md), que preserva fórmulas, lacunas e origem |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** frente D; F1 vem depois da medição e da desobstrução definidas no realinhamento de 23/11/2026.
- **Horizonte / alvo / previsão / confiança / marcos:** F1 primeiro; F2 a F5 depois de a RM-094 e a telemetria correspondente estarem disponíveis. Previsão será definida no PLAN.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-008](RM-008-loop-de-aprendizado.md), [RM-094](RM-094-caixa-de-intencoes.md), [RM-083](RM-083-estado-do-roadmap-acompanha-a-entrega.md) e [RM-090](RM-090-telemetria-opentelemetry-para-sdlc-analytics.md). Owner: Julio; revisão antes do PLAN.
- **Premissas / riscos / mitigação:** correlação temporal pode parecer causa; F1 exige vínculo explícito. Sinal de uso pode ser incompleto; cobertura aparece junto da proposta. Incidente pode expor dado privado; a projeção segue o filtro da telemetria. Proposta pode virar fila automática; F2 exige confirmação humana antes do destino.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** o dono aprovou os três sinais iniciais, a triagem humana e a evolução para adesão, hipótese e DORA em 23/11/2026.

## Estado com evidências

O item está em Discovery e nenhum sinal está automatizado por esta página.

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

- **RACI (R / A / C / I):** R: futura thread de implementação; A: Julio; C: responsáveis por CI, forja, telemetria e produto; I: builders e times afetados.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO do realinhamento estruturou a página dentro do resultado aprovado; não promoveu sinal nem criou captura.
- **Próxima ação, responsável e prazo:** planejar F1 depois das frentes anteriores; responsável: futura thread; sem prazo declarado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-23 | Item criado em Discovery na frente D | Requisito 002 e realinhamento aprovado pelo dono | Julio aprovou o resultado; sessão GO estruturou a página |
