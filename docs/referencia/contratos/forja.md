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
  com a porta padrão (443 ou 80): qualquer `porta` declarada é recusada, até a 443 ou a 80. Num remoto web com
  porta explícita fora do padrão, a `porta` declarada tem de ser igual a ela. Para remoto SSH, vale a regra do SSH em
  outro host, abaixo;
- o remoto é web e o `caminho_base` não é prefixo do caminho dele, ou não sobra `dono/repo` depois dele;
- o `tipo` contradiz um host conhecido (`tipo: gitlab` em `github.com`);
- o remoto está em host conhecido (`github.com`, `gitlab.com` e os apelidos SSH): ele nunca é redirecionado, e o
  `host` ou a `porta` do manifesto que divergem recusam.

O único desvio é o do SSH em outro host: o remoto `ssh` ou `scp` (nunca `git://`) cujo host é o `ssh_host` declarado
usa o `host` do manifesto para a web e a API, e esse `host` nunca pode ser um host conhecido.

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
- commit status: a conta de um app (`github-actions[bot]`) vale pelo slug; outra conta só com `status:<login>`;
- verde de produtor fora da lista não aprova; vermelho, pendente ou bloqueado de qualquer produtor reprova ou espera.

Muda para quem já usava outro app: o `ork-verify` verde de um app fora da lista deixa de aprovar o gate, e a pessoa
declara a lista em `ci.produtor`.

`ci.produtor` é validado na leitura do manifesto: de 1 a 20 entradas (a string solta vale como lista de uma), cada
uma um slug de app, um nome de job ou `status:<login>` (letras, dígitos, `_`, `.` e `-`, até 100 caracteres, começando
por letra ou dígito); repetidas contam uma vez. Lista vazia, com mais de 20 ou com entrada inválida é erro do
manifesto: nunca se adivinha quem aprova.

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

- Uma casa da rede GitLab em subcaminho ou com CA própria: o `rede.json` guarda só `host[:porta]`.
- Duas instâncias do GitLab no mesmo host, em subcaminhos diferentes, na mesma máquina (limite do `glab`).
