---
id: FEAT-031
tipo: feature
titulo: Orkastery Network, a rede das máquinas de uma pessoa
estado: em desenvolvimento
pai: MOD-01
roadmap: [RM-053]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-30T02:33:06-03:00
versao: ork/ork-rm053network-full@1295214
fontes:
  codigo:
    - core/src/rede.ts
    - core/src/rede-adesao.ts
    - core/src/rede-forja.ts
    - core/src/rede-projetos.ts
    - core/src/rede-status.ts
  testes:
    - core/test/rede.test.ts
  docs:
    - docs/guias/varias-maquinas.md
    - docs/conceitos/decisoes/ADR-001-estado-da-rede.md
    - docs/referencia/contratos/rede-rm053.md
  simbolos:
    - core/src/rede.ts#entrarNaRede
    - core/src/rede.ts#publicarRede
    - core/src/rede.ts#sairDaRede
    - core/src/rede.ts#exigirRetratoSeguro
    - core/src/rede.ts#exigirSoOProprioRetrato
    - core/src/rede.ts#normalizarRetrato
    - core/src/rede-adesao.ts#adesaoDaRede
    - core/src/rede-adesao.ts#idDaMaquina
    - core/src/rede-forja.ts#forjaPorNome
    - core/src/rede-forja.ts#comGitIsolado
    - core/src/rede-projetos.ts#projetosConhecidos
    - core/src/rede-status.ts#lerRede
  contratos:
    - ork.rede/v1
    - ork.rede-maquina/v1
    - ork.rede-status/v1
  comandos:
    - ork network status
    - ork network entrar
    - ork network publicar
    - ork network sair
---

# FEAT-031 — Orkastery Network, a rede das máquinas de uma pessoa

> **Em uma frase:** cada máquina publica um retrato sem segredo num repositório privado da pessoa na forja, e `ork network status` mostra todas, de qualquer diretório, com a fonte e as lacunas.

- **Estado:** em desenvolvimento · **Verificado em:** 2026-09-30 · **Versão:** `ork/ork-rm053network-full@1295214`
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-01](MOD-01-conducao-de-threads.md)
- **Roadmap:** [RM-053](../roadmap/RM-053-orkastery-network.md) · **Decisão:** [ADR-001](../conceitos/decisoes/ADR-001-estado-da-rede.md) · **Contratos:** [rede-rm053](../referencia/contratos/rede-rm053.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** entrar na rede com um nome de máquina; ver as máquinas da pessoa de qualquer diretório; publicar o retrato agora; sair.
- **Pré-condições e gatilho:** a CLI da forja (`gh` ou `glab`) com login nesta máquina; para publicar, a máquina é membro (entrou, ou fez `ork fabrica entrar`).
- **Fluxo principal:**

  1. `ork network entrar --maquina pc-casa` confere a casa `<usuario>/orkastery-network` na forja, cria o repositório privado quando falta e é do próprio login, publica o primeiro retrato e só então grava o nome e a adesão em `~/.orkastery/`.
  2. Depois, a batida do pulse (depois da entrega ao dono) e os eventos de thread publicam o retrato em segundo plano: no máximo uma tentativa a cada 14 minutos, e retrato igual só de hora em hora, sem chamar a forja nesse meio tempo.
  3. `ork network status` lê a casa e a `ork/fabrica-estado` dos projetos conhecidos e mostra cada máquina, com a batida, os runtimes, os hosts e os projetos.

- **Alternativas, erros e recuperação:**
  - sem CLI de forja, sem login ou sem repositório: `status` responde com a lacuna tipada; `entrar` e `publicar` recusam com `rede.sem-forja` ou `rede.sem-repositorio`;
  - repositório público ou `internal`: nada é publicado (`rede.repositorio-publico`), e o `status` mostra a lacuna;
  - URL da casa sem https (GitLab próprio servido por http): nada é publicado (`rede.sem-https`), e o `status` mostra a lacuna `rede.sem-leitura` e só a última cópia local;
  - nome em uso por outra instalação: `rede.nome-em-uso`; `ork network entrar --forcar` toma o nome, e o commit registra;
  - `entrar` que falha (inclusive `rede.ocupado`) não grava adesão nem nome;
  - sem rede: o `status` mostra a última cópia e diz que é cópia; `--sem-remoto` nem tenta ler;
  - push recusado: relê a ponta e grava de novo, até cinco vezes;
  - publicação em segundo plano que falhou fica em `~/.orkastery/rede/rede.log`.
- **Pós-condições:** a casa tem um `maquinas/<maquina>.json` por máquina, o `REDE.md` e um commit por publicação, com a máquina como autor e na mensagem.
- **Regras de negócio:**
  - BR-031-01: a adesão é da máquina, explícita em `rede.json` ou herdada de `ork fabrica entrar`; `ork network sair` vence a herança; o manifesto do projeto não inscreve ninguém.
  - BR-031-02: publicar exige a casa privada (visibilidade `private`), conferida na forja antes de cada publicação; publicação em segundo plano nunca cria repositório.
  - BR-031-03: o retrato é uma lista de permissão. Campo que o núcleo monta com cara de segredo recusa a publicação inteira; projeto (que vem do registro, do cwd ou do último retrato) com cara de segredo, ou com texto que o leitor recusa (caractere invisível, nome acima de 80), fica fora sozinho (com aviso quando vem do diretório atual; o registro e o último retrato o descartam na leitura): o escritor usa o mesmo predicado de projeto do leitor. O remoto de projeto é montado de partes validadas, nunca copiado. O erro e o aviso dizem o padrão e o campo, nunca o valor.
  - BR-031-04: cada máquina só escreve o próprio retrato, identificado pelo nome saneado e pelo `id` aleatório da instalação (`~/.orkastery/maquina-id`); retrato com o nome de outra máquina, malformado ou com nome de arquivo fora do padrão é ignorado na leitura e vira lacuna; o nome tomado por outra instalação vira a lacuna `maquina.nome-em-uso`, e o retrato de outra instalação que esta versão não lê continua prendendo o nome quando tem o cabeçalho do contrato.
  - BR-031-05: lacuna nunca vira lista vazia; a leitura declara a fonte, o horário e o que não consultou (roadmap, reservas, threads); máquina vista só na fábrica não é dada como membro.
  - BR-031-06: todo git da rede roda isolado do ambiente de quem chamou: sem as variáveis que redirecionam o repositório, sem prompt, em inglês e com autor e committer fixos na máquina.
  - BR-031-07: o escritor publica o que o leitor aceita (mesmas regras antes do push), e o leitor ignora item de host ou forja que não conhece: versão nova não some para quem não atualizou.
  - BR-031-08: nada que o terminal executa ou que ninguém vê (ESC, BEL, bidi, largura zero; fora o ZWJ e os seletores que montam emoji) passa pela rede: o leitor recusa o retrato que o tem, o texto do status põe cada valor numa linha só e sem eles, o JSON os escreve como `\uXXXX` e o `REDE.md` escapa o Markdown. A casa só fala por HTTPS.
- **Critérios de aceite e testes:** Dadas duas máquinas com a forja simulada, quando cada uma entra e publica, então o `status` de uma, de fora de qualquer clone, mostra as duas, e nenhum blob nem commit da casa tem token, credencial, caminho de credencial, e-mail ou dado de conta paga (`core/test/rede.test.ts`).
- **Interface e acessibilidade:** texto em linhas curtas, com a fonte e o que não foi lido no topo e as lacunas no fim; `ork network status --json` com o contrato `ork.rede-status/v1` para agentes.

## Dados e contratos

- **Entidades e campos:**
  - `~/.orkastery/rede.json` (`ork.rede/v1`): adesão e casa;
  - `~/.orkastery/maquina-id`: o identificador desta instalação, fora da pasta de cache (aleatório quando criado; sem hard link, ou na troca do arquivo ruim, aleatório numa reserva `maquina-id.reserva/` ou `maquina-id.troca-<chave>/`, igual para todo host que divide a pasta; derivado do arquivo ruim, da pasta e do boot só se a reserva falhar);
  - `maquinas/<maquina>.json` (`ork.rede-maquina/v1`): máquina, `id`, hostname, forjas com o login, runtimes e hosts com versão, projetos com remoto sem credencial e caminho, versão do `ork` e batida;
  - `ork network status --json` (`ork.rede-status/v1`): casa, esta máquina, fontes, membros, lacunas e o que não foi consultado.
- **APIs e endpoints:** a API da forja pela CLI dela, sempre com o host da casa: `gh api --hostname` e `glab api --hostname`; o git por HTTPS, autenticado pelo helper da própria CLI.
- **Eventos e jobs:** a batida do pulse (cron de 15 minutos) e os eventos de thread; nada novo no ledger das threads.

## Operação e controle

- **Configuração e ambientes:** `ork network entrar`, `--forja github|gitlab`, `--repositorio` e `--forcar`; `ORK_MAQUINA` vale na primeira entrada e fica gravado; `ORK_REDE_PUBLICAR=0` desliga a publicação automática; `ORK_BINARIOS_EXTRA` troca as pastas extras de binários.
- **Observabilidade:** `ork network status`, o `REDE.md` da casa, `~/.orkastery/rede/rede.log` e, desde a fatia 2, a linha `rede` do `ork doctor`, com a última batida e a última falha.
- **Acesso, privacidade e conformidade:** casa privada da pessoa; nenhum token é lido pelo `ork`; hostname e caminhos locais só vão para a casa privada, nunca para a branch da fábrica (BR-027-02 continua).
- **Dependências e rollback:** depende da CLI da forja e do git. Rollback: `ork network sair` em cada máquina; apagar o repositório `orkastery-network` zera a rede sem afetar projeto nenhum.
- **Código, PR, testes e release:** `core/src/rede*.ts`, `core/test/rede.test.ts`; PR e release a registrar no RM-053.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-29 | página criada com a fatia 1 da RM-053 | Claude (agente) / Julio, revisão pendente | RM-053, ADR-001 |
| 2026-09-29 | renumerada de FEAT-030 para FEAT-031 (a RM-052 usa o 030) e revista com o GO-FIX 1 do CHECK 1 | Claude (agente) / Julio, revisão pendente | parecer do CHECK 1 da thread `ork-rm053network` |
| 2026-09-29 | revista com o GO-FIX 2: contrato igual no escritor e no leitor, `id` fora do cache, nome tomado visível | Claude (agente) / Julio, revisão pendente | parecer do CHECK 2 da thread `ork-rm053network` |
| 2026-09-29 | revista com o GO-FIX 3: remoto montado de partes validadas | Claude (agente) / Julio, revisão pendente | parecer do CHECK 3 da thread `ork-rm053network` |
| 2026-09-30 | revista com o GO-FIX 4: SSH sem `?` nem `#`, regra única de nome, texto sem invisíveis, casa só por HTTPS (BR-031-08) | Claude (agente) / Julio, revisão pendente | parecer do CHECK 4 da thread `ork-rm053network` |
| 2026-09-30 | revista com o GO-FIX 5: o escritor usa o predicado de projeto do leitor, o `id` com cabeçalho prende o nome, cada valor do texto numa linha | Claude (agente) / Julio, revisão pendente | parecer do CHECK 5 da thread `ork-rm053network` |
| 2026-09-30 | revista com o GO-FIX 6: invisível pelas classes do Unicode, nome sem `://`, o id derivado descrito | Claude (agente) / Julio, revisão pendente | parecer do CHECK 6 da thread `ork-rm053network` |
| 2026-09-30 | revista com o GO-FIX 7: o aviso só do diretório atual, a batida ilegível | Claude (agente) / Julio, revisão pendente | parecer do CHECK 7 da thread `ork-rm053network` |
| 2026-10-03 | o `id` sem hard link e o da troca do arquivo ruim saem de uma reserva igual entre hosts (X6) | Claude (agente) / Julio, revisão pendente | decisões no ledger da thread `ork-rm053iddains` |
