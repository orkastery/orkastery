---
id: FEAT-041
tipo: feature
titulo: Security scan no CHECK
estado: vigente
pai: MOD-02
roadmap: [RM-068]
owner: Paschoal
aprovador: Julio
verificado_em: 2026-10-27T00:50:00-03:00
versao: main@6d9c0f5d
fontes:
  codigo:
    - core/src/security-scan/cli.ts
    - core/src/security-scan/run.ts
    - core/src/security-scan/executor.ts
    - core/src/security-scan/compare.ts
    - core/src/security-scan/detect.ts
    - core/src/security-scan/report.ts
    - core/src/security-scan/config.ts
    - core/src/security-scan/guard.ts
    - core/src/security-scan/tools.ts
    - core/src/security-scan/types.ts
    - core/assets/security-scan/tools.json
    - core/src/ship.ts
    - core/src/ci.ts
    - core/src/doctor.ts
    - core/src/init.ts
    - skills/phases/security-remediation/SKILL.md
    - skills/reviewers/security-auditor/SKILL.md
    - .ork-security/config.json
  testes:
    - core/test/security-scan-run.test.ts
    - core/test/security-scan-normalize.test.ts
    - core/test/security-scan-compare.test.ts
    - core/test/security-scan-detect.test.ts
    - core/test/security-scan-report.test.ts
    - core/test/security-scan-tools.test.ts
    - core/test/security-scan-manifest.test.ts
    - core/test/security-scan-ci.test.ts
    - core/test/security-scan-ship.test.ts
    - core/test/security-scan-doctor.test.ts
    - core/test/security-scan-integracao.test.ts
  docs:
    - docs/guias/verificacao.md
    - docs/referencia/cli.md
  simbolos:
    - core/src/security-scan/run.ts#runScan
    - core/src/security-scan/compare.ts#classify
    - core/src/security-scan/executor.ts#chooseExecutor
    - core/src/security-scan/report.ts#exitCodeOf
    - core/src/security-scan/detect.ts#detectStacks
    - core/src/ship.ts#unscannedCategories
    - core/src/doctor.ts#checarSecurityScan
  contratos:
    - ork.security-scan/v1
  comandos:
    - ork security-scan
    - ork verify
    - ork ship
    - ork doctor
    - ork ci prepare
---

# FEAT-041: Security scan no CHECK

> **Em uma frase:** o `ork verify` roda ferramentas de segurança e qualidade de código no HEAD e na base antes do push para a `main`, e achado crítico novo dispara a triagem do CHECK e a correção do GO-FIX, em qualquer projeto conduzido pelo `ork`.

- **Estado:** vigente · **Verificado em:** 2026-10-27 · **Versão:** main@6d9c0f5d (PR #186), publicada na 0.6.0
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-02](MOD-02-verdade-e-entrega.md)
- **Roadmap:** [RM-068](../roadmap/RM-068-security-scan-no-check.md)
- **Dono da página / aprovador:** Paschoal / Julio

## Comportamento

- **Casos de uso e operações:**
  - UC-040-01, varrer o HEAD contra a base e gravar o relatório: `ork security-scan [--base <ref>] [--json]`.
  - UC-040-02, reprovar o verify por segredo ou vulnerabilidade `high`/`critical` nova: `verify.security_scan` no manifesto.
  - UC-040-03, triar cada achado novo no CHECK e corrigir no GO-FIX: skills `security-auditor` e `security-remediation`.
  - UC-040-04, dispensar um falso positivo com decisão registrada: `.ork-security/dismissals.json`.
  - UC-040-05, parar o SHIP sem varredura possível e entregar só com autorização: `ork ship --allow-unscanned "<quem>"`.
  - UC-040-06, rodar o scan no CHECK independente do CI, com a ferramenta ausente reprovando: `ork ci prepare`.
- **Pré-condições e gatilho:**
  - `verify.security_scan` declarado no manifesto (o `ork init` grava quando detecta JS/TS, Python ou Go). Sem a chave, nada muda.
  - Docker (CLI e daemon) ou, para cada ferramenta, o binário nativo na versão aceita pelo catálogo.
  - Um repositório git com a base resolvível (merge-base com a branch base do manifesto, ou `--base`).
- **Fluxo principal:**

  1. O motor detecta as stacks na árvore do HEAD (raiz e primeiro nível de pastas, o que cobre `core/package.json`).
  2. Para cada ferramenta do catálogo aplicável, escolhe o executor: imagem Docker por digest, depois binário nativo, depois `unavailable` com o motivo.
  3. Roda no HEAD e na base, cada um numa worktree destacada do commit; o resultado da base fica em cache por SHA, ferramenta e digest.
  4. Normaliza cada saída em achados com severidade comum e impressão digital sem o número da linha; compara com a base e com as dispensas.
  5. Grava `report.json` e `report.md` em `.orkastery/security-scan/<sha>/` da árvore principal, imprime o resumo e sai 1 se houver achado novo no laço.
  6. No `ork verify`, o 1 reprova como qualquer comando. O CHECK lê o relatório, dá um veredito por achado (real, falso positivo ou inconclusivo), e o `ork fix open` abre a correção; o `ork fix reverify` roda o scan de novo.

- **Alternativas, erros e recuperação:**
  - Base não resolvida (clone raso sem histórico): todas as ferramentas `failed` com `base-unresolved`; nunca limpo.
  - Gitleaks que lê 0 commits com a faixa `base..HEAD` com conteúdo de patch: `failed` com `zero-commits-scanned` (faixa só de merges, commits vazios ou renomeações não tem o que ler e passa).
  - Saída da ferramenta ausente ou fora do formato: `failed`. O Semgrep com erro não fatal (`Timeout`, `PartialParsing`) fica `ran` com motivo `partial-*`.
  - Ferramenta que passa do prazo: `failed` com `timeout`; `ORK_SECURITY_SCAN_DEADLINE_MS` limita a rodada inteira e um vigia desfaz as worktrees e os contêineres se o processo morrer. O `ork verify` e o `ork ci run` exportam a variável com o prazo do `security_scan` menos `min(300 s, prazo/4)`, e a claim cujo comando é o do scan roda com esse prazo.
  - Nada a varrer: `unsupported-ci` (GitLab CI sem analisador) e `no-requirements-file` (com outra ferramenta da categoria rodando) ficam declarados como `unavailable`, sem contar como categoria não varrida.
  - Sem Docker nem binário: `unavailable`, saída 0, e o gate do SHIP decide (abaixo).
  - Dispensa sem `reason` ou `decisionRef`, ou config inválida: saída 1, com a entrada nomeada e nada varrido.
  - Laço esgotado em `retry.max_tentativas` ou veredito inconclusivo: sobe ao humano, como qualquer correção.
- **Pós-condições:** o relatório por SHA em `.orkastery/security-scan/<sha>/`; `ship_unscanned_authorized` no ledger quando a entrega segue sem varredura, com quem, o SHA e as categorias. Nada é escrito fora do checkout, exceto o cache da base em `$XDG_CACHE_HOME/orkastery/security-scan/`.
- **Regras de negócio:**
  - BR-040-01: `secret` entra no laço sempre que `new`; `dependency`, `sast`, `iac` e `workflow` só com `high` ou `critical`; `quality` e `license` nunca.
  - BR-040-02: `unavailable` e `failed` nunca contam como limpo; com `ORK_SECURITY_SCAN_REQUIRED=1`, em categoria do laço, a saída é 1. Exceção: `unsupported-ci`, e `no-requirements-file` quando outra ferramenta da mesma categoria rodou, são declarados e não contam, aqui nem no SHIP.
  - BR-040-03: o valor de um segredo nunca vai ao relatório, ao stdout nem ao ledger; só o hash entra na impressão digital.
  - BR-040-04: com `verify.security_scan` e sem `ci.required_for_ship`, categoria do laço sem varredura no SHA da candidata (ferramenta `unavailable` ou `failed`, salvo a exceção de BR-040-02, ou nenhum relatório) para o `ork ship` com `human.pending` antes de qualquer push. O `--dry-run` não grava a autorização.
  - BR-040-05: caminho excluído em `config.json` não gera achado e é listado no relatório.
  - BR-040-06: o relatório vale pelo SHA; mudança não commitada não é varrida.
- **Critérios de aceite e testes:**
  - Dado um segredo novo na thread, quando o scan roda, então sai 1 e o valor do segredo não aparece em `report.json`, `report.md` nem no stdout (`core/test/security-scan-report.test.ts`, `core/test/security-scan-run.test.ts`).
  - Dado código deslocado de linha entre base e HEAD, quando o scan compara, então o achado segue `existing` (`core/test/security-scan-compare.test.ts`).
  - Dado `docker` ausente do `PATH` e nenhum binário, quando o scan roda, então toda ferramenta sai `unavailable` com saída 0, e com `ORK_SECURITY_SCAN_REQUIRED=1` sai 1 (`core/test/security-scan-run.test.ts`).
  - Dado categoria do laço sem varredura no SHA, quando o `ork ship` roda sem `--allow-unscanned`, então para com `human.pending` e nada é empurrado; com a flag, entrega e grava o evento; com `--dry-run`, não grava (`core/test/security-scan-ship.test.ts`).
  - Dado `security_scan` com prazo próprio, quando o verify, uma claim do scan ou o `ork ci run` o rodam, então o comando recebe `ORK_SECURITY_SCAN_DEADLINE_MS` igual ao prazo menos a margem (`core/test/security-scan-deadline.test.ts`).
  - Dado o bundle do CI, quando o `ork ci prepare` o monta, então o `security_scan` leva `ORK_SECURITY_SCAN_REQUIRED=1` (`core/test/security-scan-ci.test.ts`).
  - Dado Docker real, quando o scan roda numa fixture de cada stack, então todas as ferramentas rodam e os achados novos do laço aparecem (`core/test/security-scan-integracao.test.ts`, só na estação).
- **Interface e acessibilidade:** não aplicável: comando de terminal e relatório em Markdown e JSON.

## Dados e contratos

- **Entidades e campos:** `ork.security-scan/v1`: `base`, `head`, `generatedAt`, `stacks[]`, `tools[]` (`name`, `category`, `version`, `executor`, `state`, `reason`, `counts` por status e severidade), `excluded[]` e `findings[]` (`tool`, `rule`, `category`, `severity`, `stack`, `file`, `line`, `message`, `fingerprint`, `status`, `loop`).
- **APIs e endpoints:** não aplicável. Código de saída: 0, 1 (achado novo no laço, config ou dispensa inválida, ou `REQUIRED=1` sem cobertura) e 2 (opção desconhecida).
- **Eventos e jobs:** evento de ledger `ship_unscanned_authorized`. Nenhum job novo; no CI, o `ork-verify` roda o scan do bundle.

## Operação e controle

- **Configuração e ambientes:** `verify.security_scan` e `verify.timeout_ms_por_comando.security_scan` no manifesto; `.ork-security/config.json` (`exclude`, `tools`, `stacks`) e `.ork-security/dismissals.json`; variáveis `ORK_SECURITY_SCAN_REQUIRED` e `ORK_SECURITY_SCAN_DEADLINE_MS`. Sem segredo em nenhuma delas.
- **Observabilidade:** o `report.md` mostra ferramenta, executor, estado e motivo; o `ork doctor` ganha o check "security scan" (`ok` com Docker ou com todos os binários do laço, `warn` nunca `fail` quando alguma ferramenta ficaria `unavailable`).
- **Acesso, privacidade e conformidade:** repositório montado só para leitura, usuário não root, rede só nas ferramentas que a pedem; Semgrep com métricas desligadas e sem `--config auto`; imagens por digest. As imagens e o conjunto de regras do Semgrep têm termos de uso próprios, dos fornecedores.
- **Dependências e rollback:** nenhuma dependência nova no pacote; as ferramentas são executáveis externos. Para desligar, retire `verify.security_scan` do manifesto: o comportamento volta ao anterior.
- **Código, PR, testes e release:** PR #186 (merge `6d9c0f5d`, cabeça da branch `34f019b1`), na `main`; a suíte inteira e o scan do próprio repositório estão na descrição do PR. Release: versão 0.6.0 (tag `v0.6.0`, `@orkastery/cli` 0.6.0 no npm, publicado em 27/10/2026).

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-10-20 | Página criada com o scan implementado na branch | Paschoal (com agente) / Julio, revisão pendente | branch `forja/security-scan` |
| 2026-10-20 | Mesclado na main pelo PR #186, ainda sem release no npm | Paschoal (com agente), mesclado pelo autor | merge `6d9c0f5d` |
| 2026-10-27 | vigente: publicada na 0.6.0 | Claude (agente, thread `ork-docsda060emp`) / Julio, revisão pendente | merge `6d9c0f5d` na tag `v0.6.0` |
