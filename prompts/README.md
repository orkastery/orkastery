# prompts/

Os prompts do `ork` como **templates versionados** (bloco B4).

Ate o B2 o prompt de fase era montado por concatenacao dentro do codigo: mudar uma linha do
contrato de fase era mudar codigo, e nao havia como um projeto revisar o texto sem abrir o
compilador. Aqui o texto virou arquivo, com frontmatter, versao e lint.

| Comando | O que faz |
|---|---|
| `ork prompt list` | Os templates que valem, com a versao e a origem de cada um |
| `ork prompt lint` | Reprova template quebrado ANTES de ele virar despacho |
| `ork prompt render <thread> --fase F` | O prompt exato, com o mesmo sha256 que vai ao ledger |
| `ork prompt render --exemplo --fase F --modo M` | O mesmo, sem thread nenhuma e sem gravar nada |

## Como a resolucao funciona

A lingua do prompt e a declarada pelo dono em `owner.language` (sem ela, pt-BR), a mesma do
`ork phase run`: o `LANG` de quem roda nao a muda, e o `ork prompt render` mostra o prompt que o
despacho grava. Em pt-BR:

1. `prompts/fase-<minuscula>.md` do projeto, se existir (por exemplo `prompts/fase-goal.md`);
2. senao, `prompts/fase-padrao.md` do projeto;
3. senao, o template embutido no `ork`.

Com o dono em ingles (RM-061), o template do projeto vence o embutido e o da fase vence o
padrao; no mesmo nivel, o par `.en` vem antes:

1. `prompts/fase-<minuscula>.en.md`, depois `prompts/fase-<minuscula>.md`;
2. `prompts/fase-padrao.en.md`, depois `prompts/fase-padrao.md`;
3. o `fase-padrao.en` embutido.

Os valores do prompt falam a lingua do template escolhido: o template do projeto sem o par
`.en` sai inteiro em pt-BR, e o `ork prompt lint` avisa. O `ork prompt list` e o `lint` mostram
todos os templates do projeto e, dos embutidos, o da lingua do prompt.

O `fase-padrao.md` deste repositorio e identico, byte a byte, ao embutido, e o
`fase-padrao.en.md` ao embutido ingles; ha teste que reprova a divergencia e que exige as mesmas
versao, fases e variaveis nas duas linguas. Isso e de proposito: o arquivo existe para ser lido e
revisado, nao para virar uma segunda fonte de verdade que ninguem compara com a primeira.

## O que o lint cobra

- `id`, `versao` e `descricao` no frontmatter, com o `id` batendo com o nome do arquivo.
- Toda `{{variavel}}` usada esta declarada, e toda declarada e usada.
- As secoes obrigatorias: ciclo canonico, modo de conducao, contexto da thread, pedido do
  builder e regras de evidencia.
- A frase `REGRA CENTRAL: o modo afrouxa a pausa, NUNCA a verificacao.`, que e o contrato dos
  cinco modos e a coisa mais cara de se perder neste arquivo.
- `{{pedido}}` presente: um template sem ele despacharia uma fase sem a demanda do builder.
- Nenhuma credencial no texto, pelos mesmos padroes da policy `segredo_em_prompt`. Quando acha,
  o lint reporta o nome do padrao e a linha, nunca o trecho: relatorio que imprime o segredo
  vaza de novo.
- Limite de 16 KB, o mesmo do manifesto.

## Regras da renderizacao

Duas, ambas deterministicas e testadas:

1. Variavel usada e nao informada e **erro**, nunca string vazia em silencio.
2. Linha cujo conteudo inteiro e uma variavel que resolveu vazio **some**, para que um campo
   opcional (a variante de ciclo, por exemplo) nao deixe linha em branco no prompt.

O que o template **nao** pode fazer e decidir: template e dado, decisao e codigo. Os valores
saem de `valoresDoPrompt` em `core/src/phase.ts`, e um projeto que reescreve o texto do prompt
continua sem conseguir mudar o que o `ork` considera verdade.
