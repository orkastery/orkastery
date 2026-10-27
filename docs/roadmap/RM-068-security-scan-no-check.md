---
id: RM-068
tipo: roadmap
titulo: Security scan no CHECK
categoria: iniciativa
pai: null
features: [FEAT-041]
owner: Paschoal
atualizado_em: 2026-10-27T00:50:00-03:00
estado:
  ciclo: Disponível
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Geral
  habilitacao: Concluída
evidencias:
  codigo:
    commit: 6d9c0f5d
    pr: 186
  deploy:
    release: v0.6.0, @orkastery/cli no npm (ork security-scan e verify.security_scan)
sdlc:
  thread: null
  modo: null
---

# RM-068: Security scan no CHECK

> **Em uma frase:** o `ork verify` roda ferramentas de segurança e qualidade de código no HEAD e na base antes do push, e achado crítico novo dispara a triagem do CHECK e a correção do GO-FIX, no Orkastery e nas apps que o `ork` conduz.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Disponível | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

**Pedido do mantenedor:** testes de segurança e de qualidade de código dentro do CHECK do `ork`, executados por ferramenta e não por leitura do agente, sem depender de workflow próprio no GitHub.

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz projetos com o `ork`, o próprio Orkastery inclusive. Até aqui o CHECK reexecutava `build`, `test` e `typecheck`, mas nada procurava segredo no diff, dependência vulnerável nova ou padrão inseguro: a leitura de segurança dependia do agente.
- **Evidências e fonte:** a varredura do Gitleaks no Orkastery em 15/10/2026 achou ocorrências no histórico e em testes; o `npm audit` e o Trivy acham CVEs de produção que a `main` já carrega. Sem comparar com a base, qualquer scan reprovaria por dívida antiga.
- **Objetivo/OKR:** achado crítico novo da thread nunca chega à `main` sem triagem, e entrega que não pôde ser varrida nunca passa em silêncio.
- **Hipótese:** se o scan for comando do `verify`, comparado com a base por impressão digital, e o laço reaproveitar o CHECK e o GO-FIX que já existem, então o achado novo é triado e corrigido sem etapa nova, porque o `ork` já sabe reprovar, corrigir e reverificar.
- **Métrica principal / linha de base / meta / janela / fonte:** achados `new` no laço que chegam à `main` sem veredito. Linha de base: não medida (nenhuma ferramenta rodava no CHECK). Meta: 0. Fonte: o relatório por SHA e o ledger.
- **Métricas de proteção:** o scan do próprio Orkastery sai 0 contra a base real (todos os achados `existing`); sem `verify.security_scan`, verify, CI, SHIP e skills se comportam como antes; nenhum valor de segredo em relatório, saída ou ledger; `unavailable` e `failed` nunca contam como limpos.

## Escopo e validação

- **Incluído:**
  - **Motor** (`core/src/security-scan/`): catálogo de 13 ferramentas com imagem por digest, detecção de JS/TS, Python e Go, executor Docker, nativo ou indisponível, normalização, comparação por impressão digital e relatório `ork.security-scan/v1` por SHA.
  - **Comando e manifesto:** `ork security-scan`, `verify.security_scan` com prazo próprio, `ork init` que grava a chave, `.ork-security/` para exclusões e dispensas.
  - **Gate do SHIP:** sem Docker nem binário e sem CHECK independente exigido, o `ork ship` para com `human.pending`; `--allow-unscanned "<quem>"` entrega e registra `ship_unscanned_authorized`. `unsupported-ci` e `no-requirements-file` (com outra ferramenta da categoria rodando) são declarados e não param o SHIP nem reprovam com `REQUIRED=1`.
  - **CI:** o `security_scan` entra no bundle com `ORK_SECURITY_SCAN_REQUIRED=1`.
  - **`ork doctor`:** o check "security scan".
  - **Skills:** `security-auditor` e `check-quality` ajustadas, `security-remediation` nova e `go-implementation` apontando para ela.
  - **O próprio Orkastery** declara o scan, com as fixtures vulneráveis excluídas.
- **Fora de escopo:** CodeQL, SBOM e DAST; `workflow` para GitLab CI (sai `unavailable` com `unsupported-ci`, declarado e não contado como não varrido); stacks além das três; a recorrência de achado `warn` entre threads no estágio `maduro`; autorização antecipada do `#Classic` para entrega sem varredura; troca de versão de ferramenta pela config.
- **Entregáveis e critérios de aceite:** cada comportamento com teste hermético (saídas reais gravadas de cada ferramenta e um `docker` falso no `PATH`), um teste de integração com Docker real por stack, o scan do próprio repositório contra a base real e a página [FEAT-041](../produto/FEAT-041-security-scan-no-check.md). O critério do item é a prova ponta a ponta: numa thread `#Classic` real, o verify reprova, o CHECK atesta um segredo real e um falso positivo, o GO-FIX corrige, a dispensa é registrada e o reverify passa.
- **Piloto, medição e critérios de expansão/interrupção:** piloto numa app de teste em JavaScript (abaixo). Expande por stack pelo catálogo; interrompe se algum caminho de falha da ferramenta aprovar o gate ou se um valor de segredo aparecer numa saída.

### Evidências

| Medido | Resultado |
| --- | --- |
| Suíte do núcleo no HEAD da branch, rebaseada sobre a `main` `f5c8db22` | 5286 testes, 5284 passam, 2 pulados, 0 falhas (base `f5c8db22`: 5168 testes, 5166 passam, 2 pulados, 0 falhas) |
| Scan do Orkastery no HEAD da branch contra a base real (`f5c8db22`, com e sem `REQUIRED=1`) | saída 0; 0 no laço; 472 novos, todos `quality` do ESLint (fora do laço), e 22484 `existing`; as 9 ferramentas `ran`, Semgrep com `partial-parsing: 1`; 499 s com o cache da base frio e 200 s com ele quente |
| Integração com Docker real, 3 stacks | 4 de 4 (277 s antes do rebase, 486 s depois dele, com as imagens já baixadas); as 9 ferramentas rodam em cada stack |
| Ponta a ponta, thread `#Classic` real | 2 rodadas do laço; segredo real e falso positivo atestados; dispensa registrada; reverify passa |
| Sem Docker | 9 ferramentas `unavailable`, saída 0 (1 com `REQUIRED=1`); `ork ship` para com `human.pending`; com `--allow-unscanned`, entrega e registra |

### Mudanças de comportamento que o mantenedor precisa saber

- **Só vale com `verify.security_scan` declarado.** Sem a chave, nada muda. O `ork init` de projeto novo grava a chave quando detecta uma stack.
- **Nomes novos em inglês** (comando, chave, pasta, campos, estados, flags e skill), apesar de o guia de estilo pedir nomes em português: decisão do mantenedor do projeto, declarada na descrição do PR. O texto de mensagens e docs segue o pt-BR, pelo catálogo de locale.
- **Gate do SHIP novo:** projeto com o scan declarado e sem `ci.required_for_ship` pode parar em `human.pending` onde antes entregava.
- **O CI do Orkastery passa a rodar o scan** no `ork-verify`, com Docker no runner, e soma uma varredura do HEAD e da base, que no Classic Check ocupa um quarto da parede da rodada ([RM-072](RM-072-check-cinco-vezes-mais-rapido.md), medição do GO), mais o pull frio das imagens no runner.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** pedido do mantenedor em 16/10/2026; sem pontuação RICE, decisão direta.
- **Horizonte / alvo / previsão / confiança / marcos:** motor e catálogo, comando e relatório, gate do SHIP e doctor, skills do laço, o Orkastery contra si mesmo, integração com Docker real e prova ponta a ponta. Todos mesclados na `main` por um PR só (#186).
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-012 (CI como CHECK independente), RM-061 (texto nas duas línguas). Nenhum bloqueio.
- **Premissas / riscos / mitigação:**
  - Risco: o scan ficar lento no runner. Mitigação: cache da base por SHA e digest, prazo próprio por comando, medido de 162 a 270 s.
  - Risco: o scan parecer limpo sem ter varrido. Mitigação: `unavailable` e `failed` nunca contam como limpos; no CI, `REQUIRED=1`; no SHIP, `human.pending`.
  - Risco: valor de segredo vazar. Mitigação: só o hash entra na impressão digital; testes procuram o valor em toda saída.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  - O scan é comando do `verify`, a triagem é o CHECK, a correção é o GO-FIX, sem motivo tipado novo (decisão do mantenedor, 16 a 19/10/2026).
  - Relatório por SHA em `.orkastery/security-scan/<sha>/`, e não por thread: o verify não passa a thread ao comando.
  - Só `--allow-unscanned`, sem autorização antecipada no `#Classic`, na primeira versão.
  - Sem recorrência de `warn` no `maduro`: ligar o scan ao board de auditoria é uma entrega própria.
  - Semgrep roda na worktree da base, e não com `--baseline-commit`, porque o baseline nativo pede `git reset --hard` e a montagem é só leitura.

## Estado com evidências

O código está na `main` desde o PR #186 (merge `6d9c0f5d`, cabeça da branch `34f019b1`) e em produção na versão 0.6.0 (tag `v0.6.0` e `@orkastery/cli` 0.6.0 no npm, publicado em 27/10/2026). A suíte, o scan do próprio repositório, a integração com Docker real e a prova ponta a ponta estão resumidos em [Evidências](#evidências).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Disponível | — | 2026-10-27 | Paschoal |
| Documentação | Em revisão | — | 2026-10-27 | Paschoal |
| Código | Mesclado | commit `6d9c0f5d` · PR #186 | 2026-10-27 | Paschoal |
| Testes | Aprovados | — | 2026-10-27 | Paschoal |
| Deploy | Produção | release: v0.6.0, @orkastery/cli no npm (ork security-scan e verify.security_scan) | 2026-10-27 | Paschoal |
| Exposição | Geral | — | 2026-10-27 | Paschoal |
| Habilitação | Concluída | — | 2026-10-27 | Paschoal |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: Paschoal; A: Julio; C: nenhum; I: nenhum.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** agente de código na implementação, nas provas e nas revisões, com Paschoal no comando; revisor humano: Julio, no PR.
- **Próxima ação, responsável e prazo:** nenhuma de publicação: o scan saiu na versão 0.6.0. Responsável: Paschoal. Sem data definida.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-20 | Item criado com o scan implementado na branch | Pedido do mantenedor; suíte, integração real e prova ponta a ponta em [Evidências](#evidências) | Paschoal |
| 2026-10-20 | Mesclado na main pelo PR #186 | Merge `6d9c0f5d` (cabeça da branch `34f019b1`); sem release no npm: a publicação espera a aceitação dos pilotos do #Noctum | Paschoal |
| 2026-10-27 | Em produção na 0.6.0: ciclo Disponível, exposição Geral (o scan roda em todo projeto com `verify.security_scan`) e habilitação Concluída (o guia de verificação e a referência do CLI saíram com a versão) | Tag `v0.6.0`, com o merge `6d9c0f5d` (PR #186) na tag; seção 0.6.0 do CHANGELOG, de 26/10/2026 | thread `ork-docsda060emp` (#Fast), pelo pedido do dono |
