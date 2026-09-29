# O que contribuir, e por onde começar

> **Em uma frase:** feature nova começa por uma conversa, defeito começa por uma issue, e documentação ou correção pequena pode ir direto para um PR.

## Escolha o caminho

| Você tem | Comece por | Por quê |
| --- | --- | --- |
| Uma feature nova: modo, fase, comando ou integração | [Discussions, categoria Ideas](https://github.com/orkastery/orkastery/discussions/categories/ideas) | Feature nova costuma mexer em contrato; combinar antes evita PR recusado |
| Um defeito: o `ork` não faz o que a doc diz | [Issue de bug](https://github.com/orkastery/orkastery/issues/new?template=bug_report.yml) | O modelo pede o comando, a saída real e o `ork doctor` |
| Uma página errada, confusa ou que falta | PR direto, ou a [issue de documentação](https://github.com/orkastery/orkastery/issues/new?template=documentacao.yml) | Doc errada é defeito do projeto |
| Uma correção pequena: digitação, mensagem, teste que falta | PR direto | Cabe numa revisão só |
| Uma dúvida de uso | [Discussions, categoria Q&A](https://github.com/orkastery/orkastery/discussions/categories/q-a) | A resposta fica achável para quem vier depois |
| Uma vulnerabilidade | O canal privado do [SECURITY.md](../../../SECURITY.md) | Nunca em issue pública |

## Pede conversa antes, sempre

- **Vocabulário fixo:** fases, modos, ciclos, motivos de gate, ações de retry, classes de falha, famílias de lease e o contrato do MASTER log são contratos. A lista está no [vocabulário fixo do CLI](../../referencia/cli.md#vocabulário-fixo-do-cli). Mudar um deles é PR próprio, com a justificativa separada.
- **Dependência nova de runtime no núcleo:** é decisão de produto. A regra `RU3` do pack de auditoria `reuse` existe para esse caso.
- **Número que o produto não mede:** onde a medida não existe, o `ork` escreve `unavailable`. Proposta que precisa inventar um valor volta.

## Antes de começar

- Procure no [roadmap](../../roadmap/README.md) e nas [issues abertas](https://github.com/orkastery/orkastery/issues). Se o item existe, comente nele o seu caso.
- Vai pegar uma issue? Comente nela antes, para ninguém fazer em dobro.
- Primeira vez? Comece pelas issues com [`good first issue`](https://github.com/orkastery/orkastery/labels/good%20first%20issue).

## O que ajuda muito

- Bug com o comando exato e a saída real, não a descrição dela.
- Teste que reproduz um defeito, mesmo sem a correção.
- Doc que diverge do código, com o comando que mostra a divergência.
- Skill nova com corpus em `eval/casos/<nome>.json`: skill sem corpus não entra no catálogo.

## Próximo passo

[Desenvolvimento local](desenvolvimento-local.md): do clone ao `ork` rodando do checkout.

Índice dos guias: [CONTRIBUTING](../../../CONTRIBUTING.md).
