# ADR-001 — Onde mora o estado da rede de uma pessoa

> **Em uma frase:** a rede de cada pessoa mora num repositório privado dela na forja, `<usuario>/orkastery-network`, com um arquivo por máquina gravado por push atômico sem força; a branch `ork/fabrica-estado` de cada projeto continua lida durante a migração.

- **Estado:** aceita · decisão autônoma no modo `#Auto`, a ratificar pelo dono
- **Data:** 2026-09-29 · **Decisor:** agente da thread `ork-rm053network`, por delegação de Julio · **Ledger:** evento `59c6859d` da thread
- **Item do roadmap:** RM-053, Orkastery Network · **Substitui:** nada
- **Relacionados:** [RM-047](../../roadmap/RM-047-fabrica-em-varias-maquinas.md), [FEAT-027](../../produto/FEAT-027-fabrica-compartilhada.md), [RM-040](../../roadmap/RM-040-estado-de-conta-compartilhado.md), [RM-026](../../roadmap/RM-026-workspace-empresarial.md)

## Contexto

- Em 29/09/2026, perguntado pelo Telegram sobre o roadmap do orkastery, o OpenClaw respondeu com o panorama de `~/.openclaw/workspace` e concluiu "outras máquinas: nenhuma publicou ainda". A vps tinha 10 threads ativas.
- A causa estrutural: o estado das máquinas (RM-047) vive na branch `ork/fabrica-estado` do remoto de **um** repositório. Fora daquele clone, não há o que ler.
- A Orkastery Network é o conjunto das máquinas em que uma pessoa entrou no Orkastery e autenticou a forja (GitHub ou GitLab). Todo agente, em qualquer máquina dela, precisa enxergar o conjunto.
- O retrato de uma máquina leva hostname, runtimes, hosts e caminhos locais dos projetos: dado pessoal, que não cabe em lugar público.

## Critérios

Os seis primeiros vêm do pedido do dono; os dois últimos vêm do incidente e do conteúdo do retrato.

| # | Critério |
| --- | --- |
| C1 | Funciona só com `gh` ou `glab` autenticados |
| C2 | Push atômico, sem força |
| C3 | Sem servidor próprio |
| C4 | Sem segredo em lugar nenhum |
| C5 | Auditável por git |
| C6 | Sobrevive à máquina offline |
| C7 | Legível de qualquer diretório, sem clone de projeto |
| C8 | Privado de verdade, conferível na forja |

## Opções consideradas

- **A. Repositório privado por pessoa na forja:** `<usuario>/orkastery-network`, branch `main`, um arquivo por máquina.
- **B. Branch em cada repositório, agregada:** o modelo atual da RM-047 (`ork/fabrica-estado`), lido projeto a projeto.
- **C. Gist ou snippet:** um gist no GitHub ou um snippet no GitLab por pessoa, com um arquivo por máquina.
- **D. Servidor ou banco próprio (OrkMind):** descartada de saída pelo C3.

## Comparação

| Critério | A. Repositório privado | B. Branch por repositório | C. Gist ou snippet |
| --- | --- | --- | --- |
| C1 | sim: `gh api` e `glab api`, e o git autentica pelo helper da própria CLI | sim, mas exige permissão de push em cada repositório | sim |
| C2 | sim: commit sobre a ponta lida; push recusado relê e tenta de novo (o mecanismo da RM-047) | sim | parcial: o gist é um repositório git, mas a API de edição é "o último vence", e o snippet não segue o mesmo modelo |
| C3 | sim | sim | sim |
| C4 | sim | sim | sim |
| C5 | sim: um commit por publicação, com a máquina na mensagem | sim | parcial: revisões sem mensagem |
| C6 | sim: o último retrato fica, com a hora da batida | sim | sim |
| C7 | sim: um repositório por pessoa, achado pelo login | **não**: exige saber quais repositórios existem e ler cada remoto | sim |
| C8 | sim: a visibilidade é conferida na forja antes de cada publicação | **não**: o remoto do projeto pode ser público, como o `orkastery/orkastery` | **não**: gist "secreto" é só não listado; quem tem o link lê |

## Decisão

Opção **A**, com estas regras:

- **Casa:** `<usuario>/orkastery-network` na forja em que a pessoa entrou; `--forja` e `--repositorio` trocam a casa.
- **Layout:** branch `main`, `maquinas/<maquina>.json` (contrato `ork.rede-maquina/v1`) e `REDE.md`, o índice legível que quem publica regenera.
- **Gravação:** índice temporário, `commit-tree` sobre a ponta lida e push sem força, num cache bare em `~/.orkastery/rede/`, fora de qualquer clone de projeto. Push recusado relê a ponta.
- **Identidade:** só o login, lido de `gh api user` ou `glab api user`. O git autentica pelo helper de credencial da própria forja, configurado só no cache da rede; o `ork` nunca lê token.
- **Privacidade:** publicar exige o repositório privado, conferido na forja antes de cada publicação. Repositório público recusa com `rede.repositorio-publico`.
- **Criação:** a primeira máquina que roda `ork network entrar` cria o repositório privado. Publicação em segundo plano nunca cria nada.
- **Conteúdo:** lista de permissão (nome, hostname, forjas, runtimes, hosts, projetos, versão do `ork` e batida) e varredura de segredo antes do push, que recusa a publicação inteira.

## Consequências

- **Boas:** qualquer máquina da pessoa lê a rede de qualquer diretório; a privacidade é verificável; a história de cada retrato está no git; nada de servidor novo.
- **Custos:** um repositório a mais na conta da pessoa; a primeira entrada exige o escopo de criar repositório (`repo` no GitHub, `api` no GitLab); cada publicação faz uma chamada à API da forja para conferir a visibilidade.
- **Limite honesto:** todas as máquinas usam a mesma identidade na forja, que não distingue máquinas. A regra "cada máquina só escreve o próprio retrato" é garantida pelo cliente (guarda no código e leitura que ignora retrato trocado) e auditada pelo git. Não é ACL da forja.
- **GitLab:** a interface é a mesma do GitHub e está provada com `glab` simulado; o piloto com GitLab real fica declarado no item.

## Migração da fábrica

- A fábrica da RM-047 não muda: `ork/fabrica-estado` continua gravada e lida.
- Máquina que já fez `ork fabrica entrar` é membro da rede sem refazer nada: a adesão é herdada enquanto não houver `~/.orkastery/rede.json`.
- `ork network status` também lê `ork/fabrica-estado` dos projetos conhecidos; máquina que só aparece lá entra como membro pela fábrica, até publicar na rede.
- A regra BR-027-02 continua: nada de caminho local na branch da fábrica. Caminho local só vai ao repositório privado da rede.

## Fora desta decisão

- A rede de equipe (RM-026): outra casa, com acesso por pessoa.
- Contas e credenciais (RM-040): continuam locais; a rede não carrega perfil nem login.
- Roadmaps, reservas e threads da rede: são da RM-054, que lê esta casa pelo contrato `ork.rede-status/v1`.

## Gatilhos para revisar

- O dono quer a rede de equipe, com mais de uma pessoa no mesmo repositório.
- Uma pessoa passa de 50 máquinas: o índice e o fetch completo deixam de ser baratos.
- O repositório da rede aparece público: a publicação para sozinha, e esta decisão volta à mesa.
