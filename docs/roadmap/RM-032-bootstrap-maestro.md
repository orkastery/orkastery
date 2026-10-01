---
id: RM-032
tipo: roadmap
titulo: Bootstrap universal Maestro
categoria: iniciativa
pai: null
features: [FEAT-020]
owner: Julio
atualizado_em: 2026-10-01T05:20:00-03:00
estado:
  ciclo: Disponível
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Parcial
  habilitacao: Em andamento
evidencias:
  codigo:
    commit: 10ca416
    pr: null
sdlc:
  thread: ork-i32bootstrap
  modo: "#Maestro"
  fase: MASTER
  status: fechada
---

# RM-032 — Bootstrap universal Maestro

> **Em uma frase:** `orkastery maestro` mostra o panorama canônico do projeto em qualquer host, com HITL no canal escolhido e paridade de entrada nos quatro hosts.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Disponível | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-020](../produto/FEAT-020-mcp-e-adaptadores.md)
- **Thread:** `ork-i32bootstrap`; fatia de prova automatizável: `ork-rm032ativaca` (01/10/2026)

## Problema e resultado

- **Problema:** cada host tinha uma porta de entrada diferente, e nada provava, por comando, que um host recém-instalado responde `orkastery maestro` com o projeto certo.
- **Evidência:** em 29/09/2026 o dono pediu ao OpenClaw, pelo Telegram, o status report do roadmap do orkastery; a resposta leu o workspace do gateway (projeto "workspace", 0 threads) e concluiu "o roadmap está vazio", com 13 itens reservados e 10 threads ativas na VPS. A RM-052 e a RM-054 corrigiram o projeto-alvo e a fonte do roadmap; faltava a prova de ativação que pega essa classe de erro num host novo.
- **Resultado:** pacote de código com 8 de 12 critérios do GOAL atendidos (19/09/2026) e, desde 01/10/2026, um roteiro que prova a ativação em sessão nova por host, com recibo citável.
- **Hipótese (fatia de 01/10):** Se cada host novo passar por uma prova em sessão nova e não interativa que confere a ferramenta chamada e o projeto lido, então uma instalação que não expõe o Maestro, ou que lê o projeto do diretório, aparece antes de o dono perguntar, porque a conferência julga a chamada e o resultado, não o texto do modelo.
- **Métrica principal / linha de base / meta / janela / fonte:** hosts com prova de ativação aprovada em sessão nova; linha de base 0 de 4 (até 30/09/2026); meta 4 de 4; janela até a publicação dos pacotes; fonte: recibos `ork.prova-ativacao/v1` em [evidencias/RM-032](evidencias/RM-032/). Em 01/10/2026: 2 de 4 aprovados (Claude Code e OpenClaw), 2 sem host na máquina de prova (Hermes, Codex).
- **Métricas de proteção:** os arquivos de configuração global do host (settings e registro de plugins do Claude; `openclaw.json` e a extensão global do OpenClaw) têm o mesmo sha256 antes e depois; o estado do CLI do Claude (`.claude.json`) não ganha aceite para a raiz temporária; o log do OpenClaw da cópia fica na raiz da prova, fora de `/tmp/openclaw`; o recibo é redigido campo a campo antes de ser gravado; a consulta não escreve em `.orkastery`.

## Escopo e validação

- **Incluído (fatia de 01/10/2026):** conferência pura do transcript ([`core/src/prova-ativacao.ts`](../../core/src/prova-ativacao.ts)); roteiro [`core/scripts/prova-ativacao.cjs`](../../core/scripts/prova-ativacao.cjs) para Claude Code e OpenClaw; recibos reais da srvjcp86; documentação no [contrato do snapshot](../referencia/contratos/maestro-i32.md#prova-de-ativação-por-host-rm-032) e nos READMEs dos adaptadores.
- **Fora de escopo:** Hermes e Codex (sem host na srvjcp86; o roteiro recusa com `host.nao-suportado`); publicação dos pacotes (ato do mantenedor); atualizar a extensão global do OpenClaw ou reiniciar o gateway.
- **Entregáveis e critérios de aceite:**
  - conferência → `npm --prefix core run build && npm --prefix core run build:test && node --test core/dist-test/test/prova-ativacao.test.js` (10 testes: entrada exposta e chamada, desvio pelo shell, erro, snapshot fora do contrato, panorama da rede, projeto de outra cópia, "roadmap vazio" afirmado e negado, redação);
  - roteiro sem host → `node --test core/dist-test/test/prova-ativacao-roteiro.test.js` (`host.nao-suportado` e `host.ausente`, saída 2);
  - Claude Code → `node core/scripts/prova-ativacao.cjs claude-code` sai 0: [recibo de 01/10/2026](evidencias/RM-032/claude-code-2026-10-01.json), 10 de 10 conferências, Claude Code 2.1.286, `sonnet`, `mcp__orkastery__ork_maestro` chamada;
  - OpenClaw → `node core/scripts/prova-ativacao.cjs openclaw` sai 0: [recibo de 01/10/2026](evidencias/RM-032/openclaw-2026-10-01.json), 10 de 10 conferências, OpenClaw 2026.9.4, `deepseek-flash` (o modelo do incidente), `ork_network_roadmap` chamada num workspace sem manifesto e o panorama do projeto certo.
- **Critérios I32 ainda abertos:** I32-C01, I32-C09, I32-C11 e I32-C12 continuam pendentes. O texto original desses critérios não está versionado (o GOAL da `ork-i32bootstrap` não está no repositório nem em `ork/fabrica-estado`); esta fatia não os declara atendidos. Ela entrega a parte automatizável da prova de ativação em sessão nova por host e a evidência de Claude Code e OpenClaw. Faltam Hermes, Codex e a publicação dos pacotes dos dois sites.
- **Achados da prova:**
  - com `--modelo haiku`, o Claude carregou a skill `orkastery-bootstrap` e respondeu por `Bash ork maestro --json` (o `ork` do PATH, que resolve pelo diretório) em vez da tool MCP; o `ork-guard` do plugin libera comandos `ork` sem pedir permissão. A conferência reprova esse desvio. Com `sonnet`, a tool MCP foi chamada;
  - com a extensão 0.4.3 e o perfil `coding` (o da instalação desta máquina), o OpenClaw expôs 37 tools e nenhuma `ork_*`: a frase não foi reconhecida. Com a 0.5.0, que declara `ork_network_roadmap` no perfil `coding`, a frase chega ao panorama da rede;
  - o OpenClaw carrega a extensão da raiz global com o aviso "can't verify where this plugin came from" (`Trust: record-missing`); `openclaw plugins install <caminho>` recusa sem revisão ("rerun with --force after reviewing the source"). A prova usa a via documentada do `ork` e não contorna nenhum dos dois.

### Para o dono (ação humana, não contornada)

1. **Atualizar o gateway desta máquina** (a extensão global é a 0.4.3, sem `ork_network_roadmap`): com o `ork` 0.5.0 ou mais novo instalado, `ork adapter install openclaw --dir ~/.openclaw && systemctl --user restart openclaw-gateway` (sequência não executada pela prova).
2. **Revisar a procedência da extensão** até haver pacote oficial (npm ou ClawHub): `openclaw plugins inspect orkastery`.
3. **Decidir se as outras tools `ork_*` chegam ao modelo no perfil `coding`** (opcional; a frase sem projeto só precisa de `ork_network_roadmap`): `openclaw config set tools.alsoAllow '["orkastery"]' --strict-json`.
4. **Claude Code interativo, uma vez por projeto:** `cd <projeto> && claude`, aceitar "trust this folder" e aprovar o servidor `orkastery` do `.mcp.json` (ou `/mcp`); na primeira `orkastery maestro`, aprovar `mcp__orkastery__ork_maestro`.

## Plano e decisões

- **Instalação por host:** `ork adapter install <host>`, na [referência do CLI](../referencia/cli.md).
- **Prioridade / método / pontuação / justificativa / data:** fatia pedida pelo dono em 29/09/2026 para a noite de 30/09, depois do incidente do OpenClaw; vem antes da publicação, porque a publicação sem prova repete o incidente.
- **Decisões da fatia (ledger da `ork-rm032ativaca`, 01/10/2026, decididas pelo agente em #Auto):** D1 roteiro em `core/scripts`, sem subcomando novo; D2 Claude isolado por `--plugin-dir` e login nativo, sem copiar credencial nem gravar o registro global de plugins; D3 OpenClaw em estado temporário com segredo só por SecretRef; D5 `sonnet` como padrão; D7 (revisa D6) o OpenClaw instala pela via documentada do `ork` na cópia, sem `plugins install --force` nem `plugins.allow`.

## Estado com evidências

- Merge `20e3835` (PR #13, 19/09/2026); score humano 3/5 ratificado em 19/09/2026.
- Prova de ativação, 01/10/2026, srvjcp86, candidato `c80af41` sobre a 0.5.0: Claude Code e OpenClaw aprovados, 10 de 10 conferências cada. Recibos em [evidencias/RM-032](evidencias/RM-032/).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Disponível | — | 2026-10-01 | Julio |
| Documentação | Em revisão | — | 2026-10-01 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-10-01 | Julio |
| Testes | Aprovados | — | 2026-10-01 | Julio |
| Deploy | Produção | — | 2026-10-01 | Julio |
| Exposição | Parcial | — | 2026-10-01 | Julio |
| Habilitação | Em andamento | — | 2026-10-01 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.
- **Próxima ação, responsável e prazo:** atualizar o gateway desta máquina e decidir a publicação; prova de Hermes e Codex numa máquina que os tenha. Julio, sem prazo.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-19 | pacote de código entregue (8 de 12) | PR #13, merge `20e3835` | Julio |
| 2026-10-01 | prova de ativação por host automatizada; Claude Code e OpenClaw aprovados | thread `ork-rm032ativaca`, recibos em `evidencias/RM-032` | agente (#Auto), revisão de Julio |
