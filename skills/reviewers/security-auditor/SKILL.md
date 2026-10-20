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
   - **real:** correcao tipo B, com a regra, `arquivo:linha`, a saida real, o `SEC n` e o alcance (`reachable` do govulncheck); a volta e da skill `security-remediation`;
   - **falso positivo:** correcao tipo A, `acrescentar <fingerprint> ao .ork-security/dismissals.json, motivo <m>`, mais `ork decisao registrar`;
   - **inconclusivo:** `ork gate request`, e o achado fica aberto ate a resposta.
4. **O auditor nao edita:** nem codigo, nem o `.ork-security/dismissals.json`. Ele devolve o veredito, e quem escreve a correcao e o GO.
5. `existing` e `dismissed` entram no relatorio como divida declarada, nunca como bloqueador novo.

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
- Achado `new` do laco sem veredito, ou ferramenta `failed` contada como limpa.

## Verificacao antes de sair da auditoria

Escopo declarado, arvore e historico varridos, artefatos da thread lidos, cada achado com categoria
e `SEC n`, credencial nenhuma impressa, e zero bloqueadores para o veredito PASSOU. Ver `SEC 15` a
`SEC 17` e `DoD 9`.
