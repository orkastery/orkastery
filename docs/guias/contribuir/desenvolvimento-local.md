# Desenvolvimento local

> **Em uma frase:** clone, instale e compile o núcleo, e rode o `ork` direto do checkout com `node core/dist/index.js`.

## Requisitos

- Node.js na versão de `engines` do [core/package.json](../../../core/package.json). O CI testa nas versões da matriz de [ci.yml](../../../.github/workflows/ci.yml).
- npm, que vem com o Node.js, e git.
- Nenhum runtime de agente (Claude Code, Codex): a suíte do CI roda sem eles.

Confira a versão pedida e a sua:

```bash
node -p "require('./core/package.json').engines.node"
node --version
```

## Clonar e instalar

<!-- checagem: citado -->

```bash
git clone https://github.com/orkastery/orkastery.git
cd orkastery
npm --prefix core ci
```

Os comandos destes guias rodam da raiz do checkout.

## Compilar

```bash
npm --prefix core run build
```

- O TypeScript de `core/src/` vira `core/dist/`.
- Compile de novo a cada mudança no núcleo.

## Rodar o `ork` do checkout

```bash
node core/dist/index.js --version
node core/dist/index.js --help
node core/dist/index.js demo
```

- `--help` é a fonte de verdade dos comandos; a [referência do CLI](../../referencia/cli.md) organiza a mesma lista por tarefa.
- `demo` mostra, offline e sem conta, uma afirmação falsa reprovada e a corrigida aceita.

Para digitar só `ork` nesta sessão do terminal:

<!-- checagem: citado -->

```bash
alias ork="node $PWD/core/dist/index.js"
ork doctor
```

`ork doctor` diz o que vale na sua máquina e sai diferente de zero quando falta um runtime. Para contribuir com o núcleo, isso não bloqueia.

## Onde fica cada coisa

| Pasta | O que tem |
| --- | --- |
| [core/src](../../../core/src) | O núcleo em TypeScript: CLI, gates, verify, ship |
| [core/test](../../../core/test) | A suíte, em `node --test` |
| [skills](../../../skills) | As skills finas, uma pasta por skill |
| [eval](../../../eval) | Os canários e o corpus das skills |
| [adapters](../../../adapters) | Os adaptadores de host |
| [prompts](../../../prompts) | Os modelos de prompt das fases |
| [docs](../../README.md) | A documentação |

A [arquitetura](../../conceitos/arquitetura.md) mostra o mapa dos módulos.

## Próximo passo

[Testes e verificação](testes-e-verificacao.md): o que rodar antes do PR.
