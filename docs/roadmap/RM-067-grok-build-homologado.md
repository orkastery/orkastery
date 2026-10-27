---
id: RM-067
tipo: roadmap
titulo: Grok Build homologado ao lado de Codex e Claude Code
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-27T08:41:04-03:00
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
  thread: ork-rm067f4cmcpd
  modo: "#Auto"
  fase: GOAL
  status: aberta
---

# RM-067: Grok Build homologado ao lado de Codex e Claude Code

> **Em uma frase:** o Grok Build (o agente CLI `grok`, da xAI) passa a despachar fase, ter o fim visto e entrar no rodízio de contas do `ork`, com o mesmo contrato de prova do `claude-bg` e do `codex`, começando pela chave de API.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Aprovados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Pedido do dono de 19/10/2026:** "e também adicione o Grok Build, o agente CLI do Grok". Prioridade do dono em 25/10/2026: "Priorize RM-067 Grok Build além das que já estão em andamento".

**Estado:** F1 a F4c entregues, com testes sobre um `grok` simulado, porque a máquina não tem o runtime: F1 e F2 na thread `ork-grokbuild`, F3 na `ork-rm067f3perfi`, F4 na `ork-rm067f4setup`, o host MCP do `grok` (F4b) na `ork-rm067f4bhost` e o servidor MCP do `ork` fora do sandbox do `grok` (F4c) na `ork-rm067f4cmcpd`.

O dono decidiu a D1 em 27/10/2026 (alternativa b, a assinatura agora) e a D2 no mesmo dia (alternativa a, o servidor do `ork` fora do sandbox). A F5 fica para depois, e meta, janela e piloto continuam a definir pelo dono. O que existe e o que falta estão em "Estado com evidências".

**Decisão de condução:** uma página por runtime, porque cada um avança no próprio ritmo. O Google Antigravity tem a [RM-066](RM-066-google-antigravity-homologado.md).

**Nome:** o produto é o Grok Build e o binário é `grok`; o pacote npm é `@xai-official/grok` (E1). A documentação fica em `docs.x.ai` e o repositório oficial se apresenta como SpaceXAI (G4).

## Problema e resultado

- **Público e problema/oportunidade:** o dono que já conduz fases pelo `claude-bg` e pelo `codex` e quer um terceiro runtime, de outro fornecedor, para o rodízio de contas e para o fallback quando uma cota acaba ([RM-064](RM-064-conta-esgotada-nao-para-a-fase.md)). Até a thread `ork-grokbuild`, o `ork` só despachava por dois runtimes; com F1 e F2, o `grok` entra no registro `RUNTIMES` (`core/src/runtimes.ts`) só por despacho explícito.
- **Evidências e fonte:** o pedido do dono de 19/10/2026 e a pesquisa de 19/10/2026 sobre o `grok`, com as fontes na seção "Fontes" abaixo, reconferidas na mesma data.
- **Objetivo/OKR:** o `grok` aparece em `ork phase run --runtime` e em `ork setup` como runtime homologado, com o mesmo contrato de despacho: `dry-run`, verificação externa da sessão e nenhum auto-relato como prova.
- **Hipótese:** se o adaptador do `grok` reaproveitar o contrato `RuntimeAdapter` e ler o fim da sessão de uma fonte que o próprio runtime grava (o evento `end` do `streaming-json` e o `updates.jsonl` da sessão), então ele entra no rodízio sem mudar o contrato dos outros dois, porque o `grok` já tem modo headless com saída de máquina, códigos de saída documentados e transcrição em JSONL.
- **Métrica principal / linha de base / meta / janela / fonte:** fases de uma thread concluídas pelo `grok` com o fim visto pelo watcher, sem o dono. Linha de base: zero, porque não há adaptador. Meta, janela e piloto: A definir pelo dono. Fonte: ledger (`phase_dispatch_verified` e `phase_result` da sessão).
- **Métricas de proteção:** o contrato do `claude-bg` e do `codex` não muda (paridade sem downgrade); nenhum despacho em conta fora do rodízio; nenhuma credencial copiada ou lida pelo `ork`; nenhum uso que a política do fornecedor não autorize.

## Escopo e validação

- **Incluído:** o adaptador de despacho e a saída em stream; o fim da sessão e o watcher; perfis de conta, login e cota esgotada; `ork setup`, sandbox, MCP, documentação e onboarding; o ensaio real de homologação.
- **Fora de escopo:** fazer do `grok` o runtime padrão; o transporte ACP (`grok agent stdio`), que fica para uma página própria se o headless não bastar; o modo interativo (TUI); contornar qualquer limite da política de uso do fornecedor; comprar cota ou criar conta, que continua com o dono.
- **Entregáveis e critérios de aceite:** as cinco fatias da seção "Plano e decisões", cada uma com a prova listada.
- **Piloto, medição e critérios de expansão/interrupção:** A definir pelo dono. Interrompe se a política de uso mudar contra o modo escolhido (a assinatura, pela D1) ou se a xAI suspender a conta.

### O que o Orkastery exige e o que o Grok Build oferece

As colunas "o que o runtime oferece" citam a fonte entre parênteses (lista em "Fontes"). "Não confirmado" quer dizer que a fonte não diz.

| # | O que o Orkastery exige (onde está hoje) | O que o `grok` oferece | Lacuna |
| --- | --- | --- | --- |
| E1 | Adaptador no registro `RUNTIMES` (`core/src/runtimes.ts`): `disponivel`, `versao`, `montarComando`, `despachar`, `fonteVerificacao`, com `dry-run`; `ork phase run --runtime` resolve por nome | `grok -p "<prompt>"` não interativo, com `--output-format plain`, `json`, `streaming-json` ou `streaming-messages-json`, `-m`, `--effort`, `--cwd`, `--max-turns`, `--allow`, `--deny`, `--sandbox`, `--no-auto-update` (G2, G3, G4). Instalação por `curl -fsSL https://x.ai/cli/install.sh \| bash` ou `npm install -g @xai-official/grok` (G4, G6). Última versão no registro npm em 19/10/2026: 1.0.62 (npm) | Escrever o adaptador. Não há registro de sessões vivas que o `ork` consulte como o `claude agents --json`: a prova de existência vem do stream e do diretório da sessão (E2) |
| E2 | Fim da sessão visto por fonte externa, nunca por auto-relato (watcher e sensores, RM-004 e RM-034; `core/src/session-watcher.ts`) | `streaming-json` termina com o evento `end` (`stopReason`, `sessionId`, `usage`, `num_turns`); o `json` traz um objeto único com `text`, `stopReason`, `sessionId` e o gasto (G4). Transcrição em `~/.grok/sessions/<cwd-codificado>/<id>/updates.jsonl`, JSONL e fonte da verdade da sessão; o SQLite é só o índice da busca (G4). Hooks `Stop`, `StopFailure` e `SessionEnd`, com `sessionId` no payload (G8) | O payload dos hooks não traz o caminho da transcrição (G8): o caminho se deriva de `GROK_HOME`, do diretório de trabalho e do `sessionId`. A pesquisa anterior apontava "SQLite" para a transcrição; a documentação do repositório diz JSONL, e esta página segue ela |
| E3 | Falha tipada pelo código de saída e pelo erro estruturado, nunca pelo texto do agente (`core/src/adapters/codex-events.ts` faz isso no `codex`) | Saídas 0 (sucesso), 1 (falha de autenticação, de rede ou do runtime), 130 (SIGINT) e 143 (SIGTERM); em falha o `json` emite `{"type":"error",...}` (G4). Interrompido, salva o estado até a última ferramenta concluída e não desfaz arquivos já modificados (G4) | O código 1 mistura autenticação, rede e erro do runtime: a classificação fina precisa do objeto `error`. O formato exato desse objeto para a cota esgotada não está confirmado |
| E4 | Perfis de conta por runtime e login: `VARIAVEL_DO_PERFIL` em `core/src/runtime-profiles.ts` liga o runtime à variável do diretório de configuração; `ork accounts add --runtime R --dir D` roda o login do próprio CLI (RM-033, RM-040) | `GROK_HOME` muda o diretório de configuração, autenticação e sessões (G5). Login por navegador com `grok login`, por código de dispositivo com `grok login --device-auth` ou por `XAI_API_KEY`; credencial em `auth.json`, modo 0600 (G3, G4, G6). O token de sessão vence a chave; para cair na chave, `grok logout` ou apagar o arquivo (G4) | A variável do perfil existe (`GROK_HOME`), o que é melhor que o caso do `agy`. Entregue na F3: `ork accounts add --runtime grok` com `GROK_HOME` por perfil e o login pelo próprio CLI. Com a D1 b (assinatura), não há perfil por chave: o estado `provider-pago` segue sem despacho, sem exceção para este runtime. O `grok` não documenta conferência de login, e o `ork` não lê o `auth.json`: o perfil entra sem conferência prévia, e o despacho prova o login |
| E5 | Cota esgotada não para a fase (RM-064, RM-063 F4): `runtime.quota-exhausted` só de erro estruturado do runtime (`core/src/conta-esgotada.ts`, `core/src/retry.ts`, `core/src/runtime-escada.ts`) | Cada assento pago tem um pool semanal; passado o incluído, o uso vira "Additional Usage", pago com créditos e com tetos de gasto, e a página de uso mostra a próxima renovação (G14) | A mensagem e o formato do CLI na cota esgotada: não confirmado. Sem o formato estruturado o sinal não é tipado e o `ork` não pode marcar o perfil. Desde a F3, nenhum texto do `grok` vira cota esgotada, e o `grok` fica fora da escada automática e do fallback até a F5 ler o formato |
| E6 | `ork setup <modo> --bloco N --runtime R --model M --effort E` e fallback `runtime:modelo[:esforco]` (`core/src/setup.ts`); o modelo de um runtime não serve a outro | `-m` escolhe o modelo e `grok models` os lista; `--effort` aceita níveis de `none` a `max`, e cada modelo só aceita os que o próprio menu anuncia (G3, G4) | Mapear o esforço do Orkastery aos níveis aceitos por modelo e definir o modelo padrão do runtime, que o dono confirma |
| E7 | Postura de sandbox (RM-047): o `runtime.sandbox` mais frouxo só despacha depois de `ork setup sandbox confirmar` (`docs/referencia/cli.md`); o filho nunca amplia o que a worktree permite | `--sandbox` com os perfis `off` (padrão), `workspace`, `read-only` e `strict`; Landlock no Linux (G7). Permissões por `--allow` e `--deny`; `--yolo` e `--permission-mode bypassPermissions` aprovam tudo (G4) | Escolher o mapeamento entre a postura do Orkastery e os perfis do `grok`, com `workspace` como piso e sem `--yolo` por padrão |
| E8 | MCP do `ork` vinculado à thread e pacote de experiência (RM-016, RM-051): `ork mcp install --host` aceita hoje `claude-code` e `codex` (`core/src/mcp-install.ts`) | `grok mcp list`, `add`, `remove` e `doctor` (G3). Lê `AGENTS.md`, `CLAUDE.md` e `.grok/rules/` (G4); lê hooks de `.claude/settings.json` (G8) | Novo `host` no instalador do MCP, com o perfil filho e as ferramentas enumeradas. O local do MCP, lido em 27/10/2026: `[mcp_servers.<nome>]` em `$GROK_HOME/config.toml` (padrão `~/.grok/config.toml`) ou em `.grok/config.toml` do projeto, procurado do cwd até a raiz do git (G5, G16); o headless não tem flag de MCP por sessão (G2, G4). O `grok` só carrega o `AGENTS.md` da partida com a pasta confiada (`--trust`) (G4, G17): entregue na F4. Entregue na F4b: o host `grok` do `ork mcp install` e do `ork mcp serve`, a config da worktree e o `--allow` das ferramentas enumeradas. O sandbox do `grok` vale para o processo inteiro e os filhos (G17); entregue na F4c: o servidor do `ork` fora dele, pela forma `url` com `bearer_token_file` (G16) |
| E9 | Playbook dos runtimes (RM-009): `core/src/playbook-capabilities.ts` descreve capacidades por runtime (`codex` ou `claude`) | Capacidades das linhas E1 a E8 | Acrescentar o `grok` ao playbook, com as lacunas acima marcadas |
| E10 | Medição de consumo por runtime no #Noctum (RM-058 N6; `core/src/noctum-medicao.ts`): só o que o runtime gravou, nunca estimativa | `usage`, `num_turns` e `modelUsage` no `json` e no `end`. O custo (`total_cost_usd`) só aparece quando o servidor o informa por completo, hoje para tráfego de chave de API; pelo pool da assinatura costuma faltar (G4). `grok usage` mostra totais por turno (G4) | Percentual da cota: não confirmado. Sem medida estruturada o `ork` registra a lacuna da cota da sessão, como o `core/src/noctum-medicao.ts` já faz quando o runtime não a grava |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** A definir pelo dono. A posição no índice de prioridade do roadmap é decisão dele; esta página não a propõe.
- **Horizonte / alvo / previsão / confiança / marcos:** sem data. As fatias abaixo são propostas, na ordem, e cada uma só começa depois da anterior mesclada.
- **Dependências e bloqueios (ID, owner, próxima revisão):** as decisões D1 (autenticação) e D2 (o MCP com o sandbox ligado) foram tomadas pelo dono em 27/10/2026 e não bloqueiam mais nenhuma fatia; [RM-064](RM-064-conta-esgotada-nao-para-a-fase.md) (cota esgotada e retomada); [RM-063](RM-063-fabrica-que-nao-para.md) (escada de recuperação); [RM-056](RM-056-perfil-por-thread-e-carga.md) (perfil por thread); [RM-040](RM-040-estado-de-conta-compartilhado.md) (estado de conta). Próxima revisão: Julio, após ler esta página.

### Fatias propostas

| Fatia | O que entrega | Critério de aceite (a provar) |
| --- | --- | --- |
| F1 Adaptador e despacho headless | Entrada `grok` em `RUNTIMES`, com `montarComando` e `despachar` sobre `grok -p` e `--output-format streaming-json`; `--runtime grok` em `ork phase run`; `dry-run` | Teste com `grok` simulado: o comando montado leva `-m`, `--effort`, `--cwd` da worktree, o perfil de sandbox do bloco e `--no-auto-update`; `--dry-run` não despacha; runtime ausente recusa com erro tipado; os testes do `claude-bg` e do `codex` passam sem alteração |
| F2 Fim da sessão, transcrição e watcher | Fonte canônica do fim (evento `end` e `updates.jsonl` da sessão), sensores e watcher próprios do `grok` | Teste com stream e diretório de sessão simulados: o `end` com `stopReason` de fim normal vira um único `phase_result`; saída 1 com objeto `error` vira parada tipada; saída 130 ou 143 vira interrupção, com retomada por `-r <id>`; stream cortado sem `end` termina como `runtime.unavailable` depois do prazo |
| F3 Perfis, login e cota esgotada | `grok` em `ork accounts add --runtime`, com `GROK_HOME` por perfil; login pelo próprio CLI; sinal tipado de cota esgotada; entrada na escada e no fallback | Teste com dois perfis simulados: esgotar o primeiro move a thread para o segundo; perfil de outro estado não recebe despacho; o `ork` não lê nem copia `auth.json`. A fatia só começa com a decisão D1 registrada (registrada em 27/10/2026) |
| F4 Setup, sandbox, MCP, documentação e onboarding | `ork setup` com o `grok`; mapeamento da postura de sandbox; `ork mcp install --host` para o `grok`; confiança da worktree; playbook; guia de onboarding | Teste: a postura mais frouxa sem confirmação recusa com `runtime.sandbox-nao-confirmado`; o MCP instalado traz só as ferramentas enumeradas; o `AGENTS.md` da worktree é carregado na partida headless; `ork docs verificar` verde com a página do runtime; o onboarding lista o `grok` com o modo de autenticação decidido |
| F5 Homologação com ensaio real | Uma thread `#Fast` de uma fase conduzida de ponta a ponta pelo `grok`, em credencial que o dono autoriza no modo decidido | O ensaio fecha com a sessão vista pelo watcher, claims verificados, `ork verify` verde e o ledger sem auto-relato como prova. Se o fornecedor não autorizar o modo escolhido, a fatia para e volta ao dono |

- **Premissas / riscos / mitigação:**
  - **Política de uso:** ela proíbe acesso aos serviços por meios automatizados "não autorizados", enquanto a documentação promove o headless e o ACP para scripts e orquestradores (D1). Mitigação: a decisão foi do dono (D1 b, 27/10/2026), que aceitou o risco; se o fornecedor não autorizar o modo, a F5 para e volta ao dono.
  - **Produto em beta:** o lançamento foi em beta inicial para assinantes (G1), e a documentação traz a série 1.0.x; a GA não está confirmada. Mitigação: `versao()` no adaptador, `--no-auto-update` no comando e teste de contrato do formato do stream.
  - **Cota esgotada sem formato conhecido:** sem ele o sinal tipado de E5 não existe. Mitigação: a F3 não tipa cota por texto do `grok`, e o runtime fica fora da escada automática e do fallback; o formato vem do ensaio real (F5), com o runtime de verdade.
  - **Repositório espelho:** o código é Apache-2.0, sincronizado do monorepo interno e sem contribuição externa (G4). Mitigação: nenhuma, e correção de comportamento do runtime depende do fornecedor.
  - **Concorrência no mesmo id de sessão:** duas execuções com o mesmo id ao mesmo tempo são "melhor esforço" (G4). Mitigação: o `ork` já mantém uma sessão por worktree.
- **Não-objetivos:** trocar o runtime padrão; ler o banco de busca do `grok`; prometer paridade de modelo ou de qualidade entre runtimes.

### Decisões do dono

**D1. Modo de autenticação do `grok` no Orkastery.** A política de uso da xAI, vigente desde 14/08/2026, proíbe "accessing the Services through unauthorized automated or non-human means, whether through a bot, script, or otherwise" (G15). A documentação e o anúncio do produto dizem o contrário no sentido prático: o modo `-p` serve para "scripts and automations" e o ACP serve para "agent orchestration apps" (G1, G2). Quem decide se o login de assinatura num orquestrador de terceiros é "autorizado" é a xAI, e a fonte não diz.

| Alternativa | O que significa | Custo e risco |
| --- | --- | --- |
| **a (recomendada)** | Começar pela `XAI_API_KEY`, que a documentação indica para CI e automação (G5, G6). A assinatura só entra depois de confirmação escrita da xAI | Fora da zona cinza da política. Cobrança por uso, e o estado de perfil `provider-pago` (hoje fora do despacho) precisa de uma exceção para este runtime em F3, que vai ao dono junto |
| b | A assinatura agora | Risco de a política ser lida contra o uso, dito aqui, sem confirmação do fornecedor; possível suspensão da conta do dono |
| c | Esperar a GA | Sem risco de política, e o runtime não entra até lá; só F1 e F2 andam |

**Decisão do dono, 27/10/2026, no terminal (resposta "3.b"): alternativa b, a assinatura agora.** O dono aceitou o risco descrito acima: a política de uso da xAI pode ser lida contra o uso automatizado, com possível suspensão da conta, e a xAI não confirmou que o login de assinatura num orquestrador de terceiros é "autorizado". Com ela, o `grok` despacha pelo login de assinatura do perfil (`GROK_HOME`), o filho segue sem `XAI_API_KEY`, e o estado `provider-pago` continua sem despacho. Meta, janela e piloto continuam a definir pelo dono.

**D2. O MCP do `ork` com o sandbox do `grok` ligado.** A F4b achou no guia oficial de sandbox (G17) que ele vale para o processo inteiro do `grok` e os filhos: o servidor MCP do `ork`, filho do `grok`, lia o estado no piso `workspace`, mas não gravava o ledger nem os artefatos, e a fase pararia sem prova.

| Alternativa | O que significa | Custo e risco |
| --- | --- | --- |
| **a (escolhida)** | O servidor MCP do `ork` fora do sandbox do `grok`: o `ork` o sobe como processo próprio, vinculado à thread e à sessão, e o `grok` se conecta pelo transporte que a fonte oficial aceita para servidor externo | Um canal local por sessão, que só pode aceitar a sessão filha daquela thread |
| b | A postura `danger-full-access` confirmada, com o `grok` no perfil `off` | A sessão inteira roda sem sandbox |
| c | O `grok` só em fases de leitura | O `grok` não grava artefato, commit nem entrega pelo núcleo |

**Decisão do dono, 27/10/2026, no terminal (resposta "3.a"): alternativa a, o MCP do `ork` fora do sandbox do `grok`.** O `grok` continua no `workspace`, sem `danger-full-access`, `--yolo` ou `bypassPermissions`. Entregue na F4c (thread `ork-rm067f4cmcpd`), abaixo.

**Decisão da condutora, registrada no ledger:** uma página por runtime (RM-066 e RM-067), sem fatia comum, porque cada um avança no próprio ritmo.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-27 | Julio |
| Documentação | Em revisão | — | 2026-10-27 | Julio |
| Código | Mesclado | commit `c3801f4` · PR ##205 | 2026-10-27 | Julio |
| Testes | Aprovados | — | 2026-10-27 | Julio |
| Deploy | Não implantado | — | 2026-10-27 | Julio |
| Exposição | Flag desligada | — | 2026-10-27 | Julio |
| Habilitação | Pendente | — | 2026-10-27 | Julio |

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

### F3 entregue (thread `ork-rm067f3perfi`)

As provas usam o mesmo `grok` simulado da F1 e da F2, com um `GROK_HOME` temporário por perfil (`core/test/rm067-grok-perfis.test.ts`).

- **Perfis** (`core/src/runtime-profiles.ts`): o `grok` aceita perfil, com o diretório em `grokHome`, que vira o `GROK_HOME` do filho (`core/src/adapters/grok.ts`). O despacho escolhe o perfil da vez pela mesma regra do `claude-bg` e do `codex`, a sessão é procurada na casa do perfil, e o watcher a acompanha lá.
- **Login:** `ork accounts add <id> --runtime grok --dir <dir>` roda `grok login` com o `GROK_HOME` do perfil, e `--device-auth` (só no `grok`) roda `grok login --device-auth`; sem TTY, imprime o comando. O `ork` nunca lê nem copia o `auth.json`: o teste deixa um FIFO no lugar dele, que travaria quem o abrisse, e confere que nenhum arquivo do projeto tem a credencial simulada.
- **Conferência de login:** o `grok` não documenta um comando de status do login. O perfil entra no rodízio sem conferência prévia (`ork accounts add` e `check` dizem isso, e o `check` mantém o estado), e quem prova o login é o despacho: o erro de login do runtime vira `runtime.auth-missing` e tira o perfil. Perfil reprovado só volta pelo `ork accounts remove` e `add` depois do `grok login`.
- **Cota esgotada:** o formato do erro de cota do `grok` não está confirmado, então nenhum texto dele vira `runtime.quota-exhausted` (a frase de cota no `error` ou no stderr não marca o perfil). Até a F5 ler o formato estruturado, o `grok` fica fora da escada automática (o degrau "outro perfil" da escada de recuperação pula com `runtime-so-por-pedido`) e do fallback (ele nunca é alvo de `--fallback`), como o playbook dos runtimes registra (`docs/referencia/contratos/playbook-runtimes-i09.md`).
- **Dois perfis:** com o primeiro perfil esgotado no store, a rotação do retry acha o segundo e o redespacho da thread sai por ele, com a sessão na casa dele; o despacho novo também o pula. Perfil `sem-auth`, `provider-pago`, `desativado` ou esgotado no prazo não recebe despacho, nem pedido por `--perfil`.
- **Fora da F3:** as sessões `grok` não entram no inventário por conta (`ork sessions`, a carga do rodízio por carga, a medição do #Noctum); num projeto com o MCP do `ork`, o `ork retry` não rota o `grok` até a F4.
- **Paridade:** os testes do `claude-bg` e do `codex` passam sem alteração.

### F4 entregue em parte (thread `ork-rm067f4setup`)

As provas usam o mesmo `grok` simulado (`core/test/rm067-grok-setup.test.ts`, `core/test/runtimes-grok.test.ts`, `core/test/grok.test.ts`).

- **Setup (E6):** o `grok` é runtime de bloco e entra no fallback `grok:<modelo>[:esforço]` do `ork setup` (`RUNTIMES_DE_BLOCO` em `core/src/runtimes.ts`), sempre com o modelo dado pelo dono: trocar o runtime do bloco sem `--model` recusa, e o modelo do `claude-bg` nunca vira o do `grok`. O padrão do projeto (`runtime.adapter`) segue `claude-bg` e `codex`, e o manifesto com `adapter: grok` recusa. O modelo padrão do `grok` continua a definir pelo dono.
- **Esforço:** o esforço do Orkastery vai ao `--effort` do `grok` com o mesmo nome (`low`, `medium`, `high`, `xhigh`, `max`, níveis canônicos do guia headless), e o `eco` vira `minimal`, para a escada de esforço seguir com degraus distintos. O menu de cada modelo só o runtime conhece (`grok models`): o nível que o modelo não anuncia é recusado pelo próprio `grok` no despacho.
- **Sandbox (E7):** `workspace` é o piso; `read-only` vem de `runtime.sandbox: read-only` e do PLAN que fecha o bloco; `danger-full-access` vira `off` (sem sandbox) só com `ork setup sandbox confirmar danger-full-access` nesta máquina. Sem a confirmação, `ork phase run` e `ork retry` recusam com `runtime.sandbox-nao-confirmado`, como no `codex`. Nenhuma postura leva `--yolo`, `--always-approve` nem `--permission-mode`. O `strict` do `grok` não tem postura do Orkastery que o peça.
- **Confiança da worktree (E8):** o comando leva `--trust` logo depois do `--cwd` da worktree da thread, e o `AGENTS.md` dela entra na partida headless (G4, G17). A confiança também liga, nessa pasta, as regras de permissão e os hooks de projeto que o `grok` lê; não aprova ferramenta nenhuma.
- **Retry:** num projeto com o MCP do `ork`, o `grok` tem capacidade tipada `runtime.context.no-host`; a troca de perfil dentro do `grok` vale (`capacidadeDaRotacao` em `core/src/runtime-context.ts`), e o `ork retry` troca a conta dele como troca a dos outros runtimes. Como alvo de fallback de uma thread que tem o MCP, ele fica de fora, porque a sessão perderia o contexto.
- **Inventário:** o `ork sessions` e a carga do rodízio leem as sessões `grok` pela pasta `sessions/` de cada `GROK_HOME`, só pelos nomes e pelo mtime do `updates.jsonl`, nunca o conteúdo; viva é a escrita nos últimos 30 min. A conta do processo do `grok` só entra quando essa pasta existe.
- **Playbook e onboarding (E9):** a seção do `grok` em `docs/referencia/contratos/playbook-runtimes-i09.md` e a tabela de runtimes em `docs/guias/onboarding.md`, com a assinatura (D1 = b) e as lacunas.
- **Paridade:** os testes do `claude-bg` e do `codex` passam sem alteração; o `ORDEM_DOS_RUNTIMES` (o padrão do projeto) não mudou.
- **Fora desta thread:** o host MCP do `grok` (`ork mcp install --host grok` e `ork mcp serve --host grok`) e o `grok` no `ork_phase_run` do MCP. Os dois mudam `core/src/mcp-server.ts`, e listar o `grok` na tela do setup muda `core/src/setup.ts`; os dois arquivos são contrato público (`core/src/contrato-publico.ts`), que uma thread `#Fast` não commita. A decisão está no ledger da thread, e a F4b pede uma thread com PLAN e CHECK. A F4b, abaixo, os entregou.

### F4b entregue (thread `ork-rm067f4bhost`)

As provas usam o mesmo `grok` simulado (`core/test/rm067-grok-mcp.test.ts`, `core/test/session-watcher-grok.test.ts`, `core/test/rm067-grok-setup.test.ts`, `core/test/runtimes-grok.test.ts`). As fontes do MCP, do sandbox e das permissões foram relidas em 27/10/2026 (G5, G16, G17).

- **Instalação (E8):** `ork mcp install --project <raiz> --host grok` grava `[mcp_servers.orkastery]` no `.grok/config.toml` do projeto, por acréscimo, com o `--ship-transport` e o perfil filho (`--child-permissions`), como o codex. Repetir dá `igual`; a entrada divergente, o TOML ilegível ou fechado e o link recusam sem mudar bytes, e o `--owner-permissions` segue só do Codex. A entrada da raiz marca o projeto e o perfil filho: o servidor do `grok` não serve sem `--thread`.
- **Servidor só da sessão filha:** `ork mcp serve --host grok` sem `--thread` recusa com `mcp.host.child-only`. Com a thread, ele lista só as ferramentas do perfil filho, as que o `--allowedTools` do `claude-bg` libera: no `interactive`, as consultas, `ork_artifact_write` e `ork_decision_record` (o PLAN as usa); no `worktree`, as consultas, `ork_git_status` e as seis mutações; com a flag do grafo, as consultas dele. Sem diálogo no headless, ele não cria o ingresso HITL local nem o da nota, e a condução que ele toma declara o canal `grok`, o sétimo do registro.
- **Contexto e despacho:** num projeto preparado por qualquer host, o `grok` recebe o contexto do MCP no `ork phase run` e no `ork retry`, sem adaptador instalável (ele não tem catálogo do Orkastery). O despacho grava na worktree, fora do git, o `.grok/config.toml` com o servidor vinculado à thread e ao despacho (`--thread`, `--dispatch`) e um `.grok/.gitignore` só com os nomes dos arquivos do `ork`: regra ou arquivo novo que a sessão deixe em `.grok/` segue visível ao git e à prova do GO. O comando leva no fim um `--allow MCPTool(orkastery__<ferramenta>)` por ferramenta liberada, a mesma lista do `--allowedTools` do `claude-bg` no mesmo caso. A thread sem worktree própria recusa o `grok` com o MCP (`runtime.context.worktree`), porque na raiz a config da sessão viraria a entrada do projeto.
- **Recusas da config:** a config versionada, a sem a marca do `ork` na primeira linha, o link no lugar do arquivo e o `$` num campo do servidor (o `grok` expande `${VAR}`, G16) recusam com `runtime.context.conflict`, e a pasta `.grok` em link, com `runtime.context.worktree`, sempre sem escrever; o ensaio (`--dry-run`) não escreve. Não versione o `.grok/config.toml` da raiz: ele tem caminhos desta máquina, e, versionado, ele vai a cada worktree e o despacho com o MCP o recusa.
- **Config do time:** o `.grok/config.toml` do projeto é a config do próprio `grok`. Ilegível ou divergente, ele recusa o `grok`, com `runtime.context.conflict`, sem repetir o arquivo nem o caminho. Para o `claude-bg` e o `codex`, a falha dele só conta quando a entrada `orkastery` dele é a única preparação do projeto: aí eles recusam também, em vez de despachar como num projeto legado, sem o MCP.
- **Sem MCP de outros clientes:** o filho roda sempre com `GROK_CLAUDE_MCPS_ENABLED=0` e `GROK_CURSOR_MCPS_ENABLED=0` (G5, G16), com ou sem o MCP do `ork`, e a retomada pronta para colar leva as duas na frente. Com o MCP, ela avisa também que parte do `.grok/config.toml` da worktree como ele está, porque a sessão podia escrever nele; o `ork retry` o reescreve antes de redespachar.
- **`ork_phase_run` e setup:** o `ork_phase_run` do MCP aceita o `grok`, com a mesma recusa do CLI sem `--model`. A tela do setup, a ajuda e as recusas de runtime e de fallback listam `claude-bg`, `codex` e `grok`; as recusas "só por pedido", sem runtime que as alcançasse desde a F4, saíram.
- **Retry e fallback:** o `ork retry` troca o perfil do `grok` também num projeto com o MCP, e o despacho pedido leva o contexto. Como destino automático de outra thread (o fallback e a escada), ele segue fora num projeto preparado, agora pelo sandbox (`runtime.context.sandbox`): no piso `workspace` a fase pararia sem prova. A escada segue sem trocar a conta dele (cota sem sinal tipado). A F4c o devolveu ao fallback.
- **Prova sob o lock:** o watcher do `grok` refaz a prova do `ork` com o ledger relido sob o lock da sessão. Se ela mudou entre as duas leituras, por inteiro (um commit, um verify ou um `ship_done` gravado pelo MCP no fim da sessão), a decisão fica para a volta seguinte, como a do Stop no `claude-bg`, e o `phase_result` leva a prova refeita.
- **Limite do sandbox (G17):** o guia oficial de sandbox diz que ele vale para o processo inteiro do `grok`, desde a partida, e que os filhos herdam a restrição de arquivo; no `workspace`, a escrita só vale no cwd, em `~/.grok/` e nas pastas temporárias. O servidor MCP do `ork` é filho do `grok`: com `workspace` ou `read-only`, ele lê o estado, mas não grava o ledger nem os artefatos (na raiz do projeto, fora da worktree), e o git de uma worktree ligada (na pasta `.git` da raiz) também fica fora. Só o perfil `off`, da postura `danger-full-access` confirmada por `ork setup sandbox confirmar`, deixa as mutações do MCP gravarem; até a F5 confirmar, a sessão `grok` no piso `workspace` usa só as consultas do MCP. A F4c, abaixo, tirou o servidor do sandbox (D2).
- **Paridade:** os testes do `claude-bg` e do `codex` passam sem alteração; o `claude-bg` só passou a exportar as duas listas de ferramentas que o `grok` reaproveita.

### F4c entregue (thread `ork-rm067f4cmcpd`)

As provas usam o mesmo `grok` simulado, agora com um cliente MCP como o do guia (`core/test/rm067-grok-mcp-externo.test.ts`), e um teste de integração local roda o `grok` simulado confinado pelo Landlock do kernel como o perfil `workspace` (`core/test/rm067-grok-landlock.test.ts`). As fontes do MCP remoto e do sandbox foram relidas em 27/10/2026 (G5, G7, G16, G17).

- **Transporte (G16):** o guia oficial aceita servidor MCP externo pela forma `url` (a seção "HTTP/SSE Transport (Remote Server)" e `grok mcp add --transport http`), tratada pelo próprio `grok`, sem subprocesso. Socket Unix não é documentado e não entra.
- **Servidor fora do sandbox (D2):** com o MCP do `ork`, o despacho `--runtime grok`, pelo `ork phase run` e pelo `ork retry`, sobe antes do `grok` um processo do próprio `ork`, filho do processo que despacha e nunca do `grok` (`core/src/adapters/grok-mcp.ts` e `core/src/adapters/grok-mcp-servidor.ts`): Streamable HTTP só em `127.0.0.1`, porta efêmera, caminho `/mcp`, vinculado à thread e ao despacho. A config da worktree passa a ter `url` e `bearer_token_file`, sem `command`, e o `grok` segue no `workspace` (ou no `read-only` do PLAN que fecha o bloco), sem `off`, `--yolo`, `--always-approve` nem `--permission-mode`.
- **Canal só da sessão filha:** o token tem 256 bits por despacho, gerado pelo servidor num arquivo 0600 da pasta de sessões da thread (fora da worktree e do git), que o `grok` lê a cada requisição pelo `bearer_token_file` (G16; com ele, o `grok` pula a descoberta OAuth); o token nunca vai a argv, ambiente, ledger ou config. O servidor confere o endereço do loopback, o caminho, o `Host` exato e a ausência de `Origin` (contra DNS rebinding e navegador), o token em tempo constante e o método, e limita o corpo e as sessões MCP. O token de outro despacho e o processo sem token recebem 401; com o token certo, outra thread recebe `mcp.thread.scope`; a porta não escuta fora do loopback.
- **Só as ferramentas do despacho:** o servidor lista exatamente as do `--allow` daquele despacho, da mesma chamada que monta o comando, e a ferramenta fora dela não existe para a sessão (`mcp.tool.unknown`). Isso fecha a lacuna "Servidor por despacho" da F4b.
- **O servidor morre com a sessão:** ele sai com o recibo do supervisor, com o processo do `grok` ausente (pid, início e boot), sem a partida do `grok` no prazo e com um sinal, e o despacho o encerra em toda falha depois de subi-lo. No fecho, ele apaga o token, deixa de aceitar conexão e espera a requisição em andamento, com teto, para não cortar uma mutação. O recibo do servidor (`<sessão>.grok-mcp.json`, na pasta de sessões da thread) diz o motivo.
- **A fase fecha com prova:** com o `grok` simulado, o filho no `workspace` grava a decisão, a claim e o artefato pelo servidor externo, e o watcher fecha a fase como `fase_concluida`. Com o Landlock do kernel, o `grok` simulado confinado como o `workspace` não grava o ledger pelo servidor stdio da F4b (a ferramenta volta com `EACCES`) e grava pelo servidor externo.
- **Fallback:** com isso, o `runtime.context.sandbox` deixa de barrar o `grok`: num projeto com o MCP, ele volta a ser destino do fallback do retry e do degrau de fallback da escada, que segue sem trocar a conta dele (cota sem sinal tipado).
- **`auth.json`:** o servidor e o despacho nunca abrem o `GROK_HOME`; com um FIFO no lugar do `auth.json` do perfil, o despacho com o servidor termina sem travar.
- **Retomada manual:** o servidor terminou com a sessão e o token foi apagado, então a retomada pronta para colar roda sem o MCP do `ork` (e não alcança o servidor de outra sessão que pegue a mesma porta), e o aviso dela diz isso e manda pelo `ork retry`, que sobe outro servidor e reescreve a config.
- **Paridade:** os testes do `claude-bg` e do `codex` passam sem alteração.

### O que falta

- **Cota esgotada tipada:** o formato estruturado do erro de cota do `grok`, lido no ensaio real (F5); só com ele o `grok` entra na escada automática.
- **Conferência de login:** um comando do próprio `grok` que diga o login sem o `ork` ler o `auth.json`, se o fornecedor documentar um.
- **MCP no ensaio real:** a conexão do `grok` de verdade ao servidor do `ork` pela `url`, no `workspace` e no `read-only` do PLAN (o guia só bloqueia a rede dos filhos, e o cliente HTTP do MCP é do próprio processo), e se ele abre fluxo `GET` (o servidor responde 405, como a especificação do Streamable HTTP permite).
- **`.mcp.json` do projeto:** fonte separada do `grok`, sem variável que a desligue (G16). O `orkastery` da config da worktree vence pelo nome, nenhuma ferramenta de outro servidor entra no `--allow`, e a F5 confirma se o headless recusa a ferramenta fora dele. A F4c não mudou isso: o único ajuste documentado (`grok mcp disable`, que grava `disabled_mcp_servers`) mora na config do usuário, que o `ork` não edita.
- **Config da worktree entre partidas:** no perfil `workspace` a sessão escreve no cwd, então pode mudar o `.grok/config.toml` que a retomada manual reusa. Desde a F4c, a retomada manual roda sem o MCP do `ork` (o servidor terminou com a sessão), o `ork retry` sobe outro servidor e reescreve a config, e a retomada pronta para colar avisa; conferir o arquivo pelo hash gravado no despacho, numa retomada pelo próprio `ork` (`-r`), fica para a F5, com essa retomada.
- **F5:** o ensaio real de homologação, que também confirma o `-s` com o id do `ork`, o formato do stream, o comportamento sem aprovação automática e a conexão do MCP pela `url`.
- **Lacunas menores:** a retomada automática pelo `ork retry` com `-r`; o status do roadmap e a prova de vida do retry ainda não leem a sessão `grok` (quem impede a segunda sessão na worktree é o lease da condução, que só solta com o resultado); o pedido de impedimento do dono ainda manda o binário `claude` para o `grok`; a medição de consumo do #Noctum.

### Fontes

Consultadas em 19/10/2026.

- G1: <https://x.ai/news/grok-build-cli> (25/05/2026)
- G2: <https://docs.x.ai/build/cli/headless-scripting>
- G3: <https://docs.x.ai/build/cli/reference>
- G4: <https://github.com/xai-org/grok-build,> o README e os guias `14-headless-mode`, `17-sessions`, `02-authentication` e `12-project-rules`, em `crates/codegen/xai-grok-pager/docs/user-guide/`
- G5: <https://docs.x.ai/build/settings/reference> (relida em 27/10/2026: o servidor remoto aceita `url`, `headers` e `bearer_token_env_var`)
- G6: <https://docs.x.ai/build/enterprise>
- G7: <https://docs.x.ai/build/features/sandbox> (relida em 27/10/2026, atualizada em 21/07/2026: o `workspace` libera a rede dos filhos, e a rede do próprio processo não é bloqueada pelos perfis)
- G8: <https://docs.x.ai/build/features/hooks>
- G14: <https://docs.x.ai/x-subscription/usage-limits>
- G16: o guia `07-mcp-servers` do repositório oficial (`crates/codegen/xai-grok-pager/docs/user-guide/07-mcp-servers.md` em <https://github.com/xai-org/grok-build>) e <https://docs.x.ai/build/features/mcp-servers>, consultados em 27/10/2026; relidos em 27/10/2026 na F4c: a forma `url` ("HTTP/SSE Transport (Remote Server)"), o `bearer_token_file` (lido a cada requisição, sem descoberta OAuth) e a forma nativa sem subprocesso
- G17: os guias `12-project-rules`, `18-sandbox` e `22-permissions-and-safety` do mesmo repositório, consultados em 27/10/2026; o `18-sandbox` relido em 27/10/2026 na F4c: no `workspace`, "Network access is allowed for tools like web_search and MCP servers"
- G15: <https://x.ai/legal/acceptable-use-policy;> a página oficial devolveu acesso negado ao leitor automático, e a cláusula foi lida numa cópia do arquivo da web (`web.archive.org`) da mesma página
- npm: <https://registry.npmjs.org/@xai-official/grok/latest>

Pontos que a página não confirma:

- se o `grok` real conecta ao servidor do `ork` pela `url` no `read-only` (o guia só bloqueia a rede dos filhos) e se ele abre fluxo `GET` no Streamable HTTP;
- a GA, a mensagem e o formato do CLI na cota esgotada e o menu de esforço de cada modelo;
- se o headless recusa a ferramenta MCP fora do `--allow`, se o `grok` passa o ambiente dele ao servidor MCP stdio e se o `.mcp.json` do projeto carrega na partida headless;
- se a confiança dada por `--trust` com o sandbox ligado é só da sessão (o guia de sandbox diz que o arquivo de confiança fica só leitura sob os perfis com sandbox);
- se o login de assinatura num orquestrador de terceiros é "autorizado".

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: condutor da thread `ork-runtimesnovo` para a página, da thread `ork-grokbuild` para F1 e F2, da thread `ork-rm067f3perfi` para F3, da thread `ork-rm067f4setup` para a F4 da thread `ork-rm067f4bhost` para a F4b e da thread `ork-rm067f4cmcpd` para a F4c; A: Julio; C: A definir; I: A definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a página foi redigida por agente em #Fast, a partir do pedido do dono e das fontes citadas; F1 e F2 foram implementadas por agente em #Auto na thread `ork-grokbuild`, F3 em #Fast na thread `ork-rm067f3perfi`, a F4 em #Fast na thread `ork-rm067f4setup` a F4b em #Auto na thread `ork-rm067f4bhost` e a F4c em #Auto na thread `ork-rm067f4cmcpd`, com testes sobre o `grok` simulado; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** Julio define meta, janela e piloto e o modelo padrão do `grok`, antes da F5. Sem prazo definido.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-19 | Item criado em Discovery, com cinco fatias propostas e a decisão D1 aberta | Pedido do dono de 19/10/2026; fontes reconferidas na mesma data | Julio |
| 2026-10-25 | F1 e F2 entregues na thread `ork-grokbuild`, com o `grok` simulado; F3 a F5 seguem propostas, e a F3 espera a D1 | Prioridade do dono de 25/10/2026; testes do adaptador, do stream, do registro, do watcher e de ponta a ponta | Julio |
| 2026-10-27 | D1 decidida: alternativa b, a assinatura agora, com o risco da política de uso aceito; a D1 deixa de bloquear | Resposta "3.b" do dono no terminal, em 27/10/2026 | Julio |
| 2026-10-27 | F3 entregue na thread `ork-rm067f3perfi`, com o `grok` simulado; o `grok` fica fora da escada automática e do fallback até a F5 confirmar o formato da cota | Pedido do dono de 27/10/2026; `core/test/rm067-grok-perfis.test.ts` | Julio |
| 2026-10-27 | F4 entregue em parte na thread `ork-rm067f4setup`: setup de bloco e fallback, esforço, sandbox com confirmação, `--trust`, troca de perfil no retry, inventário, playbook e onboarding; o host MCP do `grok` vira F4b, porque muda contrato público | Pedido do dono de 27/10/2026; `core/test/rm067-grok-setup.test.ts`; recusa `mcp.git.contract.protected` do commit `#Fast` | Julio |
| 2026-10-27 | F4b entregue na thread `ork-rm067f4bhost`: host MCP do `grok` (instalação, servidor só da sessão filha, config da worktree com o `--allow` das ferramentas enumeradas), o `grok` no `ork_phase_run` e na tela do setup, e a prova do `ork` sob o lock; o sandbox do `grok` vale também para o MCP, que só grava com o perfil `off` | Pedido do dono de 27/10/2026; `core/test/rm067-grok-mcp.test.ts`; guia `18-sandbox` (G17) | Julio |
| 2026-10-27 | D2 decidida: alternativa a, o MCP do `ork` fora do sandbox do `grok`; o `grok` segue no `workspace` | Resposta "3.a" do dono no terminal, em 27/10/2026 | Julio |
| 2026-10-27 | F4c entregue na thread `ork-rm067f4cmcpd`: o servidor MCP do `ork` fora do sandbox do `grok` (Streamable HTTP no loopback, token por despacho, só as ferramentas do despacho, vida presa à sessão), a fase no `workspace` fechando com prova e o `grok` de volta ao fallback de um projeto com o MCP | Pedido do dono de 27/10/2026; `core/test/rm067-grok-mcp-externo.test.ts`; `core/test/rm067-grok-landlock.test.ts`; guia `07-mcp-servers` (G16) | Julio |
