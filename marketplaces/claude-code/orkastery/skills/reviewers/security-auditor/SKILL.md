---
name: security-auditor
description: "Auditor de seguranca do CHECK: percorre security-checklist.md sobre o diff, o historico da branch e os artefatos da thread, com a condicao dura de zero bloqueadores. Nunca imprime o segredo que encontra."
bucket: reviewers
roteia: "ork verify <thread> | references/security-checklist.md"
license: MIT
---

# Security Auditor

## O que esta skill e

Um roteador fino que aplica [security-checklist.md](../../../references/security-checklist.md) ao
escopo da thread. A condicao de passagem e dura: **zero bloqueadores de seguranca, em qualquer modo
de conducao, inclusive `#Auto`.**

## Como rotear

```bash
git diff <base>...HEAD               # a arvore de trabalho
git log -p <base>..HEAD              # o historico atras da branch
ork phase list <thread>              # policies e gates ja registrados
ork doctor                           # provider e ambiente da maquina
```

## Escopo e conduta

1. **O escopo e declarado antes dos achados:** quais diretorios, qual intervalo de historico,
   quais artefatos. Auditoria sem escopo declarado nao vale como evidencia.
2. **Fixture de teste e config de exemplo estao no escopo.** Credencial em teste e credencial
   vazada, com a agravante de ninguem olhar para la; `SEC 1` inclui `.env`, fixtures e exemplos.
3. **O historico entra no escopo.** Segredo commitado e depois apagado continua vazado; a auditoria
   le o intervalo, nao so a arvore.
4. **Relatorio nao imprime credencial.** O achado nomeia o padrao, o arquivo e a linha, em forma
   redigida. **Relatorio de vazamento que imprime o segredo e um segundo vazamento.**
5. **Ausencia e afirmada como resultado**, com o que foi olhado: "nada encontrado" sem escopo e
   diferente de "auditado e limpo", e a diferenca fica escrita.

## Com `verify.security_scan` declarado

Sem `verify.security_scan`, esta skill faz o que sempre fez: a checklist inteira por leitura, e a passagem manual continua valendo. Com a chave declarada, o relatorio do scan (`.orkastery/security-scan/<sha>/report.json`, na arvore principal) e a evidencia de `SEC 1`, `SEC 2` e `SEC 10`, e a triagem abaixo vale.

1. **Declare o escopo do scan:** `base`, `head`, as stacks e cada ferramenta com o estado (`ran`, `failed` ou `unavailable`) e o `reason`.
2. **Ferramenta `unavailable` ou `failed` nunca conta como limpa.** Declare-a assim; os itens `SEC` dela voltam para a leitura manual, marcada como tal. A passagem manual so vale com o scan `unavailable` declarado.
3. **Triagem: um veredito por achado `new` do laco** (`loop`), nenhum sem veredito:
   - **real:** correcao tipo B, com a regra, `arquivo:linha`, a saida real **redigida (nunca o valor do segredo; so regra, `arquivo:linha` e `fingerprint`)**, o `SEC n` e o alcance (`reachable` do govulncheck); a volta e da skill `security-remediation`;
   - **falso positivo:** correcao tipo A, `acrescentar <fingerprint> ao .ork-security/dismissals.json, motivo <m>`, mais `ork decisao registrar`;
   - **inconclusivo:** sem correcao; a pergunta curta vai ao parecer, o veredito nao e PASSOU e o achado fica aberto ate a resposta do dono pelo `ork gate request` (o caminho esta na skill `check-quality`).
4. **O veredito chega ao GO-FIX como claim do CHECK, uma por achado.** O `ork fix open` deriva a spec do GO-FIX so do `ork verify`, e o verify reexecuta as claims: cada claim reprovada vira uma correcao com o texto dela.
   - real: `ork claims add <thread> <arquivo> --fase CHECK --claim "<veredito>" --verificar "<comando de verify.security_scan>"`; o comando reprova no HEAD e a correcao nasce tipo B (`claims.failed`). A claim reprova e passa com o scan inteiro, nao com este achado (o `fingerprint` fica no texto), custa uma varredura do HEAD a mais por claim em cada verify e vai ao bundle `.ork-ci` com as outras claims;
   - falso positivo: `ork claims add <thread> .ork-security/dismissals.json --fase CHECK --claim "<veredito>"`, sem `--verificar`; a claim sem comando nasce tipo A (`claims.unverifiable`). Alegacao que o nucleo le como negativa reprova sem comando e vira tipo B sem aviso: `ehAlegacaoNegativa` em `core/src/claims.ts` procura, sem acento e ate dentro de palavras, `nenhum`, `nenhuma`, `nunca`, `sempre`, `zero`, `todos`, `todas`, `nao ha`, `nao existe`, `nao resta`, `sem nenhum`, `100%`, `totalmente`, `completamente` (`metodos` contem `todos`). Confira a saida do `ork claims add`: o falso positivo so vale com a linha `negativa` em `nao` e a linha `estado` em `nao-verificavel`; fora disso, `ork claims retirar <thread> <claim> --motivo "<motivo>"` e registre de novo com texto neutro;
   - o `<veredito>` leva o id do achado, a ferramenta, a regra, `arquivo:linha`, o `fingerprint`, o tipo e a correcao, e no falso positivo o motivo e o `eventId` do `ork decisao registrar`;
   - a resposta do dono a um inconclusivo vira claim do mesmo jeito, registrada por quem conduz ou por um CHECK novo, antes do `ork fix open`.
5. **O auditor nao edita:** nem codigo, nem o `.ork-security/dismissals.json`. Ele devolve o veredito, e quem escreve a correcao e o GO.
6. **Material de segredo nunca vai a saida da sessao.** Com achado `new` do Gitleaks, a linha do achado e o conteudo do commit que a trouxe nao vao a saida por ferramenta nenhuma: Read, `sed`, `head`, `grep -n`, editor, `git log -p`, `git show`, `cat`, diff. A saida vai a transcricao e ao provider, e e um segundo vazamento. O que vale e a `rule`, o `arquivo:linha` e o `fingerprint` do relatorio. O contexto se le sem a linha do achado (`awk -v n=<linha> 'NR>=n-5 && NR<=n+5 && NR!=n' <arquivo>`), e comparar o valor com outro se faz por hash (`sha256sum`), sem imprimir nenhum dos dois.
7. `existing` e `dismissed` entram no relatorio como divida declarada, nunca como bloqueador novo.

## O que o nucleo verifica por voce

A policy `segredo_em_prompt` roda no gate `phase.dispatch` **antes de o prompt ser gravado em
disco**: prompt reprovado nao chega a existir como arquivo. A policy `provider` bloqueia despacho
por provider pago sob `subscription-only`, e a `push_direto_na_base` bloqueia entrega sem branch de
thread. As tres reprovam em qualquer modo.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "A chave esta so no fixture de teste" | Fixture esta no escopo de `SEC 1`. Credencial em teste e credencial vazada, com a agravante de ninguem olhar para la. |
| "Apaguei o commit que tinha o token" | Apagar da arvore nao apaga do historico. Bloqueador ate a credencial ser rotacionada e a rotacao verificada, nao prometida. |
| "Colo o trecho no relatorio para o time ver" | Relatorio de vazamento que imprime o segredo e um segundo vazamento. Nomeie o padrao e a linha, redigido. |
| "Esse bloqueador e teorico, ninguem exploraria" | Zero bloqueadores e condicao dura, nao negociavel por probabilidade estimada no olho. |
| "A thread e `#Auto`, a auditoria pode ser mais leve" | O modo afrouxa a pausa, nunca a verificacao. A lista e a mesma; o que muda e quem espera pelo veredito. |
| "Ja que achei, corrijo aqui mesmo" | O auditor nao edita. Auditor que corrige passa a auditar o proprio trabalho; o veredito vai ao GO e a correcao volta pelo CHECK. |

## Bandeiras vermelhas

- Relatorio de seguranca sem escopo e sem intervalo de historico.
- Segredo real colado dentro do relatorio ou do ledger.
- Achado sem o `SEC n` que ele viola.
- "Nada encontrado" sem dizer o que foi olhado.
- Dependencia nova sem justificativa no PLAN.
- Valor de segredo do Gitleaks colado na correcao, no veredito ou no ledger.
- Achado `new` do laco sem veredito, ou ferramenta `failed` contada como limpa.
- Linha ou commit de achado `new` do Gitleaks na saida da sessao, por qualquer ferramenta (Read, `sed`, `grep -n`, `git log -p`, `git show`, `cat`, diff).
- Veredito de achado `new` do scan so no parecer, sem a claim do CHECK que o leva ao `ork fix open`.

## Verificacao antes de sair da auditoria

Escopo declarado, arvore e historico varridos, artefatos da thread lidos, cada achado com categoria
e `SEC n`, credencial nenhuma impressa, e zero bloqueadores para o veredito PASSOU. Ver `SEC 15` a
`SEC 17` e `DoD 9`.
