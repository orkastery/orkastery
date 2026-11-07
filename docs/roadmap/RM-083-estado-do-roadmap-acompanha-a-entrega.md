---
id: RM-083
tipo: roadmap
titulo: Estado do roadmap acompanha a entrega
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-07T16:41:25-03:00
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

# RM-083: Estado do roadmap acompanha a entrega

> **Em uma frase:** o próprio PR de entrega prepara o estado pós-merge da página e do índice, para que a `main` não dependa de um PR posterior de sincronização.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem entrega um item pelo fluxo oficial pode deixar a documentação da `main` incompatível com o merge, mesmo quando código e CI terminaram corretamente.
- **Evidências e fonte:** em 07/11/2026, depois do merge da [RM-079](RM-079-claims-que-a-correcao-passa.md), o CI da `main` reprovou porque a página ainda dizia que a branch havia sido criada. A correção exigiu outro PR com `ork docs sincronizar --escrever --so RM-079`. O bloco de estado, o índice e `sdlc` ficaram atrás da entrega.
- **Objetivo/OKR:** a `main` já recebe a página e o índice coerentes com a entrega no mesmo merge.
- **Hipótese:** se o PR transportar e validar o estado prospectivo que passa a ser verdadeiro no merge, então a documentação fica correta quando o commit entra na base, sem uma segunda mudança manual.
- **Métrica principal / linha de base / meta / janela / fonte:** merges de item que deixam `docs verificar` vermelho por atraso de estado. Linha de base: o caso da RM-079. Meta: zero. Janela: por merge. Fonte: CI da base e recibo de `ship registrar-pr`.
- **Métricas de proteção:** nenhum item é marcado como mesclado sem o commit da entrega; merge recusado ou abandonado não altera a `main`; o histórico continua distinguindo entrega, registro e encerramento.

## Escopo e validação

- **Incluído:**
  - o próprio PR de entrega leva o frontmatter, o bloco de estado e o índice no estado que passa a valer quando seu HEAD entra na base;
  - `docs verificar --pr` reconhece o estado prospectivo, confere o commit da entrega e reprova incoerência interna antes do merge;
  - depois do merge, `docs verificar` confere o mesmo conteúdo contra a base sem exigir `ork docs sincronizar --escrever` em outro PR;
  - `sdlc` registra a fase e o status da entrega no próprio PR; `ship registrar-pr` registra o fato do merge no ledger, e MASTER não é usado para reparar a página;
  - o índice é gerado no PR a partir do frontmatter prospectivo e chega coerente à base;
  - merge feito fora do `ork`, mas pelo PR que passou pelo mesmo contrato, conserva o estado correto; merge direto ou PR que contorne o contrato gera divergência tipada no CI e no status da thread, sem inferir entrega nem reescrever histórico em silêncio;
  - a recuperação de merge que contornou o contrato é uma operação explícita de registro e sincronização pelo núcleo, sem exigir que a pessoa monte um PR manual de documentação;
  - paridade entre pt-BR e inglês em toda mensagem que tenha os dois idiomas.
- **Fora de escopo:** marcar entrega antes de existir commit candidato, alterar o estado de itens sem relação com o PR, fechar MASTER durante o merge ou aceitar CI vermelho na base.
- **Entregáveis e critérios de aceite:**
  - o PR de uma entrega contém página, bloco de estado, `sdlc` e índice coerentes com seu estado pós-merge;
  - o merge deixa `node core/dist/index.js docs verificar` verde na base sem PR manual de sincronização;
  - PR fechado sem merge não muda a base nem produz estado de entrega;
  - `ship registrar-pr` registra um merge já refletido na página, sem criar correção documental separada;
  - merge fora do `ork` que passou pelo contrato do PR permanece verde; bypass do contrato é identificado por causa tipada e não vira entrega por inferência;
  - um mutante por transição de estado e por índice morre.
- **Piloto, medição e critérios de expansão/interrupção:** piloto numa entrega de item do roadmap; interromper se o estado prospectivo puder chegar à base sem o commit correspondente ou se um PR não mesclado alterar a fonte canônica.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** prioridade a definir pelo dono; incidente de documentação na entrega da RM-079 em 07/11/2026.
- **Horizonte / alvo / previsão / confiança / marcos:** a definir pelo dono; primeiro o contrato prospectivo no PR, depois o caminho tipado para merge que contorne o fluxo.
- **Dependências e bloqueios (ID, owner, próxima revisão):** `docs verificar --pr`, `docs sincronizar`, `ship registrar-pr` e o contrato do índice; owner: Julio; próxima revisão no planejamento da fatia.
- **Premissas / riscos / mitigação:** o estado prospectivo pode parecer verdadeiro antes do merge quando lido na branch; mitigação: o verificador distingue candidata e base e exige o commit candidato. Um merge que contorne CI pode deixar a base divergente; mitigação: causa tipada e recuperação pelo núcleo, nunca inferência silenciosa.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  1. Corrigir no MASTER: tarde demais para o CI da base e exige nova mudança depois do merge.
  2. Corrigir em `ship registrar-pr`: o merge já deixou a base divergente.
  3. Levar o estado prospectivo no próprio PR e usar `ship registrar-pr` só para registrar o fato (recomendada).

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-11-07 | Julio |
| Documentação | Rascunho | — | 2026-11-07 | Julio |
| Código | Não iniciado | — | 2026-11-07 | Julio |
| Testes | Não iniciados | — | 2026-11-07 | Julio |
| Deploy | Não implantado | — | 2026-11-07 | Julio |
| Exposição | Flag desligada | — | 2026-11-07 | Julio |
| Habilitação | Pendente | — | 2026-11-07 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão condutora da thread que pegar o item; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela condução a pedido do builder; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** o dono define a prioridade e a condução planeja a transição prospectiva do PR.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-07 | Item criado em Discovery | CI da `main` reprovou após a RM-079 até um PR separado executar a sincronização documental | Builder (pedido de 07/11/2026) |
