<!--
Seção em branco faz o PR voltar. O guia de PR:
https://github.com/orkastery/orkastery/blob/main/docs/guias/contribuir/pull-request.md
-->

## O problema

<!-- O que estava errado, com o comando ou o passo que reproduz. -->

## A mudança

<!-- O que você fez, e o que você deliberadamente NÃO fez. -->

## A prova

<!--
Cole a SAÍDA REAL, não a descrição dela. Nada entra sem evidência executável.

Os comandos, da raiz do checkout (o guia de testes explica cada um):
  `npm --prefix core run test:ci`
  `node core/dist/index.js eval`
  `node core/dist/index.js prompt lint`
  `node core/dist/index.js audit lint`
https://github.com/orkastery/orkastery/blob/main/docs/guias/contribuir/testes-e-verificacao.md

Mexeu em texto? Também:
  `core/node_modules/.bin/markdownlint-cli2`
  `node core/dist/index.js docs verificar`
  `node core/scripts/checar-links.cjs`
https://github.com/orkastery/orkastery/blob/main/docs/guias/contribuir/documentacao.md

Usou o ork? Cole a saída de `ork verify <thread>` e deixe o `.ork-ci/bundle.json` no último commit.
-->

```text
```

## Baseline

<!--
Algum comando já falhava ANTES da sua mudança? Diga qual, com a saída na `main`: é dívida
anterior, e não é sua. Como separar:
https://github.com/orkastery/orkastery/blob/main/docs/guias/contribuir/testes-e-verificacao.md#falha-anterior-ou-regressão
-->

## O risco

<!-- O que pode quebrar, e o que fica sem cobertura. -->

## Contrato

- [ ] Não altero vocabulário fixo (fases, modos, ciclos, motivos tipados de gate, ações de
      retry, classes de falha, famílias de lease, contrato do MASTER log). *Se altero, isto é
      uma mudança de contrato e merece o próprio PR, com a justificativa separada.*
- [ ] Não adiciono dependência de runtime ao núcleo sem issue aberta antes.
- [ ] Não substituo nenhuma lacuna de medida por zero ou por estimativa não declarada.
- [ ] Skill nova (se houver) tem corpus em `eval/casos/`.
- [ ] Mudança de comportamento (se houver) tem linha na seção "Não publicado" do `CHANGELOG.md`.

## Uso de agente

- Modelos usados: <!-- ou "nenhum" -->
- Host ou interface: <!-- ou "nenhum" -->
- [ ] Commit com trecho escrito por agente traz o trailer `Co-Authored-By:`.
- [ ] Eu, autor humano, revisei e aprovei o diff inteiro antes de enviar.
