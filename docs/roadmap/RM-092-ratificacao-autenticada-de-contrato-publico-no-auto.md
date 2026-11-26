---
id: RM-092
tipo: roadmap
titulo: Autorização autenticada com escopo, validade, canal e prova
categoria: iniciativa
pai: RM-048
features: []
owner: Julio
atualizado_em: 2026-11-26T09:50:38-03:00
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

# RM-092 — Autorização autenticada com escopo, validade, canal e prova

> **Em uma frase:** toda autorização do dono usa um contrato único que registra exatamente o que vale, até quando vale, por qual canal chegou e qual prova sustenta sua autoria.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Origem e consolidação

A RM-092 nasceu em 12/11/2026 para a ratificação autenticada de nomes de contrato público no `#Auto`. O realinhamento de 23/11/2026 ampliou o resultado: autorização durável da [RM-063](RM-063-fabrica-que-nao-para.md), envelope do [#Noctum na RM-058](RM-058-modo-noctum.md), ratificação de contrato público e nota humana do MASTER passam a usar um contrato de autorização único.

A [RM-093](RM-093-acao-do-dono-executada-pela-fabrica.md) consome esse contrato para executar ações reservadas. Esta página autoriza; ela não executa a ação.

## Problema e resultado

- **Público e problema/oportunidade:** diferentes superfícies provam a vontade do dono com campos e limites próprios. Isso dificulta conferir alcance, validade, revogação e autoria sem ampliar a resposta por inferência.
- **Evidências e fonte:** incidentes B2, B6 e B7 da RM-090 mostraram nomes sem ratificação exata; a RM-063 propôs autorização durável; a RM-058 usa envelope próprio; a nota do MASTER exige prova de origem humana. O dono aprovou a consolidação em 23/11/2026. Em 26/11/2026, um verify só de claims encerrou uma autorização nominal dada pela resposta curta `b`, e a pergunta seguinte ao dono omitiu o achado anterior do mesmo SHA; a [RM-068](RM-068-security-scan-no-check.md) registra a mesma dívida como A59 e A60.
- **Objetivo/OKR:** uma mesma regra verificável autoriza decisão, contrato ou ação em qualquer modo e canal, sem que agente, transporte ou consumidor invente alcance.
- **Hipótese:** se escopo, validade, canal e prova forem obrigatórios e ligados à mesma pergunta, então cada consumidor consegue aceitar somente o que o dono viu e rejeitar replay, alteração e extensão.
- **Métrica principal / linha de base / meta / janela / fonte:** razão entre autorizações consumidas com todos os campos conferidos e tentativas de consumo. A linha de base será medida no piloto; a fonte é o recibo e o resultado de cada consumidor.
- **Métricas de proteção:** nenhum agente assume a identidade do dono; nome, ação ou parâmetro ausente continua não autorizado; mudança de pergunta invalida a resposta; revogação impede consumo futuro; autorização não substitui verify, CHECK, CI ou recibo de execução.

## Escopo e validação

- **Incluído:** pergunta no padrão da [RM-048](RM-048-hitl-humano-no-centro.md); escopo exato; validade temporal e condicional; canal autenticado; prova da autoria e do vínculo com a pergunta; política de uso único ou reutilização declarada; revogação; recibo de consumo; adaptação das quatro autorizações consolidadas; consumo condicionado ao efeito autorizado, de modo que verify só de claims não encerra autorização de cobertura do security scan; nova pergunta para o mesmo SHA inclui o último achado ainda relevante.
- **Fora de escopo:** autorizar por argumento de ferramenta; resposta de agente; permissão genérica sem validade; inferir nomes ou parâmetros; executar a ação; decidir nesta página nomes públicos de comandos, eventos, schemas ou arquivos.
- **Entregáveis e critérios de aceite:** os quatro casos consolidados produzem a mesma forma canônica; consumidor aceita somente escopo idêntico e validade vigente; proposta alterada, canal sem prova, replay proibido e autorização revogada são recusados com motivo; uma recusa não invalida trabalho independente; verify só de claims preserva a autorização nominal do scan; uma nova pergunta do mesmo SHA cita o achado anterior que ainda não foi superado.
- **Piloto, medição e critérios de expansão/interrupção:** piloto com ratificação de contrato e nota do MASTER, depois autorização durável e #Noctum. Expandir para RM-093 somente quando uso único, revogação e recibo de consumo estiverem provados. Interromper se houver extensão por inferência ou autoria inconclusiva.

### Campos do contrato único

| Campo | Regra |
| --- | --- |
| Pergunta | Identificador estável e impressão do conteúdo apresentado |
| Escopo | Decisão, nomes, ação e parâmetros exatos que podem ser consumidos |
| Validade | Início, fim e condições que encerram a autorização |
| Canal | Transporte homologado pelo qual a resposta chegou |
| Prova | Autoria conferida pelo ingresso e vínculo com a pergunta entregue |
| Resposta | Alternativa escolhida e texto original preservado |
| Uso | Uso único ou reutilização explicitamente autorizada, nunca presumida |
| Revogação | Evento que impede novo consumo sem apagar consumos anteriores |
| Consumo | Quem consumiu, para qual efeito e com qual resultado |

### Consumidores consolidados

| Origem | Escopo que passa ao contrato único | Regra adicional |
| --- | --- | --- |
| RM-063 F7 | autorização durável de condução | validade e ações permitidas ficam explícitas; não aprova gate por omissão |
| RM-058 | autorização e revogação do arco | o envelope referencia o recibo, sem manter prova concorrente |
| RM-092 original | nomes de contrato público | cada nome precisa aparecer no escopo exato e na proposta impressa |
| MASTER | nota humana | nota e justificativa preservam prova do canal e não autorizam outra ação |
| RM-093 | ação reservada | uso único, parâmetros exatos e recibo de execução são obrigatórios |

### Fatias

| Ordem | Fatia | Critério de aceite verificável |
| --- | --- | --- |
| F1 | Contrato canônico | Testes de contrato recusam campo ausente, proposta alterada, validade encerrada, prova inconclusiva e alcance adicional |
| F2 | Ratificação e MASTER | Nomes de contrato e nota humana usam o mesmo recibo sem trocar seu significado; cada consumidor lê somente seu escopo |
| F3 | Autorização durável e #Noctum | As formas anteriores apontam para o recibo canônico, preservam revogação e não ampliam ações ou duração |
| F4 | Consumo pela RM-093 | A ação usa autorização de uso único, registra o consumo e recusa replay ou parâmetro diferente antes de executar |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** filha da RM-048 e parte da frente A; necessária antes de a RM-093 executar ação reservada. Consolidação aprovada em 23/11/2026.
- **Horizonte / alvo / previsão / confiança / marcos:** Discovery; F1 a F4. Nomes públicos e migração serão definidos no PLAN com ratificação do dono.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-048](RM-048-hitl-humano-no-centro.md), [RM-058](RM-058-modo-noctum.md), [RM-063](RM-063-fabrica-que-nao-para.md), [RM-093](RM-093-acao-do-dono-executada-pela-fabrica.md) e ingressos autenticados. Owner: Julio; revisão antes do PLAN.
- **Premissas / riscos / mitigação:** contrato genérico pode perder semântica; cada consumidor declara seu efeito e lê somente seu escopo. Migração pode aceitar recibo antigo além do necessário; adaptadores validam equivalência e têm janela de transição explícita. Validade longa pode virar permissão esquecida; toda autorização declara fim e revogação.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** o dono escolheu em 12/11 abrir a ratificação autenticada; em 23/11 aprovou fundi-la com autorização durável, envelope do #Noctum e nota do MASTER em um contrato único consumido pela RM-093.

## Estado com evidências

O item continua em Discovery. A consolidação é documental e não declara migração implementada.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-11-26 | Julio |
| Documentação | Rascunho | — | 2026-11-26 | Julio |
| Código | Não iniciado | — | 2026-11-26 | Julio |
| Testes | Não iniciados | — | 2026-11-26 | Julio |
| Deploy | Não implantado | — | 2026-11-26 | Julio |
| Exposição | Flag desligada | — | 2026-11-26 | Julio |
| Habilitação | Pendente | — | 2026-11-26 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: futura thread de implementação; A: Julio; C: CHECK, segurança, canais autenticados e consumidores; I: builders e responsáveis pelas ações.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO do realinhamento consolidou o resultado aprovado; não nomeou contrato público nem migrou recibo.
- **Próxima ação, responsável e prazo:** planejar F1 e a migração de ratificação e MASTER; responsável: futura thread; sem prazo declarado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-12 | RM-092 criada para ratificação autenticada de contrato público | Resposta `1a` e incidentes B2, B6 e B7 da RM-090 | Julio |
| 2026-11-23 | Escopo consolidado em autorização única e item movido para filho da RM-048 | Realinhamento aprovado; RM-063 F7, envelope do #Noctum, ratificação e MASTER deixam de manter contratos concorrentes | Julio |
| 2026-11-26 | Consumo da autorização fica preso ao efeito autorizado e a pergunta seguinte preserva o achado anterior do mesmo SHA | Achado da condução da versão 0.6.11 e dívidas A59 e A60 registradas na RM-068 | sessão GO `ork-achados0611` (#Fast) |
