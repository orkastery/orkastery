# Rede coletiva da empresa

A rede coletiva reúne projeções mínimas de vários maestros em um repositório privado dedicado. Ela não recebe o
estado local inteiro, credenciais nem objetos do panorama. A empresa governa a política e as inscrições; cada
maestro publica apenas no caminho de sua própria inscrição.

## Criar a rede

Crie primeiro uma organização no GitHub ou um grupo no GitLab e conceda à conta usada pelo Orkastery permissão
para criar um repositório nesse dono. Então use `ork network empresa criar` para criar e reler o repositório privado.
A operação falha se a forja devolver outro dono, outro caminho ou visibilidade pública.

No GitHub, a implementação usa a identidade numérica de [`GET /user`](https://docs.github.com/en/rest/users/users)
e cria o repositório da organização por
[`POST /orgs/{org}/repos`](https://docs.github.com/en/rest/repos/repos#create-an-organization-repository). O
[`gh api --hostname`](https://cli.github.com/manual/gh_api) seleciona um host configurado.

No GitLab, ela usa a identidade numérica de [`GET /user`](https://docs.gitlab.com/api/users/#list-current-user)
e cria o projeto por [`POST /projects`](https://docs.gitlab.com/api/projects/#create-a-project), com `namespace_id`
e visibilidade privada. A [configuração do `glab`](https://docs.gitlab.com/cli/connection/) seleciona GitLab.com ou
uma instalação Self-Managed.

As APIs confirmam a criação no namespace indicado. A permissão efetiva da conta em uma organização, grupo,
subgrupo ou instalação com políticas próprias não é confirmada até a própria forja responder. Criar a organização
ou o grupo não faz parte deste comando. A idempotência de uma escrita cuja resposta se perdeu também não é
garantida pelas fontes: o Orkastery relê o caminho completo antes de decidir.

## Inscrever e sincronizar

O fluxo tem duas operações e duas autoridades. Primeiro, a empresa roda `ork network empresa inscrever` e registra
a identidade esperada do maestro com `forja + host + accountId` numérico; essa operação não aceita a inscrição nem
cria configuração local para o maestro. Depois, o maestro entra na conta esperada e roda
`ork network empresa aceitar`. O aceite relê a inscrição administrativa, resolve a conta autenticada e recusa outra
forja, outro host ou outro `accountId`. O login atual é apenas apresentação e pode mudar. Antes de aceitar, confira
no resumo o destino, a versão da política, os projetos autorizados e as categorias publicadas.

Depois do aceite:

- `ork network empresa publicar` resolve novamente a conta autenticada, recompõe e varre a projeção antes de gravar;
- `ork network empresa status` mostra a projeção publicada, a fonte e uma publicação pendente;
- `ork network empresa sair` encerra a inscrição quando a política permite;
- `ork network empresa revogar` cessa novas publicações de uma inscrição administrada.

As escritas usam uma única branch sem `force`. Cada inscrição tem um caminho próprio. Se outro maestro avançar a
branch, a operação relê política e inscrição, descarta a mudança anterior e recompõe a projeção. Sem alcance à
forja, nada entra numa fila de payload: o status local fica pendente e orienta conferir login, acesso e alcance.

## O que é publicado

Esta tabela é a lista fechada. Campo não listado não sai. Antes do blob, o serializado passa pela policy
`dado_privado` e pela varredura de segredo.

| Parte | Sai | Não sai |
| --- | --- | --- |
| Envelope | contrato, versão da política, id da inscrição e instante da publicação | configuração local, diretório do usuário e nome de máquina |
| Maestro | forja, host, `accountId` e login atual | nome civil, e-mail, token, credencial e perfil local |
| Rede e projeto | tipo da forja, host e caminho controlado do repositório | clone local, remoto cru e URL com credencial |
| Itens | id e estado | título, descrição, ciclo e outros textos livres |
| Reservas | id do item, referência opaca opcional da thread e início | pessoa, máquina, nota e tomada da reserva |
| Trabalhos | referência opaca da thread, fase e id opcional do item | slug, nome, branch, pergunta, runtime, modelo, esforço e sessão |
| Fontes | parte, atualizada, instante de leitura e commit opcional | origem textual, local, ref local e mensagem livre |
| Lacunas | tipo e parte | alvo, detalhe, correção e erro cru |

A referência da thread é um hash determinístico por inscrição, não o slug. Caminho local, diretório do usuário e
nome de máquina nunca entram no contrato. Um scanner indisponível ou um achado impede a publicação sem repetir o
valor encontrado.

## Revogação, saída e limites

Revogação e saída mudam o estado na mesma branch das publicações. A próxima tentativa relê esse estado e para.
Uma publicação aceita antes da transição permanece no histórico; exclusão e retenção automáticas não estão
confirmadas nesta fase.

O contrato recusa, antes do blob, projeção maior que 1 MiB ou acima dos limites declarados de itens, reservas,
trabalhos e lacunas. Esses limites são guardas de entrada, não promessa de capacidade ou desempenho.

## Resolver falhas

Toda falha da família retorna código estável, mensagem e ação. Siga a ação sem copiar token para argumentos ou
logs. Em geral: confirme o login no host correto, o acesso ao repositório privado e ao projeto, a versão da política
e o estado ativo da inscrição; depois repita. Em concorrência persistente, aguarde a outra escrita terminar e
repita. Não use `force` e não reduza a privacidade para destravar uma publicação.
