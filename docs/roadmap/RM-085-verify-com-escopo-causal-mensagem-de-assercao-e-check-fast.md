---
id: RM-085
tipo: roadmap
titulo: "Verify com escopo causal, mensagem de asserção e CHECK independente no #Fast"
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-08T23:59:18-03:00
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

# RM-085: Verify com escopo causal, mensagem de asserção e CHECK independente no #Fast

> **Em uma frase:** a rodada do verify mede todo o trabalho que cria, registra a asserção que falhou e permite acrescentar CHECK independente a uma thread #Fast existente.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz e diagnostica uma rodada do `verify` perde atribuição causal, detalhe da falha ou independência de revisão em três fronteiras observadas pela bancada da [RM-074](RM-074-agile-check-tres-vezes-mais-rapido.md).
- **Evidências e fonte:** na bancada M13 de 07 e 08/11/2026, numa rede de três VPS, o PSI `full` ficou sem crédito porque a rodada não tinha cgroup exclusivo e os contêineres da varredura nasceram sem cgroup pai. A falha do GX3 chegou ao ledger com nome e arquivo, mas sem a mensagem da asserção, e exigiu reprodução. Na condução, `ork phase run <thread> CHECK` recusou uma thread #Fast com `fase invalida`, de modo que a revisão independente ficou apenas como decisão registrada.
- **Objetivo/OKR:** o verify atribui a contenção ao trabalho completo da rodada, preserva no ledger o diagnóstico limitado e seguro de uma asserção e aceita CHECK independente sob uma conta diferente do construtor quando a condução o pede numa #Fast existente.
- **Hipótese:** se a rodada possuir um escopo de execução comum, a falha persistir o detalhe mínimo seguro e o ciclo #Fast aceitar a extensão explícita com CHECK, então a medição, o diagnóstico e a revisão independente deixam de depender de reprodução ou registro substituto.
- **Métrica principal / linha de base / meta / janela / fonte:** três contratos atendidos por rodada: atribuição causal disponível quando o host permite o escopo exclusivo; mensagem de asserção presente nas falhas `node --test`; CHECK independente anexável a uma #Fast existente. Linha de base: os três casos da bancada e da condução da RM-074. Meta: os três aceites abaixo. Janela: por rodada e por extensão de ciclo. Fonte: `verify_run`, ledger da thread e resultado de `phase run`.
- **Métricas de proteção:** host sem capacidade mantém motivo tipado e crédito causal zero; a mensagem tem limite de tamanho e redação de credenciais da [RM-079](RM-079-claims-que-a-correcao-passa.md); quem não pede CHECK conserva o fluxo #Fast atual.

## Escopo e validação

- **Incluído:**
  - **A rodada mede todo o trabalho que cria:** o processo da rodada e os contêineres da varredura e da integração herdam um escopo exclusivo comum, sem deixar trabalho criado pelo verify fora da hierarquia medida; a bancada credita contenção causal somente quando essa herança está completa. Quando o host não permite o escopo, o motivo continua tipado e o crédito continua zero.
  - **O ledger guarda a mensagem da asserção:** uma falha de `node --test` registra nome, arquivo e mensagem limitada com esperado, obtido e local; a persistência e a apresentação aplicam a redação de credenciais da RM-079.
  - **Uma #Fast pode receber CHECK independente:** a condução acrescenta CHECK a uma thread #Fast existente, exige conta nativa diferente da conta do construtor e não muda o ciclo das threads que não pedem a extensão.
- **Fora de escopo:** dar crédito sem fonte causal exclusiva, mudar a bateria ou a fórmula da bancada, persistir saída ilimitada do runner, afrouxar a redação de credenciais, acrescentar CHECK automaticamente a toda #Fast ou tratar nome de papel no prompt como identidade independente.
- **Entregáveis e critérios de aceite:**
  - uma rodada em host compatível roda em escopo exclusivo e inclui nele os contêineres que cria; a bancada consegue creditar a contenção causal;
  - um host incompatível produz motivo tipado, conserva crédito zero e não infere atribuição parcial como causal;
  - uma falha de asserção registra esperado, obtido e local, com tamanho limitado e sem credencial em texto;
  - truncamento e redação preservam diagnóstico suficiente e não alteram o resultado do teste;
  - `phase run` acrescenta CHECK a uma #Fast existente quando a condução pede, e o núcleo prova uma conta diferente da do construtor;
  - uma #Fast sem esse pedido conserva as fases e pausas atuais;
  - um mutante por fronteira de cgroup, persistência da falha, limite/redação e extensão do ciclo morre.
- **Piloto, medição e critérios de expansão/interrupção:** piloto na bancada do próprio Orkastery e numa thread #Fast com CHECK solicitado; interromper se algum contêiner criado pela rodada escapar do escopo sem motivo, se a mensagem expuser credencial ou se a extensão aceitar a mesma conta do construtor.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** prioridade a definir pelo dono; item aberto por decisão do dono em 08/11/2026 a partir das três lacunas observadas no fechamento da RM-074.
- **Horizonte / alvo / previsão / confiança / marcos:** a definir pelo dono; marcos independentes para escopo causal, diagnóstico de asserção e extensão explícita do #Fast, com validação conjunta no verify.
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-074 para a bancada M13; RM-079 para limite e redação de credenciais; contratos de cgroup, `node --test`, ledger, identidade de conta e ciclo #Fast; owner: Julio; próxima revisão no planejamento do item.
- **Premissas / riscos / mitigação:** nem todo host oferece cgroup exclusivo; mitigação: fallback fechado com causa tipada e crédito zero. A mensagem do runner pode conter segredo ou volume excessivo; mitigação: estrutura mínima, limite e redação antes de persistir. A extensão do #Fast pode virar mudança silenciosa do modo; mitigação: só a condução a acrescenta e a ausência do pedido preserva o fluxo vigente.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  1. Corrigir as três lacunas dentro da RM-074: manteria aberta uma iniciativa cujo resultado já foi medido e encerrado.
  2. Abrir a RM-085 com as três lacunas e fechar a RM-074 pelo resultado medido (decisão do dono, 08/11/2026).

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-11-08 | Julio |
| Documentação | Rascunho | — | 2026-11-08 | Julio |
| Código | Não iniciado | — | 2026-11-08 | Julio |
| Testes | Não iniciados | — | 2026-11-08 | Julio |
| Deploy | Não implantado | — | 2026-11-08 | Julio |
| Exposição | Flag desligada | — | 2026-11-08 | Julio |
| Habilitação | Pendente | — | 2026-11-08 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão condutora da thread que pegar o item; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela condução por decisão do dono; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** o dono define a prioridade e a condução planeja as três fronteiras sem misturar seus critérios de aceite.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-08 | Item criado em Discovery com três lacunas de produto | Bancada M13 e condução de fechamento da RM-074 | Julio (decisão de 08/11/2026) |
