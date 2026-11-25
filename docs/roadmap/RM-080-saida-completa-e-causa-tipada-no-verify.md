---
id: RM-080
tipo: roadmap
titulo: Verify diz a causa e guarda a saída inteira
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-25T00:00:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Branch criada
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: ork-macosportave
  modo: auto
---

# RM-080 — Verify diz a causa e guarda a saída inteira

> **Em uma frase:** toda falha do verify informa a causa real, preserva a saída completa redigida e liga o diagnóstico ao trabalho que a rodada executou.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Origem e consolidação

Este item absorve três conjuntos de trabalho:

- a RM-080 original, sobre saída completa e causa tipada;
- o escopo causal e o diagnóstico de asserção da [RM-085](RM-085-verify-com-escopo-causal-mensagem-de-assercao-e-check-fast.md);
- as pendências de diagnóstico e execução uniforme que restaram na [RM-037](RM-037-verify-rapido-e-confiavel.md).

O CHECK independente no `#Fast`, antes parte da RM-085, passa para a [RM-077](RM-077-revisao-independente-pelo-construtor-do-head.md). A RM-037 conserva o histórico do que já foi entregue; a RM-085 fica descontinuada com estes apontamentos.

## Problema e resultado

- **Público e problema/oportunidade:** quem corrige uma rodada pode receber somente o fim da saída, uma causa incorreta, uma asserção sem detalhe ou uma medida que não cobre os processos criados pelo próprio verify.
- **Evidências e fonte:** achados de condução da RM-080, pendências da RM-037, bancada da RM-085 e [issue #304](https://github.com/orkastery/orkastery/issues/304). Os casos observados incluem limite de saída confundido com sinal, logs temporários removidos, caminhos de execução com diagnósticos diferentes, mensagem de asserção ausente, shell fixo confundido com claim falsa e descendentes fora do escopo causal da rodada.
- **Objetivo/OKR:** uma falha pode ser diagnosticada a partir do recibo e do log preservado, sem reprodução obrigatória e sem atribuição causal maior do que a prova disponível.
- **Hipótese:** se execução, classificação, persistência e apresentação usarem o mesmo contrato, então o GO-FIX recebe causa e evidência suficientes e o verify deixa de mascarar limite próprio como falha do produto.
- **Métrica principal / linha de base / meta / janela / fonte:** razão entre comandos reprovados com causa tipada, saída completa redigida e vínculo causal conferido. A linha de base será calculada no piloto; a fonte é o recibo da rodada e o artefato de saída.
- **Métricas de proteção:** segredos e dados privados são redigidos antes da persistência; a saída completa tem política de retenção e integridade; host sem escopo causal informa a lacuna; truncamento da apresentação não altera o artefato nem o veredito.

## Escopo e validação

- **Incluído:** executor comum para verify, baseline, preparo, claims, GO-FIX, CI, MCP, Classic e Agile; saída completa de stdout e stderr; causa de encerramento tipada; artefato redigido com impressão de integridade; mensagem de asserção limitada; escopo causal da rodada e dos descendentes; retenção e limpeza.
- **Fora de escopo:** CHECK independente no `#Fast`, movido para RM-077; envio do log a serviço externo; retenção sem limite; crédito causal quando a plataforma não prova a hierarquia; afrouxar o resultado do teste por dificuldade de diagnóstico.
- **Entregáveis e critérios de aceite:** todos os caminhos incluídos produzem o mesmo contrato; limite de saída, sinal, prazo, código de saída e falha de infraestrutura não se confundem; log completo permanece acessível pela impressão registrada; asserção traz esperado, obtido e local quando a fonte fornece; lacuna causal aparece como causa, não como atribuição parcial.
- **Piloto, medição e critérios de expansão/interrupção:** piloto nas suítes com maior volume de saída e na bancada causal. Expandir quando cada adaptador provar equivalência. Interromper persistência se a redação falhar e interromper crédito causal se algum descendente escapar do escopo.

### Fatias

| Ordem | Fatia | Critério de aceite verificável |
| --- | --- | --- |
| F0 | Shell portátil e causa ambiental | verify e CHECK paralelo usam o mesmo caminho absoluto versionado; ausência do shell deixa a evidência não executada com `verify.sem-veredito`; o recibo identifica o executor |
| F1 | Executor e saída únicos | Classic, Agile, preparo, claims, baseline, GO-FIX, CI e MCP guardam stdout e stderr pelo mesmo caminho, sem buffer que mude o resultado |
| F2 | Causa tipada | Limite de saída, sinal, prazo, saída normal e falha de infraestrutura recebem causas distintas; o erro bruto não substitui a causa |
| F3 | Artefato íntegro e redigido | O ledger guarda referência e impressão da saída completa já redigida; alteração do arquivo, referência ausente e redação incompleta são detectadas |
| F4 | Diagnóstico de asserção | Falha suportada registra teste, arquivo, mensagem limitada, esperado, obtido e local; dado indisponível aparece como lacuna e credencial não persiste |
| F5 | Escopo causal | Processo da rodada e descendentes criados pelo verify pertencem ao mesmo escopo quando a plataforma permite; sem essa capacidade, o recibo informa a causa e não atribui contenção |
| F6 | Retenção e limpeza | Política conserva o necessário para correção e auditoria, remove pelo ciclo declarado e nunca apaga artefato ainda referenciado por rodada ativa |

### O que foi absorvido

| Página de origem | Trabalho que fica na RM-080 | Trabalho que permanece fora |
| --- | --- | --- |
| RM-037 | pendências de diagnóstico uniforme, classificação e preservação da evidência em todos os caminhos do verify | histórico das fatias já entregues e seu estado de produção |
| RM-085 | escopo causal da rodada e mensagem segura da asserção | CHECK independente no `#Fast`, movido para RM-077 |
| RM-080 original | causa verdadeira, saída inteira, referência e integridade do log | envio do log para serviço externo |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** frente C, com F0 promovida à ordem zero das issues de usuários em 24/11/2026. A consolidação reduz filas que diagnosticavam a mesma rodada por contratos diferentes.
- **Horizonte / alvo / previsão / confiança / marcos:** Discovery; F0 a F6. Previsão será definida no PLAN.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-037](RM-037-verify-rapido-e-confiavel.md), [RM-072](RM-072-check-cinco-vezes-mais-rapido.md), [RM-079](RM-079-claims-que-a-correcao-passa.md) e [RM-077](RM-077-revisao-independente-pelo-construtor-do-head.md). Owner: Julio; revisão antes do PLAN.
- **Premissas / riscos / mitigação:** log pode ocupar espaço; F6 limita e limpa. Redação pode retirar contexto; F4 conserva estrutura e marca o que foi redigido. Executor único pode alterar ordenação ou códigos; testes de equivalência fixam veredito, causa e artefato antes da migração. Plataforma pode não provar hierarquia; F5 responde com lacuna tipada.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** em 23/11/2026 o dono aprovou fundir RM-080, a parte de verify da RM-085 e as pendências da RM-037; o CHECK independente foi direcionado à RM-077.

## Estado com evidências

O item entrou em desenvolvimento pela F0 da thread `ork-macosportave`. As demais fatias continuam planejadas; o que a RM-037 já publicou permanece registrado nela.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-11-25 | Julio |
| Documentação | Em revisão | — | 2026-11-25 | Julio |
| Código | Branch criada | — | 2026-11-25 | Julio |
| Testes | Em execução | — | 2026-11-25 | Julio |
| Deploy | Não implantado | — | 2026-11-25 | Julio |
| Exposição | Flag desligada | — | 2026-11-25 | Julio |
| Habilitação | Pendente | — | 2026-11-25 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: futura thread de implementação; A: Julio; C: responsáveis por verify, CI, segurança e runtimes; I: builders que corrigem falhas.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO do realinhamento consolidou somente o plano documental; nenhuma pendência foi declarada implementada.
- **Próxima ação, responsável e prazo:** planejar F1 a F3 antes da migração dos demais caminhos; responsável: futura thread; sem prazo declarado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-31 | RM-080 criada para saída completa e causa tipada | Achados de condução em rede | Julio |
| 2026-11-23 | RM-080 absorveu verify da RM-085 e pendências da RM-037; CHECK independente foi para RM-077 | Realinhamento aprovado | Julio |
| 2026-11-25 | F0 recebeu resolução determinística do shell, recibo e causa ambiental | Issue #304 e thread `ork-macosportave` | Sessão #Auto, por delegação do dono |
