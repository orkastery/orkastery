---
id: RM-067
tipo: roadmap
titulo: Grok Build homologado ao lado de Codex e Claude Code
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-26T02:46:25-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: c3801f4
    pr: "#205"
sdlc:
  thread: ork-grokbuild
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-067: Grok Build homologado ao lado de Codex e Claude Code

> **Em uma frase:** o Grok Build (o agente CLI `grok`, da xAI) passa a despachar fase, ter o fim visto e entrar no rodízio de contas do `ork`, com o mesmo contrato de prova do `claude-bg` e do `codex`, começando pela chave de API.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Aprovados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Pedido do dono de 19/10/2026:** "e também adicione o Grok Build, o agente CLI do Grok". Prioridade do dono em 25/10/2026: "Priorize RM-067 Grok Build além das que já estão em andamento".

**Estado:** F1 e F2 entregues na thread `ork-grokbuild`, com testes sobre um `grok` simulado, porque a máquina não tem o runtime. F3 a F5 ficam para depois, e a F3 espera a decisão D1 do dono. O que existe e o que falta estão em "Estado com evidências".

**Decisão de condução:** uma página por runtime, porque cada um avança no próprio ritmo. O Google Antigravity tem a [RM-066](RM-066-google-antigravity-homologado.md).

**Nome:** o produto é o Grok Build e o binário é `grok`; o pacote npm é `@xai-official/grok` (E1). A documentação fica em `docs.x.ai` e o repositório oficial se apresenta como SpaceXAI (G4).

## Problema e resultado

- **Público e problema/oportunidade:** o dono que já conduz fases pelo `claude-bg` e pelo `codex` e quer um terceiro runtime, de outro fornecedor, para o rodízio de contas e para o fallback quando uma cota acaba ([RM-064](RM-064-conta-esgotada-nao-para-a-fase.md)). Até a thread `ork-grokbuild`, o `ork` só despachava por dois runtimes; com F1 e F2, o `grok` entra no registro `RUNTIMES` (`core/src/runtimes.ts`) só por despacho explícito.
- **Evidências e fonte:** o pedido do dono de 19/10/2026 e a pesquisa de 19/10/2026 sobre o `grok`, com as fontes na seção "Fontes" abaixo, reconferidas na mesma data.
- **Objetivo/OKR:** o `grok` aparece em `ork phase run --runtime` e em `ork setup` como runtime homologado, com o mesmo contrato de despacho: `dry-run`, verificação externa da sessão e nenhum auto-relato como prova.
- **Hipótese:** se o adaptador do `grok` reaproveitar o contrato `RuntimeAdapter` e ler o fim da sessão de uma fonte que o próprio runtime grava (o evento `end` do `streaming-json` e o `updates.jsonl` da sessão), então ele entra no rodízio sem mudar o contrato dos outros dois, porque o `grok` já tem modo headless com saída de máquina, códigos de saída documentados e transcrição em JSONL.
- **Métrica principal / linha de base / meta / janela / fonte:** fases de uma thread concluídas pelo `grok` com o fim visto pelo watcher, sem o dono. Linha de base: zero, porque não há adaptador. Meta, janela e piloto: A definir pelo dono depois da decisão de autenticação. Fonte: ledger (`phase_dispatch_verified` e `phase_result` da sessão).
- **Métricas de proteção:** o contrato do `claude-bg` e do `codex` não muda (paridade sem downgrade); nenhum despacho em conta fora do rodízio; nenhuma credencial copiada ou lida pelo `ork`; nenhum uso que a política do fornecedor não autorize.

## Escopo e validação

- **Incluído:** o adaptador de despacho e a saída em stream; o fim da sessão e o watcher; perfis de conta, login e cota esgotada; `ork setup`, sandbox, MCP, documentação e onboarding; o ensaio real de homologação.
- **Fora de escopo:** fazer do `grok` o runtime padrão; o transporte ACP (`grok agent stdio`), que fica para uma página própria se o headless não bastar; o modo interativo (TUI); contornar qualquer limite da política de uso do fornecedor; comprar cota ou criar conta, que continua com o dono.
- **Entregáveis e critérios de aceite:** as cinco fatias da seção "Plano e decisões", cada uma com a prova listada.
- **Piloto, medição e critérios de expansão/interrupção:** A definir pelo dono, depois da decisão de autenticação. Interrompe se a política de uso mudar contra o modo escolhido.

### O que o Orkastery exige e o que o Grok Build oferece

As colunas "o que o runtime oferece" citam a fonte entre parênteses (lista em "Fontes"). "Não confirmado" quer dizer que a fonte não diz.

| # | O que o Orkastery exige (onde está hoje) | O que o `grok` oferece | Lacuna |
| --- | --- | --- | --- |
| E1 | Adaptador no registro `RUNTIMES` (`core/src/runtimes.ts`): `disponivel`, `versao`, `montarComando`, `despachar`, `fonteVerificacao`, com `dry-run`; `ork phase run --runtime` resolve por nome | `grok -p "<prompt>"` não interativo, com `--output-format plain`, `json`, `streaming-json` ou `streaming-messages-json`, `-m`, `--effort`, `--cwd`, `--max-turns`, `--allow`, `--deny`, `--sandbox`, `--no-auto-update` (G2, G3, G4). Instalação por `curl -fsSL https://x.ai/cli/install.sh \| bash` ou `npm install -g @xai-official/grok` (G4, G6). Última versão no registro npm em 19/10/2026: 1.0.62 (npm) | Escrever o adaptador. Não há registro de sessões vivas que o `ork` consulte como o `claude agents --json`: a prova de existência vem do stream e do diretório da sessão (E2) |
| E2 | Fim da sessão visto por fonte externa, nunca por auto-relato (watcher e sensores, RM-004 e RM-034; `core/src/session-watcher.ts`) | `streaming-json` termina com o evento `end` (`stopReason`, `sessionId`, `usage`, `num_turns`); o `json` traz um objeto único com `text`, `stopReason`, `sessionId` e o gasto (G4). Transcrição em `~/.grok/sessions/<cwd-codificado>/<id>/updates.jsonl`, JSONL e fonte da verdade da sessão; o SQLite é só o índice da busca (G4). Hooks `Stop`, `StopFailure` e `SessionEnd`, com `sessionId` no payload (G8) | O payload dos hooks não traz o caminho da transcrição (G8): o caminho se deriva de `GROK_HOME`, do diretório de trabalho e do `sessionId`. A pesquisa anterior apontava "SQLite" para a transcrição; a documentação do repositório diz JSONL, e esta página segue ela |
| E3 | Falha tipada pelo código de saída e pelo erro estruturado, nunca pelo texto do agente (`core/src/adapters/codex-events.ts` faz isso no `codex`) | Saídas 0 (sucesso), 1 (falha de autenticação, de rede ou do runtime), 130 (SIGINT) e 143 (SIGTERM); em falha o `json` emite `{"type":"error",...}` (G4). Interrompido, salva o estado até a última ferramenta concluída e não desfaz arquivos já modificados (G4) | O código 1 mistura autenticação, rede e erro do runtime: a classificação fina precisa do objeto `error`. O formato exato desse objeto para a cota esgotada não está confirmado |
| E4 | Perfis de conta por runtime e login: `VARIAVEL_DO_PERFIL` em `core/src/runtime-profiles.ts` liga o runtime à variável do diretório de configuração; `ork accounts add --runtime R --dir D` roda o login do próprio CLI (RM-033, RM-040) | `GROK_HOME` muda o diretório de configuração, autenticação e sessões (G5). Login por navegador com `grok login`, por código de dispositivo com `grok login --device-auth` ou por `XAI_API_KEY`; credencial em `auth.json`, modo 0600 (G3, G4, G6). O token de sessão vence a chave; para cair na chave, `grok logout` ou apagar o arquivo (G4) | A variável do perfil existe (`GROK_HOME`), o que é melhor que o caso do `agy`. Falta um perfil por chave: o estado `provider-pago` do perfil hoje nunca recebe despacho (login por chave de API), o que conflita com a alternativa recomendada na decisão D1 desta página |
| E5 | Cota esgotada não para a fase (RM-064, RM-063 F4): `runtime.quota-exhausted` só de erro estruturado do runtime (`core/src/conta-esgotada.ts`, `core/src/retry.ts`, `core/src/runtime-escada.ts`) | Cada assento pago tem um pool semanal; passado o incluído, o uso vira "Additional Usage", pago com créditos e com tetos de gasto, e a página de uso mostra a próxima renovação (G14) | A mensagem e o formato do CLI na cota esgotada: não confirmado. Sem o formato estruturado o sinal não é tipado e o `ork` não pode marcar o perfil |
| E6 | `ork setup <modo> --bloco N --runtime R --model M --effort E` e fallback `runtime:modelo[:esforco]` (`core/src/setup.ts`); o modelo de um runtime não serve a outro | `-m` escolhe o modelo e `grok models` os lista; `--effort` aceita níveis de `none` a `max`, e cada modelo só aceita os que o próprio menu anuncia (G3, G4) | Mapear o esforço do Orkastery aos níveis aceitos por modelo e definir o modelo padrão do runtime, que o dono confirma |
| E7 | Postura de sandbox (RM-047): o `runtime.sandbox` mais frouxo só despacha depois de `ork setup sandbox confirmar` (`docs/referencia/cli.md`); o filho nunca amplia o que a worktree permite | `--sandbox` com os perfis `off` (padrão), `workspace`, `read-only` e `strict`; Landlock no Linux (G7). Permissões por `--allow` e `--deny`; `--yolo` e `--permission-mode bypassPermissions` aprovam tudo (G4) | Escolher o mapeamento entre a postura do Orkastery e os perfis do `grok`, com `workspace` como piso e sem `--yolo` por padrão |
| E8 | MCP do `ork` vinculado à thread e pacote de experiência (RM-016, RM-051): `ork mcp install --host` aceita hoje `claude-code` e `codex` (`core/src/mcp-install.ts`) | `grok mcp list`, `add`, `remove` e `doctor` (G3). Lê `AGENTS.md`, `CLAUDE.md` e `.grok/rules/` (G4); lê hooks de `.claude/settings.json` (G8) | Novo `host` no instalador do MCP, com o perfil filho e as ferramentas enumeradas. O local do arquivo de MCP do `grok` não foi lido nesta consulta. O `grok` só carrega o `AGENTS.md` da partida com a pasta confiada (`--trust`) (G4): a worktree da thread precisa dessa confiança |
| E9 | Playbook dos runtimes (RM-009): `core/src/playbook-capabilities.ts` descreve capacidades por runtime (`codex` ou `claude`) | Capacidades das linhas E1 a E8 | Acrescentar o `grok` ao playbook, com as lacunas acima marcadas |
| E10 | Medição de consumo por runtime no #Noctum (RM-058 N6; `core/src/noctum-medicao.ts`): só o que o runtime gravou, nunca estimativa | `usage`, `num_turns` e `modelUsage` no `json` e no `end`. O custo (`total_cost_usd`) só aparece quando o servidor o informa por completo, hoje para tráfego de chave de API; pelo pool da assinatura costuma faltar (G4). `grok usage` mostra totais por turno (G4) | Percentual da cota: não confirmado. Sem medida estruturada o `ork` registra a lacuna da cota da sessão, como o `core/src/noctum-medicao.ts` já faz quando o runtime não a grava |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** A definir pelo dono. A posição no índice de prioridade do roadmap é decisão dele; esta página não a propõe.
- **Horizonte / alvo / previsão / confiança / marcos:** sem data. As fatias abaixo são propostas, na ordem, e cada uma só começa depois da anterior mesclada.
- **Dependências e bloqueios (ID, owner, próxima revisão):** a decisão D1 (autenticação), do dono, antes de F3; [RM-064](RM-064-conta-esgotada-nao-para-a-fase.md) (cota esgotada e retomada); [RM-063](RM-063-fabrica-que-nao-para.md) (escada de recuperação); [RM-056](RM-056-perfil-por-thread-e-carga.md) (perfil por thread); [RM-040](RM-040-estado-de-conta-compartilhado.md) (estado de conta). Próxima revisão: Julio, após ler esta página.

### Fatias propostas

| Fatia | O que entrega | Critério de aceite (a provar) |
| --- | --- | --- |
| F1 Adaptador e despacho headless | Entrada `grok` em `RUNTIMES`, com `montarComando` e `despachar` sobre `grok -p` e `--output-format streaming-json`; `--runtime grok` em `ork phase run`; `dry-run` | Teste com `grok` simulado: o comando montado leva `-m`, `--effort`, `--cwd` da worktree, o perfil de sandbox do bloco e `--no-auto-update`; `--dry-run` não despacha; runtime ausente recusa com erro tipado; os testes do `claude-bg` e do `codex` passam sem alteração |
| F2 Fim da sessão, transcrição e watcher | Fonte canônica do fim (evento `end` e `updates.jsonl` da sessão), sensores e watcher próprios do `grok` | Teste com stream e diretório de sessão simulados: o `end` com `stopReason` de fim normal vira um único `phase_result`; saída 1 com objeto `error` vira parada tipada; saída 130 ou 143 vira interrupção, com retomada por `-r <id>`; stream cortado sem `end` termina como `runtime.unavailable` depois do prazo |
| F3 Perfis, login e cota esgotada | `grok` em `ork accounts add --runtime`, com `GROK_HOME` por perfil; login pelo próprio CLI; sinal tipado de cota esgotada; entrada na escada e no fallback | Teste com dois perfis simulados: esgotar o primeiro move a thread para o segundo; perfil de outro estado não recebe despacho; o `ork` não lê nem copia `auth.json`. A fatia só começa com a decisão D1 registrada |
| F4 Setup, sandbox, MCP, documentação e onboarding | `ork setup` com o `grok`; mapeamento da postura de sandbox; `ork mcp install --host` para o `grok`; confiança da worktree; playbook; guia de onboarding | Teste: a postura mais frouxa sem confirmação recusa com `runtime.sandbox-nao-confirmado`; o MCP instalado traz só as ferramentas enumeradas; o `AGENTS.md` da worktree é carregado na partida headless; `ork docs verificar` verde com a página do runtime; o onboarding lista o `grok` com o modo de autenticação decidido |
| F5 Homologação com ensaio real | Uma thread `#Fast` de uma fase conduzida de ponta a ponta pelo `grok`, em credencial que o dono autoriza no modo decidido | O ensaio fecha com a sessão vista pelo watcher, claims verificados, `ork verify` verde e o ledger sem auto-relato como prova. Se o fornecedor não autorizar o modo escolhido, a fatia para e volta ao dono |

- **Premissas / riscos / mitigação:**
  - **Política de uso:** ela proíbe acesso aos serviços por meios automatizados "não autorizados", enquanto a documentação promove o headless e o ACP para scripts e orquestradores (D1). Mitigação: a decisão é do dono, e F3 só começa depois dela.
  - **Produto em beta:** o lançamento foi em beta inicial para assinantes (G1), e a documentação traz a série 1.0.x; a GA não está confirmada. Mitigação: `versao()` no adaptador, `--no-auto-update` no comando e teste de contrato do formato do stream.
  - **Cota esgotada sem formato conhecido:** sem ele o sinal tipado de E5 não existe. Mitigação: F3 obtém o formato no ensaio com perfil simulado e, até lá, o runtime fica fora da escada automática.
  - **Repositório espelho:** o código é Apache-2.0, sincronizado do monorepo interno e sem contribuição externa (G4). Mitigação: nenhuma, e correção de comportamento do runtime depende do fornecedor.
  - **Concorrência no mesmo id de sessão:** duas execuções com o mesmo id ao mesmo tempo são "melhor esforço" (G4). Mitigação: o `ork` já mantém uma sessão por worktree.
- **Não-objetivos:** trocar o runtime padrão; ler o banco de busca do `grok`; usar a assinatura sem a confirmação da decisão D1; prometer paridade de modelo ou de qualidade entre runtimes.

### Decisões que esperam o dono

**D1. Modo de autenticação do `grok` no Orkastery.** A política de uso da xAI, vigente desde 14/08/2026, proíbe "accessing the Services through unauthorized automated or non-human means, whether through a bot, script, or otherwise" (G15). A documentação e o anúncio do produto dizem o contrário no sentido prático: o modo `-p` serve para "scripts and automations" e o ACP serve para "agent orchestration apps" (G1, G2). Quem decide se o login de assinatura num orquestrador de terceiros é "autorizado" é a xAI, e a fonte não diz.

| Alternativa | O que significa | Custo e risco |
| --- | --- | --- |
| **a (recomendada)** | Começar pela `XAI_API_KEY`, que a documentação indica para CI e automação (G5, G6). A assinatura só entra depois de confirmação escrita da xAI | Fora da zona cinza da política. Cobrança por uso, e o estado de perfil `provider-pago` (hoje fora do despacho) precisa de uma exceção para este runtime em F3, que vai ao dono junto |
| b | A assinatura agora | Risco de a política ser lida contra o uso, dito aqui, sem confirmação do fornecedor; possível suspensão da conta do dono |
| c | Esperar a GA | Sem risco de política, e o runtime não entra até lá; só F1 e F2 andam |

**Decisão da condutora, registrada no ledger:** uma página por runtime (RM-066 e RM-067), sem fatia comum, porque cada um avança no próprio ritmo.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-26 | Julio |
| Documentação | Em revisão | — | 2026-10-26 | Julio |
| Código | Mesclado | commit `c3801f4` · PR ##205 | 2026-10-26 | Julio |
| Testes | Aprovados | — | 2026-10-26 | Julio |
| Deploy | Não implantado | — | 2026-10-26 | Julio |
| Exposição | Flag desligada | — | 2026-10-26 | Julio |
| Habilitação | Pendente | — | 2026-10-26 | Julio |

<!-- ork-docs:estado:fim -->

### F1 e F2 entregues (thread `ork-grokbuild`)

As provas usam um `grok` simulado: um binário falso em `sh` no PATH e o stream `streaming-json` escrito a partir do formato do guia headless (G4), em `core/test/fixtures/grok/`. O ensaio com o runtime real é a F5.

- **F1, adaptador e despacho headless** (`core/src/adapters/grok.ts`): `ork phase run <thread> <FASE> --runtime grok --model <modelo>` monta `grok -p <prompt> --output-format streaming-json -s <id> --cwd <worktree> -m <modelo> --effort <esforço> --sandbox <perfil> --no-auto-update` e roda pelo supervisor destacado, com o log do stream e os recibos de processo e de saída.
- **Prova de existência:** o id da sessão é do `ork` (`-s`), e a sessão só fica verificada pela pasta `<GROK_HOME>/sessions/<grupo>/<id>/` com o `updates.jsonl`, que o runtime grava. O `ork` lista nomes e lê o tamanho desse arquivo, nunca o conteúdo, e nunca abre o `auth.json`.
- **Ensaio e ausência:** `--dry-run` monta o comando e não despacha; sem o `grok` no PATH, o despacho recusa com `runtime.unavailable` tipado e deixa o prompt gravado para o `ork retry`. O rate limit de janela curta antes da sessão vai à fila com o runtime `grok`, e a retomada volta por ele, com o modelo dele.
- **Credencial e sandbox:** o filho roda sem `XAI_API_KEY` e sem as variáveis de provider pago, até a D1. Sem a chave, o despacho real autentica pelo login que o próprio `grok` guardou no `GROK_HOME`, o da assinatura: é a alternativa b da D1, em zona cinza da política de uso, então nenhuma conta real deve despachar antes da decisão do dono. O perfil de sandbox é `workspace` (o piso da E7), e `read-only` com `runtime.sandbox: read-only` e no PLAN que fecha o próprio bloco (no `#Auto`, de bloco único, o PLAN segue a postura do manifesto); nunca `--yolo`.
- **Só explícito:** o `grok` resolve por nome no despacho, mas não é runtime de bloco, nem fallback, nem `runtime.adapter`: o `ork setup` e o manifesto recusam com a mensagem do despacho explícito, e a leitura do `setup.json` o descarta.
- **F2, fim da sessão e watcher** (`core/src/session-watcher-grok.ts`): o fim vem do evento `end` do stream e do recibo de saída do supervisor, com um único `phase_result` por despacho, e a condução da thread solta com ele.
- **Classificação:** `end_turn` com saída 0 só conclui com a prova do `ork` (a mesma do `claude-bg`); a saída 1 com objeto `error` vira parada tipada (`runtime.auth-missing` pela frase do runtime, senão `runtime.unavailable`); 130, 143, SIGINT, SIGTERM e `cancelled` sem objeto `error` (com qualquer saída) vão ao dono (`human.pending`) com a retomada `grok -p continue -r <id>`, e o `end` válido seguido de outra saída sem `error` também; com o `error` e uma saída diferente de 0, 130 e 143, sem SIGINT nem SIGTERM, a parada tipada vence o `cancelled`; o stream sem `end` e sem processo vira `runtime.unavailable` depois do `LIMITE_MORTE_MS`.
- **Paridade:** o comando, o registro e os testes do `claude-bg` e do `codex` não mudaram, e os testes deles seguem verdes.

### O que falta

- **D1 do dono:** o modo de autenticação. Sem ela, a F3 não começa, e o filho segue sem `XAI_API_KEY`.
- **F3:** perfis com `GROK_HOME` por conta, login pelo próprio CLI, sinal tipado de cota esgotada (o formato do erro de cota não é documentado) e entrada na escada e no fallback.
- **F4:** `ork setup` com o `grok`, o sandbox `off` e `strict` com a confirmação local, o host do MCP do `ork` (inclusive o `ork_phase_run` pelo MCP), as regras `--allow` e `--deny`, a confiança da worktree, o playbook e o onboarding. Sem o MCP, a sessão `grok` não grava o artefato da fase nem registra commit pelo núcleo, então a prova do `ork` ainda não fecha uma fase real.
- **F5:** o ensaio real de homologação, que também confirma o `-s` com o id do `ork`, o formato do stream e o comportamento sem aprovação automática.
- **Lacunas menores:** a retomada automática pelo `ork retry` com `-r`; o inventário de sessões vivas (`ork sessions`), o status do roadmap e a prova de vida do retry ainda não leem a sessão `grok` (quem impede a segunda sessão na worktree é o lease da condução, que só solta com o resultado); o pedido de impedimento do dono ainda manda o binário `claude` para o `grok`; com o MCP da F4, a prova do `ork` do `grok` precisa reler os eventos sob o lock da sessão, como o `claude-bg`; a medição de consumo do #Noctum.

### Fontes

Consultadas em 19/10/2026.

- G1: <https://x.ai/news/grok-build-cli> (25/05/2026)
- G2: <https://docs.x.ai/build/cli/headless-scripting>
- G3: <https://docs.x.ai/build/cli/reference>
- G4: <https://github.com/xai-org/grok-build,> o README e os guias `14-headless-mode`, `17-sessions`, `02-authentication` e `12-project-rules`, em `crates/codegen/xai-grok-pager/docs/user-guide/`
- G5: <https://docs.x.ai/build/settings/reference>
- G6: <https://docs.x.ai/build/enterprise>
- G7: <https://docs.x.ai/build/features/sandbox>
- G8: <https://docs.x.ai/build/features/hooks>
- G14: <https://docs.x.ai/x-subscription/usage-limits>
- G15: <https://x.ai/legal/acceptable-use-policy;> a página oficial devolveu acesso negado ao leitor automático, e a cláusula foi lida numa cópia do arquivo da web (`web.archive.org`) da mesma página
- npm: <https://registry.npmjs.org/@xai-official/grok/latest>

Pontos que a página não confirma: a GA; a mensagem e o formato do CLI na cota esgotada; o local do arquivo de MCP; se o login de assinatura num orquestrador de terceiros é "autorizado".

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: condutor da thread `ork-runtimesnovo` para a página e da thread `ork-grokbuild` para F1 e F2; A: Julio; C: A definir; I: A definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a página foi redigida por agente em #Fast, a partir do pedido do dono e das fontes citadas; F1 e F2 foram implementadas por agente em #Auto na thread `ork-grokbuild`, com testes sobre o `grok` simulado; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** Julio decide D1; com ela, a F3 pode começar. Sem prazo definido.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-19 | Item criado em Discovery, com cinco fatias propostas e a decisão D1 aberta | Pedido do dono de 19/10/2026; fontes reconferidas na mesma data | Julio |
| 2026-10-25 | F1 e F2 entregues na thread `ork-grokbuild`, com o `grok` simulado; F3 a F5 seguem propostas, e a F3 espera a D1 | Prioridade do dono de 25/10/2026; testes do adaptador, do stream, do registro, do watcher e de ponta a ponta | Julio |
