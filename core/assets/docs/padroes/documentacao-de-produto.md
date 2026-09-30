# Padrão de documentação de produto de software

> Versão 1.1 · Aplicação: plataformas, sistemas, módulos e funcionalidades · Documento complementar: [Padrão de roadmap de produto](roadmap-de-produto.md)
>
> A versão 1.1 mantém a 1.0 e acrescenta a seção 6 (três leitores e fatos de SDLC) e o frontmatter do modelo, que o `ork docs verificar` confere.

## 1. Objetivo e unidade documental

Este padrão descreve **o produto e seu comportamento verificável**, do contexto da plataforma aos contratos técnicos. Crie uma página por entidade relevante; uma funcionalidade (`Feature`) é a unidade recomendada para especificar comportamento. Detalhes volumosos, como contratos OpenAPI e esquemas de dados, podem ficar em arquivos próprios, ligados por identificadores estáveis.

Use a hierarquia `Plataforma → Sistema/Serviço → Módulo → Submódulo/Domínio → Feature`. Um caso de uso pertence a uma feature; uma operação representa uma ação dessa feature. Entidades e campos descrevem dados; APIs, endpoints, eventos, gatilhos e jobs descrevem interfaces e execução. Um mesmo serviço ou contrato pode atender várias features: mantenha uma fonte canônica e faça referências, sem copiar definições divergentes.

O **roadmap** registra problemas, hipóteses, escolhas, prioridades e andamento das mudanças. Esta documentação registra o comportamento vigente e, quando necessário, a especificação futura explicitamente identificada. Relacione ambos por IDs e links; não trate proposta como funcionalidade já entregue.

## 2. Convenções obrigatórias

| Regra | Aplicação |
| --- | --- |
| Identidade | Atribua IDs estáveis, por exemplo `PLAT-01`, `SYS-01`, `MOD-01`, `FEAT-042`, `UC-042-01`, `BR-042-01`, `API-01`, `EVT-01`, `JOB-01` e `RM-042`. Renomear não muda o ID. No Orkastery, o número da FEAT nova sai de `ork roadmap feat`, reservado entre máquinas; nunca do maior número da sua branch. |
| Escopo e estado | Informe se a página descreve `vigente`, `em desenvolvimento`, `proposto` ou `descontinuado`, com ambiente, versão e data de verificação. |
| Rastreabilidade | Ligue feature ↔ item de roadmap ↔ casos de uso/regras ↔ contratos/esquemas ↔ código/PR ↔ testes/evidências ↔ release. Use `Não aplicável — motivo` quando uma seção não fizer sentido. |
| Fonte | Diferencie `confirmado` (código, contrato, teste ou decisão aprovada), `planejado` (item de roadmap) e `a validar`. Nunca complete uma lacuna por inferência silenciosa. |
| Forma | Use português claro; preserve nomes exatos de código, endpoints, flags e eventos em crases. Datas em ISO 8601 com fuso; unidades explícitas. |
| Responsabilidade | Registre owner humano da página, aprovador técnico quando aplicável e última revisão. Um agente de IA pode propor alterações, com fonte e revisão humana definidas pelo time. |
| Histórico | Mudanças de comportamento exigem atualização da página e ligação ao item de roadmap/release; decisões técnicas relevantes apontam para um ADR. |

## 3. Categorias de documentação

Preencha os campos aplicáveis. Para entidades reutilizáveis, crie páginas próprias e ligue seus IDs à página da feature.

### 3.1 Contexto e arquitetura

| Campo | O que registrar |
| --- | --- |
| Plataforma; sistema/serviço; módulo; submódulo | IDs, nomes e links para os respectivos pais. |
| Objetivo; limites | Problema atendido, responsabilidade do componente e o que não lhe pertence. |
| Dependências | Serviços internos/externos e impacto em caso de falha. |
| Repositório; localização do código | URL, diretórios e versão/commit de referência. |
| Implantação; ambientes | Modelo de deploy, ambientes e regiões efetivamente usados. |
| Isolamento; configuração | Modelo de tenancy e parâmetros de sistema; cite nomes, efeito, padrão e ambiente, nunca valores secretos. |
| Retenção | Tipos de dado, prazo, descarte e política/decisão aprovada. |

### 3.2 Funcionalidades e comportamento

| Campo | O que registrar |
| --- | --- |
| Feature; atores/personas | ID, finalidade, usuários e sistemas participantes. |
| Casos de uso; operações | IDs e nomes; operações CRUD e ações de negócio separadas. |
| Pré-condições; gatilho | Estado necessário e ação/evento que inicia o fluxo. |
| Fluxo principal; alternativas | Passos observáveis e caminhos de erro, cancelamento, timeout e recuperação. |
| Pós-condições | Alterações persistidas, mensagens emitidas e efeitos externos. |
| Regras de negócio | Regra atômica com ID, condição, resultado e exceções. |
| Critérios de aceite | Cenários testáveis, preferencialmente Dado/Quando/Então, ligados às regras. |
| Interface | Telas, componentes, estados, acessibilidade e referência ao protótipo aprovado. |

### 3.3 Dados e campos

Defina cada entidade uma vez. Para cada campo, registre `nome técnico`, `rótulo`, `tipo`, `unidade`, `obrigatoriedade`, `nulidade`, `limites`, `validação`, `formato/máscara`, `valor padrão`, `classificação de sensibilidade`, `retenção` e `origem/destino`. Explique diferenças entre representação de UI, API e banco; por exemplo, `refund_amount_cents` é inteiro em centavos e aparece como moeda na interface. Relacione tabela/migration/schema e a versão do contrato. Não use uma regex de formato como prova de validade semântica de um documento.

### 3.4 APIs e integrações

Registre `API/integração`, `protocolo e versão`, `provedor/consumidor`, `método e endpoint`, `path/query/header params`, `autenticação`, `autorização`, `request`, `response de sucesso`, `erros`, `paginação`, `limites de uso`, `timeout`, `idempotência`, `compatibilidade` e link para OpenAPI ou contrato canônico. Inclua exemplos sanitizados e sem credenciais; explicite o comportamento diante de falhas e versões anteriores.

### 3.5 Eventos, gatilhos e tarefas agendadas

Registre `ID/nome/versão do evento`, `produtor`, `gatilho`, `payload/schema`, `broker/tópico`, `consumidores`, `entrega/ordenação`, `retry/backoff`, `DLQ`, `idempotência`, `observabilidade` e `retenção`. Para jobs, inclua `ID`, `dono`, `expressão de agendamento`, `fuso horário`, `timeout`, `concorrência`, `efeitos`, `retentativa` e procedimento de reprocessamento. Um cron em UTC precisa de descrição legível e referência de fuso.

### 3.6 Observabilidade e operação

Registre `correlation_id/trace_id`, logs e campos permitidos, métricas técnicas e de negócio, SLI/SLO com janela de medição, alertas e limiares, dashboards, rastreamento de erros, health checks, runbook, eventos de auditoria e impacto esperado em custo/capacidade. Diferencie meta de serviço (SLO) de compromisso contratual (SLA).

### 3.7 Segurança, governança e conformidade

Registre risco, perfis e matriz de permissões (RBAC/ABAC), autenticação/sessão, criptografia e gestão de segredos, tratamento de dados pessoais, mascaramento em logs, validação de entrada, políticas de origem quando houver navegador, requisitos regulatórios aplicáveis, janela de manutenção e procedimento de reversão. Cite políticas internas e decisões aprovadas em vez de presumir que toda norma citada se aplica.

## 4. Modelo de página de feature

Reserve o número com `ork roadmap feat --thread <thread>` e copie [o modelo](../produto/_modelo-feature.md) para cada feature; substitua colchetes por valores ou por `Não aplicável — motivo`. O frontmatter é a camada que agentes e o verificador leem; o corpo é a camada que pessoas leem. Acrescente tabelas de campos e contratos quando houver vários elementos.

Chaves do frontmatter de uma feature:

| Chave | Conteúdo | Conferido por `ork docs verificar` |
| --- | --- | --- |
| `id`, `tipo`, `titulo` | `FEAT-000`, `feature`, nome | formato do ID, nome do arquivo, unicidade |
| `estado` | `vigente`, `em desenvolvimento`, `proposto` ou `descontinuado` | valor do padrão |
| `pai` | `MOD-00` | existe e é do nível acima |
| `roadmap` | lista de `RM-000` | existe, e o item cita a feature de volta |
| `owner`, `aprovador` | pessoas | presença |
| `verificado_em`, `versao` | ISO 8601 com fuso; branch@commit | formato |
| `fontes.codigo`, `fontes.testes`, `fontes.docs` | caminhos relativos à raiz | **existem no repositório** |
| `fontes.simbolos` | `arquivo#nome` | **o nome aparece no arquivo** |
| `fontes.contratos` | IDs de contrato (`ork.hitl/v2`) | **aparecem em `fontes.codigo`** |
| `fontes.comandos` | comandos do CLI do produto | **o CLI declara o comando** |

## 5. Revisão e sincronização

Antes de aprovar uma mudança, confira IDs e links, comportamento e exceções, nomes e tipos contra código/migrations, contratos de API/evento, permissões, testes e ambiente real. Atualize a documentação junto à mudança de implementação; marque diferenças como `a validar` com responsável e prazo. Automação ou agente pode comparar fontes e preparar um diff, mas deve registrar o commit/contrato consultado e não converter suposição em fato. O status de execução e as decisões de prioridade ficam no [padrão de roadmap](roadmap-de-produto.md).

No Orkastery essa comparação tem dono e comando:

- `ork docs verificar` — roda no CI em todo PR; reprova página cujas `fontes` não existem mais, link quebrado, ID repetido ou campo de modelo esquecido.
- `ork docs sincronizar` — roda na máquina do projeto; lê o ledger das threads e o git e atualiza **só fatos** (merge, fase), nunca status por passagem de tempo. Sem `--escrever`, só mostra o que mudaria.
- `ork docs init` — cria esta estrutura em qualquer produto conduzido pelo Orkastery.

## 6. Três leitores e fatos de SDLC (adaptação Orkastery)

Cada página é lida ao mesmo tempo por três leitores. Se um deles fica para trás, a página falhou.

### 6.1 Pessoa com TDAH

- **Resposta primeiro.** Logo abaixo do título, uma linha `> **Em uma frase:**` com até 240 caracteres.
- **Estado de relance.** Estado, data de verificação e versão aparecem antes de qualquer explicação.
- **Uma ideia por linha.** Tópicos em vez de parágrafos; parágrafo com mais de 600 caracteres gera aviso.
- **Seções sempre com o mesmo nome.** Quem já leu uma página sabe onde está cada coisa na próxima.
- **Nada vazio em silêncio.** Seção sem conteúdo diz `Não aplicável — motivo` ou `A definir — responsável, prazo`.

### 6.2 Verificador de paridade

- A página afirma coisas conferíveis: caminhos, símbolos, contratos, comandos, commits.
- Divergência entre página e repositório é **erro de lint**, não questão de opinião.
- O verificador nunca completa lacuna nem infere estado; ele só aponta.

### 6.3 Modelos e agentes de IA

- Frontmatter YAML com chaves e valores fixos (seção 4); IDs estáveis no nome do arquivo e no título.
- `ork docs verificar --json` devolve os achados com regra tipada (`docs.paridade.fonte`, `docs.leitura.resumo`...).
- Um agente pode propor a mudança; a revisão e a decisão ficam com pessoas (seção 2, Responsabilidade).

### 6.4 Fatos de SDLC do método Orkastery

- Entram na documentação **fatos do produto**: a feature está `vigente`, em qual versão, verificada quando, contra quais fontes.
- O andamento da entrega (thread, fase, CHECK, merge) é registrado no [roadmap](roadmap-de-produto.md), na seção `sdlc` do item.
- **Micro-decisões de condução não entram**: qual claim foi recadastrada, qual GO-FIX corrigiu um teste, qual sessão caiu. Isso vive no ledger da thread.
