---
id: RM-071
tipo: roadmap
titulo: Fluxo da fábrica por item
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

# RM-071 — Fluxo da fábrica por item

> **Em uma frase:** o relatório semanal mostra espera, vazão útil, ritmo, fluidez, qualidade, gargalo, previsão e custo por item com fórmulas reproduzíveis, e exporta os mesmos fatos pela telemetria existente.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** o product builder humano precisa saber quanto a fábrica entrega, onde o fluxo espera e qual recurso limita o paralelismo. O estado atual registra muitos eventos, mas não os reúne por item com fórmula, cobertura e origem.
- **Evidências e fonte:** requisitos 003 e 004 do realinhamento aprovado em 23/11/2026. O dono determinou medir vazão real, congestionamento, prazo, ritmo, fluidez, qualidade e os limites de decisão humana, máquina, cota e contas.
- **Objetivo/OKR:** permitir que a prioridade e a capacidade sejam ajustadas pelo gargalo medido, sem confundir atividade com entrega nem ausência de dado com zero.
- **Hipótese:** se cada item carregar intervalos, entregas e falhas ligados aos fatos do ledger, da forja e do CI, então o relatório semanal identifica o recurso limitante e sustenta uma previsão honesta.
- **Métrica principal / linha de base / meta / janela / fonte:** vazão útil por janela de relatório, definida como entregas mescladas com recibo e sem reversão na janela de observação. A linha de base será calculada na F2; a fonte é a cadeia item, thread, recibo, merge e eventual reversão.
- **Métricas de proteção:** toda medida informa fórmula, janela, cobertura e fonte; lacuna nunca vira zero; nenhum dado privado identifica máquina, conta ou pessoa na superfície coletiva; a medição não abre backend novo nem bloqueia a fábrica.

## Escopo e validação

- **Incluído:** oito fatias de medição; agregação por item; agrupamentos operacionais por máquina, conta e builder com identificadores adequados à superfície; soma na rede da empresa; relatório semanal; exportação pelo canal da [RM-090](RM-090-telemetria-opentelemetry-para-sdlc-analytics.md).
- **Fora de escopo:** criar painel ou backend; declarar meta sem linha de base; comparar pessoas por ranking; estimar custo monetário sem fonte; usar duração da sessão como entrega; publicar nomes privados de máquinas ou contas.
- **Entregáveis e critérios de aceite:** cada fatia abaixo produz medida reproduzível a partir de fixtures e aponta as lacunas. O relatório de um item pode ser refeito dos mesmos fatos e chega ao mesmo resultado.
- **Piloto, medição e critérios de expansão/interrupção:** piloto no próprio roadmap. Expandir quando os vínculos entre item, thread e entrega estiverem cobertos. Interromper uma medida, sem interromper as demais, se a origem não puder ser provada.

### Fórmulas e regras comuns

| Medida | Fórmula ou regra |
| --- | --- |
| Janela | Intervalo fechado no início e aberto no fim, declarado no relatório |
| Cobertura | fatos válidos usados divididos pelos fatos elegíveis; o denominador ausente vira lacuna |
| Vazão útil | entregas com merge e recibo, sem reversão na janela de observação, divididas pela janela |
| Lead time | instante da entrada do item na frente até o recibo da entrega útil; itens sem entrega ficam abertos |
| Tempo por fase | soma dos intervalos atribuídos à fase, excluindo a espera que recebe motivo próprio |
| Frequência | entregas úteis divididas pela janela, apresentada junto da distribuição dos intervalos entre entregas |
| Retrabalho | ciclos adicionais de correção ligados ao mesmo achado ou resultado, divididos pelos ciclos encerrados |
| Reincidência | achado de mesmo id estável que reaparece dentro de trinta dias depois de fechado |
| Custo por entrega | tokens medidos e consumo de cota ligados às threads da entrega, divididos pelas entregas úteis |

### Motivos tipados de espera

F1 começa com uma lista fechada: `dono`, `cota`, `vaga pesada`, `CI` e `máquina fora`. A implementação pode acrescentar motivo somente por contrato ratificado e deve conservar uma categoria de lacuna quando o evento não basta para classificar. Intervalos sobrepostos não são somados duas vezes.

### Fatias

| Ordem | Fatia | Resultado e critério de aceite verificável |
| --- | --- | --- |
| F1 | Espera por motivo | Reconstrói por item os intervalos de espera por dono, cota, vaga pesada, CI e máquina fora; intervalos sobrepostos têm regra determinística e causa ausente aparece como lacuna |
| F2 | Vazão útil | Conta merge com recibo e sem reversão, por semana, máquina, conta e builder, e soma na rede da empresa; reversão posterior reapresenta a série sem apagar o fato original |
| F3 | Ritmo | Calcula lead time e tempo por fase em p50 e p85, além da frequência; amostra insuficiente e item aberto aparecem explicitamente |
| F4 | Fluidez | Separa intervenções evitáveis e necessárias e mostra a espera por motivo; toda intervenção aponta para o evento que sustenta a classificação |
| F5 | Qualidade | Mede retrabalho, reincidência em trinta dias e falha evitável, usando id estável de achado para ligar descoberta, correção, reverificação e reaparecimento |
| F6 | Gargalo semanal | Identifica o recurso que limitou a vazão entre decisão humana, máquina, cota, conta e fila pesada, mostra a evidência e sugere uma ação; empate ou cobertura insuficiente não produz vencedor falso |
| F7 | Previsão de prazo | Para cada item, apresenta faixa de data com probabilidade e amostra comparável; mudança de escopo, bloqueio novo ou cobertura insuficiente invalida ou alarga a previsão |
| F8 | Custo por entrega | Liga tokens e consumo de cota às entregas úteis; dado não medido fica fora do numerador e aparece na cobertura, sem conversão monetária inventada |

### Canais

- **Relatório semanal:** apresenta a janela, as oito medidas disponíveis, o gargalo e a ação sugerida. As fatias ainda não entregues aparecem como indisponíveis, nunca como zero.
- **Telemetria da RM-090:** exporta os mesmos fatos e fórmulas para o canal já existente, com os vínculos de item, thread e entrega e as lacunas correspondentes.
- **Sem backend novo:** armazenamento, transporte e visualização reutilizam ledger, forja, CI, rede coletiva e telemetria existentes.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** frente B do realinhamento. F1 e F2 avançam em paralelo com a frente A; F3 a F6 vêm em seguida; F7 e F8 fecham a frente D. Decisão do dono em 23/11/2026.
- **Horizonte / alvo / previsão / confiança / marcos:** Discovery; marcos F1 a F8 na ordem de dependência acima. A própria F7 produzirá previsão quando houver amostra; esta página não antecipa data.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-076](RM-076-fila-pesada-com-prioridade.md) para vaga pesada; [RM-077](RM-077-revisao-independente-pelo-construtor-do-head.md) para revisão; [RM-089](RM-089-orkastery-network-coletiva-da-empresa.md) para soma coletiva; [RM-090](RM-090-telemetria-opentelemetry-para-sdlc-analytics.md) para exportação; [RM-095](RM-095-resultado-de-producao-vira-proposta.md) para deploy e incidente. Owner: Julio; revisão antes do PLAN.
- **Premissas / riscos / mitigação:** merge pode ser revertido depois da janela; a série conserva o evento e reapresenta a entrega. Percentis com amostra pequena parecem precisos; o relatório mostra tamanho e cobertura da amostra. Gargalo pode mudar por item; F6 não generaliza sem janela e agrupamento. Identificador operacional pode expor dado privado; a superfície coletiva usa pseudônimo estável e mantém o mapa fora do relatório.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** o dono substituiu o relatório anterior pelo fluxo em oito fatias e determinou relatório semanal e RM-090 como canais, sem backend novo, em 23/11/2026.

## Estado com evidências

O item está em Discovery. A reformulação documental não declara fatia implementada.

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

- **RACI (R / A / C / I):** R: futuras threads das fatias; A: Julio; C: produto, telemetria, CI, forja e rede coletiva; I: builders e times da empresa.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO do realinhamento reformulou somente a documentação aprovada; fórmulas públicas e contratos de implementação serão ratificados no PLAN correspondente.
- **Próxima ação, responsável e prazo:** planejar F1 e F2; responsável: futuras threads da frente B; sem data declarada.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-21 | Item criado como relatório da esteira do SDLC | Pedido do dono por visibilidade do consumo e dos ciclos da fábrica | Julio |
| 2026-11-23 | Item reformulado como fluxo da fábrica por item, em oito fatias | Requisitos 003 e 004 e realinhamento aprovado | Julio aprovou o resultado; sessão GO estruturou as fórmulas |
