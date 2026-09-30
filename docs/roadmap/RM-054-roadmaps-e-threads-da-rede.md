---
id: RM-054
tipo: roadmap
titulo: Roadmaps e threads da rede visíveis a todo agente e runtime
categoria: iniciativa
pai: null
features: [FEAT-032]
owner: Julio
atualizado_em: 2026-09-30T03:09:41+00:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Branch criada
  testes: Aprovados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: b64d2f2
    pr: null
sdlc:
  thread: ork-rm054fatia2
  modo: "#Auto"
  fase: GOAL
  status: aberta
---

# RM-054 — Roadmaps e threads da rede visíveis a todo agente e runtime

> **Em uma frase:** todo agente e runtime que usa o Orkastery enxerga, de qualquer máquina e diretório, o roadmap, as reservas e as threads de cada projeto da pessoa, com a fonte e a hora de cada parte, sem confundir "não li" com "não tem".

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Aprovados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-032](../produto/FEAT-032-roadmap-da-rede.md)
- **Threads:** `ork-rm054roadmap` (fatia 1, mesclada em `b64d2f2`) · `ork-rm054fatia2` (fatia 2)

## Problema e resultado

- **Público e problema:** o dono e todo agente que responde por ele. Um host fora de um clone (o gateway do OpenClaw, um cron) não enxerga `ork/fabrica-estado` nem `ork/roadmap-reservas`, e a saída não dizia qual projeto foi lido nem o que ficou de fora.
- **Evidência (Telegram, 29/09/2026, srvjcp86):** a pergunta "orkastery maestro - qual é o status report do roadmap do orkastery agora?" voltou o panorama de `~/.openclaw/workspace` (projeto `workspace`, 0 threads), com "o roadmap está vazio" e "nenhuma outra máquina publicou". O roadmap tinha 13 itens reservados, e a `vps`, 10 threads ativas.
- **Causas verificadas:**
  - a extensão do OpenClaw publicada no npm (0.4.3) não tem tool de roadmap;
  - as tools chamam o `ork` sem projeto-alvo, e o núcleo resolve pelo cwd (RM-052);
  - as branches de estado vivem no remoto de um repositório, e fora de um clone ninguém as lê;
  - a saída não dizia o que não foi consultado, e o modelo leu "0 threads neste projeto" como "roadmap vazio";
  - achado na prova ao vivo da fatia 2: com `tools.profile: coding` (o padrão do OpenClaw e o config da srvjcp86), nenhuma tool `ork_*` chegava ao modelo, porque o manifesto não as declarava no perfil; o modelo ia ao `ork` 0.4.3 pelo shell.
- **Objetivo:** a pergunta pelo roadmap de um projeto, feita de qualquer lugar da rede, volta o roadmap real, com as threads de todas as máquinas e a fonte e a hora de cada parte.
- **Hipótese:** Se o núcleo juntar, de qualquer diretório, o roadmap, as reservas e as threads por máquina de cada projeto, lendo a forja quando não há clone e declarando cada lacuna, então nenhum agente conclui "roadmap vazio" a partir de uma fonte que não leu, porque a resposta cita a fonte de cada parte e diz o que não foi consultado.
- **Métrica principal:** fontes não lidas que aparecem como lacuna tipada. Linha de base: 0% (o incidente de 29/09). Meta: 100%. Janela: cada pedido de status do roadmap pelos canais, a partir da fatia 2. Fonte: os testes `rede: lacuna` e `rede: incidente`, e na fatia 2 `rede nos hosts: incidente` e a prova ao vivo pelo OpenClaw.
- **Métricas de proteção:**
  - nenhum token ou credencial na saída nem em argumento de processo, e nenhuma escrita na forja;
  - o `ork roadmap status` local igual ao de antes;
  - leitura sem clone em até 5 s por projeto (de 1,0 s a 1,7 s medidos em 29/09 para `orkastery/orkastery`).

## Escopo e validação

- **Fatia 1, o agregador no núcleo (thread `ork-rm054roadmap`):**
  - `ork network roadmap`, com `--projeto`, `--json` e `--sem-remoto`: para cada projeto, o status report do RM-048 com as threads de todas as máquinas, as reservas, as threads por máquina com a idade da batida, a fonte e a hora de cada parte e as lacunas tipadas, no contrato `ork.network-roadmap/v1`;
  - leitura sem clone: roadmap, reservas e fábrica direto da forja, só consulta (`gh api graphql` numa chamada; GitLab pela mesma interface).
- **Fatia 2, os hosts (thread `ork-rm054fatia2`):**
  - `ork_network_roadmap` no OpenClaw, no MCP (Claude Code e Codex), no Hermes e nas entradas do Claude Code e do Codex, cada uma uma chamada ao núcleo, com o `projeto` da RM-052; a descrição manda transportar o texto como vem e nunca concluir "roadmap vazio" nem "nenhuma máquina publicou" de lacuna;
  - o status do roadmap nos hosts vem da rede; `ork_roadmap_status` fica como o relatório só desta máquina e aponta para ela;
  - a frase "orkastery maestro" sem projeto nomeado oferece o panorama da rede, nas entradas dos hosts e na própria recusa `projeto.escolha` do núcleo;
  - o núcleo em modo host (`ORK_PROJETO_EXPLICITO=1`): o `--projeto` do `network` é nome registrado ou `github:`/`gitlab:`, e o projeto do cwd do gateway só entra pelo registro; em modo fixado, o MCP lê só o projeto servido, em todas as máquinas dele;
  - o critério de aceite do incidente: da srvjcp86, pelo OpenClaw, "qual é o status report do roadmap do orkastery agora?" devolve o roadmap real do `orkastery/orkastery` com as threads da `vps` e da `srvjcp86`, citando a fonte e o horário de cada parte.
- **Lacunas tipadas da fatia 2, que dependem da RM-053 na `main` (fatia 3):**
  - `ork_network_status` nos hosts: o núcleo desta base não expõe `ork network status`;
  - a rede por pessoa (`ork.rede-status/v1`) como fonte de projetos e máquinas: o panorama segue dizendo "rede por pessoa (RM-053): não lida";
  - o localizador de binário da forja para o PATH curto do gateway e do cron (o `gh` desta máquina está em `~/.local/bin`);
  - o leitor do GitLab provado com `glab` de verdade (`glab` não está instalado na srvjcp86).
- **Fora de escopo:** publicar no npm (ato do mantenedor, RM-049); o `--projeto` global e `ORK_PROJETO` (RM-052); a casa da rede e `ork network entrar`, `status` e `sair` (RM-053); rede de equipe (RM-026).
- **Achado extra, registrado e não implementado aqui:** o despacho que falha por impedimento que só o dono resolve vira só `phase_dispatch_failed`, sem HITL nem "espera você" no board e na fábrica. Evidência: ledger da `ork-rm054roadmap`, 29/09 16:32 UTC, `claude --bg` recusado com "Workspace not trusted".
- **Critérios de aceite da fatia 1, cada um com o teste que prova:**
  - roadmap, reservas e threads das duas máquinas, com fonte e hora: `rede: agrega`;
  - projeto sem clone lido da forja numa consulta, só leitura: `rede: sem clone`;
  - máquina sem batida, forja inacessível, cópia local e branch que não existe viram lacuna, nunca "vazio": `rede: lacuna`;
  - de um cwd com manifesto de outro projeto, a resposta é do projeto pedido: `rede: incidente`;
  - o CLI e o contrato: `rede: CLI`, todos em `core/test/network-roadmap.test.ts`;
  - identidade da forja, GitHub, GitLab e erro sem segredo: `core/test/forja.test.ts`.
- **Prova ao vivo (29/09/2026, srvjcp86):** `ork network roadmap --projeto github:orkastery/orkastery`, de um diretório sem manifesto, devolveu o roadmap da `main`, as 16 reservas e as threads da `vps` (10) e da `srvjcp86` (4), com a fonte e a hora de cada parte.
- **Critérios de aceite da fatia 2, cada um com o teste que prova** (`core/test/network-roadmap-hosts.test.ts`, salvo o OpenClaw):
  - modo host: caminho e URL recusam com saída 4 sem ecoar o pedido, e o cwd fora do registro vai ao não consultado: `rede nos hosts: host`;
  - sem projeto, a recusa `projeto.escolha` oferece o panorama da rede: `rede nos hosts: escolha`;
  - MCP com o projeto servido em todas as máquinas, sem revelar os outros projetos: `rede nos hosts: MCP`;
  - OpenClaw, a tool, o `projeto` com a forja e as descrições: `adapters/openclaw/test/network-roadmap.test.mjs`;
  - Hermes, o wrapper, o manifesto e a skill: `rede nos hosts: Hermes`;
  - Claude Code e Codex, a rota e a frase sem projeto: `rede nos hosts: Claude Code`;
  - o incidente pela extensão do OpenClaw com o `ork` real, sem LLM, com as duas máquinas e a hora de cada fonte: `rede nos hosts: incidente`.
- **Prova ao vivo da fatia 2 (30/09/2026, srvjcp86):** num turno isolado do OpenClaw 2026.9.4 (`openclaw agent exec` com config e state temporários, o modelo do gateway, `openrouter/~deepseek/deepseek-flash-latest`, e o perfil `coding` do `~/.openclaw/openclaw.json`), com a extensão desta worktree numa cópia temporária, "orkastery maestro - qual é o status report do roadmap do orkastery agora?" fez uma chamada, `ork_network_roadmap` com `projeto: orkastery`, e voltou o roadmap da `origin/main`, as threads da `srvjcp86` (5, estado local) e da `vps` (8, retrato de 30/09 03:15), as reservas e a fonte e a hora de cada parte, sem lacuna. Sem a declaração de perfil no manifesto, nenhuma tool `ork_*` chegava ao modelo, e ele respondeu pelo shell. A extensão global em `~/.openclaw/extensions` e o gateway não foram tocados.
- **Para valer no Telegram (ato do dono, depois do merge e da publicação da RM-049):** `npm i -g @orkastery/cli@<versão nova> && ork adapter install openclaw --dir ~/.openclaw && openclaw daemon restart`. Volta: `npm i -g @orkastery/cli@0.4.3 && ork adapter install openclaw --dir ~/.openclaw && openclaw daemon restart`.

## Plano e decisões

- **Prioridade:** 3 de 3 no pedido de 29/09/2026 (RM-052, RM-053, RM-054); consome as outras duas.
- **Horizonte:** fatia 1 mesclada em 30/09; fatia 2 em PR; fatia 3 (as lacunas acima) depois da RM-053 na `main`.
- **Dependências:** RM-048 (formato do status report), RM-052 (registro `ork.projetos/v1`, lido aqui), RM-053 (vocabulário das lacunas e `ork.rede-status/v1`), RM-025 (fonte, frescor e lacuna do pacote citável), RM-032 (ativação por host, na fatia 2) e RM-049 (a publicação no npm destrava o uso fora do checkout).
- **Decisões da fatia 1** (ledger da `ork-rm054roadmap`, tomadas pelo agente no #Auto em 29/09/2026, revisão do dono pendente):
  - o roadmap da rede vem de `docs/roadmap` da base remota, e não da árvore de trabalho: toda máquina vê o mesmo roadmap;
  - com clone, esta máquina entra pelo estado local; as outras, pelo retrato em `ork/fabrica-estado`;
  - "Entregue hoje" na rede sai do merge `ship(<thread>)` do dia na base, ligado ao item por `sdlc.thread`, pelo item da thread ou pela reserva;
  - máquina sem batida é a que passa de 3 h sem retrato, o limiar da RM-053;
  - sem clone, o GitHub responde numa consulta GraphQL; o GitLab usa a mesma interface, provado só com resposta simulada;
  - `--projeto` aceita `github:dono/repo`, `gitlab:grupo/repo`, URL, nome conhecido ou a raiz do clone escrita como caminho; nome sozinho é sempre nome, e ambíguo ou desconhecido recusa com os candidatos e a saída 4 da RM-052;
  - o fuso do dono do projeto consultado (`owner.timezone`) vale para o "hoje" e os horários do panorama;
  - a prova ao vivo contra a forja fica fora do bundle do CI, porque depende de rede e de login.
- **Decisões da fatia 2** (ledger da `ork-rm054fatia2`, D-G1 a D-G9, tomadas pelo agente no #Auto em 30/09/2026, revisão do dono pendente):
  - sem `ork_network_status` enquanto o núcleo não tiver `ork network status` (RM-053);
  - o status do roadmap nos hosts vem de `ork_network_roadmap`; `ork_roadmap_status` é só desta máquina;
  - a frase sem projeto leva ao panorama da rede, e a oferta também sai do núcleo, na recusa `projeto.escolha` e `projeto.nenhum`;
  - no host, `projeto` é o nome registrado ou `github:`/`gitlab:`; caminho e URL recusam no host e no núcleo, e a forja só vale em `github.com`, `gitlab.com` ou no host de um projeto registrado (GO-FIX 1 do CHECK);
  - o "Não lido" do núcleo aponta `ork network roadmap`, e o manifesto do OpenClaw declara só `ork_network_roadmap` nos perfis `coding` e `messaging` (`toolMetadata`), as duas achadas na prova ao vivo;
  - no MCP, só o projeto servido, sem ler o registro nem revelar os outros projetos;
  - em modo host, o projeto do cwd do gateway só entra pelo registro;
  - o aceite ao vivo usa cópia temporária da extensão e turno isolado, sem tocar na extensão global nem no gateway;
  - entrega por PR em rascunho; o merge, o `ork ship registrar-pr` e o MASTER ficam com o mantenedor;
  - a `main` de 30/09 (RM-049) entrou na branch antes do GO, porque o catálogo ganhou cópia derivada em `marketplaces/`.
- **Achado de segurança pré-existente, para uma próxima thread:** `ork fabrica` e `ork roadmap reservas` passam o `fabrica.remoto` do manifesto ao `git fetch` sem validar; um valor que comece com `-` vira opção do git. O `ork network roadmap` valida o remoto e a `worktree.base_branch`, e o `git log` de `entregasNaBase` passou a receber a ref qualificada (`refs/...`), que nunca vira opção; o helper `branch-de-estado.ts` ainda não valida o remoto.
- **Riscos e mitigação:**
  - o esquema do GitLab sem prova real: parse estrito, e a divergência vira `forja.resposta-invalida`;
  - colisão com o `--projeto` global da RM-052 e com a família `network` da RM-053 no CLI: fiação mínima, e quem entra depois resolve o conflito.

## Estado com evidências

- 29/09/2026: fatia 1 na thread `ork-rm054roadmap` (#Auto). A revisão independente do CHECK achou quatro defeitos maiores e cinco menores (thread corrompida derrubava o comando, pasta de mesmo nome tomava o `--projeto`, página não-ASCII sumia, `fabrica.remoto` virava opção do git); os três GO-FIX os corrigem, cada um com teste que falhava antes.
- A rodada 2 da revisão resolveu seis achados e achou a mesma injeção pela `worktree.base_branch`, que o GO-FIX 4 fecha junto com os três achados parciais; a rodada 3 confirmou tudo e achou dois menores (a ref do `git log` e a espera do dono igual nas duas seções), fechados no GO-FIX 5.
- Testes focados verdes: `network-roadmap.test.js` 17 de 17, `forja.test.js` 5 de 5, e o RM-048 sem regressão.
- 30/09/2026: fatia 1 mesclada pelo PR 25 (`b64d2f2`); fatia 2 na thread `ork-rm054fatia2` (#Auto). A prova ao vivo achou duas causas a mais (o perfil `coding` escondia as tools, e o "Não lido" apontava as fontes separadas), fechadas na T4b e na T2b. A revisão independente do CHECK achou um defeito maior (no host, a forja aceitava qualquer host, e o `gh`/`glab` falaria com o servidor pedido pelo texto do modelo) e um menor (um assert sempre verdadeiro), fechados no GO-FIX 1 com testes que reprovam o código de antes.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-09-30 | Julio |
| Documentação | Em revisão | — | 2026-09-30 | Julio |
| Código | Branch criada | commit `b64d2f2` | 2026-09-30 | Julio |
| Testes | Aprovados | — | 2026-09-30 | Julio |
| Deploy | Não implantado | — | 2026-09-30 | Julio |
| Exposição | Flag desligada | — | 2026-09-30 | Julio |
| Habilitação | Pendente | — | 2026-09-30 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente no modo #Auto da thread; revisão e decisão final: Julio.
- **Próxima ação:** revisar e mesclar o PR da fatia 2, publicar a extensão (RM-049) e reinstalar a do gateway; depois, a fatia 3 com a RM-053 na `main`; responsável: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-29 | proposto, com a fatia 1 aberta | incidente do Telegram de 29/09; thread `ork-rm054roadmap` | Julio |
| 2026-09-29 | limiar de batida de 2 h para 3 h | alinhar ao vocabulário publicado pela RM-053 | Claude (agente, #Auto), revisão de Julio pendente |
| 2026-09-30 | fatia 1 mesclada; fatia 2 aberta com as tools dos hosts | PR 25; thread `ork-rm054fatia2` | Julio |
| 2026-09-30 | `ork_network_status` e a rede por pessoa passam para a fatia 3 | a RM-053 não está na `main`; D-G1 no ledger da `ork-rm054fatia2` | Claude (agente, #Auto), revisão de Julio pendente |
