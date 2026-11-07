---
id: RM-081
tipo: roadmap
titulo: CHECK que entende qualquer runner de teste e só roda de novo o necessário
categoria: iniciativa
pai: null
features: [FEAT-004]
owner: Julio
atualizado_em: 2026-11-06T00:00:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Em execução
  deploy: Produção
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: e17ab8e
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
| Em desenvolvimento | Mesclado | Em execução | Produção | Flag desligada |

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
    - O Agile passa `ORK_WORKERS` a cada lane com a reserva vigente medida pelo agendador; o Classic publica a mesma variável com a capacidade inteira disponível.
    - `check.agile.test` preserva `lane: comando` e aceita um objeto único com as chaves de F1, F2, F3 e F5, mais `recursos`.
    - Lanes com recurso comum não se sobrepõem; a soma das reservas simultâneas permanece dentro da capacidade medida.
    - Pytest, Playwright, Vitest, Jest e Go têm exemplos no [guia de verificação](../guias/verificacao.md#workers-e-recursos-por-lane).
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
| Ciclo do item | Em desenvolvimento | — | 2026-11-06 | Julio |
| Documentação | Em revisão | — | 2026-11-06 | Julio |
| Código | Mesclado | commit `e17ab8e` | 2026-11-06 | Julio |
| Testes | Em execução | — | 2026-11-06 | Julio |
| Deploy | Produção | — | 2026-11-06 | Julio |
| Exposição | Flag desligada | — | 2026-11-06 | Julio |
| Habilitação | Pendente | — | 2026-11-06 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão condutora de cada fatia; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela condução da VPS a pedido do dono, a partir do relato da pilha de testes de outra rede; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** a condução submete a F3 empilhada sobre a F1; F2 e F4 seguem como fatias independentes depois da 0.6.4.

### F2 nesta fatia

- O manifesto aceita `relogio` por comando ou lane JUnit, com uma estratégia entre padrão de nome, marcador e tag. Sem a declaração, Classic e Agile conservam o julgamento anterior.
- Sob steal acima do limiar, somente um conjunto de falhas integralmente marcado fica sem veredito. Falha comum no mesmo comando, ou caso marcado sem steal alto, continua regressão.
- A segunda rodada reutiliza o filtro nominal da F3 para isolar os nomes marcados quando ele existe. O resultado é diagnóstico e nunca transforma o primeiro resultado em verde.
- Ledger, gate e texto bilíngue conservam os nomes, o steal e o resultado da segunda rodada. Os mutantes cobrem marcação excessiva, limiar ignorado, promoção indevida a verde, ausência de isolamento e perda do recibo.

### F3 nesta fatia

- O mapa de comando aceita `filtro` ao lado de `comando` e `junit`; sem a declaração nova, Classic e Agile continuam com a suíte inteira.
- A correção usa somente nomes JUnit do último `verify_run` do mesmo comando. Parcial vermelha reprova ali; parcial verde segue para o comando integral.
- O recibo e o texto declaram a parcial e os nomes selecionados. O SHIP recusa explicitamente qualquer recibo parcial.
- Testes focados cobrem Classic, lanes Agile, escape dos nomes e a defesa do SHIP; a bancada de razão permanece com a condução.

### F5 nesta fatia

- A lane Agile aceita `selecao` com comando nativo, caminhos que o runner garante mapear e configurações que invalidam essa garantia. Sem a declaração, nada muda.
- Só a rodada morna com último `verify_run` verde, mesma base, commit ancestral e árvore limpa pode selecionar. Rodada fria, Classic, cache ausente ou inválido, manifesto, lockfile, configuração e caminho não mapeado executam a suíte inteira com o motivo.
- A lane grava modo, motivo, arquivos e base no ledger e no texto bilíngue. A seleção reutiliza `parcial` da F3; o SHIP continua recusando pelo caminho existente.
- O guia e a referência trazem exemplos de Vitest, Jest e Playwright. Testes focados e mutantes cobrem as regras; a razão contra a rodada integral fica para a bancada da condução, sem ganho antecipado.

### F4 nesta fatia

- A F4 entrou sobre a pilha de F1, F2, F3 e F5: a lane tem uma única declaração, textual ou em objeto, sem escolher entre formatos incompatíveis.
- O objeto usa o leitor comum de comando e reúne `comando`, `junit`, `filtro`, `relogio`, `selecao` e `recursos`; chave desconhecida conserva o caminho completo no erro.
- O Agile publica `ORK_WORKERS` pela reserva vigente e serializa somente lanes com recurso comum. O Classic publica o mesmo contrato com a capacidade inteira e conserva comandos e ordem.
- Testes focados, TL10, TL11 e mutantes M1–M4 cobrem o contrato. A razão contra a rodada sem a fatia permanece para a bancada da condução, sem ganho antecipado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-01 | Item criado em Discovery, com as fatias F1 a F5 | Relato da pilha de testes de outra rede, conferido contra a 0.6.3 | Julio (pedido de 01/11/2026) |
| 2026-11-02 | F1 implementa JUnit declarado por comando e lane, sem mudar a forma textual | Fixtures de pytest, Vitest, Jest, Playwright e gotestsum e mutantes da thread `ork-rm081f1relat`; veredito no CHECK | Codex (#Auto, D1 registrada no ledger) |
| 2026-11-02 | F3 roda primeiro os nomes da correção e conserva a suíte inteira como condição do SHIP | Testes focados da thread `ork-rm081f3rodad`; D1 a D4 registradas no ledger; CHECK pendente | Codex (#Auto) |
| 2026-11-02 | F2 protege qualquer runner JUnit marcado contra julgamento temporal sob steal, sem esconder falha comum | Testes focados e mutantes da thread `ork-rm081f2teste`; decisões autônomas registradas no ledger; CHECK pendente | Codex (#Auto) |
| 2026-11-02 | F5 usa seleção nativa somente no Agile morno e cai para a suíte inteira na dúvida | Testes focados e mutantes da thread `ork-rm081f5selec`; decisões autônomas registradas no ledger; CHECK pendente | Codex (#Auto) |
| 2026-11-02 | F4 entra sobre a pilha com workers por reserva e recursos exclusivos na declaração única da lane | Testes focados e mutantes M1–M4 da thread `ork-rm081f4sobre`; decisões D1–D4 registradas no ledger; CHECK pendente | Codex (#Auto) |
| 2026-11-03 | F1 a F5 mescladas e em produção na 0.6.5 | PRs #251, #253, #254, #255 e #256 (último merge `e17ab8e`) e tag `v0.6.5` publicada no npm | Julio |
| 2026-11-06 | Fixtures que apenas aguardam fila, recibo, estado, resultado ou processo deixam o prazo de parede para o limite externo da rodada | Código, testes e mutantes da thread `ork-testesdoprod`; CHECK pendente | Codex (#Auto) |
