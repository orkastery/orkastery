---
id: RM-052
tipo: roadmap
titulo: Projeto-alvo explícito e resposta honesta nos hosts
categoria: melhoria
pai: null
features: [FEAT-030, FEAT-020, FEAT-014, FEAT-027]
owner: Julio
atualizado_em: 2026-10-10T04:05:00-03:00
estado:
  ciclo: Em validação
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Parcial
  habilitacao: Em andamento
evidencias:
  codigo:
    commit: a24a187
    pr: 24
  testes:
    ci: verde no push do merge (run 36659111443) e no da v0.5.0 (run 36815186450)
  deploy:
    release: v0.5.0, @orkastery/cli 0.5.0 no npm
    gateway: Extensão OpenClaw 0.5.0+ instalada, conforme confirmação da condução; piloto no Telegram pendente
sdlc:
  thread: ork-rm052projet2
  modo: "#Auto"
  fase: PLAN
  status: aberta
---

# RM-052 — Projeto-alvo explícito e resposta honesta nos hosts

> **Em uma frase:** todo comando e toda tool `ork_*` consultam o projeto que o dono pediu, nunca o do diretório do gateway, e toda resposta diz qual projeto leu e o que não leu, para nenhum canal relatar um projeto como se fosse outro.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em validação | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** o dono, que pergunta pelo Telegram ou pelo terminal sobre um projeto específico, e os agentes dos hosts (OpenClaw, Hermes, Claude Code, Codex), que respondem. Hoje o `ork` resolve o projeto pelo diretório do processo, e a resposta não diz qual projeto foi lido.
- **Evidências e fonte (origem: incidente relatado pelo dono, 29/09/2026, máquina do incidente):**
  - no Telegram, "orkastery maestro - qual é o status report do roadmap do orkastery agora?" recebeu o panorama de `~/.openclaw/workspace` (projeto "workspace", 0 threads), com "o roadmap está vazio" e "outras máquinas: nenhuma publicou ainda"; o roadmap tinha 13 itens reservados e a vps conduzia 10 threads;
  - a extensão OpenClaw publicada (0.4.3) não tem tool de roadmap (`~/.openclaw/extensions/orkastery/openclaw.plugin.json`: 23 tools, sem `ork_roadmap_status`);
  - as tools chamavam o `ork` sem projeto, e o núcleo partia do `process.cwd()` (`core/src/manifest.ts`, `acharRaiz` e `carregarManifesto`);
  - reproduzido nesta máquina com o `ork` 0.4.3 no cwd do gateway: `ork board plan` imprime "Nenhuma thread no projeto." sem dizer qual, e `ork board` termina com "Outras maquinas (ork/fabrica-estado, ultima copia local): nenhuma publicou ainda." num projeto que nem remoto tem.
- **Objetivo/OKR:** a pergunta pelo projeto X devolve X, ou a escolha entre os projetos da máquina; nunca Y apresentado como X.
- **Hipótese:** Se o núcleo resolver o projeto por pedido explícito (`--projeto`, `ORK_PROJETO` ou a escolha no host) e toda saída declarar o projeto consultado e o que não foi lido, então nenhum canal relata o roadmap de um projeto como se fosse outro, porque o modelo recebe a escolha ou um cabeçalho que nomeia a fonte, em vez de um panorama anônimo.
- **Métrica principal / linha de base / meta / janela / fonte:** respostas de host sobre um projeto em que o projeto consultado difere do pedido sem que a resposta o declare. Linha de base: 1 (29/09/2026). Meta: zero. Janela: 30 dias depois da publicação da versão com este item. Fonte: revisão do dono das respostas do Telegram e o teste de regressão `core/test/projeto-alvo-incidente.test.ts`.
- **Métricas de proteção:** no terminal, sem `--projeto` e sem `ORK_PROJETO`, nada muda (o diretório atual continua valendo); nenhum argumento de tool aponta o núcleo para um diretório arbitrário; o registro nunca carrega segredo.

## Escopo e validação

- **Incluído:**
  1. **Projeto-alvo no núcleo:** opção global `--projeto <nome|caminho>` e `ORK_PROJETO`, com precedência sobre o `process.cwd()`; registro local `~/.orkastery/projetos.json` (`ork.projetos/v1`, sem segredo), alimentado por `ork init`, `ork thread new` e `ork fabrica entrar`; `ork projetos [--json]`, `ork projetos registrar` e `ork projetos esquecer`. Nome ambíguo ou desconhecido recusa com erro tipado e candidatos, na saída 4.
  2. **Adaptadores:** toda tool `ork_*` do OpenClaw e do MCP aceita `projeto`; o OpenClaw e o Hermes declaram `ORK_PROJETO_EXPLICITO=1`, e sem projeto, com mais de um conhecido, a resposta é a escolha (`projeto.escolha`); o MCP de Claude Code e Codex continua fixado na instalação e recusa outro projeto com `projeto.fora-do-servidor`.
  3. **Honestidade da saída:** `ork maestro`, `ork board`, `ork board plan`, `ork fabrica` e `ork roadmap status`, em texto e JSON, declaram o projeto consultado (nome, raiz, remoto, origem) e o que não foi lido; sem remoto, nunca "nenhuma publicou ainda"; as descrições das tools proíbem concluir o roadmap a partir do board.
  4. **Regressão do incidente:** a tool chamada do cwd de outro projeto nunca relata aquele projeto como o pedido.
- **Fora de escopo:** publicar a versão no npm e reinstalar a extensão OpenClaw (ato do mantenedor, [RM-049](RM-049-lancamento.md)); a rede de máquinas da pessoa (RM-053); o roadmap e as threads da rede (RM-054); a prova viva de ativação por host ([RM-032](RM-032-bootstrap-maestro.md)); o achado extra abaixo.
- **Entregáveis e critérios de aceite:**
  - `--projeto` vence `ORK_PROJETO`, que vence o cwd (`core/test/projeto-alvo-cli.test.ts`);
  - desconhecido e ambíguo recusam com candidatos; o registro é `ork.projetos/v1` sem segredo (`core/test/projeto-alvo.test.ts`);
  - os cinco comandos declaram o projeto consultado e o não lido (`core/test/projeto-alvo-consulta.test.ts`);
  - OpenClaw aceita só nome e repassa `--projeto` (`adapters/openclaw/test/projeto-alvo.test.mjs`); MCP confere o projeto servido (`core/test/projeto-alvo-mcp.test.ts`); Hermes e Claude Code (`core/test/projeto-alvo-hosts.test.ts`);
  - regressão do incidente pela extensão OpenClaw real (`core/test/projeto-alvo-incidente.test.ts`).
- **Fatia 2, o que faltou da resposta honesta (thread `ork-rm052projet2`, 10/10/2026):** a auditoria do código da `main` contra a promessa do item achou quatro lacunas, cada uma reproduzida antes da correção:
  1. **A sessão despachada lê o projeto pelo próprio cwd:** o modo host (`ORK_PROJETO_EXPLICITO=1`) e o `ORK_PROJETO` do gateway iam para a sessão despachada pelo `ork phase run` e para o filho `fabrica publicar`; na worktree da thread, numa máquina com mais de um projeto, todo `ork` da sessão recusava com `projeto.escolha`, ou lia outro projeto. O ambiente da condução passa a levar `ORK_PROJETO` vazio e `ORK_PROJETO_EXPLICITO=0` (codex por cima do ambiente herdado, claude-bg pelo `--settings`).
  2. **`ork roadmap reservas` não diz "nenhum" sem ter lido:** sem remoto, imprimia "Nenhum item do roadmap reservado." sem dizer de qual projeto. Agora abre com o cabeçalho, lê o remoto só quando o projeto o tem e separa lido agora, última cópia local, remoto mudo sem cópia e projeto sem remoto; o JSON ganha `consulta` e `leitura`.
  3. **Toda resposta de projeto declara o projeto consultado:** dez das catorze tools de projeto do OpenClaw respondiam sem nomeá-lo. Todo comando que lê um projeto que o leitor não tem como adivinhar (no host, ou fora do diretório dele) termina com a linha `Projeto consultado: ...` no stderr, salvo se já montou o próprio cabeçalho; no terminal, dentro do projeto, nada muda.
  4. **O Hermes passa o projeto em todo `ork` do terminal:** fora dos wrappers, a skill ensinava o `ork` sem projeto, e o cwd do gateway escolhia.
- **Critérios de aceite da fatia 2, cada um com o teste que prova** (os testes novos reprovam o código da fatia 1, por A/B num clone da base `203084d6`):
  - a sessão despachada e o filho da fábrica (`core/test/projeto-alvo-despacho.test.ts`);
  - as reservas sem remoto, com o remoto mudo, com cópia local e lidas agora, e a cena de 29/09 pelo host (`core/test/projeto-alvo-reservas.test.ts`);
  - a linha no terminal fora do cwd e no host, uma só nos comandos com cabeçalho, e as 22 tools de projeto do OpenClaw real nomeando o projeto (`core/test/projeto-alvo-declaracao.test.ts`);
  - a regra do terminal na skill do Hermes instalada (`core/test/projeto-alvo-hosts.test.ts`).
- **Piloto, medição e critérios de expansão/interrupção:** piloto na máquina do incidente, com a extensão 0.5.0+ já instalada: o dono repete a pergunta de 29/09 no Telegram. Expande se a resposta nomear o orkastery ou pedir a escolha; interrompe se algum canal voltar a responder por um projeto não pedido.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** prioridade 1 das três (RM-052, RM-053, RM-054), por pedido do dono em 29/09/2026: destrava as outras duas, que consomem o registro e a resolução.
- **Horizonte / alvo / previsão / confiança / marcos:** Agora. Marco 1: branch da thread com as oito tarefas e o CHECK; marco 2: merge pelo mantenedor; marco 3: publicação e piloto.
- **Dependências e bloqueios (ID, owner, próxima revisão):**
  - [RM-048](RM-048-hitl-humano-no-centro.md) (`ork roadmap status` e `ork_roadmap_status`), na `main`;
  - [RM-019](RM-019-catalogo-multi-repositorio.md) (portfólio): avaliado e não reutilizado, porque o portfólio é estado de um projeto e não conhece as raízes locais (D1);
  - [RM-032](RM-032-bootstrap-maestro.md): o snapshot do maestro passa a carregar o projeto consultado; a prova viva por host segue na RM-032;
  - RM-053 e RM-054 leem `ork.projetos/v1` e usam os mesmos códigos de recusa ([contrato](../referencia/contratos/projetos-rm052.md)).
- **Premissas / riscos / mitigação:**
  - premissa: um host com registro vazio segue funcionando, porque o projeto do cwd conta como candidato;
  - risco: conflito de merge com RM-053 e RM-054 no `index.ts` e no catálogo do OpenClaw; mitigação: lógica em módulo próprio, nenhuma tool nova, e `network` com `--projeto` próprio;
  - risco: `ork board --json` deixou de ser lista; mitigação: nenhum consumidor no repositório além do teste de contrato, ajustado, e a mudança no CHANGELOG.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** D1 a D10 no ledger da thread `ork-rm052projeto`, decididas pelo agente condutor sob o #Auto do dono em 29/09/2026: registro por máquina (D1), precedência (D2), host sem cwd e saída 4 (D3), só nome no host (D4), MCP fixado (D5), contrato JSON do board (D6), registro que nunca derruba o comando (D7), raiz com `~` (D8), transporte MCP desta sessão (D9) e entrega por PR (D10). Alternativa descartada: resolver pelo `HOME` ou pelo primeiro projeto registrado, que chutaria. Fatia 2: D1 a D9 no ledger da thread `ork-rm052projet2`, decididas pela sessão condutora sob o #Auto em 10/10/2026: escopo (D1), projeto neutro na sessão despachada (D2), a linha no stderr (D3), as reservas (D4), a skill do Hermes (D5), a base na `origin/main` (D6), o GOAL composto no PLAN (D7), a entrega pelo CI no SHA exato (D8) e o estado do item (D9).
- **Achado extra (registrado, não implementado aqui):** despacho que falha por impedimento que só o dono resolve vira apenas `phase_dispatch_failed`, sem HITL e sem "espera você" no board e na fábrica. Evidência: o primeiro despacho desta própria thread (evento `7123c016` do ledger de `ork-rm052projeto`, 29/09 16:32) falhou com "Workspace not trusted. Run `claude` in ... once and accept the trust prompt, then retry." e nada chegou ao dono. Proposta para um item próprio: motivo tipado do impedimento, com pedido HITL e a linha "espera você" até o dono destravar. Virou a [RM-055](RM-055-impedimento-do-dono-vira-hitl.md).
- **Próxima fatia:** medir o piloto no Telegram da máquina do incidente, sob condução do dono. A extensão OpenClaw 0.5.0+ já está instalada no gateway; a prova de ativação do Codex tem acompanhamento próprio na RM-032.

## Estado com evidências

- Na `main` pelo PR #24 (merge `a24a187`), com o CI verde no push do merge (run 36659111443).
- Em produção na versão 0.5.0: tag `v0.5.0` (merge `2418a4e`, PR #36), `@orkastery/cli` 0.5.0 no npm, CI verde no push da versão (run 36815186450).
- A extensão OpenClaw 0.5.0+ já está instalada no gateway, conforme confirmação da condução. A instalação é um fato operacional, sem novo commit do produto; o código segue ancorado no PR #24 (`a24a187`).
- Em validação: falta o dono repetir a pergunta no Telegram da outra máquina e registrar se a resposta nomeia o projeto correto ou pede a escolha. Instalação concluída não é prova do piloto.
- Fatia 2 na branch `ork/ork-rm052projet2-full` (thread `ork-rm052projet2`), entregue por PR com o CI independente no SHA exato. Até o merge dela, o código "Mesclado" do frontmatter é o da fatia 1 (`a24a187`, D9 da fatia 2).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em validação | — | 2026-10-10 | Julio |
| Documentação | Em revisão | — | 2026-10-10 | Julio |
| Código | Mesclado | commit `a24a187` · PR #24 | 2026-10-10 | Julio |
| Testes | Aprovados | ci: verde no push do merge (run 36659111443) e no da v0.5.0 (run 36815186450) | 2026-10-10 | Julio |
| Deploy | Produção | release: v0.5.0, @orkastery/cli 0.5.0 no npm · gateway: Extensão OpenClaw 0.5.0+ instalada, conforme confirmação da condução; piloto no Telegram pendente | 2026-10-10 | Julio |
| Exposição | Parcial | — | 2026-10-10 | Julio |
| Habilitação | Em andamento | — | 2026-10-10 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: agentes do Orkastery · A: Julio · C: — · I: —
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a thread `ork-rm052projeto` (#Auto, claude-code) conduziu GOAL a MASTER; o CHECK independente é o do CI (`ork-verify`), e a decisão final de merge é de Julio. A fatia 2 é da thread `ork-rm052projet2` (#Auto, claude-bg a partir do PLAN, porque a sessão GOAL do codex terminou sem conseguir gravar), com o mesmo CHECK independente do CI.
- **Próxima ação e responsável:** o dono faz o piloto no Telegram da outra máquina e registra o resultado. Merge (PR #24, `a24a187`), publicação e instalação da extensão 0.5.0+ no gateway já aconteceram.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-29 | item criado, com a thread `ork-rm052projeto` reservando o RM-052 | incidente do Telegram de 29/09 e pedido do dono para as três threads | Julio |
| 2026-09-29 | oito tarefas entregues na branch da thread: registro, `--projeto`, cabeçalho honesto, MCP, OpenClaw, Hermes e Claude Code, regressão, docs | thread `ork-rm052projeto`, decisões D1 a D10 no ledger | agente condutor; decisão final de Julio |
| 2026-09-29 | CHECK: GO-FIX de F1 (host só nome), F2 (cópia do cwd) e F3 (suíte isolada); `ork verify` com 47/47 claims e 0 regressões; PR #24 aberto como rascunho | `docs/check.md` da thread e o PR #24 | agente condutor; merge pelo mantenedor |
| 2026-09-29 | mesclado na `main` | PR #24, merge `a24a187` | Julio |
| 2026-10-01 | em produção na versão 0.5.0; o piloto segue em aberto | tag `v0.5.0` (PR #36), `@orkastery/cli` 0.5.0 no npm | Julio |
| 2026-10-03 | Extensão OpenClaw 0.5.0+ instalada; piloto permanece com o dono | Instalação confirmada pela condução; código no PR #24 (`a24a187`), versão 0.5.0 no PR #36 (`2418a4e7`); nenhum resultado de piloto declarado | Codex (agente, #Fast), revisão pendente |
| 2026-10-10 | fatia 2 aberta e entregue por PR: sessão despachada com o projeto neutro, reservas que não dizem "nenhum" sem leitura, a linha "Projeto consultado" em toda resposta de projeto e o Hermes com `--projeto` no terminal | auditoria do código da `main` contra a promessa do item; decisões D1 a D9 no ledger da `ork-rm052projet2` | Claude (agente, #Auto), revisão de Julio pendente |
