# Versões e publicação

> **Em uma frase:** a versão nova entra por PR, a tag na `main` dispara o CI que publica no npm, e publicar é ato do mantenedor.

## Para quem contribui

- Não mude `version` em `core/package.json` no seu PR.
- Mudou comportamento? Acrescente uma linha na seção "Não publicado" do [CHANGELOG](../../../CHANGELOG.md), no grupo certo: Adicionado, Mudado, Corrigido ou Removido.
- A linha diz o efeito para quem usa, com o item do roadmap quando houver.
- O CI confere: PR que muda `core/`, `adapters/` ou `marketplaces/` sem linha nova em "Não publicado" reprova no check `documentacao` com `changelog.linha-ausente`. Fica de fora o PR só de testes (pasta `test`, `tests` ou `__tests__`, ou arquivo `*.test.*` e `*.spec.*`) e o PR só de CI (`.github/`, `.ork-ci/`, `core/scripts/test-ci.js` e os checadores `core/scripts/checar-*.cjs`, que não entram no pacote). O PR de versão passa porque abre a seção da versão nova.
- Para conferir antes do PR, da raiz do checkout: `node core/scripts/checar-changelog.cjs --base origin/main`.

## Versão atual

Do checkout:

```bash
node -p "require('./core/package.json').version"
```

Do npm, com rede:

<!-- checagem: citado -->

```bash
npm view @orkastery/cli version
```

## Publicar (mantenedor)

A publicação sai do CI, nunca de uma máquina. O workflow [publicar.yml](../../../.github/workflows/publicar.yml) usa Trusted Publishing, sem token nem senha.

1. Um PR leva a versão nova: `version` em `core/package.json`, e a seção "Não publicado" do CHANGELOG vira a seção da versão, com a data.
2. Com o CI verde na `main`, o mantenedor cria a tag no commit do merge:

   <!-- checagem: citado -->

   ```bash
   git tag v<versao> <sha-do-merge>
   git push origin v<versao>
   ```

3. O workflow confere que a tag bate com o `package.json`, que o commit está na `main` e que os canários passam. Só então publica.
4. O mantenedor confere no npm com `npm view @orkastery/cli version`.

## Versão com defeito

- Versão publicada não se reescreve: a correção sai numa versão nova, pelo mesmo caminho.
- A versão com defeito pode ser marcada como obsoleta no npm pelo mantenedor, com o motivo.

## Próximo passo

[Contribuir com o ork](com-o-ork.md).

Índice dos guias: [CONTRIBUTING](../../../CONTRIBUTING.md).
