# Testes e verificação

> **Em uma frase:** rode o que o CI roda antes de abrir o PR, e compare com a `main` para saber se uma falha é sua ou já existia.

## O que rodar antes do PR

Da raiz do checkout, com o núcleo compilado:

```bash
npm --prefix core run test:ci
node core/dist/index.js eval
node core/dist/index.js prompt lint
node core/dist/index.js audit lint
```

| Comando | O que confere |
| --- | --- |
| `npm --prefix core run test:ci` | A suíte do núcleo, hermética: sem rede, sem Docker, sem runtime |
| `node core/dist/index.js eval` | Os canários de comportamento e o corpus das skills |
| `node core/dist/index.js prompt lint` | Os modelos de prompt das fases |
| `node core/dist/index.js audit lint` | Os modelos de auditoria |

- São os passos do check `nucleo ork (build, testes, canarios)`, que roda em cada versão do Node da matriz.
- Mexeu em texto? Rode também o que o guia de [documentação](documentacao.md#conferir-antes-do-pr) lista.

## Um teste só, ou uma skill só

```bash
npm --prefix core run build:test
node --test core/dist-test/test/claim-lint.test.js
node core/dist/index.js eval --skill goal-definition
```

- `build:test` compila `core/test/` em `core/dist-test/`. Troque `claim-lint` pelo teste que você mexeu.
- Troque `goal-definition` pelo nome da skill, que é o nome da pasta dela em [skills](../../../skills).

## A suíte inteira

<!-- checagem: citado -->

```bash
npm --prefix core test
```

- Ela inclui integrações que pedem recurso local (Docker, OrkMind, sessão de runtime), listadas em [integracoes-locais.ts](../../../core/src/integracoes-locais.ts).
- O CI não roda essas integrações. Sem as dependências opcionais, cada teste que precisa delas sai como skip com o motivo (`# skip: PostgreSQL ausente ...`), e a suíte passa com 0 falhas. O fim do relatório conta os skips em `ℹ skipped`.
- Tem tudo instalado e quer a prova completa? `ORK_TESTE_EXIGE_AMBIENTE=1 npm --prefix core test` não pula nada: a dependência que faltar reprova. Ver [verificação](../verificacao.md#dependência-opcional-ausente-é-skip-não-falha-rm-037).

## Falha anterior ou regressão

Uma falha só é sua se ela não acontecia antes da sua mudança. Para separar:

1. Rode o mesmo comando na `main` atual, numa pasta à parte. Num fork, o remoto do Orkastery costuma se chamar `upstream`: troque `origin` por ele.

   <!-- checagem: citado -->

   ```bash
   git fetch origin
   git worktree add ../orkastery-main origin/main
   npm --prefix ../orkastery-main/core ci
   npm --prefix ../orkastery-main/core run test:ci
   ```

2. Passa na `main` e falha na sua branch: é regressão, e é sua.
3. Falha nas duas: é dívida anterior. Diga no PR, na seção "Baseline", com a saída das duas.
4. Teste com relógio pode falhar com a máquina ocupada. Rode o arquivo isolado de novo antes de concluir.

Com o `ork`, essa separação é um comando: `ork verify <thread> --baseline` grava o estado antes da mudança, e `ork verify <thread>` compara depois. Ver [contribuir com o ork](com-o-ork.md).

## Próximo passo

[Documentação](documentacao.md), se você mexeu em texto; senão, [lint e estilo](lint-e-estilo.md).

Índice dos guias: [CONTRIBUTING](../../../CONTRIBUTING.md).
