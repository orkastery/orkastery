<!-- Seção em branco faz o PR voltar. Veja CONTRIBUTING.md. -->

## O problema

<!-- O que estava errado, com o comando ou o passo que reproduz. -->

## A mudança

<!-- O que você fez, e o que você deliberadamente NÃO fez. -->

## A prova

<!--
Cole a SAÍDA REAL, não a descrição dela. Nada entra sem evidência executável.

  cd core && npm ci && npm run build && npm test
  node core/dist/index.js eval
  node core/dist/index.js prompt lint
  node core/dist/index.js docs verificar
-->

```text
```

## Baseline

<!--
Algum destes já falhava ANTES da sua mudança? Se sim, diga qual: é dívida pré-existente, e
não é sua. É a mesma distinção que `ork verify --baseline` faz, e ela vale para gente também.
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

## Uso de agente

- Modelos usados: <!-- ou "nenhum" -->
- Host ou interface: <!-- ou "nenhum" -->
- [ ] Eu, autor humano, revisei e aprovei o diff inteiro antes de enviar.
