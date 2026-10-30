---
name: check-quality
description: "Fase CHECK (F4): verificacao contra a baseline, os cinco eixos de review, auditoria de seguranca e de performance, auditoria de delegacao e um veredito unico. Roteia para ork verify e para as quatro skills de reviewer."
bucket: phases
roteia: "ork verify <thread> | ork gate request <thread>"
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
ork gate request <thread>            # o pedido da pausa; o humano responde pelo canal autenticado
```

- Esperas: nunca dispare verify, build ou suite com `&` dentro do comando, porque o processo se perde e a sessao espera um aviso que nunca vem; prefira `ork_verify` assíncrono e consulte `ork_verify_status` a cada 30–60 s; sem essa ferramenta, rode o `ork verify` em primeiro plano, com `timeout` (ele espera a vez na fila de recursos pesados), ou use a execucao em segundo plano do host, que avisa quando termina; nunca espere com `pgrep -f` cujo padrao aparece no proprio comando, porque o laco acha a si mesmo e nao termina: espere pelo arquivo de saida com prazo, ou pelo PID guardado.

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

## Com `verify.security_scan` declarado

Sem `verify.security_scan`, nada desta secao vale e o CHECK e o de sempre. Com a chave, o `ork verify` roda `ork security-scan` e o veredito consolida o scan:

1. Leia `report.md` e `report.json` em `.orkastery/security-scan/<sha>/`, na arvore principal; o SHA e o do HEAD verificado.
2. Zero bloqueadores de seguranca passa a ser: nenhum achado `new` do laco sem veredito resolvido do `security-auditor` (real corrigido, falso positivo dispensado com decisao registrada, ou inconclusivo com o `ork gate request` respondido).
3. Achado `new` com `loop: false` (`warn` no relatorio, como qualidade, licenca ou severidade abaixo do corte) vai ao eixo certo como aviso registrado, com o nome de quem aceitou, nunca como bloqueador escondido.
4. Ferramenta `unavailable` ou `failed` e declarada no veredito e nunca conta como limpa; com `ORK_SECURITY_SCAN_REQUIRED=1` ela faz o scan sair 1.
5. Correcao vinda do scan volta pelo GO-FIX, com a skill `security-remediation`; a prova e o `ork fix reverify`, que reexecuta o verify e o scan.
6. O veredito por achado chega ao GO-FIX pela claim do CHECK (`--fase CHECK`), uma por achado real ou falso positivo, como a skill `security-auditor` diz. O `ork fix open <thread>` reexecuta o verify e abre uma correcao por claim reprovada, tipo B para o real (`claims.failed`) e tipo A para o falso positivo (`claims.unverifiable`), ao lado da correcao tipo B do comando `security_scan`; o `ork fix list <thread>` as mostra ao GO-FIX com o texto do veredito.
7. Inconclusivo nao abre o pedido de dentro da sessao do CHECK: o `ork gate request` recusa enquanto o observador nao grava a conclusao da fase (`a conclusao da fase precisa estar registrada antes da pausa`), e `--motivo` so aceita escalacao tipada ja registrada no ledger (`escalacao tipada nao comprovada`). A pergunta curta vai ao parecer, a sessao termina, e quem conduz roda `ork gate request <thread> --formato telegram`, que abre a pausa do fim do bloco que termina no CHECK, com o parecer nas evidencias. Entre os modos vivos, so o #Classic tem essa pausa (bloco GO-CHECK); #Look e #Ork tambem pausavam no CHECK, mas estao aposentados (I-43) e o pedido recusa para eles. O pedido leva a pergunta generica do gate (`Qual e o veredito sobre evidencias...?`): quem conduz aponta ao dono a pergunta do parecer, com o id do achado. A resposta do dono vira claim do CHECK como a skill `security-auditor` diz, antes do `ork fix open`. Em modo sem essa pausa (#Maestro, #Auto), o pedido recusa (`modo nao preve pausa humana nesta fase`): o veredito e BLOQUEADO, com a pergunta escrita, e nada segue ate o dono responder.

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
- Achado `new` do laco sem veredito dado como zero bloqueadores.
- Inconclusivo de achado `new` do scan levado por `ork gate request` de dentro da sessao do CHECK, ou com `--motivo` de texto livre.

## Verificacao antes de sair da fase

Suite reexecutada no HEAD real, cinco eixos preenchidos, seguranca com zero bloqueadores,
performance auditada ou dispensada por escrito, delegacao auditada, veredito unico gravado e o gate
de evidencias resolvido pelo caminho que o modo exige. Ver `DoD 6` a `DoD 11`, `REVIEW 6` e `SEC 16`.
