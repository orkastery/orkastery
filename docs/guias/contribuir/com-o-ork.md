# Contribuir com o próprio ork

> **Em uma frase:** recomendado e opcional: abra uma thread, registre claims com o comando que prova cada uma, e leve o verify e o bundle do CI no PR.

- Sem o `ork`, siga o guia de [pull request](pull-request.md): o PR é aceito do mesmo jeito.
- Com ele, a prova chega no formato que o mantenedor reexecuta, e a baseline separa o que já falhava do que é seu.

## A promessa em segundos

```bash
node core/dist/index.js demo
```

## O caminho

Os comandos abaixo gravam estado em `.orkastery/`, que o `.gitignore` deixa fora do repositório. Troque `<thread>` pelo id que o `thread new` imprime.

<!-- checagem: citado -->

```bash
ork thread new "<o que muda>" --modo classic
ork verify <thread> --baseline
ork claims add <thread> <arquivo> --claim "<o que você afirma>" --verificar "<comando que prova>"
ork verify <thread>
ork ci prepare <thread>
```

1. `thread new` abre a thread. Em `--modo classic`, você aprova objetivo, plano e evidências.
2. `verify --baseline`, antes de mexer, grava o que já passava e o que já falhava. Ele roda a verificação do manifesto, com a suíte inteira, e leva o tempo dela.
3. `claims add` registra cada afirmação com o comando que a julga. Prefira `node --test` no arquivo, ou a suíte hermética `npm --prefix core run test:ci`; `npm --prefix core test` é recusado no bundle, porque pede recurso local.
4. `verify` reexecuta as claims no commit real e compara com a baseline.
5. `ci prepare` grava `.ork-ci/<thread>.json`, só desta thread. Faça dele o último commit do PR: o check `ork-verify` acha o arquivo pelo nome da branch e reexecuta as suas claims no runner do GitHub.

A [verificação](../verificacao.md) explica claim, baseline e o lint do comando em detalhe.

## No PR

- Na seção "A prova", a saída de `ork verify <thread>`.
- No último commit, o `.ork-ci/<thread>.json`.
- Claim que afirma ausência com `git grep` no repositório inteiro exclui `':(exclude).ork-ci/'`: os bundles das threads já entregues ficam versionados e citam os comandos delas.
- Nada de `.orkastery/` no commit.

## O que o mantenedor faz

A entrega de toda contribuição passa pelo ciclo do próprio `ork`, a partir da branch do PR:

<!-- checagem: citado -->

```bash
ork thread new "aplicar o PR <numero>" --ciclo merge-branch --branch <branch-do-pr> --modo classic
```

- GOAL, PLAN, GO, CHECK, SHIP e MASTER rodam sobre a sua branch; pode levar mais tempo que um merge comum.
- O merge sai com o CI verde no commit exato, com o assunto `ship(<thread>): ...`, e a entrega é registrada:

<!-- checagem: citado -->

```bash
ork ship registrar-pr <thread>
ork master <thread> --aceitar-omissao
```

## Próximo passo

Volte ao [índice](../../../CONTRIBUTING.md).
