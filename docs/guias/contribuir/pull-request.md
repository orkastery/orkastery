# Pull request

> **Em uma frase:** título que diz o resultado, descrição com o problema, a mudança, a prova e o risco, os checks obrigatórios verdes e commits com a sua identidade.

## Título

- Curto, em pt-BR, dizendo o resultado para quem usa: "O CI para de cair em teste com relógio (RM-037)".
- Cite o item do roadmap entre parênteses, quando houver.

## Descrição

O [modelo de PR](../../../.github/PULL_REQUEST_TEMPLATE.md) já abre com as seções. Seção em branco faz o PR voltar.

| Seção | O que traz |
| --- | --- |
| O problema | O que estava errado, com o comando ou o passo que reproduz |
| A mudança | O que você fez, e o que deliberadamente não fez |
| A prova | A saída real dos comandos, colada, não descrita |
| Baseline | O que já falhava antes da sua mudança |
| O risco | O que pode quebrar, e o que fica sem cobertura |

Um PR que descreve o problema em uma linha e cola a saída de um teste novo vale mais que três parágrafos sem comando.

## Evidência esperada

- A saída dos comandos de [testes e verificação](testes-e-verificacao.md#o-que-rodar-antes-do-pr).
- Mudou comportamento: um teste que falhava antes e passa agora.
- Mudou texto: a saída de [conferir antes do PR](documentacao.md#conferir-antes-do-pr).
- Usou o `ork`: a saída de `ork verify` e o bundle do CI, como diz [contribuir com o ork](com-o-ork.md).

## Checks obrigatórios

A `main` é protegida: o merge só sai com os checks obrigatórios verdes no último commit do PR.

| Check | O que roda |
| --- | --- |
| `documentacao (markdownlint e paridade)` | markdownlint, `ork docs verificar`, os links relativos e a linha no CHANGELOG ([versões e publicação](versoes-e-publicacao.md#para-quem-contribui)) |
| `nucleo ork (build, testes, canarios)`, um por versão do Node da matriz | Build, `test:ci`, `eval`, `prompt lint` e `audit lint` |
| `ork-verify` | O bundle da thread da branch, `.ork-ci/<thread>.json`: as claims dela e a suíte do CI; sem thread, só a suíte |

- Se o `ork-verify` reprovar por uma claim que não é da sua mudança, diga no PR. Quem decide é o mantenedor.
- No primeiro PR vindo de fork, o GitHub pode esperar o mantenedor liberar os checks.

## Identidade

- Commite com a sua identidade do GitHub. Para não expor seu e-mail, use o endereço `noreply` que o GitHub mostra em Settings, Emails:

  <!-- checagem: citado -->

  ```bash
  git config user.email "<id>+<usuario>@users.noreply.github.com"
  ```

- Um agente escreveu parte do diff? Diga na seção "Uso de agente" do PR e ponha o trailer `Co-Authored-By:` com o agente no commit.
- Você responde pelo diff inteiro: revise antes de enviar.

## Commits

- Mensagem em pt-BR, no formato `<área>: <o que muda>`, como `docs: guia de testes sem contagem fixa`.
- Um commit por mudança lógica. Depois que a revisão começar, prefira commit novo a reescrever o histórico.

## Depois de abrir

- O mantenedor revisa, pede ajuste ou aprova, no prazo do guia de [triagem](triagem.md#prazo-de-resposta).
- O merge é do mantenedor, com o CI verde no commit exato. A entrega passa pelo ciclo do próprio `ork`: ver [o que o mantenedor faz](com-o-ork.md#o-que-o-mantenedor-faz).

## Próximo passo

[Triagem](triagem.md), para saber o que acontece com o PR e com as issues.

Índice dos guias: [CONTRIBUTING](../../../CONTRIBUTING.md).
