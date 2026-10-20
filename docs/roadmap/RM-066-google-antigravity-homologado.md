---
id: RM-066
tipo: roadmap
titulo: Google Antigravity homologado ao lado de Codex e Claude Code
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-19T23:45:00-03:00
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

# RM-066: Google Antigravity homologado ao lado de Codex e Claude Code

> **Em uma frase:** o Google Antigravity (o CLI `agy`) passa a despachar fase, ter o fim visto e entrar no rodízio de contas do `ork`, com o mesmo contrato de prova do `claude-bg` e do `codex`, depois que o dono decidir o modo de autenticação.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Pedido do dono de 19/10/2026:** "adicione no roadmap a inclusão do Google Antigravity como homologado ao lado de codex e claude code". Esta página é só planejamento: nenhum código nem teste foi escrito, e os critérios de aceite abaixo são o que cada fatia terá de provar.

**Decisão de condução:** uma página por runtime, porque cada um avança no próprio ritmo. O Grok Build tem a [RM-067](RM-067-grok-build-homologado.md).

## Problema e resultado

- **Público e problema/oportunidade:** o dono que já conduz fases pelo `claude-bg` e pelo `codex` e quer um terceiro runtime, de outro fornecedor, para o rodízio de contas e para o fallback quando uma cota acaba ([RM-064](RM-064-conta-esgotada-nao-para-a-fase.md)). Hoje o `ork` só despacha por dois runtimes: `RUNTIMES` em `core/src/runtimes.ts` tem duas entradas.
- **Evidências e fonte:** o pedido do dono de 19/10/2026 e a pesquisa de 19/10/2026 sobre o `agy`, com as fontes na seção "Fontes" abaixo, reconferidas na mesma data.
- **Objetivo/OKR:** o `agy` aparece em `ork phase run --runtime` e em `ork setup` como runtime homologado, com o mesmo contrato de despacho: `dry-run`, verificação externa da sessão e nenhum auto-relato como prova.
- **Hipótese:** se o adaptador do `agy` reaproveitar o contrato `RuntimeAdapter` e ler o fim da sessão de uma fonte que o próprio runtime grava (o `result` do `stream-json` e o `transcriptPath` dos hooks), então ele entra no rodízio sem mudar o contrato dos outros dois runtimes, porque o `agy` já tem modo headless com saída de máquina.
- **Métrica principal / linha de base / meta / janela / fonte:** fases de uma thread concluídas pelo `agy` com o fim visto pelo watcher, sem o dono. Linha de base: zero, porque não há adaptador. Meta, janela e piloto: A definir pelo dono depois da decisão de autenticação. Fonte: ledger (`phase_dispatch_verified` e `phase_result` da sessão).
- **Métricas de proteção:** o contrato do `claude-bg` e do `codex` não muda (paridade sem downgrade); nenhum despacho em conta fora do rodízio; nenhuma credencial copiada ou lida pelo `ork`; nenhum uso que a política do fornecedor não autorize.

## Escopo e validação

- **Incluído:** o adaptador de despacho e a saída em stream; o fim da sessão e o watcher; perfis de conta, login e cota esgotada; `ork setup`, sandbox, MCP, documentação e onboarding; o ensaio real de homologação.
- **Fora de escopo:** fazer do `agy` o runtime padrão; o Gemini CLI, que é outro produto; contornar qualquer limite da política do fornecedor; comprar cota ou criar conta, que continua com o dono.
- **Entregáveis e critérios de aceite:** as cinco fatias da seção "Plano e decisões", cada uma com a prova listada.
- **Piloto, medição e critérios de expansão/interrupção:** A definir pelo dono, depois da decisão de autenticação. Interrompe se a política do fornecedor mudar contra o modo escolhido.

### O que o Orkastery exige e o que o Antigravity oferece

As colunas "o que o runtime oferece" citam a fonte entre parênteses (lista em "Fontes"). "Não confirmado" quer dizer que a fonte não diz.

| # | O que o Orkastery exige (onde está hoje) | O que o `agy` oferece | Lacuna |
| --- | --- | --- | --- |
| E1 | Adaptador no registro `RUNTIMES` (`core/src/runtimes.ts`): `disponivel`, `versao`, `montarComando`, `despachar`, `fonteVerificacao`, com `dry-run`; `ork phase run --runtime` resolve por nome | `agy -p "<prompt>"` não interativo, com `--output-format text`, `json` ou `stream-json`, `--input-format stream-json`, `--json-schema`, `--model`, `--effort low`, `medium` ou `high`, `--agent`, `--sandbox`, `--print-timeout` (A1). CLI v1.4.0 de 16/10/2026 (A3) | Escrever o adaptador. Não há registro de sessões que o `ork` possa consultar como o `claude agents --json`: a prova de existência vem do próprio stream (E2) |
| E2 | Fim da sessão visto por fonte externa, nunca por auto-relato (watcher e sensores, RM-004 e RM-034; `core/src/session-watcher.ts`) | `stream-json` com os eventos `init`, `step_update` e `result`, este uma vez ao fim (A1). O envelope `json` traz `conversation_id`, `status`, `num_turns` e `usage` (A1). Hooks `Stop` e `PostInvocation`, com `conversationId` e `transcriptPath` no payload (A7) | O caminho do histórico das conversas não é documentado: o formato é SQLite (`.db`) desde a v1.0.4 (A3, A6). Só o `transcriptPath` dos hooks e o stream servem de fonte. Falta decidir qual vira a fonte canônica |
| E3 | Falha tipada pelo código de saída e pelo erro estruturado, nunca pelo texto do agente (`core/src/adapters/codex-events.ts` faz isso no `codex`) | Sucesso sai 0; falha sem resposta sai com código diferente de zero e o motivo no `stderr`; modelo desconhecido sai 1 (A1). Desde a v1.2.6 o erro headless imprime uma linha `AGY_ERROR` em JSON no `stderr` e sai 3 (A3). Ferramenta que pede aprovação e não a recebe é negada sem parar a execução: sai 0, avisa no `stderr` e lista em `denied_actions` no JSON (A1, A3) | Tratar saída 0 com `denied_actions` como parada tipada, não como sucesso. O sinal de cota esgotada não tem código próprio (ver E5) |
| E4 | Perfis de conta por runtime e login: `VARIAVEL_DO_PERFIL` em `core/src/runtime-profiles.ts` liga o runtime à variável do diretório de configuração; `ork accounts add --runtime R --dir D` roda o login do próprio CLI (RM-033, RM-040) | Login pessoal por OAuth, com URL e código colados no SSH, e credencial no keyring do sistema (A5). Sem barramento D-Bus, o keyring é ignorado (v1.1.3) (A3). Modo headless exige login interativo antes, e sem ele sai com `authentication required` (A1). Chave de API: `GEMINI_API_KEY` com `modelProvider` igual a `gemini` em `~/.gemini/antigravity-cli/settings.json`; ADC com `AGY_ADC_AUTH=true` (A5). Diretório de configuração fixo; variável para trocá-lo: não documentada (A5) | Perfil por conta sem variável de diretório: isolar por `HOME` não está confirmado. O estado `provider-pago` do perfil hoje nunca recebe despacho (login por chave de API), o que conflita com a alternativa recomendada na decisão D1 desta página |
| E5 | Cota esgotada não para a fase (RM-064, RM-063 F4): `runtime.quota-exhausted` só de erro estruturado do runtime (`core/src/conta-esgotada.ts`, `core/src/retry.ts`, `core/src/runtime-escada.ts`) | Cota renova a cada 5 h (planos Pro e Ultra) ou por semana, sem números; passado o limite, créditos comprados cobrem o excesso conforme a configuração da conta (A12). Desde a v1.2.15 a cota esgotada falha na hora, com a mensagem "Your AI credits balance is too low to continue" (A3) | Falta o formato estruturado (código de saída ou campo do JSON) que distingue cota de outra falha, e o prazo de volta. Sem isso o sinal não é tipado e o `ork` não pode marcar o perfil |
| E6 | `ork setup <modo> --bloco N --runtime R --model M --effort E` e fallback `runtime:modelo[:esforco]` (`core/src/setup.ts`); o modelo de um runtime não serve a outro | `--model` aceita um nome de `agy models`, e `--effort` aceita três níveis (A1) | Mapear o esforço do Orkastery aos três níveis do `agy` e definir o modelo padrão do runtime, que o dono confirma |
| E7 | Postura de sandbox (RM-047): o `runtime.sandbox` mais frouxo só despacha depois de `ork setup sandbox confirmar` (`docs/referencia/cli.md`); o filho nunca amplia o que a worktree permite | `toolPermission` com padrão `request-review` no CLI e `proceed-in-sandbox`; sandbox por namespaces do kernel no Linux; `--sandbox` e `--dangerously-skip-permissions` (A10, A1) | Escolher o mapeamento entre a postura do Orkastery e os modos do `agy`, sem usar `--dangerously-skip-permissions` por padrão |
| E8 | MCP do `ork` vinculado à thread e pacote de experiência (RM-016, RM-051): `ork mcp install --host` aceita hoje `claude-code` e `codex` (`core/src/mcp-install.ts`) | MCP em `~/.gemini/config/mcp_config.json` e `.agents/mcp_config.json`, com `mcpServers`, `command` ou `serverUrl` (A8). Lê `AGENTS.md`, `GEMINI.md` e `.agents/rules/` (A9) | Novo `host` no instalador do MCP, com o perfil filho e as ferramentas enumeradas. Os hooks de sensor usam `.agents/hooks.json` (A7) |
| E9 | Playbook dos runtimes (RM-009): `core/src/playbook-capabilities.ts` descreve capacidades por runtime (`codex` ou `claude`) | Capacidades das linhas E1 a E8 | Acrescentar o `agy` ao playbook, com as lacunas acima marcadas |
| E10 | Medição de consumo por runtime no #Noctum (RM-058 N6; `core/src/noctum-medicao.ts`): só o que o runtime gravou, nunca estimativa | `usage` com tokens de entrada, saída, raciocínio, cache e total no envelope `json` (A1) | Percentual da cota: não confirmado. Sem medida estruturada o `ork` registra a lacuna da cota da sessão, como o `core/src/noctum-medicao.ts` já faz quando o runtime não a grava |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** A definir pelo dono. A posição no índice de prioridade do roadmap é decisão dele; esta página não a propõe.
- **Horizonte / alvo / previsão / confiança / marcos:** sem data. As fatias abaixo são propostas, na ordem, e cada uma só começa depois da anterior mesclada.
- **Dependências e bloqueios (ID, owner, próxima revisão):** a decisão D1 (autenticação), do dono, antes de F3; [RM-064](RM-064-conta-esgotada-nao-para-a-fase.md) (cota esgotada e retomada); [RM-063](RM-063-fabrica-que-nao-para.md) (escada de recuperação); [RM-056](RM-056-perfil-por-thread-e-carga.md) (perfil por thread); [RM-040](RM-040-estado-de-conta-compartilhado.md) (estado de conta). Próxima revisão: Julio, após ler esta página.

### Fatias propostas

| Fatia | O que entrega | Critério de aceite (a provar) |
| --- | --- | --- |
| F1 Adaptador e despacho headless | Entrada `agy` em `RUNTIMES`, com `montarComando` e `despachar` sobre `agy -p` e `--output-format stream-json`; `--runtime agy` em `ork phase run`; `dry-run` | Teste com `agy` simulado: o comando montado leva `--model`, `--effort`, o modo de permissão do bloco e `--print-timeout` explícito; `--dry-run` não despacha; runtime ausente recusa com erro tipado; os testes do `claude-bg` e do `codex` passam sem alteração |
| F2 Fim da sessão, transcrição e watcher | Fonte canônica do fim (`result` do stream e `transcriptPath` dos hooks), sensores e watcher próprios do `agy` | Teste com stream simulado: `result` com `status` de sucesso vira um único `phase_result`; saída 3 com `AGY_ERROR` vira parada tipada; saída 0 com `denied_actions` não conta como conclusão; stream cortado sem `result` termina como `runtime.unavailable` depois do prazo |
| F3 Perfis, login e cota esgotada | `agy` em `ork accounts add --runtime`; login pelo próprio CLI; sinal tipado de cota esgotada; entrada na escada e no fallback | Teste com dois perfis simulados: esgotar o primeiro move a thread para o segundo; perfil de outro estado não recebe despacho; o `ork` não lê nem copia credencial. A fatia só começa com a decisão D1 registrada |
| F4 Setup, sandbox, MCP, documentação e onboarding | `ork setup` com o `agy`; mapeamento da postura de sandbox; `ork mcp install --host` para o `agy`; playbook; guia de onboarding | Teste: a postura mais frouxa sem confirmação recusa com `runtime.sandbox-nao-confirmado`; o MCP instalado traz só as ferramentas enumeradas; `ork docs verificar` verde com a página do runtime; o onboarding lista o `agy` com o modo de autenticação decidido |
| F5 Homologação com ensaio real | Uma thread `#Fast` de uma fase conduzida de ponta a ponta pelo `agy`, em conta que o dono autoriza no modo decidido | O ensaio fecha com a sessão vista pelo watcher, claims verificados, `ork verify` verde e o ledger sem auto-relato como prova. Se o fornecedor não autorizar o modo escolhido, a fatia para e volta ao dono |

- **Premissas / riscos / mitigação:**
  - **Termos do fornecedor:** a FAQ não suporta o uso por orquestrador na assinatura de consumidor (D1). Mitigação: a decisão é do dono, e F3 só começa depois dela.
  - **Isolamento de contas:** sem variável de diretório documentada, duas contas na mesma máquina podem colidir no keyring. Mitigação: F3 prova o isolamento antes de aceitar mais de um perfil; sem prova, o runtime entra com um perfil só.
  - **Divergência de documentação:** `--print-timeout` aparece com padrão de 5 minutos na página do modo headless (A1) e como ilimitado desde a v1.2.6 no changelog (A3). Mitigação: o adaptador sempre passa o prazo explícito.
  - **Preview e mudança rápida:** o CLI tem versões novas toda semana (A3). Mitigação: `versao()` no adaptador e teste de contrato do formato do stream.
  - **Fonte da transcrição:** o histórico é SQLite sem caminho documentado. Mitigação: não ler o banco; usar só o stream e o `transcriptPath`.
- **Não-objetivos:** trocar o runtime padrão; ler o banco de conversas do `agy`; usar a assinatura de consumidor sem a decisão D1; prometer paridade de modelo ou de qualidade entre runtimes.

### Decisões que esperam o dono

**D1. Modo de autenticação do `agy` no Orkastery.** A FAQ do Antigravity diz que embrulhar o `agy` em agente ou aplicação de terceiros não é suportado nos planos de consumidor, que automatizar o rodízio de contas também não, e que isso é violação dos termos e pode suspender a conta (A2). Os termos tratam o acesso por software de terceiros como violação (A13). Para agente de terceiros com Gemini, a FAQ recomenda uma chave do Gemini Enterprise ou do Google AI Studio (A2).

| Alternativa | O que significa | Custo e risco |
| --- | --- | --- |
| **a (recomendada)** | Só chave de API ou credencial empresarial: Gemini API ou AI Studio, Gemini Enterprise, ADC. Nada de assinatura de consumidor | Dentro do que a FAQ recomenda. Cobrança por uso, e o estado de perfil `provider-pago` (hoje fora do despacho) precisa de uma exceção para este runtime em F3, que vai ao dono junto |
| b | A assinatura de consumidor mesmo assim | Contra a FAQ: risco de suspensão da conta do dono, dito aqui, sem mitigação do lado do Orkastery |
| c | Esperar a Google mudar a regra | Sem risco de termos, e o runtime não entra até lá; só F1 e F2 andam |

**Decisão da condutora, registrada no ledger:** uma página por runtime (RM-066 e RM-067), sem fatia comum, porque cada um avança no próprio ritmo.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-10-19 | Julio |
| Documentação | Rascunho | — | 2026-10-19 | Julio |
| Código | Não iniciado | — | 2026-10-19 | Julio |
| Testes | Não iniciados | — | 2026-10-19 | Julio |
| Deploy | Não implantado | — | 2026-10-19 | Julio |
| Exposição | Flag desligada | — | 2026-10-19 | Julio |
| Habilitação | Pendente | — | 2026-10-19 | Julio |

<!-- ork-docs:estado:fim -->

### Fontes

Consultadas em 19/10/2026.

- A1: <https://antigravity.google/docs/cli/headless/>
- A2: <https://antigravity.google/docs/faq/>
- A3: <https://antigravity.google/docs/changelog/> (as entradas do CLI: v1.0.4, v1.1.3, v1.1.10, v1.1.27, v1.2.6, v1.2.10, v1.2.15 e v1.4.0)
- A5: <https://antigravity.google/docs/install?tab=cli>
- A6: <https://antigravity.google/docs/cli/commands/resume/>
- A7: <https://antigravity.google/docs/hooks/>
- A8: <https://antigravity.google/docs/mcp/>
- A9: <https://antigravity.google/docs/rules/>
- A10: <https://antigravity.google/docs/sandbox/>
- A12: <https://antigravity.google/docs/plans/>
- A13: <https://antigravity.google/terms> (seção 6)

Pontos que a página não confirma: a licença do `agy`; o caminho do histórico das conversas; a variável do diretório de configuração; o formato estruturado da cota esgotada; qual `--print-timeout` padrão vale hoje.

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: condutor da thread `ork-runtimesnovo`, só para esta página; A: Julio; C: A definir; I: A definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a página foi redigida por agente em #Fast, a partir do pedido do dono e das fontes citadas; revisor humano: Julio. Nenhum código foi escrito.
- **Próxima ação, responsável e prazo:** Julio decide D1 e a posição do item no índice de prioridade; sem prazo definido.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-19 | Item criado em Discovery, com cinco fatias propostas e a decisão D1 aberta | Pedido do dono de 19/10/2026; fontes reconferidas na mesma data | Julio |
