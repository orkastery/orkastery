# Política de recibo da empresa

[English](politica-de-recibo-da-empresa.md) | **Português (Brasil)**

A empresa pode observar, avisar ou exigir no CI que toda mudança destinada à branch protegida tenha um verify vigente do Orkastery. A regra é opt-in por repositório: sem `ci.politica_recibo`, `ork ci run --branch` mantém o resultado e o código de saída anteriores.

## Configurar o manifesto

No `orkastery.yaml`, escolha um nível:

```yaml
ci:
  context: ork-verify
  politica_recibo: exigir
  fabrica:
    github_app_id: 123
    gitlab_user_id: 456
```

| Nível | Resultado do check | Diagnóstico |
| --- | --- | --- |
| `observar` | Não reprova por recibo | Inclui `presente`, `ausente`, `invalido` ou `sha-divergente` no bloco `policy` |
| `avisar` | Igual a `observar` | Também escreve uma anotação e o resumo do job no GitHub, quando disponível, ou um aviso no log do GitLab |
| `exigir` | Reprova PR/MR para `worktree.base_branch` quando o recibo não está presente | Retorna `ci.recibo.ausente`, `ci.recibo.invalido` ou `ci.recibo.sha-divergente`, com a ação de correção |

Valor diferente desses três torna o manifesto inválido. O push na própria branch protegida não é um PR/MR e não reprova pela ausência do recibo.

`ork ci prepare <thread>` grava no campo `recibo` do `ork.ci-bundle/v1` uma entrada
`ork.ci-projecao-replay/v1`. A projeção leva thread, claims canônicas, rodada, baseline mínima, comandos e hashes, mas
não declara um HEAD como recibo presente. O leitor aceita o recibo legado apenas para compatibilidade; ele nunca
satisfaz a prova desta etapa. A baseline projetada é informativa: por vir do próprio PR/MR, ela não participa do
julgamento executado no CI e não pode classificar uma falha atual como dívida preexistente.

No checkout do PR/MR, o runner valida a projeção, reexecuta preparo, claims e comandos canônicos pelo mesmo julgamento
puro do verify e emite `ork.ci-recibo-runner/v1` no campo `recibo` do resultado `ork.ci-run/v1`. O recibo fica
`presente` somente quando `resultado.recibo.head`, `resultado.commit` e o HEAD executado são iguais e a rodada integral
fica verde. A projeção precisa ter ao menos uma claim e seus comandos devem ser idênticos aos comandos de `verify` do
manifesto lido da ref da branch de destino. O `verify.preparo` projetado também precisa ser idêntico ao preparo desse
mesmo manifesto: ausência, inclusão ou troca unilateral invalida a receita. Ref ausente ou manifesto ilegível falha
fechado. Recibo de outro HEAD é `sha-divergente`; contrato, hash ou receita inválida é `invalido`.

O replay monta um ambiente novo por allowlist. Primitivas de execução, locale, fuso, marcador de CI e valores
sintéticos da rodada entram; `GITHUB_TOKEN`, `CI_JOB_TOKEN`, chaves `*_TOKEN` e `*_SECRET`, credenciais de runtime ou
forja e autoridade `ORK_HITL_*` ficam fora. Branch `ork/*`, branch externa e fork seguem a mesma medição nas duas
forjas. Quando a forja não inicia o job de um fork, o Ork não inventa resultado; a regra de check obrigatório governa
o merge.

### Diagnósticos do replay

Todas as causas abaixo deixam `policy.receipt` como `invalido`. Em `observar` e `avisar`, o diagnóstico de recibo não
acrescenta reprovação; em `exigir`, ele reprova o PR/MR para a branch protegida. Falha real de preparo, claim ou comando
continua reprovando nos três níveis.
O replay julga todas as execuções atuais sem baseline: não há exceção de dívida preexistente no CI.

| Código | Mensagem | Ação |
| --- | --- | --- |
| `ci.recibo.projecao-acima-do-limite` | A projeção excede o limite do bundle | Reduza aos campos canônicos, rode verify no HEAD atual e prepare de novo |
| `ci.recibo.claim-nao-hermetica` | A claim não pode ser reexecutada integralmente no runner | Torne a claim hermética ou remova a dependência incompatível, rode verify e prepare de novo |
| `ci.recibo.runner-sem-capacidade` | Falta uma capacidade exigida pelo replay | Disponibilize a capacidade ou revise a claim ou o comando e reexecute |
| `ci.recibo.comando-nao-iniciado` | Um comando não foi iniciado | Restaure o executável ou runtime declarado e reexecute |
| `ci.recibo.prazo-excedido` | Um comando excedeu o prazo do verify | Corrija ou divida o comando, ou ajuste o prazo no manifesto, rode verify e prepare de novo |
| `ci.recibo.produto-alterado` | O produto mudou durante o replay | Remova a mutação concorrente, restaure o checkout e reexecute |

## Adotar uma branch e orientar a sessão

`ork adotar <branch> --roadmap RM-NNN --nome <nome> --modo <modo> --perfil-check <perfil>` incorpora uma história que já existe. A branch canônica nasce no commit da origem; a ref externa e os OIDs exclusivos não são movidos nem reescritos. Os estados públicos são `preparada`, `verificada`, `revisada` e `concluida`. Eles exigem, nessa ordem, registro durável, verify verde, CHECK independente e recibo do runner no mesmo HEAD. Repetir o comando devolve a thread e o próximo passo; não faz push, merge ou SHIP.

Uma sessão que começa fora de thread consulta `ork.sessao-orientacao/v1` no núcleo. Claude Code e Codex transportam o texto em `SessionStart`; o Codex instala o manifesto e o script em `.codex/` e mantém a skill em `.agents/`. Hermes usa o plugin nativo `orkastery-hitl` e injeta o texto somente na primeira chamada ao modelo. OpenClaw responde somente aos eventos de chat `/new` e `/reset`; RPC não recebe reply, e `agent:bootstrap` recebe apenas contexto. O aviso é informativo e nunca bloqueia. Instalação, habilitação, confiança e entrega sem prova própria permanecem **não confirmado**.

## Exceção auditável do recibo

A exceção da F5 não reutiliza a exceção de coordenação coletiva da F2. O builder fornece somente uma `authorizationRef` opaca. A autorização, a policy, o mapa que liga principals a atores, o destinatário e as chaves do emissor vêm da branch protegida ou de autoridade organizacional assinada. Builder e autorizador precisam resolver para atores independentes; outra conta, alias, serviço ou token do mesmo ator não satisfaz a separação. Expiração e referência, responsável e prazo de revisão são obrigatórios.

A porta gerida usa três contratos separados:

- `ork.excecao-notificacao-pedido/v1` liga autorização, policy, projeto, source, target, HEAD, operação, destinatário e idempotência;
- `ork.excecao-notificacao-recibo/v1` declara o resultado assinado do emissor. `ledgerEventId` e `recordedAt` são proibidos nele, e somente `delivered` satisfaz `exigir`;
- `ork.excecao-notificacao-ledger/v1` é anexado pelo núcleo depois da validação e liga o evento ao recibo por `receiptId` e `receiptHash`.

A ordem é pedido, recibo, validação, append durável e exposição do par. Falha de append não expõe a exceção. Depois do append, a mesma chave de idempotência devolve o par sem reenviar nem criar evento. Antes do append, a porta idempotente precisa devolver o mesmo recibo. O recibo assinado prova a resposta `delivered` do emissor para o pedido exato; não prova leitura humana.

## Decisão da fábrica

A F7 fornece o motor e as portas da decisão. Ela não provisiona nem opera o serviço da fábrica. O bloco `ci.fabrica` é lido somente do manifesto da branch de destino. `github_app_id` identifica o GitHub App esperado e `gitlab_user_id` identifica a conta esperada no GitLab. Segredos não pertencem ao manifesto.

A decisão relê os registros do núcleo e os fatos da forja. Ela exige que o último verify seja verde e tenha executado os comandos do manifesto, além da lista completa de commits e arquivos, cada commit de produto registrado pela thread, CHECK independente posterior ao último commit de produto e ligado ao commit aceito do verify, e a tag da mesma condução. Commit de produto é um commit que não é merge e muda ao menos um arquivo fora de `.ork-ci`. Depois do verify, somente `.ork-ci/` pode mudar; outra mudança exige novo verify. O resultado forte usa `ork.ci-recibo-forte-payload/v2` e `ork.ci-recibo-forte-assinatura/v2`, separados do recibo F5. A assinatura Ed25519 liga projeto, origem, destino, HEAD, verify, CHECK, condução, validade e, quando existe, a exceção F6 exata. Evento com `emitidoEm` posterior a `recebidoEm` é recusado, sem tolerância de relógio.

No GitHub, `exigir` publica no HEAD o nome `ork-fabrica/utf8-<destino-em-hex>` e requer uma regra própria da branch, atualização estrita e o App exato. `observar` e `avisar` usam `ork-fabrica-diagnostico/utf8-<destino-em-hex>` e nunca tornam o diagnóstico decisório. O sufixo é a codificação hexadecimal dos bytes UTF-8 do nome completo da branch. O App precisa de leitura para conteúdo, pull requests, regras da branch e Administration, esta última para ler a proteção clássica, além de escrita de check-runs. Fork e `merge_group` não são aceitos em `exigir` nesta etapa. A atualização estrita não prova o commit de merge criado pela própria forja; mudança própria desse merge permanece fora da garantia do verify do HEAD.

No GitLab, a conta da fábrica precisa de token com escopo `api`, acesso restrito aos projetos declarados e função Maintainer. A branch de destino precisa estar protegida, sem push de Maintainer e sem force push. O MR precisa estar atualizado com o destino e toda chamada de merge usa a API com o campo `sha` igual ao HEAD relido; a operação falha se a API não confirmar esse vínculo. O diagnóstico fica no registro publicado pela fábrica e não transforma commit status ou external status check em autoridade positiva. Na edição Free, outro Maintainer efetivo produz o aviso não bloqueante `ci.fabrica.maintainer-adicional`. Owner, administrador e bypass permanecem fora da garantia. Nas edições pagas, a fábrica também exige reset de aprovações após push, regra não editável no MR, bloqueio de aprovação pelo autor e aprovações válidas. Merge train não é aceito em `exigir` nesta etapa. O merge criado pelo GitLab pode ter mudança própria que não estava no HEAD verificado; essa mudança permanece fora da garantia.

Os códigos da fábrica são `ci.fabrica.prova-ausente`, `ci.fabrica.indisponivel`, `ci.fabrica.prazo-excedido`, `ci.fabrica.regra-destino-invalida`, `ci.fabrica.maintainer-adicional`, `ci.fabrica.nome-colidente` e `ci.fabrica.publicacao-recusada`. No contrato do SHIP, sinal negativo da CI continua vetando e sinal positivo não autoriza sozinho. As recusas próprias são `ship.fabrica.push-recusado`, `ship.fabrica.merge-pendente` e `ship.fabrica.sha-divergente`.

## Limite de confiança do nível básico

O bundle e o `sha256` da projeção vêm do próprio PR/MR e podem ser forjados por quem controla essa mudança. O runner exige
um conjunto não vazio de claims e ancora os comandos e o preparo no `verify` do manifesto da branch de destino, cuja
proteção administrativa por `CODEOWNERS` e regra obrigatória está fora do controle isolado do PR. Isso prova que a receita
aceita não esvaziou as claims nem trocou ou omitiu os comandos e o preparo protegidos. No caminho normal, sem exceção,
o runner não consulta nem confere a projeção contra o ledger do Orkastery. Sem transporte, nenhum caminho entrega uma
exceção F6 ao runner e `exigir` continua pedindo o recibo F5. Esta F7 não fornece esse transporte e o runner não aplica
exceção ao resultado forte. O motor só vincula uma exceção exata recebida por uma porta externa. Nenhum dos caminhos prova que as claims são completas ou
autênticas, nem prova a autoria do bundle,
do código ou do workflow. Também não confia na baseline da projeção: reexecuta no HEAD o preparo, as claims e os comandos
ancorados, reprova qualquer falha atual e emite o recibo do HEAD que acabou de executar.
Não usa ancestralidade nem diff posterior para transformar um HEAD antigo em presente. Isso detecta divergência operacional, mas não prova a autoria
do bundle nem do código.

O resultado forte da fábrica é um artefato v2 separado. Ele não acrescenta o campo `assinatura` ao recibo F5 e não
transforma o job do CI em autoridade positiva. Alteração de escopo, HEAD, evidência, emissor ou chave invalida o resultado.

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

Quando falta recibo, a orientação oferece `ork thread new` para trabalho novo e `ork adotar` para uma branch existente. Os adaptadores atuais não têm capacidade de comentário em PR/MR, portanto `avisar` usa anotação e resumo no GitHub e log no GitLab. Comentário automático permanece uma lacuna declarada.

Se o projeto também participa da rede da empresa, `ork ci run` anexa um preflight coletivo consultivo ao resultado
do PR/MR. O segredo opcional `ORK_REDE_EMPRESA_READ_TOKEN` deve permitir somente leitura do repositório privado da
rede e fica apenas no ambiente do transporte Git. Sem segredo, ou em PR de fork, a saída informa “Checagem
coletiva não realizada”. Esse estado não muda `ok`, a decisão desta política de recibo nem o código de saída.
