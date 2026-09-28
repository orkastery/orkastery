---
name: check-quality
description: "Fase CHECK (F4): verificacao contra a baseline, os cinco eixos de review, auditoria de seguranca e de performance, auditoria de delegacao e um veredito unico. Roteia para ork verify e para as quatro skills de reviewer."
bucket: phases
roteia: "ork verify <thread> | ork gate approve <thread> evidencias"
license: MIT
---

# CHECK, verificacao

## O que esta skill e

Um roteador fino da fase CHECK. Ela consolida o que o `ork` mediu e o que os quatro reviewers
acharam, e produz **exatamente um veredito**: PASSOU, PRECISA DE MUDANCA ou BLOQUEADO. Ela nao
corrige o que encontra: correcao e trabalho de GO.

## Como rotear

```bash
ork verify <thread>                  # reexecuta claims e verify contra a baseline
ork phase list <thread>              # o ledger, para a auditoria de delegacao
ork worktree audit <thread>          # a worktree confere no proprio git
ork gate approve <thread> evidencias --por <quem>
```

Quando o veredito e PRECISA DE MUDANCA, o sub-loop GO-FIX / CHECK-REVERIFY do bloco B3 e
quem conduz a volta, e ele nao depende de humano ate o veredito final:

```bash
ork fix open <thread>                # deriva a spec exata de cada correcao do verify real
ork fix list <thread>                # as correcoes da rodada, com o tipo A ou B de cada uma
ork fix reverify <thread>            # veredito POR correcao, mais o verify completo
ork retry plan <thread>              # o que o ork faria pelo ultimo gate reprovado, e por que
```

Duas guardas que o nucleo executa por voce: reexecucao PARCIAL e RECUSADA quando a rodada
tem correcao tipo B, e o limite de escalacao do manifesto (`retry.max_tentativas`) sobe o
veredito para humano em qualquer modo, inclusive `#Auto`.

Os quatro reviewers do catalogo entram aqui: `code-reviewer`, `security-auditor`, `test-engineer`
e `web-performance-auditor`. Cada um roda no seu escopo e devolve achados categorizados.

## O que o CHECK entrega

1. **Comparacao contra a baseline**, separando regressao de divida pre-existente. Sem essa
   separacao, o relatorio culpa a thread pelo que ja estava quebrado.
2. **Os cinco eixos**, cada um com achados ou um "nenhum" explicito: correcao, seguranca,
   performance, manutenibilidade, estilo.
3. **Zero bloqueadores de seguranca**, condicao dura, valida em qualquer modo, inclusive `#Auto`.
4. **Auditoria de delegacao**, cacando subclassificacao e escalacao indevida com peso igual.
5. **Correcoes classificadas com honestidade:** tipo A e uma linha ou equivalente, registrada, com
   as verificacoes afetadas reexecutadas; tipo B devolve a tarefa ao GO, e o CHECK seguinte e uma
   reexecucao completa, nunca parcial.
6. **Um veredito unico**, no diretorio da thread, com todo aviso aceito carregando seu registro.

## O que o nucleo verifica por voce

Os motivos tipados do `ork` fazem o veredito parar de ser conversa: `claims.failed`,
`verify.regression`, `verify.failed`, `policy.violation`, `cost.violation`, `tree.blocked`,
`lease.busy`, `runtime.rate-limited`. Todos reprovam em qualquer modo, porque **o modo afrouxa
a pausa, nunca a verificacao**. Cada um deles tem uma acao de retry deterministica em
`ork retry policy`, e `cost.violation` e o unico que NUNCA recebe retry automatico.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "So um aviso, da para passar" | Aviso passa com registro nominal de quem aceitou e por que. Aviso aceito sem registro e aviso escondido. |
| "A correcao foi pequena, nao precisa rodar tudo de novo" | Correcao tipo B devolveu a tarefa ao GO: o CHECK seguinte e reexecucao completa. Parcial depois de tipo B nao e CHECK. |
| "Esse teste ja falhava, ignora" | Ja falhava e afirmacao verificavel: e a baseline que responde, e a divida entra declarada no relatorio. |
| "O bloqueador de seguranca e teorico" | Zero bloqueadores e condicao dura. Bloqueador rebaixado para aviso porque a entrega estava perto e o defeito de processo que o CHECK existe para expor. |
| "Ja que achei, corrijo aqui mesmo" | CHECK nao corrige. Achado vira tarefa de GO, com commit proprio, ou o revisor passa a revisar a si mesmo. |
| "A thread e `#Auto`, o CHECK pode ser mais leve" | O modo afrouxa a pausa, nunca a verificacao. `#Auto` roda o mesmo CHECK; o que ele dispensa e a espera pelo humano. |

## Bandeiras vermelhas

- Relatorio com dois vereditos, ou com nenhum.
- Eixo de review sem achado e sem "nenhum" escrito.
- Correcao tipo B seguida de reexecucao parcial.
- Aviso aceito sem nome de quem aceitou.
- CHECK rodado sem baseline para comparar.

## Verificacao antes de sair da fase

Suite reexecutada no HEAD real, cinco eixos preenchidos, seguranca com zero bloqueadores,
performance auditada ou dispensada por escrito, delegacao auditada, veredito unico gravado e o gate
de evidencias resolvido pelo caminho que o modo exige. Ver `DoD 6` a `DoD 11`, `REVIEW 6` e `SEC 16`.
