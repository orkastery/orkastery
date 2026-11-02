---
id: FEAT-004
tipo: feature
titulo: Claims e verify no HEAD real
estado: vigente
pai: MOD-02
roadmap: [RM-100, RM-037, RM-081]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-27T09:10:12-03:00
versao: main@949df8e
fontes:
  codigo:
    - core/src/claims.ts
    - core/src/verify.ts
    - core/src/junit.ts
    - core/src/verify-sandbox.ts
    - core/src/redacao-saida.ts
    - core/src/claim-lint.ts
  testes:
    - core/test/verify.test.ts
    - core/test/verify-arvore.test.ts
    - core/test/verify-sandbox.test.ts
    - core/test/verify-timeout.test.ts
    - core/test/claim-lint.test.ts
    - core/test/verify-compilacao-unica.test.ts
    - core/test/rm081-junit.test.ts
    - core/test/rm081-f3.test.ts
  simbolos:
    - core/src/claims.ts#adicionarClaim
    - core/src/verify.ts#verificar
    - core/src/verify.ts#gravarBaseline
    - core/src/verify.ts#causaDoEncerramento
    - core/src/verify.ts#prazoDoComando
    - core/src/redacao-saida.ts#redigirSaida
    - core/src/claim-lint.ts#analisarComando
    - core/src/verify.ts#identidadeDoProduto
    - core/src/verify.ts#executarComFiltro
  comandos:
    - ork claims add
    - ork claims verificar
    - ork verify
    - ork ci prepare
---

# FEAT-004 — Claims e verify no HEAD real

> **Em uma frase:** Toda afirmação do agente vira claim com comando, e `ork verify` reexecuta os comandos no commit real da worktree; claim sem prova não conta.

- **Estado:** vigente · **Verificado em:** 2026-09-27 · **Versão:** main@949df8e
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-02](MOD-02-verdade-e-entrega.md)
- **Roadmap:** [RM-100](../roadmap/RM-100-fundacao-do-nucleo.md), [RM-037](../roadmap/RM-037-verify-rapido-e-confiavel.md), [RM-081](../roadmap/RM-081-check-por-qualquer-runner.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** registrar claim, anexar comando, reexecutar tudo, gravar baseline antes do GO.
- **Pré-condições e gatilho:** thread com worktree; commit no HEAD.
- **Fluxo principal:**

  1. `ork claims add <thread> <arquivo> --claim "<alegação>" --verificar "<comando>"`.
  2. `ork verify <thread>` roda cada comando no HEAD real, mais o verify do manifesto; em repositório com `CHANGELOG.md`
     e versão publicada por tag `v*`, roda também a regra estrutural do CHANGELOG.
  3. Regressão contra a baseline reprova o gate.
  4. Na correção, comando com JUnit e `filtro` roda primeiro os nomes da última rodada; se
     passarem, a suíte inteira roda antes de o recibo ficar verde.
  5. Sob steal alto, uma reprovação formada somente por casos JUnit marcados em `relogio` fica sem
     veredito e recebe uma segunda rodada isolada pelo mesmo `filtro`; essa rodada nunca a torna verde.

- **Alternativas, erros e recuperação:** comando que estoura o prazo é encerrado com a árvore inteira de processos e sai como `verify.timeout`, sem reprovar a alegação; alegação negativa ("não existe X") também é conferida. Claim nova que use `rg`, chame `ork` diretamente, leia `.orkastery/` ou leve `\x22`/`\x27` literalmente é recusada antes de ser gravada; use `grep`, `node core/dist/index.js`, arquivos versionados e aspas reais do shell.
- **Pós-condições:** evento `verify_run` com o resultado de cada claim e `gate_blocked` quando reprova. Com JUnit declarado, o evento inclui a leitura estruturada e suas contagens por comando ou lane. Passagem filtrada vermelha marca comando e rodada como parciais, com os nomes selecionados. Relógio JUnit protegido inclui `relogioSobSteal` e `retesteDeRelogio`, com nomes, steal e resultado da segunda rodada.
- **Regras de negócio:** BR-004-01: claim pendente, reprovada ou retirada não conta. BR-004-02: o verificador nunca afrouxa asserção para passar. BR-004-03: estouro de prazo não é reprovação; o retry reexecuta. BR-004-04: o comando de verificação nunca herda variável `ORK_HITL_*`. BR-004-05: o comando de claim passa pelo lint; a suíte inteira do npm é recusada no `ci prepare`, e `rg`, `ork` direto, `.orkastery/` e aspas escapadas literalmente são recusados já no `claims add` para claim nova. Claim sem o campo `lint`, anterior à regra, só avisa no bundle. BR-004-06: só conta o comando que rodou (`executado`); com `verify.preparo`, o produto é conferido do preparo ao fim da rodada, e mudança no meio invalida o veredito (`verify.sem-veredito`). BR-004-07: em repositório que tenha `CHANGELOG.md` e ao menos uma tag `v*` alcançável pelo HEAD, linha nova do CHANGELOG não entra em seção com tag `v<versão>` e, em `## Não publicado`, fica sob `### Adicionado`, `### Alterado`, `### Corrigido` ou `### Segurança`; verify, docs no PR e CI compartilham a regra. Sem arquivo ou versão publicada, a regra não entra no verify. BR-004-08: uma passagem parcial verde é intermediária e sempre continua para a suíte inteira; o SHIP recusa recibo parcial. BR-004-09: sem `relogio`, o julgamento permanece igual; com marcação, só o conjunto integralmente marcado sob steal alto fica sem veredito, a segunda rodada isolada é diagnóstica e qualquer falha comum continua regressão.
- **Critérios de aceite e testes:** Dado um comando que passa do teto, quando o verify encerra, então nenhum descendente segue vivo (`core/test/verify-arvore.test.ts`). Dado um comando que estoura o prazo do manifesto, quando o verify roda, então o motivo é `verify.timeout` e o ledger grava causa, prazo e duração (`core/test/verify-timeout.test.ts`). Dado JUnit marcado e steal alto, quando somente os casos marcados caem, então o recibo fica sem veredito e o reteste usa o filtro existente (`core/test/rm081-f2.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** `claims.jsonl` da thread, com o campo `lint` em cada claim nova; baseline em `.orkastery/threads/<id>/`.
- **APIs:** Não aplicável.
- **Eventos:** `verify_run`, `gate_blocked` (motivos `claims.failed`, `verify.regression`, `verify.failed`, `verify.timeout`, `verify.sem-veredito`), `claim_lint` (avisos e recusas do `ci prepare`). Por comando que falha, o evento guarda `causa`, `prazoMs`, `duracaoMs`, `testeQueCaiu` e `trecho` redigido. Quando declarado, `junit` também entra em comando verde e guarda caminho, estado, motivo de descarte ou as contagens e a duração somada; no Agile, cada lane leva sua própria evidência. `parcial` guarda os nomes filtrados quando a suíte inteira não rodou. `relogioSobSteal` guarda os casos marcados e `retesteDeRelogio` registra testes, estado e código da segunda rodada.

## Operação e controle

- **Configuração:** `build`, `test`, `typecheck` e `security_scan` no bloco `verify` aceitam o comando em texto ou `{ comando, junit, filtro, relogio }`, com `junit` relativo à worktree, `filtro` opcional contendo `{testes}` exatamente uma vez e `relogio` com exatamente uma estratégia: `{ nome: [<regex>] }`, `{ marcador: <texto> }` ou `{ tag: <texto> }`. Marcador e tag exigem comando ou lane dedicado à categoria. As lanes em `check.agile.test` aceitam as mesmas formas. `timeout_ms` (default de cada comando, 600 s sem configuração), `timeout_ms_por_comando` e `preparo` continuam independentes. O guia traz [o filtro](../guias/verificacao.md#filtro-do-runner-na-rodada-de-correção) e [um exemplo por runner](../guias/verificacao.md#teste-de-relógio-declarado-no-relatório).
- **Limite conhecido:** numa rede de três VPS, CPU tomada pelo hipervisor pode fazer teste temporal reprovar. O verify mede o steal do `/proc/stat`; a marcação JUnit protege somente casos declarados, e sem `filtro` o recibo explicita que não houve segunda rodada isolada. O CI continua sendo a prova independente ([FEAT-005](FEAT-005-ci-check-independente.md), [contrato](../referencia/contratos/instabilidade-rm037.md)).
- **Rollback:** `ork claims retirar <thread> <claim> --motivo "<motivo>"` (o histórico fica).

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
| 2026-09-27 | estouro de prazo tipado, prazo no manifesto e evidência da falha no ledger | Claude (agente) / Julio, revisão pendente | RM-037 |
| 2026-09-27 | lint do comando de claim: avisa no `claims add`, recusa a suíte inteira no `ci prepare` | Claude (agente) / Julio, revisão pendente | RM-037 |
| 2026-09-27 | compilação única por preparo, identidade do produto e `executado` no contrato | Claude (agente) / Julio, revisão pendente | RM-037 |
| 2026-10-01 | fatia 3 da RM-037: o verify e o commit pelo MCP não travam em lease de thread fechada nem em hard link de objeto do `.git`, e o CI cobra a linha do CHANGELOG e o estado do item depois do merge | Claude (agente) / Julio, revisão pendente | RM-037 |
| 2026-10-03 | fatia 6 da RM-037: steal do `/proc/stat` no `verify_run`, teste com relógio sob steal acima de 40% como `verify.timeout` e o registro `ork.instabilidade/v1` | Claude (agente) / Julio, revisão pendente | RM-037 |
| 2026-10-29 | claims novas executáveis no CI e CHANGELOG validado por seção, tag e grupo nos três verificadores | Codex (agente) / revisão pendente | RM-037, thread `ork-claimsechang` |
| 2026-11-02 | relatório JUnit declarado por comando e lane, com comparação nominal para qualquer runner | Codex (agente) / revisão pendente | RM-081 F1, thread `ork-rm081f1relat` |
| 2026-11-02 | filtro nominal na correção, recibo parcial explícito e suíte inteira obrigatória no SHIP | Codex (agente) / revisão pendente | RM-081 F3, thread `ork-rm081f3rodad` |
| 2026-11-02 | marcação de relógio por nome, marcador ou tag, reteste isolado sob steal e recibo bilíngue | Codex (agente) / revisão pendente | RM-081 F2, thread `ork-rm081f2teste` |
