# Lint e estilo

> **Em uma frase:** o TypeScript compila em modo estrito, o Markdown passa no markdownlint, e código e texto seguem o português do Brasil sem travessão longo.

## O que confere o quê

| Onde | Quem confere |
| --- | --- |
| TypeScript do núcleo | O compilador, com `strict` em [core/tsconfig.json](../../../core/tsconfig.json) |
| Markdown | O markdownlint, com as regras de [.markdownlint-cli2.jsonc](../../../.markdownlint-cli2.jsonc) |
| Modelos de prompt | `ork prompt lint` |
| Modelos de auditoria | `ork audit lint` |
| Comando de claim | O lint da claim, no `ork claims add` e no `ork ci prepare`; ver [verificação](../verificacao.md) |

```bash
npm --prefix core run build
core/node_modules/.bin/markdownlint-cli2
node core/dist/index.js prompt lint
node core/dist/index.js audit lint
```

Não há formatador automático: siga o estilo do arquivo que você edita.

## Estilo de código

- Siga o arquivo vizinho: nomes em português, comentário curto que explica o porquê.
- Mensagens do CLI, rótulos e documentação em pt-BR.
- Sem travessão longo (U+2014) em código, comentário, mensagem ou doc. O teste `catalogo.test.ts` reprova no catálogo e nos adaptadores.
- Sem número inventado: onde a medida não existe, escreva `unavailable`, nunca zero ou estimativa não declarada. O canário `fx-schema-drift` confere.

## Dependências

- As de runtime ficam em `dependencies` de `core/package.json`, com versão fixa.
- Dependência nova pede issue antes: é decisão de produto.

Para ver as de hoje:

```bash
node -p "Object.keys(require('./core/package.json').dependencies).join(', ')"
```

## Contratos

- Vocabulário fixo é contrato: fases, modos, ciclos, motivos de gate, ações de retry, classes de falha, famílias de lease e o contrato do MASTER log.
- Mudar um deles é PR próprio, com a justificativa separada.
- A lista está no [vocabulário fixo do CLI](../../referencia/cli.md#vocabulário-fixo-do-cli).

## Próximo passo

[Triagem](triagem.md), se você vai abrir ou cuidar de issue.
