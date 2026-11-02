---
id: RM-081
tipo: roadmap
titulo: CHECK que entende qualquer runner de teste e só roda de novo o necessário
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-01T01:30:00-03:00
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

# RM-081: CHECK que entende qualquer runner de teste e só roda de novo o necessário

> **Em uma frase:** o verify entende o resultado de qualquer runner e, nas rodadas de correção, roda de novo só o que precisa, sem tirar a suíte inteira do SHIP.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem usa o Orkastery num projeto que não é só Node (back-end em Python, e2e de navegador, Go) e vê o CHECK demorar e reprovar sem dizer qual teste caiu.
- **Evidências e fonte:** uma rede de três VPS que conduz uma aplicação web com o ork 0.5.6 relatou a pilha dela em 01/11/2026: pytest com pytest-xdist e serviços reais, Vitest com Testing Library, Playwright com checagem de acessibilidade e comparação visual. Conferido contra a main da 0.6.3:
  - `testesQueCairam` (`core/src/redacao-saida.ts`) só reconhece o TAP e o reporter `spec` do `node --test` e as linhas `FAIL` de Jest e Vitest, com até 10 nomes. No pytest e no Playwright, a comparação com a baseline é só por comando.
  - `reprovacaoSoDeRelogio` (`core/src/steal.ts`) só reconhece a assinatura de prazo do `node --test`. Um teste de desempenho de outro runner que reprova sob steal alto vira regressão.
  - Cada rodada de correção roda de novo a suíte inteira, mesmo quando caiu um teste só.
  - O número de workers de cada runner é fixo no projeto e não acompanha a CPU que o agendador do Agile mede (`core/src/agendador-cpu.ts`).
  - A rede ainda estava na 0.5.6, sem o Agile Check. Só atualizar e declarar as lanes em `check.agile.test` já divide a suíte.
- **Objetivo/OKR:** o CHECK de um projeto com qualquer runner fica mais rápido sem perder qualidade e diz, por nome, o que caiu.
- **Hipótese:** se o verify ler um relatório estruturado de qualquer runner, então dá para comparar teste a teste, proteger teste de relógio e rodar de novo só o que caiu, e as rodadas de correção deixam de pagar a suíte inteira.
- **Métrica principal / linha de base / meta / janela / fonte:** razão entre o CHECK de uma rodada de correção com a RM-081 e sem ela, na mesma árvore e na mesma máquina. Linha de base: a medir na bancada (`core/scripts/medir-check.cjs`). Meta: a definir pelo dono depois da primeira medida. Janela: por fatia. Fonte: a bancada, com três pares válidos.
- **Métricas de proteção:**
  - perda de qualidade de mutação de no máximo 10% contra o Classic;
  - nenhum teste removido ou afrouxado;
  - nada chega à main sem a suíte inteira verde;
  - o Classic não muda.

## Escopo e validação

- **Incluído:**
  - **F1 · Resultado estruturado de qualquer runner.**
    - O manifesto declara, por comando do verify e por lane do Agile, um relatório JUnit XML: `pytest --junitxml`, o reporter junit do Vitest, do Jest e do Playwright, o `gotestsum` no Go.
    - O verify lê do relatório o nome, o status, a duração e o teste pulado. A baseline e o recibo guardam os nomes sem o teto de 10.
    - Sem relatório, vale a leitura da saída de hoje.
  - **F2 · Teste de relógio em qualquer runner.**
    - O manifesto marca os testes que medem tempo, por padrão de nome, marcador ou tag.
    - Sob steal acima do limiar, a reprovação só deles vira sem veredito, e o verify roda de novo só esses testes, isolados.
  - **F3 · Rodar de novo só o que falhou.**
    - Na rodada de correção, o verify roda primeiro os testes que caíram na rodada anterior, com o filtro do próprio runner declarado no manifesto. Se algum ainda cai, reprova sem rodar o resto.
    - A suíte inteira roda uma vez antes do SHIP.
  - **F4 · Lanes do tamanho da máquina.**
    - O Agile passa `ORK_WORKERS` a cada lane com a reserva vigente medida pelo agendador; o Classic publica a mesma variável com a capacidade inteira da máquina.
    - `check.agile.test` preserva `lane: comando` e aceita `lane: { comando, recursos }` para declarar banco, broker, porta ou outro serviço exclusivo da rodada.
    - Lanes com recurso comum não se sobrepõem; a soma das reservas simultâneas permanece dentro da capacidade medida.
    - Pytest, Playwright, Vitest, Jest e Go têm exemplos no [guia de verificação](../guias/verificacao.md#classic-check-e-agile-check-rm-072).
  - **F5 · Seleção pelo que mudou, só na rodada morna.**
    - Usa a seleção nativa do runner declarada no manifesto, com a regra da M7 da [RM-074](RM-074-agile-check-tres-vezes-mais-rapido.md): na dúvida, suíte inteira.
    - Nunca vale no SHIP.
- **Fora de escopo:** escolher ou impor runner, framework de teste ou navegador; mudar o Classic.
- **Entregáveis e critérios de aceite:**
  - F1: com o relatório, um teste de pytest e um de Playwright caídos aparecem por nome na baseline, no verify e no recibo; sem o relatório, nada muda;
  - F2: com steal acima do limiar, a reprovação só de teste marcado vira sem veredito em qualquer runner, e asserção comum continua regressão;
  - F3: numa rodada de correção, o verify roda primeiro só os que caíram, e o SHIP recusa sem a suíte inteira verde no HEAD;
  - F4: cada lane recebe workers pela CPU medida, e a soma não passa da máquina;
  - F5: a seleção cai para a suíte inteira quando o runner não garante a seleção ou o cache não serve;
  - um mutante por regra, em cada fatia.
- **Piloto, medição e critérios de expansão/interrupção:**
  - piloto num projeto com pytest e Playwright;
  - a razão sai da bancada, com três pares válidos;
  - a fatia que perder mais de 10% de qualidade contra o Classic volta.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** 7ª da fila de achados de condução em rede (01/11/2026). Alta: num projeto que não é só Node, o CHECK não nomeia o teste que caiu nem protege teste de relógio, e cada correção paga a suíte inteira.
- **Horizonte / alvo / previsão / confiança / marcos:** fatias em `#Auto` depois da 0.6.4, na ordem F1, F3, F2, F4 e F5. A F4 pode correr ao lado da F1.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-037](RM-037-verify-rapido-e-confiavel.md), [RM-072](RM-072-check-cinco-vezes-mais-rapido.md), [RM-074](RM-074-agile-check-tres-vezes-mais-rapido.md) (a bancada e a regra da M7), [RM-078](RM-078-recibo-valido-enquanto-nada-muda.md) e [RM-080](RM-080-saida-completa-e-causa-tipada-no-verify.md).
- **Premissas / riscos / mitigação:**
  - o JUnit XML varia entre runners: normalizar só nome, classe, status e duração, com uma fixture de cada runner;
  - rodar só o que caiu pode esconder regressão nova: a suíte inteira é obrigatória antes do SHIP;
  - a seleção por mudança erra em dependência indireta: só na rodada morna, com queda para a suíte inteira.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  1. Ler a saída de cada runner por expressão regular: frágil e sem duração.
  2. Relatório JUnit XML declarado no manifesto (recomendada): pytest, Vitest, Jest, Playwright e Go já emitem.
  3. Impor um runner: fora do escopo do produto.
  - **Decisão do dono, 01/11/2026, no terminal (resposta "a"):** abrir a RM-081 e despachar todas as fatias depois da 0.6.4.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-11-01 | Julio |
| Documentação | Rascunho | — | 2026-11-01 | Julio |
| Código | Não iniciado | — | 2026-11-01 | Julio |
| Testes | Não iniciados | — | 2026-11-01 | Julio |
| Deploy | Não implantado | — | 2026-11-01 | Julio |
| Exposição | Flag desligada | — | 2026-11-01 | Julio |
| Habilitação | Pendente | — | 2026-11-01 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão condutora de cada fatia; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela condução da VPS a pedido do dono, a partir do relato da pilha de testes de outra rede; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** a condução despacha a F1, com a F4 ao lado, depois da 0.6.4.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-01 | Item criado em Discovery, com as fatias F1 a F5 | Relato da pilha de testes de outra rede, conferido contra a 0.6.3 | Julio (pedido de 01/11/2026) |
| 2026-11-02 | F4 implementa workers por reserva e recursos exclusivos com forma textual retrocompatível | Testes RM081F4 e mutantes M1–M4 da thread `ork-rm081f4worke` | Thread `ork-rm081f4worke` (#Auto) |
