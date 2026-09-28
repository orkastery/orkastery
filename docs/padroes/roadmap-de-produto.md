# Padrão de roadmap de produto de software

> Versão 1.1 · Aplicação: iniciativas, épicos, funcionalidades e mudanças · Documento complementar: [Padrão de documentação de produto](documentacao-de-produto.md)
>
> A versão 1.1 mantém a 1.0 e acrescenta a seção 6 (três leitores e fatos de SDLC) e o frontmatter do modelo, que o `ork docs verificar` confere.

## 1. Objetivo e unidade de acompanhamento

Este padrão registra **por que mudar, o que se pretende entregar, como validar e qual o estado real da execução**. Use um item por decisão de investimento/entrega rastreável. Iniciativas podem conter épicos, e épicos podem conter features; cada item tem ID próprio e aponta para o item pai. Uma feature implementada aponta para sua especificação `FEAT-ID`. Não replique campos técnicos extensos do produto no roadmap: mantenha links para a documentação canônica.

O roadmap é uma visão de planejamento sujeita a revisão. Datas, prioridades e escopo são compromissos somente quando explicitamente aprovados e identificados como tal. Marque estimativas e hipóteses como tais.

## 2. Regras comuns

| Regra | Aplicação |
| --- | --- |
| ID e vínculo | Use `RM-001` estável; indique pai, features afetadas e links para especificações, ADRs, issue, PR, testes e release. |
| Resultado | Explicite problema, público, objetivo, hipótese mensurável, linha de base, meta, janela e fonte da métrica. |
| Priorização | Registre método, critérios, pontuação e data; prioridade é distinta de urgência e não substitui justificativa. |
| Escopo | Separe incluído, excluído, dependências e premissas. Mudanças de escopo pedem registro de decisão. |
| Datas | Distinga alvo, previsão e data efetiva; use ISO 8601, fuso e nível de confiança. Nunca infira progresso pela data. |
| Evidência | Informe fonte e data de cada status. PR mesclado, deploy e disponibilidade para usuários são fatos distintos. |
| Responsabilidade | Nomeie owner humano por decisão, execução e validação. Agentes de IA podem elaborar, verificar ou executar dentro de autonomia registrada; atribua revisão e decisão final a pessoas. |
| Lacunas | Use `A definir` com responsável e prazo; para seção irrelevante, `Não aplicável — motivo`. Não invente status ou métricas. |

## 3. Categorias do item de roadmap

### 3.1 Identificação e posicionamento

Registre `ID`, `título orientado ao resultado`, `tipo` (iniciativa/épico/feature/melhoria), `item pai`, `plataforma`, `sistema`, `módulo`, `features afetadas`, `público`, `área solicitante`, `links canônicos` e `versão da página`. Hierarquia arquitetural descreve onde a mudança ocorre; hierarquia de roadmap descreve como ela é planejada.

### 3.2 Problema, objetivo e hipótese

Registre `problema/oportunidade`, `evidências`, `objetivo/OKR`, `hipótese no formato Se... então... porque...`, `métrica principal`, `métricas de proteção`, `linha de base`, `meta`, `janela de observação`, `segmento de análise` e `fonte dos dados`. Sem linha de base conhecida, defina como será medida antes de declarar sucesso.

### 3.3 Escopo, entregáveis e validação

Registre `escopo incluído`, `fora de escopo`, `entregáveis`, `casos de uso afetados`, `critérios de aceite`, `experimento/piloto`, `plano de medição`, `critérios para expandir/interromper`, `habilitação operacional` e `documentação necessária`. Aponte para IDs de regras, contratos e testes na documentação de produto.

### 3.4 Priorização e planejamento

Registre `prioridade`, `método/pontuação` (por exemplo RICE, com fatores explícitos), `justificativa`, `urgência`, `horizonte` (Agora/Próximo/Depois ou trimestre), `alvo`, `previsão`, `confiança`, `marcos`, `capacidade/custo estimado` e `trade-offs`. Uma pontuação sem critérios e data não é reproduzível.

### 3.5 Dependências, riscos e decisões

Registre `dependências com IDs e owners`, `bloqueios`, `premissas ainda não validadas`, `riscos com probabilidade/impacto`, `mitigação/contingência`, `decisões de produto`, `ADR técnico`, `alternativas descartadas`, `data/decisor` e `gatilho para revisão`. ADR é um registro de decisão que pode ser substituído por outro; preserve o histórico, sem apagar decisões anteriores.

### 3.6 Ciclo de vida e estados independentes

Não use um único campo para ocultar diferenças entre plano, código e entrega. Atualize cada dimensão separadamente:

| Dimensão | Valores recomendados | Evidência mínima |
| --- | --- | --- |
| Ciclo do item | `Discovery` → `Backlog` → `Refinamento` → `Pronto para desenvolvimento` → `Em desenvolvimento` → `Em validação` → `Piloto` → `Disponível` → `Concluído`; estados laterais: `Bloqueado`, `Cancelado`, `Descontinuado` | Decisão, marco ou entrega com data e owner. |
| Documentação | `Rascunho`, `Em revisão`, `Aprovada`, `Desatualizada` | Link, versão e revisor. |
| Código | `Não iniciado`, `Branch criada`, `PR aberto`, `Mesclado` | Repositório, branch/PR e commit. |
| Testes | `Não iniciados`, `Em execução`, `Aprovados`, `Falhando` | Execução e data; cobertura, se relevante. |
| Deploy | `Não implantado`, `Dev`, `Staging`, `Produção` | Pipeline, release e data efetiva. |
| Exposição | `Flag desligada`, `Piloto/Canary`, `Parcial`, `Geral` | Configuração por ambiente/coorte e verificação. |
| Habilitação | `Pendente`, `Em andamento`, `Concluída` | Comunicação, treinamento ou material publicado. |

`Bloqueado` exige motivo, dependência, responsável e próxima revisão. `Concluído` exige critérios de aceite cumpridos, evidência de disponibilidade e registro de medição inicial ou plano de avaliação pós-lançamento. O status não deve ser atualizado por mera passagem do tempo.

### 3.7 Owners e colaboração entre pessoas e agentes

Registre `PM/PO accountable`, `responsável técnico`, `engenheiro executor`, `QA/validador`, `sponsor`, `consultados`, `informados`, `canal`, `agente de planejamento`, `agente de execução`, `agente de validação`, `autonomia permitida`, `revisor humano` e `RACI`. Separe contribuição de agente da pessoa que aprova; documente ações realizadas e evidências, sem atribuir decisões a um agente por omissão.

## 4. Modelo de item de roadmap

Copie [o modelo](../roadmap/_modelo-item.md) para cada item. O frontmatter guarda as sete dimensões da seção 3.6 com os valores exatos do padrão, e o verificador cobra coerência entre elas:

| Regra de coerência | Por quê |
| --- | --- |
| `ciclo: Concluído` exige `codigo: Mesclado` e `testes: Aprovados` | concluído sem código na base é promessa |
| `deploy: Produção` exige `codigo: Mesclado` | não se implanta o que não foi mesclado |
| `codigo: Mesclado` exige `evidencias.codigo.commit` **na branch base** | merge se prova pelo git, não por declaração |
| `ciclo: Bloqueado` exige o mapa `bloqueio` (motivo, dependência, responsável, próxima revisão) | bloqueio sem dono não destrava |

## 5. Cadência e consistência

Revisite itens ativos na cadência do time e sempre após decisão, PR relevante, teste, deploy, alteração de flag ou medição de resultado. A cada revisão, compare roadmap, documentação da feature, código, contratos e evidências de produção; anote divergências com owner e prazo. Agentes podem sugerir atualização de status a partir de eventos do repositório, mas um PR mesclado atualiza somente a dimensão **código** até que deploy e exposição sejam comprovados. Registre a data de atualização e mantenha histórico das decisões e mudanças de escopo.

No Orkastery, `ork docs sincronizar` é esse agente: ele atualiza `estado.codigo` e `evidencias.codigo.commit` a partir do ledger (`ship_done`) e do git, e a seção `sdlc` a partir da thread. **Ele nunca mexe em ciclo, documentação, deploy, exposição ou habilitação** — essas dimensões são decisão de pessoa, e o verificador só cobra que estejam coerentes com o código.

## 6. Três leitores e fatos de SDLC (adaptação Orkastery)

As regras de leitura do [padrão de documentação](documentacao-de-produto.md#6-três-leitores-e-fatos-de-sdlc-adaptação-orkastery) valem aqui: resposta primeiro, estado de relance, uma ideia por linha, seções com nome fixo, frontmatter para agentes.

O que muda no roadmap é o bloco `sdlc`, que liga o item ao método Orkastery **só com fatos do produto**:

| Chave | Conteúdo | Quem preenche |
| --- | --- | --- |
| `sdlc.thread` | ID da thread que entrega o item | pessoa, ao abrir a thread |
| `sdlc.modo` | `#Classic`, `#Maestro`, `#Auto` ou `#Fast` | pessoa |
| `sdlc.fase`, `sdlc.status` | fase atual e status da thread | `ork docs sincronizar` |
| `sdlc.check` | último veredito do CHECK independente | pessoa, a partir do parecer |

Micro-decisões de condução (claims recadastradas, GO-FIX de teste, sessão que caiu) **não entram no item**: vivem no ledger da thread, que é o registro de auditoria do método.

## 7. Reservas de item entre máquinas (adaptação Orkastery)

Quando mais de uma máquina ou pessoa trabalha no mesmo repositório, cada item em andamento tem **uma** reserva, e ela vive fora da `main`, na branch `ork/roadmap-reservas` ([FEAT-026](../produto/FEAT-026-reservas-do-roadmap.md)):

| Momento | Comando | O que garante |
| --- | --- | --- |
| Antes de escolher | `ork roadmap reservas` | ver com quem cada item está, e desde quando |
| Ao começar | `ork thread new ... --roadmap RM-NNN` ou `ork roadmap pegar RM-NNN` | push atômico: o primeiro vence, o segundo é recusado com `roadmap.reservado` |
| Ao terminar ou desistir | `ork roadmap soltar RM-NNN` | o item volta a ficar livre |
| Máquina parada | `ork roadmap pegar RM-NNN --forcar --motivo "..."` | a tomada fica registrada com de quem e por quê |

A reserva não substitui o estado do item: o frontmatter continua sendo a fonte das sete dimensões, e a reserva só diz **quem** está com ele agora. O `RESERVAS.md` da branch mostra a mesma lista para quem abre o GitHub.
