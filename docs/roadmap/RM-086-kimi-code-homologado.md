---
id: RM-086
tipo: roadmap
titulo: Kimi Code homologado ao lado de Codex e Claude Code
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-11T18:30:00-03:00
estado:
  ciclo: Discovery
  documentacao: Rascunho
  codigo: Não iniciado
  testes: Não iniciados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: null
  modo: null
---

# RM-086: Kimi Code homologado ao lado de Codex e Claude Code

> **Em uma frase:** o Kimi Code passa a despachar fases, ter o fim observado e participar do rodízio de contas do `ork`, com o mesmo contrato de prova dos runtimes homologados e sem usar a assinatura em automação não interativa antes da decisão do dono.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Pedido do dono de 09/11/2026, no terminal:** "Inclua no roadmap a integração/homologação do orkastery com os runtimes <https://www.kimi.com/code/> e <https://opencode.ai/>". Esta página é só planejamento: nenhum código nem teste foi escrito, e os critérios de aceite abaixo são o que cada fatia terá de provar.

**Decisão de condução:** uma página por runtime, porque cada um avança no próprio ritmo. O Google Antigravity tem a [RM-066](RM-066-google-antigravity-homologado.md), o Grok Build tem a [RM-067](RM-067-grok-build-homologado.md) e o OpenCode tem a [RM-087](RM-087-opencode-homologado.md).

**Nome e distribuição:** o produto é Kimi Code, o binário é `kimi` e o pacote oficial é `@moonshot-ai/kimi-code`, sob licença MIT. O `kimi-cli` antigo em Python está arquivado, e o pacote npm `kimi-code` sem escopo não é a distribuição oficial (K11, K16, K17).

## Problema e resultado

- **Público e problema/oportunidade:** o dono que já conduz fases pelo `claude-bg`, pelo `codex` e pelo `grok` quer homologar o Kimi Code como outro runtime de despacho, com perfis, fallback e prova independente. Hoje `RUNTIMES` e `RUNTIMES_DE_BLOCO`, em `core/src/runtimes.ts`, registram somente esses três runtimes; `ORDEM_DOS_RUNTIMES` aceita apenas `claude-bg` e `codex` como padrão do projeto.
- **Evidências e fonte:** o pedido do dono de 09/11/2026, a pesquisa oficial da mesma data e o estado atual do núcleo em `core/src/runtimes.ts`, `core/src/runtime-profiles.ts`, `core/src/mcp-install.ts` e `core/src/playbook-capabilities.ts`.
- **Objetivo/OKR:** o `kimi` aparece no despacho explícito e no setup como runtime homologado, com `dry-run`, perfis isolados, fim observado por fonte do runtime, falha tipada e nenhuma alegação do agente usada como prova.
- **Hipótese:** se o adaptador consumir o `stream-json`, relacionar o `session_id` à transcrição gravada e isolar cada perfil por `KIMI_CODE_HOME`, então o Kimi Code pode cumprir o contrato de despacho sem mudar o comportamento dos runtimes atuais.
- **Métrica principal / linha de base / meta / janela / fonte:** fases de uma thread concluídas pelo `kimi`, com o fim observado pelo watcher e claims verificados. Linha de base: não há adaptador. Meta e janela: A definir pelo dono. Fonte: ledger da thread e recibos do verify.
- **Métricas de proteção:** nenhuma regressão em `claude-bg`, `codex` ou `grok`; nenhuma credencial lida ou copiada pelo `ork`; nenhum perfil pago despachado por engano; nenhum uso contrário à política citada em K15.

## Escopo e validação

- **Incluído:** adaptador e despacho headless; fim da sessão e watcher; perfis, login e cota esgotada; setup, sandbox, MCP, documentação e onboarding; ensaio real; depois dele, o host de condução (F6), como o Codex.
- **Fora de escopo:** tornar o `kimi` o runtime padrão; integrar o `kimi-cli` arquivado; usar o pacote npm sem escopo; alterar a identidade do aplicativo; comprar assinatura, chave ou cota; supor sandbox, evento ou campo que a fonte não documente.
- **Entregáveis e critérios de aceite:** as seis fatias da seção "Plano e decisões", cada uma com prova reproduzível.
- **Piloto, medição e critérios de expansão/interrupção:** A definir pelo dono. O ensaio interrompe se o modo de autenticação escolhido contrariar a política vigente ou se faltar sinal externo suficiente para provar o fim.

### O que o Orkastery exige e o que o Kimi Code oferece

As colunas sobre o runtime citam as fontes da seção "Fontes". "Não confirmado" significa que nenhuma fonte consultada afirma o comportamento.

| # | O que o Orkastery exige (onde está hoje) | O que o `kimi` oferece | Lacuna |
| --- | --- | --- | --- |
| E1 | Um `RuntimeAdapter` em `RUNTIMES`, com `disponivel`, `versao`, `montarComando`, `despachar`, `fonteVerificacao` e `dry-run`. Hoje há `claude-bg`, `codex` e `grok`; os três são runtimes de bloco, e só os dois primeiros podem ser padrão do projeto (`core/src/runtimes.ts`) | `kimi -p "<prompt>" --output-format stream-json` produz JSONL; `-m` escolhe o modelo. O headless já usa permissão automática e recusa `--yolo`, `--auto` e `--plan`. O esforço e o limite de passos vêm do config ou do ambiente; o diretório de trabalho é o do processo; a atualização automática pode ser desligada (K1, K2, K6) | Escrever o adaptador e decidir se entra apenas no despacho explícito, também em `RUNTIMES_DE_BLOCO` ou ainda em `ORDEM_DOS_RUNTIMES`. Não há flag documentada de diretório de trabalho |
| E2 | Fim observado por fonte externa ao relato do agente; cada adapter atual relaciona a sessão a uma fonte gravada pelo runtime e o watcher emite um único resultado | A última linha do stream é `session.resume_hint`, com `session_id` e comando de retomada. A transcrição fica em `$KIMI_CODE_HOME/sessions/<workspaceId>/<sessionId>/agents/main/wire.jsonl`, com `state.json` e índice. Há hooks `Stop`, `StopFailure`, `SessionEnd` e `Interrupt`, com `session_id` e `cwd`; a retomada aceita `--session` ou `-c` (K1, K3, K4, K5, K16) | O stream não informa motivo final nem uso. Não confirmado: se `SessionEnd` dispara no modo `-p`. Definir qual combinação de stream, recibo do processo, transcrição e hook prova o fim |
| E3 | Falha tipada pelo código de saída e por evento estruturado; texto livre do agente não classifica sucesso, cota ou autenticação | Saída 0 indica sucesso; 1 indica falha com código e mensagem no `stderr`; 4 indica sessão ocupada com erro JSON; `/goal` também usa 3 para bloqueado e 6 para pausado. O código define `provider.rate_limit`, `provider.auth_error`, `provider.overloaded`, `provider.filtered` e `context.overflow` (K7, K16) | Não confirmado na documentação: o contrato da saída 1 no turno comum. O adapter precisa rejeitar stream truncado e nunca inferir a classe só por frase |
| E4 | Perfil por runtime, com uma variável que move configuração, login e sessões; hoje existem `CLAUDE_CONFIG_DIR`, `CODEX_HOME` e `GROK_HOME`. O `ork` executa o login do próprio CLI e não lê segredos; `provider-pago` não recebe despacho (`core/src/runtime-profiles.ts`) | `KIMI_CODE_HOME` move config, sessões e credenciais OAuth. `kimi login` aceita OAuth por código de dispositivo ou chave da Kimi Platform. OAuth fica em arquivo com permissão restrita e chaves ficam no `config.toml`; variáveis de chave comuns não são lidas diretamente, salvo canais explícitos (K1, K2, K3, K11) | Acrescentar o runtime, o campo do perfil e o login sem abrir credenciais. A alternativa recomendada de D1 usa chave paga, hoje incompatível com a recusa geral de `provider-pago` |
| E5 | Cota esgotada só entra no rodízio quando o runtime fornece sinal tipado e prazo; o estado de conta é compartilhado entre projetos pela chave `runtime:diretório-real`. Hoje `grok` está em `RUNTIMES_SEM_COTA_TIPADA`, e não há vínculo da mesma conta entre runtimes (`core/src/runtimes.ts`, `core/src/runtime-profiles.ts`) | Limite aparece como HTTP 429 e vira `provider.rate_limit`, sem nova tentativa. Há variantes por janela, período e concorrência. A assinatura expõe uso e renovação em `/api/v1/oauth/usage` (K10, K12, K13, K16) | O stream não separa limite de taxa de cota esgotada. O endpoint de uso exige política explícita de acesso e só vale para OAuth; com chave da plataforma, o prazo e a medida correspondente não estão confirmados |
| E6 | Setup e fallback preservam modelo e esforço do runtime; hoje `RUNTIMES_DE_BLOCO` contém `claude-bg`, `codex` e `grok` (`core/src/runtimes.ts`) | Modelos incluem `k3.1-pro`, `k3`, `k3-256k`, `kimi-for-coding` e variantes; esforço aceita `low`, `high` e `max`. Também há provedores `kimi`, `anthropic`, `openai`, `openai_responses`, `google-genai` e `vertexai` (K2, K14, K19) | Mapear os esforços do Orkastery, definir modelo e provedor padrão e impedir que uma configuração de outro runtime seja reaproveitada sem decisão |
| E7 | A postura de sandbox e as permissões do filho não podem ampliar as da worktree; modo mais frouxo exige confirmação do dono | O TUI tem Always Ask, `--yolo` e `--auto`; regras `allow` e `deny` e lista de ferramentas ficam no config. No headless, o modo é automático. MCP do projeto só liga com confiança explícita por `KIMI_CODE_TRUST_WORKSPACE=1` (K1, K6, K7, K8) | Sandbox do sistema operacional no Linux: não confirmado. Definir regras fechadas para GO e leitura para PLAN sem tratar permissão do runtime como isolamento do sistema |
| E8 | O MCP do projeto é vinculado à thread e ao despacho; o instalador aceita hoje `claude-code`, `codex` e `grok` e o perfil `worktree` libera somente ferramentas exatas (`core/src/mcp-install.ts`) | MCP de usuário e projeto fica em `mcp.json`; o runtime lê `AGENTS.md`, oferece ACP por `kimi acp` e servidor por `kimi web`, com REST e WebSocket (K1, K8, K9, K10, K18) | Criar o host de instalação e uma configuração por sessão que preserve a confiança da worktree. O runtime não lê `CLAUDE.md`. SDK público no npm: não confirmado |
| E9 | O playbook de capacidades precisa registrar e provar as capacidades do runtime. O contrato em `core/src/playbook-capabilities.ts` ainda enumera somente `codex` e `claude`, apesar de o despacho já ter três runtimes | Agentes `coder`, `explore` e `plan`, escolha por `--agent` e `--agent-file`, e trava da mesma sessão entre processos (K1, K2, K9) | Ampliar o contrato sem declarar homologação antes do ensaio; definir como subagentes aparecem no consumo e no fim da sessão |
| E10 | Consumo só é registrado quando o runtime fornece medida estruturada; estimativa não substitui recibo | `stream-json` não traz tokens nem custo. `/usage` existe no TUI, e o endpoint OAuth de E5 traz proporções e datas de renovação (K10) | Não há consumo por sessão no stream. Custo com chave e percentual de cota com OAuth precisam de fontes distintas; o que faltar fica como lacuna |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** A definir pelo dono.
- **Horizonte / alvo / previsão / confiança / marcos:** A definir pelo dono. As fatias abaixo são propostas e avançam uma por vez.
- **Dependências e bloqueios:** D1 antes de F3; [RM-040](RM-040-estado-de-conta-compartilhado.md) para estado de conta; [RM-064](RM-064-conta-esgotada-nao-para-a-fase.md) para cota e retomada; a política vigente em K15. Próxima revisão: A definir pelo dono.

### Fatias propostas

| Fatia | O que entrega | Critério de aceite (a provar) |
| --- | --- | --- |
| F1 Adaptador e despacho headless | Entrada `kimi` em `RUNTIMES`, comando sobre `kimi -p --output-format stream-json`, modelo, esforço por configuração, limite de passos e atualização desligada; despacho no diretório da worktree; `dry-run` | Com `kimi` simulado, o comando e o ambiente levam apenas as escolhas da thread; `--dry-run` não inicia processo; runtime ausente e conflito de flags recusam com erro tipado; os três adapters atuais passam sem alteração |
| F2 Fim da sessão e watcher | Parser do stream, captura do `session_id`, relação com a transcrição, retomada e watcher com resultado único | Com stream e diretório de sessão simulados, o `session.resume_hint` e o recibo do processo identificam a sessão; saída tipada vira parada; sessão ocupada não duplica despacho; stream truncado ou fim sem prova externa não conclui a fase |
| F3 Perfis, login e cota esgotada | `KIMI_CODE_HOME` por perfil, `kimi login` pelo próprio CLI, modo de autenticação de D1 e sinal conservador de cota para rotação e fallback | Com dois perfis simulados, cada sessão fica no diretório do perfil correto; nenhum segredo é lido; autenticação ausente tira só o perfil correspondente; o primeiro perfil só cede ao segundo quando há sinal tipado e prazo. A fatia só começa após D1 |
| F4 Setup, sandbox, MCP, documentação e onboarding | Runtime no setup, mapeamento de esforço e permissões, host MCP por sessão, `AGENTS.md`, playbook, referência e onboarding | A postura mais frouxa sem confirmação recusa; o MCP expõe apenas as ferramentas autorizadas; projeto sem confiança não ativa MCP; `node core/dist/index.js docs verificar` passa com a documentação do runtime |
| F5 Ensaio real | Uma thread `#Fast` conduzida de ponta a ponta pelo `kimi`, com credencial autorizada no modo decidido | A sessão real fecha com fonte externa, claims verificados e verify verde; o ledger não usa auto-relato como prova; qualquer divergência da política, do stream ou da cota interrompe a homologação e volta ao dono |
| F6 Host de condução | Adaptador de Camada 1 `kimi` em `ork adapter install`, como o do Codex: entrada de condução e catálogo em arquivos do projeto que o runtime lê (`AGENTS.md` e agentes de `--agent-file` (K1, K9)), sem configuração global; MCP do dono por `ork mcp serve --host kimi`; prova de ativação lida da transcrição da sessão (`wire.jsonl`, K3) | `ork adapter install kimi --dry-run` lista só arquivos do projeto; numa sessão nova do dono, a entrada chama o `ork` e a prova de ativação acha a frase de entrada; o MCP do dono expõe só as ferramentas de condução enumeradas; a #TAG vira `--mode` e a validação fica no núcleo. Só começa depois da F5 aprovada |

- **Premissas / riscos / mitigação:**
  - **Política da assinatura:** K15 restringe assinaturas a uso pessoal interativo e exclui automação não interativa. Mitigação: recomendar a chave da Kimi Platform e impedir OAuth de assinatura no despacho até decisão explícita do dono.
  - **Cota e limite de taxa com o mesmo código:** ambos podem chegar como `provider.rate_limit`. Mitigação: sem campo estruturado e prazo, esperar ou falhar de forma tipada, sem marcar cota esgotada.
  - **Permissão não é sandbox:** o headless aprova ferramentas, mas isolamento do sistema no Linux não está confirmado. Mitigação: manter a proteção do host e provar o acesso real antes de habilitar GO.
  - **Mudança frequente:** a linha npm avançou de 0.1.0 a 2.5.2 e mantém canal canary, sem rótulo beta (K17). Mitigação: fixar versão homologada e testar o contrato do stream antes de ampliar a faixa aceita.
  - **Distribuições com nomes próximos:** há pacotes antigos ou de terceiros. Mitigação: aceitar somente o pacote oficial com escopo e o binário cuja versão seja comprovada.
- **Não-objetivos:** alterar a identidade do aplicativo; integrar o runtime Python arquivado; prometer sandbox, custo por sessão ou cota tipada sem fonte; escolher prioridade, meta, janela ou piloto pelo dono.

### Decisão do dono

**D1. Modo de autenticação do `kimi` no Orkastery.** A política vigente diz que a assinatura é para uso pessoal interativo e que automação não interativa fica fora do uso normal; também proíbe alterar a identidade do aplicativo (K15). A documentação oferece OAuth de assinatura e chave da Kimi Platform (K1, K11).

| Alternativa | O que significa | Custo e risco |
| --- | --- | --- |
| **a (recomendada)** | Usar chave da Kimi Platform, em perfil próprio, com cobrança por uso; nunca definir `KIMI_CODE_IDENTITY_SLUG` | Evita o conflito descrito em K15. Exige política explícita para um perfil pago, porque hoje `provider-pago` nunca recebe despacho; custo varia com uso |
| b | Usar OAuth da assinatura Plus ou Pro no headless | Contraria a restrição de uso interativo em K15. O fornecedor cita limitação de acesso concorrente como medida possível; a sanção específica para este caso não está confirmada |
| c | Esperar uma autorização ou modalidade específica do fornecedor | Evita risco de política e custo imediato; o runtime não entra no rodízio, e apenas as fatias sem credencial real podem avançar |

**Decidida pelo dono em 11/11/2026, no terminal: alternativa b.** O dono escolheu a assinatura Plus ou Pro, com login por OAuth, e não a chave da Kimi Platform ("Kimi será com assinatura Plus ou Pro, não com API"). O risco da alternativa b continua registrado na tabela: a diretriz do fornecedor descreve a assinatura como uso pessoal e interativo (K15). A construção deve manter o uso ligado à conta do próprio dono, sem alterar a identidade do aplicativo (`KIMI_CODE_IDENTITY_SLUG`), e registrar no ensaio real qualquer limitação que o fornecedor aplicar.

Prioridade, meta, janela e piloto: **A definir pelo dono**.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-11-11 | Julio |
| Documentação | Rascunho | — | 2026-11-11 | Julio |
| Código | Não iniciado | — | 2026-11-11 | Julio |
| Testes | Não iniciados | — | 2026-11-11 | Julio |
| Deploy | Não implantado | — | 2026-11-11 | Julio |
| Exposição | Flag desligada | — | 2026-11-11 | Julio |
| Habilitação | Pendente | — | 2026-11-11 | Julio |

<!-- ork-docs:estado:fim -->

### Fontes

Consultadas em 09/11/2026.

- K1: <https://moonshotai.github.io/kimi-code/en/reference/kimi-command.html>
- K2: <https://moonshotai.github.io/kimi-code/en/configuration/env-vars.html>
- K3: <https://moonshotai.github.io/kimi-code/en/configuration/data-locations.html>
- K4: <https://moonshotai.github.io/kimi-code/en/guides/sessions.html>
- K5: <https://moonshotai.github.io/kimi-code/en/customization/hooks.html>
- K6: <https://moonshotai.github.io/kimi-code/en/configuration/config-files.html>
- K7: <https://moonshotai.github.io/kimi-code/en/guides/interaction.html>
- K8: <https://moonshotai.github.io/kimi-code/en/customization/mcp.html>
- K9: <https://moonshotai.github.io/kimi-code/en/customization/agents.html>
- K10: <https://moonshotai.github.io/kimi-code/en/reference/server-api.html>
- K11: <https://moonshotai.github.io/kimi-code/en/guides/getting-started.html>
- K12: <https://www.kimi.com/code/docs/en/kimi-code/error-reference.html>
- K13: <https://www.kimi.com/code/docs/en/kimi-code/membership.html>
- K14: <https://www.kimi.com/code/docs/en/kimi-code/models.html>
- K15: <https://www.kimi.com/code/docs/en/kimi-code/community-guidelines.html>
- K16: <https://github.com/MoonshotAI/kimi-code> (`apps/kimi-code/src/cli/v2/run-v2-print.ts` e `packages/agent-core-v2/src/llm-adapter/contract/errors.ts`)
- K17: <https://registry.npmjs.org/@moonshot-ai/kimi-code> e <https://pypi.org/pypi/kimi-cli/json>
- K18: <https://moonshotai.github.io/kimi-code/en/reference/kimi-acp.html>
- K19: <https://moonshotai.github.io/kimi-code/en/configuration/providers.html>

Pontos que a página não confirma: se `SessionEnd` dispara no modo `-p`; motivo de parada e uso no stream; contrato documentado da saída 1 no turno comum; distinção estruturada entre limite de taxa e cota; sandbox do sistema operacional no Linux; SDK público no npm.

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: condutor da thread `ork-kimicodeeope`, somente para esta página; A: Julio; C: A definir; I: A definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** página redigida por agente em #Fast a partir do pedido do dono, do código atual e das fontes citadas; revisor humano: Julio. Nenhum código nem teste foi alterado.
- **Próxima ação, responsável e prazo:** Julio decide D1, prioridade, meta, janela e piloto; sem prazo definido.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-09 | Item criado em Discovery, com cinco fatias propostas e D1 aberta | Pedido do dono de 09/11/2026; código atual e fontes K1 a K19 | Julio |
| 2026-11-09 | F6 "host de condução" acrescentada, para depois do ensaio real, na mesma ordem que o Codex seguiu | Decisão do dono no terminal, em 09/11/2026 (alternativa a) | Julio |
| 2026-11-11 | D1 decidida: assinatura Plus ou Pro por OAuth (alternativa b) | Decisão do dono no terminal, em 11/11/2026, que corrigiu a escolha inicial pela chave da plataforma | Julio |
