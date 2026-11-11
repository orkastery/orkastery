# Política de recibo da empresa

[English](politica-de-recibo-da-empresa.md) | **Português (Brasil)**

A empresa pode observar, avisar ou exigir no CI que toda mudança destinada à branch protegida tenha um verify vigente do Orkastery. A regra é opt-in por repositório: sem `ci.politica_recibo`, `ork ci run --branch` mantém o resultado e o código de saída anteriores.

## Configurar o manifesto

No `orkastery.yaml`, escolha um nível:

```yaml
ci:
  context: ork-verify
  politica_recibo: exigir
```

| Nível | Resultado do check | Diagnóstico |
| --- | --- | --- |
| `observar` | Não reprova por recibo | Inclui `presente`, `ausente`, `invalido` ou `sha-divergente` no bloco `policy` |
| `avisar` | Igual a `observar` | Também escreve uma anotação e o resumo do job no GitHub, quando disponível, ou um aviso no log do GitLab |
| `exigir` | Reprova PR/MR para `worktree.base_branch` quando o recibo não está presente | Retorna `ci.recibo.ausente`, `ci.recibo.invalido` ou `ci.recibo.sha-divergente`, com a ação de correção |

Valor diferente desses três torna o manifesto inválido. O push na própria branch protegida não é um PR/MR e não reprova pela ausência do recibo.

`ork ci prepare <thread>` copia para o bundle o HEAD e o SHA-256 do último recibo `ork.recibo-prova/v1` produzido por um verify verde e integral. O leitor continua aceitando bundle anterior sem `recibo`; em `exigir`, ele aparece como `ausente`. Um recibo fica `presente` quando o HEAD provado é ancestral do HEAD atual e somente o bundle daquela thread mudou em `.ork-ci/` depois do verify. Outra mudança produz `sha-divergente`.

## Tornar o check obrigatório

O manifesto define o comportamento do job; a regra da organização na forja impede o merge. Proteja também a mudança da política com `CODEOWNERS`, por exemplo:

```text
/orkastery.yaml @platform-team
/.github/workflows/ci.yml @platform-team
```

No GitHub:

1. mantenha o job `ork-verify` no workflow;
2. exija revisão do `CODEOWNERS` para os arquivos acima;
3. num ruleset ou numa regra de proteção da branch, marque `ork-verify` como status check obrigatório.

Consulte a documentação oficial sobre [rulesets e status checks obrigatórios](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets), [proteção de branch](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule) e [`CODEOWNERS`](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).

No GitLab:

1. inclua o job `ork-verify` do modelo ou do CI/CD Component;
2. defina os donos do `orkastery.yaml` e da configuração de CI no `CODEOWNERS`;
3. proteja `worktree.base_branch` e habilite **Pipelines must succeed** para o merge request.

Consulte a documentação oficial sobre [branches protegidas](https://docs.gitlab.com/user/project/repository/branches/protected/), [`CODEOWNERS`](https://docs.gitlab.com/user/project/codeowners/) e [merge somente com pipeline bem-sucedida](https://docs.gitlab.com/user/project/merge_requests/auto_merge/). Os [external status checks](https://docs.gitlab.com/user/project/merge_requests/status_checks/) são uma capacidade separada, documentada para o GitLab Ultimate; o job nativo desta integração não depende dela. A exigência de aprovação pelo dono do arquivo e os tiers exatos de cada instalação são **não confirmados** até a administração da instância validar sua configuração.

## Execução no CI

No GitHub, a origem e o destino do PR vêm de `GITHUB_HEAD_REF` e `GITHUB_BASE_REF`. No GitLab, vêm de `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` e `CI_MERGE_REQUEST_TARGET_BRANCH_NAME`. Em push, a variável de destino fica ausente e a política não confunde esse evento com PR/MR.

Quando falta recibo, a orientação oferece `ork thread new`; `ork adotar` é o próximo passo da RM-089 e ainda não faz parte desta entrega. Os adaptadores atuais não têm capacidade de comentário em PR/MR, portanto `avisar` usa anotação e resumo no GitHub e log no GitLab. Comentário automático permanece uma lacuna declarada.
