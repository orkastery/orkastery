---
id: RM-077
tipo: roadmap
titulo: Revisão independente medida pelo construtor do HEAD
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-23T11:18:00-03:00
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

# RM-077: Revisão independente medida pelo construtor do HEAD

> **Em uma frase:** o CHECK independente compara o revisor com quem construiu o HEAD revisado, não com todo o histórico de GOs; exceção formal fica no ledger, sem editar estado à mão.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem usa vários runtimes na mesma thread, por escolha ou porque o rodízio por cota trocou de runtime. Hoje uma thread com GO nos dois runtimes fica sem revisor elegível.
- **Evidências e fonte:** achados de uma rede de execução que conduz um roadmap em `#Auto`, conferidos contra o comportamento do núcleo.
  - Threads com GO em `codex` e em `claude-bg` ficaram sem revisor; foi preciso desligar `exigeRuntimeDiferente` à mão, com aprovação do dono, e vincular o CHECK manual editando o estado do supervisor.
  - Na 0.6.2, `runtimeCruzadoParaDespacho` (`core/src/phase.ts`) junta o runtime de toda sessão de GO da thread e barra o CHECK em qualquer um deles. A trava só se define na criação da thread, e não há comando para registrar exceção.
  - O próprio núcleo já tem um modelo melhor na entrega do #Noctum (`noctum-provas.ts`): a revisão não pode ser de um autor da candidata e precisa ter sido despachada depois do último despacho de autor.
  - O rodízio entre runtimes por cota ([RM-064](RM-064-conta-esgotada-nao-para-a-fase.md)) aumenta a chance de uma thread ter GO nos dois runtimes.
- **Objetivo/OKR:** toda thread tem um revisor elegível sem edição manual de estado.
- **Hipótese:** se a independência for medida pelo construtor do HEAD revisado, então o CHECK independente deixa de travar threads que trocaram de runtime, sem perder independência, porque quem revisa continua não sendo quem construiu o que está sendo revisado.
- **Métrica principal / linha de base / meta / janela / fonte:** threads com CHECK barrado por `runtime.autoconferencia` sem revisor elegível. Linha de base: a medir. Meta: zero. Janela: por release. Fonte: ledger.
- **Métricas de proteção:** um runtime nunca revisa o próprio HEAD; toda exceção tem quem aprovou, quando, qual runtime e por quê.

## Escopo e validação

- **Incluído:**
  - calcular o construtor do HEAD pelas sessões de GO cujos commits estão no intervalo desde o último CHECK aprovado, reaproveitando a lógica de autores do #Noctum;
  - um comando de exceção que grava evento tipado no ledger (quem aprovou, quando, qual runtime, motivo), honrado pelo `phase run`;
  - um `phase run` manual que já nasce vinculado como revisão.
- **Fora de escopo:** trocar a política de quais runtimes podem revisar quais.
- **Entregáveis e critérios de aceite:**
  - thread com GOs antigos em `codex` e o último GO em `claude-bg` aceita CHECK no `codex` sem editar `thread.json` nem estado do supervisor;
  - CHECK no mesmo runtime do último construtor continua barrado;
  - exceção sem quem aprovou é recusada;
  - mutante que volta a olhar todo o histórico morre.
- **Piloto, medição e critérios de expansão/interrupção:** piloto nas threads que tiveram rodízio de runtime por cota.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** elevada pelo dono em 23/11/2026; sua ordem relativa com RM-064 e RM-076 segue o gargalo medido pela RM-071.
- **Horizonte / alvo / previsão / confiança / marcos:** desobstrução da frente C; a faixa de prazo será publicada pela RM-071 quando houver amostra suficiente.
- **Dependências e bloqueios (ID, owner, próxima revisão):** revisão independente da [RM-058](RM-058-modo-noctum.md) (D2) e da [RM-012](RM-012-ci-check-independente.md); absorve o CHECK independente no `#Fast` da [RM-085](RM-085-verify-com-escopo-causal-mensagem-de-assercao-e-check-fast.md); owner: Julio; revisão após a medição inicial da RM-071.
- **Premissas / riscos / mitigação:** commit sem sessão conhecida (feito à mão); mitigação: tratar como construtor desconhecido e pedir exceção.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  1. Pelo último GO: simples, mas erra quando dois GOs construíram o mesmo intervalo.
  2. Pelos autores dos commits desde a última revisão (recomendada).

## Estado com evidências

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

- **RACI (R / A / C / I):** R: a sessão condutora da thread que pegar o item; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela condução da VPS a pedido do dono, a partir dos achados de outra rede; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** depois das habilitações da frente C, a condução compara o gargalo semanal da RM-071 e ordena RM-064, RM-076 e RM-077; responsável: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-31 | Item criado em Discovery | Achados de condução em rede, conferidos contra a 0.6.2 | Julio (pedido de 31/10/2026) |
| 2026-11-23 | Prioridade elevada e CHECK independente do `#Fast` absorvido | Realinhamento aprovado pelo dono; elegibilidade considera quem construiu o HEAD revisado | Julio |
