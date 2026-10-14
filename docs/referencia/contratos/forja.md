# Contrato da forja: identidade, endereço e versão

> **Em uma frase:** como o `ork` reconhece a forja do projeto (GitHub ou GitLab), o que o bloco `forja:` do `orkastery.yaml` declara, quem pode aprovar o check exigido e o que o `ork doctor` confere.

O `ork` fala com a forja do projeto pela CLI dela já logada (`gh`, `glab`). Ele nunca lê nem passa token: quem tem o login é a CLI.

## O bloco `forja:` (opcional)

Sem ele, tudo vem do remoto `origin` e da sondagem. Com ele, o que ele declara vale mais que o remoto.

| Campo | Para que serve | Exemplo |
| --- | --- | --- |
| `tipo` | `github` ou `gitlab` | `gitlab` |
| `host`, `porta` | a web e a API | `gitlab-ia.unifique.com.br`, `443` |
| `caminho_base` | instância servida em subcaminho (`relative_url_root`); só o GitLab | `/gitlab` |
| `ssh_host`, `ssh_porta` | SSH em outro host ou outra porta | `ssh.empresa.com`, `2222` |
| `ca` | CA interna, o caminho absoluto do arquivo PEM | `/etc/pki/ca-trust/source/anchors/empresa.pem` |

Valor fora da forma é erro do manifesto. O manifesto confirma o remoto, nunca o redireciona. Dá
`forja.remoto-divergente`, sem consulta nenhuma, quando:

- o `host` declarado difere do host do remoto;
- há `porta` declarada e o remoto é de host conhecido (`github.com`, `gitlab.com`), ou é web sem porta explícita ou
  com a porta padrão do protocolo (443 em https, 80 em http): qualquer `porta` declarada é recusada,
  até a padrão. Num remoto web com porta explícita fora do padrão, a `porta` declarada tem de ser igual a ela. Num remoto SSH (`ssh://` ou `scp`) de host
  que não é conhecido, a `porta` declarada vale para a web e a API, no mesmo host do manifesto ou no caso do SSH em
  host separado (`ssh_host`, abaixo): a porta do SSH não diz nada sobre a porta da web. O host continua tendo de bater,
  e qualquer outro host dá `forja.remoto-divergente`;
- o remoto é web e o `caminho_base` não é prefixo do caminho dele, ou não sobra `dono/repo` depois dele;
- o `tipo` contradiz um host conhecido (`tipo: gitlab` em `github.com`);
- o remoto está em host conhecido (`github.com`, `gitlab.com` e os apelidos SSH): ele nunca é redirecionado, e o
  `host` ou a `porta` do manifesto que divergem recusam.

O único desvio é o do SSH em host separado: o remoto `ssh` ou `scp` (nunca `git://`) cujo host é o `ssh_host`
declarado usa o `host` do manifesto para a web e a API (e a `porta` declarada, sem confronto com a do remoto), e esse
`host` nunca pode ser um host conhecido.

## Como o tipo é resolvido

1. `forja.tipo` do manifesto.
2. Host conhecido: `github.com` (e `ssh.github.com`) é GitHub; `gitlab.com` (e `altssh.gitlab.com`) é GitLab.
3. Sondagem, só pela CLI que já tem login no host: `gh api --hostname <host> meta` e, com `GITLAB_HOST=<host>`,
   `glab api metadata`. Nenhuma requisição anônima vai a host desconhecido.
4. Nenhuma resposta: `forja.desconhecida`. Duas: `forja.ambigua`. As duas pedem `forja.tipo`.

O nome do host nunca decide o tipo sozinho: um GitLab pode se chamar `git.empresa.com`, ou `github.empresa.com`. A
resposta da sondagem fica em cache por 24 h em `.orkastery/cache/`.

## Quem aprova o check exigido: `ci.produtor`

Lista de quem pode publicar o `ork-verify`. Padrão: `github-actions` no GitHub, `gitlab-ci` no GitLab.

- check-run: o slug do app (`github-actions`, `circleci`);
- job de pipeline do GitLab: `gitlab-ci`;
- commit status: a conta de um app (`github-actions[bot]`) vale pelo slug; outra conta só com `status:<login>`;
- verde de produtor fora da lista não aprova; vermelho, pendente ou bloqueado de qualquer produtor reprova ou espera.

Muda para quem já usava outro app: o `ork-verify` verde de um app fora da lista deixa de aprovar o gate, e a pessoa
declara a lista em `ci.produtor`.

`ci.produtor` é validado na leitura do manifesto: de 1 a 20 entradas (a string solta vale como lista de uma), cada
uma um slug de app, um nome de job ou `status:<login>` (letras, dígitos, `_`, `.` e `-`, até 100 caracteres, começando
por letra ou dígito); repetidas contam uma vez. Lista vazia, com mais de 20 ou com entrada inválida é erro do
manifesto: nunca se adivinha quem aprova.

## A CI no GitLab

`ork ci status` e o gate do `ork ship` leem a CI pela forja resolvida (o mesmo resolvedor do restante do contrato).
O `ork-verify` é um job da pipeline do projeto, e o `ork` o lê pela API: os commit statuses do commit, filtrados pelo
`ci.context`, conferidos contra a lista de jobs da pipeline do projeto.

- **Só o job real é `gitlab-ci`.** Um status conta como produtor `gitlab-ci` apenas se o id, o nome e a pipeline dele
  estão na lista de jobs da pipeline do projeto.
- **Status avulso não aprova sozinho.** Um status criado por `POST /statuses` (que vira um job `external`, fora da
  lista de jobs) conta só como `status:<login>`, o login de quem o criou, e só aprova se esse produtor estiver em
  `ci.produtor`. Assim ninguém forja o `ork-verify` com um `POST /statuses` de nome igual.
- **Piso.** Abaixo do GitLab 17.0 a consulta é recusada (`forja.versao-abaixo-do-piso`).
- **Resultado mesclado e merge train** (Premium): o job roda num commit temporário, não no head do MR. O `ork` liga a
  pipeline ao head pelo pai desse commit. Sem esse vínculo (por exemplo, merge train com squash), o check nunca aprova:
  a consulta responde `ci.merged-results-sem-vinculo` (falha fechada). Vermelho e pendente continuam valendo.
- **Falha fechada:** erro de leitura, página a mais ou item fora do esquema deixam a
  consulta indisponível, nunca verde.

O job do `ork-verify` vai pelo modelo `templates/gitlab/ork-verify.yml` (copie para o projeto e use `include: local`)
ou pelo CI/CD Component `templates/ork-verify/template.yml` (GitLab 17.0 ou mais novo, com o repositório do Orkastery
espelhado na instância). Os dois rodam `ork ci run --branch` com a branch do MR e não usam token nem publicam status.
As regras de `workflow:rules` (pipeline de MR sem duplicar a de branch) têm de morar no `.gitlab-ci.yml` do próprio
projeto, fora de qualquer `include:`; sem elas, a pipeline do MR pode não nascer, ou nascer em dobro.

No `ork ci status --json`, o contrato é `ork.ci-status/v2`: a v1 mais `provider` (`github`, `gitlab` ou `null`),
`fonte` (`check-run`, `commit-status` ou `pipeline-job`) e `produtor`. Os leitores da v1 continuam aceitos.

## Pulse no GitLab

O pulse lê os MRs da base numa consulta GraphQL: os abertos (100 por página, até 200), com a pipeline do head e o
job do check da CI (o `ci.context` do manifesto, `ork-verify` por padrão), os recentes de qualquer estado (100) e os das
branches de thread com produto publicado (até 10). MR de fork e de outra base ficam de fora. Cada check sai da regra
única de estado; `manual` e `skipped` contam como verde no pulse, como no GitHub. Um status externo (`POST /statuses`)
com o nome do check fica pendente: não é o job. Lista cortada (teto, cota abaixo de 10 %) é `parcial`, nunca "sem MR".
A forja do pulse vem do bloco `forja:`, do host conhecido ou da sondagem só pela CLI com login. Sem login do `glab` no
host, o pulse diz uma vez `prs.sem-leitura`. O retrato `ork.prs-abertos/v1` aceita o repositório em subgrupos.

## Casa da rede num grupo

`ork network entrar --forja gitlab --repositorio <grupo>[/<sub>...]/<nome>` cria a casa privada no grupo quando a
pessoa é Maintainer (40) ou acima nele, herdado inclusive. Abaixo disso a recusa é `rede.repositorio-alheio`, com o
nível medido e o grupo na frase; com namespace de outro usuário, a recusa é `rede.repositorio-alheio` também. O host
com porta vai por `GITLAB_HOST`; a rede não guarda caminho base. Um GitLab em subcaminho ou com CA própria é recusado
com `rede.forja-nao-suportada`. O `ork network roadmap` lê a porta de um remoto https de GitLab (a que não é a do
esquema) e a leva à API; a porta de um remoto ssh é do ssh e nunca entra.

## Versão do servidor

`GET /api/v4/metadata` dá a versão e a edição, em cache por 24 h em `.orkastery/cache/`.

| Faixa | GitLab |
| --- | --- |
| testada | 19.4, 19.3, 19.2 (atualizada a cada release do `ork`) |
| compatível | 17.0 em diante |
| abaixo do piso | antes de 17.0: `forja.versao-abaixo-do-piso` |

## CLIs

| CLI | Mínimo | Por quê |
| --- | --- | --- |
| `gh` | 2.18.0 | a versão medida: `headRefOid` no `gh pr list --json`, `api -i`, `auth status --hostname`, `--body-file` |
| `glab` | 1.121.0 | a versão medida: `GITLAB_HOST` com porta, login em subcaminho, `GLAB_CA_CERT`, `auth git-credential` |

Na API, o `glab` recebe o host por `GITLAB_HOST=host[:porta]`, nunca por `--hostname` com porta e nunca com o
caminho base; o `gh` também recusa `--hostname host:porta` e recebe a porta por `GH_HOST`. O login de uma instância
em subcaminho é `glab auth login --hostname host[:porta]/sub --stdin`, que o `glab` guarda como o host, com o
subcaminho à parte (a chave do login é `host[:porta]`): duas instâncias no mesmo host, em subcaminhos diferentes, não
coexistem no `glab`. O corpo de uma requisição vai por stdin ou arquivo 600, nunca por argumento.

A `ca` do manifesto chega ao `glab` por `GLAB_CA_CERT` e ao `gh` por `SSL_CERT_FILE`, que só vale no Linux; em outro
sistema, instale a CA no sistema (o `ork doctor` avisa).

## Erros da forja

`forja.ausente` (a CLI não está instalada), `forja.sem-login` (401, ou CLI sem login no host), `forja.sem-permissao`
(403), `forja.nao-achei` (404; no GitLab, projeto privado sem acesso também), `forja.limite` (429 ou cota esgotada, com
`tentarEm`), `forja.conflito` (409),
`forja.indisponivel` (5xx, prazo, TLS), `forja.pedido-recusado` (outro 4xx), `forja.resposta-invalida`,
`forja.incompleto` (lista acima de 10 páginas de 100), `forja.desconhecida`, `forja.ambigua`,
`forja.remoto-divergente`, `forja.sem-capacidade`, `forja.versao-abaixo-do-piso`. Uma leitura espera uma vez o
limite de cota ou secundário (até 60 s); escrita nunca se repete sozinha. Erro ou lista incompleta nunca vira verde: a
consulta fica indisponível.

## A seção "forja" do `ork doctor`

Linhas: identidade, alcance (HTTPS e SSH separados), TLS, subcaminho, CLI, login, servidor, escopo, projeto e
capacidades. Sem remoto de forja e sem o bloco `forja:`, a seção não aparece. Reprova (identidade sem tipo, HTTPS
fora, cadeia TLS inválida, subcaminho sem resposta, CLI abaixo do mínimo, sem login, token sem leitura da API,
servidor abaixo do piso, projeto não lido) só quando o projeto depende da forja (`ci.required_for_ship: true` ou o
bloco `forja:` declarado); fora disso, avisa. SSH recusado, as opções de merge do projeto e as capacidades desligadas
são sempre aviso. Entre as que reprovam o projeto dependente, estão a CLI ausente (`forja.ausente`) e o arquivo da
`ca` que não existe ou não é legível.

No `ork doctor --json` (contrato `ork.doctor/v1`), a seção só roda com `--forja`, porque ela faz chamadas de rede. O
campo `forja` do JSON diz o que foi feito: `medida` (a seção rodou) ou `nao-medida` (sem a flag).

## O que não é suportado

- Uma casa da rede GitLab em subcaminho ou com CA própria: o `rede.json` guarda só `host[:porta]`; a recusa é
  `rede.forja-nao-suportada`.
- Duas instâncias do GitLab no mesmo host, em subcaminhos diferentes, na mesma máquina (limite do `glab`).
