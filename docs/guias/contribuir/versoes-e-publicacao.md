# Versões e publicação

> **Em uma frase:** a versão nova entra por PR, a tag na `main` dispara o CI que publica no npm, e publicar é ato do mantenedor.

## Para quem contribui

- Não mude `version` em `core/package.json` no seu PR.
- Mudou comportamento? Acrescente uma linha na seção "Não publicado" do [CHANGELOG](../../../CHANGELOG.md), no grupo certo: Adicionado, Mudado, Corrigido ou Removido. A linha pode ser em pt-BR ou em inglês; o nome do grupo não muda.
- A linha diz o efeito para quem usa, com o item do roadmap quando houver.
- O CI confere: PR que muda `core/`, `adapters/` ou `marketplaces/` sem linha nova em "Não publicado" reprova no check `documentacao` com `changelog.linha-ausente`. Fica de fora o PR só de testes (pasta `test`, `tests` ou `__tests__`, ou arquivo `*.test.*` e `*.spec.*`) e o PR só de CI (`.github/`, `.ork-ci/`, `core/scripts/test-ci.js` e os checadores `core/scripts/checar-*.cjs`, que não entram no pacote). O PR de versão passa porque abre a seção da versão nova, com ou sem colchetes no número, inclusive quando a seção "Não publicado" vira a da versão.
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

3. O workflow confere que a tag bate com o `package.json`, que o commit está na `main`, que os cenários passam e que há uma dist-tag segura. Só então publica, sempre com `npm publish --tag <dist-tag>`.
4. O mantenedor confere no npm com `npm view @orkastery/cli version`.

### Como a dist-tag é escolhida

A guarda consulta a `latest` de `@orkastery/cli` no mesmo registro configurado para a publicação e aplica a política da RM-088:

- uma versão estável maior que a `latest` estável usa `latest`;
- uma versão estável com a mesma precedência falha, porque já foi publicada;
- uma versão estável menor usa `previous` e não move a `latest` para trás;
- uma pré-release usa o primeiro identificador como canal, por exemplo `rc` ou `beta`, mesmo quando sua versão é maior que a `latest`;
- na primeira publicação, a estável usa `latest` e a pré-release mantém seu canal próprio.

O canal da pré-release é validado antes da consulta. A guarda recusa identificador vazio, numérico, iniciado por número ou por `v`/`V`, `x`/`X` e os nomes reservados `latest` e `previous`. A recusa é `publicacao.dist-tag-invalida` e não produz uma tag para o passo seguinte.

O job preserva a instalação de `npm@latest`. A consulta aceita as duas formas escalares conhecidas do `npm view --json`: a string SemVer usada pelo npm 11 e o array unitário usado pelo npm 12. Array vazio ou com mais de um item, objeto e qualquer outra forma desconhecida falham como `publicacao.consulta-invalida`.

Primeira publicação só significa pacote ausente quando a consulta exata devolve um `E404` estruturado e `npm ping` confirma o mesmo registro. Registro inacessível, erro não estruturado, pacote existente sem `latest`, `latest` apontando para pré-release e qualquer SemVer inválida falham antes do publish. A guarda não interpreta texto humano do npm e não usa fallback para `latest`.

## Versão com defeito

- Versão publicada não se reescreve: a correção sai numa versão nova, pelo mesmo caminho.
- A versão com defeito pode ser marcada como obsoleta no npm pelo mantenedor, com o motivo.

## Próximo passo

[Contribuir com o ork](com-o-ork.md).

Índice dos guias: [CONTRIBUTING](../../../CONTRIBUTING.md).
