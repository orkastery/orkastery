---
id: RM-087
tipo: roadmap
titulo: OpenCode homologado ao lado de Codex e Claude Code
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

# RM-087: OpenCode homologado ao lado de Codex e Claude Code

> **Em uma frase:** o OpenCode passa a despachar fases, ter o fim observado e participar do rodízio de contas do `ork`, com provedor, conta e linha do runtime escolhidos explicitamente e o mesmo contrato de prova dos runtimes homologados.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Pedido do dono de 09/11/2026, no terminal:** "Inclua no roadmap a integração/homologação do orkastery com os runtimes <https://www.kimi.com/code/> e <https://opencode.ai/>". Esta página é só planejamento: nenhum código nem teste foi escrito, e os critérios de aceite abaixo são o que cada fatia terá de provar.

**Decisão de condução:** uma página por runtime, porque cada um avança no próprio ritmo. O Google Antigravity tem a [RM-066](RM-066-google-antigravity-homologado.md), o Grok Build tem a [RM-067](RM-067-grok-build-homologado.md) e o Kimi Code tem a [RM-086](RM-086-kimi-code-homologado.md).

**Nome e linhas:** o repositório oficial é `anomalyco/opencode`, sob licença MIT. As linhas V1 e V2 usam o binário `opencode`; V1 é distribuída por `opencode-ai`, e V2 por `@opencode/cli`. A documentação atual é da V2 e registra mudanças incompatíveis na API de servidor, nos plugins e nos pacotes de integração (O2, O3, O18, O19).

## Problema e resultado

- **Público e problema/oportunidade:** o dono que já conduz fases pelo `claude-bg`, pelo `codex` e pelo `grok` quer homologar o OpenCode como runtime de despacho. Como o OpenCode conecta vários provedores, homologar apenas o binário sem fixar provedor, conta e política deixaria autenticação, cota e custo sem identidade. Hoje `RUNTIMES` e `RUNTIMES_DE_BLOCO`, em `core/src/runtimes.ts`, registram somente os três runtimes atuais; `ORDEM_DOS_RUNTIMES` aceita apenas `claude-bg` e `codex` como padrão do projeto.
- **Evidências e fonte:** o pedido do dono de 09/11/2026, a pesquisa oficial da mesma data e o estado atual do núcleo em `core/src/runtimes.ts`, `core/src/runtime-profiles.ts`, `core/src/mcp-install.ts` e `core/src/playbook-capabilities.ts`.
- **Objetivo/OKR:** o `opencode` aparece no despacho explícito e no setup como runtime homologado, com linha, provedor, modelo, variante e conta conhecidos; `dry-run`; perfis isolados; fim observado por fonte do runtime; falha e cota tipadas; nenhuma alegação do agente usada como prova.
- **Hipótese:** se o adaptador consumir o NDJSON de `opencode run`, relacionar o `sessionID` ao banco ou à exportação da sessão e amarrar cada perfil a uma conta de provedor explícita, então o OpenCode pode cumprir o contrato sem misturar a cota dos runtimes que já usam a mesma assinatura.
- **Métrica principal / linha de base / meta / janela / fonte:** fases de uma thread concluídas pelo `opencode`, com fim observado pelo watcher e claims verificados. Linha de base: não há adaptador. Meta e janela: A definir pelo dono. Fonte: ledger da thread, stream do runtime e recibos do verify.
- **Métricas de proteção:** nenhuma regressão em `claude-bg`, `codex` ou `grok`; nenhuma credencial lida ou copiada pelo `ork`; nenhuma conta compartilhada despachada em paralelo sem estado comum; nenhum custo ou cota atribuído ao provedor errado; nenhum uso contrário aos termos aplicáveis.

## Escopo e validação

- **Incluído:** escolha entre V1 e V2; adaptador e despacho headless; fim da sessão e watcher; perfis, provedor, conta, login e cota esgotada; setup, sandbox, MCP, documentação e onboarding; ensaio real; depois dele, o host de condução (F6), como o Codex.
- **Fora de escopo:** tornar o `opencode` o runtime padrão; homologar todos os provedores; assumir que os termos do OpenCode cobrem o CLI local com chave de terceiro; reutilizar login de outra assinatura sem decisão; comprar plano, chave ou cota; supor sandbox ou evento não documentado.
- **Entregáveis e critérios de aceite:** as seis fatias da seção "Plano e decisões", cada uma com prova reproduzível.
- **Piloto, medição e critérios de expansão/interrupção:** A definir pelo dono. O ensaio interrompe se a linha, o provedor ou a conta não tiverem contrato e política suficientes para o uso escolhido.

### O que o Orkastery exige e o que o OpenCode oferece

As colunas sobre o runtime citam as fontes da seção "Fontes". Os fatos sem marca de V1 são da V2. "Não confirmado" significa que nenhuma fonte consultada afirma o comportamento.

| # | O que o Orkastery exige (onde está hoje) | O que o `opencode` oferece | Lacuna |
| --- | --- | --- | --- |
| E1 | Um `RuntimeAdapter` em `RUNTIMES`, com `disponivel`, `versao`, `montarComando`, `despachar`, `fonteVerificacao` e `dry-run`. Hoje há `claude-bg`, `codex` e `grok`; os três são runtimes de bloco, e só os dois primeiros podem ser padrão do projeto (`core/src/runtimes.ts`) | `opencode run "<msg>" --format json` produz NDJSON; `-m provider/model#variant` escolhe provedor, modelo e esforço; `--auto` aprova o que não estiver negado; há retomada, fork, agente, worktree e servidor privado. O limite de passos vem do agente e a atualização pode ser desligada no config (O1, O3, O7, O18, O20) | Escrever o adaptador e decidir seu alcance no registro. Na V2, flag de diretório não está documentada; o uso de `$PWD` aparece no código. V1 e V2 têm contratos diferentes, sujeitos a D3 |
| E2 | Fim observado por fonte externa ao relato do agente; cada adapter atual relaciona a sessão a uma fonte gravada pelo runtime e o watcher emite um único resultado | O stream traz `sessionID` e eventos `step_start`, `text`, `reasoning`, `tool_use`, `step_finish`, `retry`, `background_wait` e `error`; `step_finish` traz razão, custo e tokens. Não há evento final de resultado: o processo sair encerra a execução. Sessões ficam em SQLite e podem ser exportadas; plugins ou `event.subscribe()` observam eventos do servidor (O1, O4, O5, O12, O18) | Definir a fonte externa canônica e como relacioná-la ao recibo do processo. Eventos `session.execution.succeeded` e `failed`: não confirmados na documentação. Não há hook de shell documentado |
| E3 | Falha tipada pelo código de saída e por evento estruturado; texto livre do agente não classifica sucesso, cota ou autenticação | Qualquer erro sai 1 com evento `error`. O código distingue `provider.rate-limit`, `provider.quota`, `provider.free-limit`, `provider.chatgpt-limit`, `provider.auth`, `permission.rejected` e `aborted`. Sem `--auto`, pedidos de permissão são rejeitados no headless (O18) | A lista de tipos não está documentada. O adapter precisa testar a versão homologada e tratar tipo desconhecido como indisponibilidade, sem inferência por frase |
| E4 | Perfil por runtime, com uma variável que move configuração, login e sessões; hoje existem `CLAUDE_CONFIG_DIR`, `CODEX_HOME` e `GROK_HOME`. O `ork` executa o login do próprio CLI e não lê segredos; `provider-pago` não recebe despacho (`core/src/runtime-profiles.ts`) | Config fica em diretórios globais e do projeto; credenciais ficam no SQLite, relocável por `XDG_DATA_HOME` e `OPENCODE_DB`. O runtime gerencia várias contas e aceita chave, OAuth, comando e ambiente; `auth switch` escolhe a conta (O1, O4, O6) | Não confirmado: se `XDG_*`, `OPENCODE_DB` e `--standalone` isolam o perfil inteiro. Definir um diretório de perfil, o provedor e o rótulo da conta sem o `ork` abrir o banco |
| E5 | Cota esgotada só entra no rodízio quando o runtime fornece sinal tipado e prazo; o estado de conta é compartilhado entre projetos pela chave `runtime:diretório-real`. Hoje não há vínculo da mesma conta entre runtimes (`core/src/runtime-profiles.ts`) | Há tipos distintos para cota, taxa, limite gratuito e limite ChatGPT. O OpenCode Go documenta tetos por janela e períodos maiores (O14, O18) | Se a conta ChatGPT usada pelo OpenCode for a conta já usada pelo `codex`, o estado atual não relaciona as duas, porque a chave começa pelo runtime. O mesmo vale para Claude Agent e `claude-bg`. RM-040 e RM-064 precisam identificar a conta entre runtimes sem guardar segredo |
| E6 | Setup e fallback preservam o modelo e o esforço do runtime; hoje `RUNTIMES_DE_BLOCO` contém `claude-bg`, `codex` e `grok` (`core/src/runtimes.ts`) | O catálogo aceita OpenAI por chave ou ChatGPT, Copilot, Bedrock, Vertex, Azure, OpenCode Go e outros provedores; `provider/model#variant` leva a variante de esforço. Claude Agent usa o Claude Code instalado e autenticado (O7, O13, O15) | D1 e D2 precisam fixar autenticação, provedor e conta; o setup deve impedir troca silenciosa de provedor, modelo ou variante entre retomadas |
| E7 | A postura de sandbox e as permissões do filho não podem ampliar as da worktree; modo mais frouxo exige confirmação do dono | Regras ordenadas `{action, resource, effect}` usam `allow`, `ask` e `deny`, com a última regra vencedora; `--auto` aprova o restante. Políticas gerenciadas podem vir do diretório do sistema (O1, O6, O8) | Sandbox do sistema operacional no Linux: não confirmado. Permissão do OpenCode não substitui o sandbox do host; regras de projeto e regras gerenciadas precisam ser reconciliadas sem sobrescrita |
| E8 | O MCP do projeto é vinculado à thread e ao despacho; o instalador aceita hoje `claude-code`, `codex` e `grok` e o perfil `worktree` libera somente ferramentas exatas (`core/src/mcp-install.ts`) | MCP local e remoto fica no config; V2 lê somente `AGENTS.md`, oferece `opencode acp`, servidores e os pacotes `@opencode/sdk` e `@opencode/client` (O9, O10, O11, O12) | Criar host de instalação e configuração por sessão. V2 não usa `CLAUDE.md`; V1 usa como alternativa. API de servidor e pacotes mudaram entre as linhas |
| E9 | O playbook de capacidades precisa registrar e provar as capacidades do runtime. O contrato em `core/src/playbook-capabilities.ts` ainda enumera somente `codex` e `claude`, apesar de o despacho já ter três runtimes | Subagentes usam `mode: subagent`, permissões próprias e ação `subagent`; o runtime oferece `run --worktree` e hooks de sessão em plugins (O12, O20) | Ampliar o contrato sem declarar homologação antes do ensaio; decidir se os plugins fazem parte da fonte de prova ou só complementam a observação |
| E10 | Consumo só é registrado quando o runtime fornece medida estruturada; estimativa não substitui recibo | `step_finish` traz custo e tokens; `opencode stats --cost --json` agrega consumo (O1, O18) | O custo depende do provedor e pode não existir em assinatura. Vincular cada medida ao provedor, modelo, variante, conta e sessão; dado ausente permanece lacuna |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** A definir pelo dono.
- **Horizonte / alvo / previsão / confiança / marcos:** A definir pelo dono. As fatias abaixo são propostas e avançam uma por vez.
- **Dependências e bloqueios:** D1, D2 e D3 antes de F3; [RM-040](RM-040-estado-de-conta-compartilhado.md) para identidade e estado de conta; [RM-064](RM-064-conta-esgotada-nao-para-a-fase.md) para cota e retomada; termos do provedor escolhido. Próxima revisão: A definir pelo dono.

### Fatias propostas

| Fatia | O que entrega | Critério de aceite (a provar) |
| --- | --- | --- |
| F1 Adaptador e despacho headless | Entrada `opencode` em `RUNTIMES`, na linha escolhida em D3, sobre `opencode run --format json`; provedor, modelo, variante, agente, limite de passos, atualização desligada e diretório da worktree; `dry-run` | Com `opencode` simulado, o comando e o ambiente levam apenas a linha, o provedor e o modelo decididos; `--dry-run` não inicia processo; runtime ausente recusa com erro tipado; os três adapters atuais passam sem alteração |
| F2 Fim da sessão e watcher | Parser do NDJSON, captura do `sessionID`, fonte da sessão, retomada e watcher com resultado único | Com stream, recibo e armazenamento simulados, `step_finish` não encerra cedo; saída 0 com sessão persistida conclui uma vez; evento `error` e saída 1 viram parada tipada; stream cortado ou sessão sem prova externa não conclui a fase |
| F3 Perfis, login e cota esgotada | Perfil isolado, provedor e conta de D2, login pelo próprio CLI, seleção de conta, erros de cota e integração com o estado compartilhado | Com dois perfis simulados, cada despacho usa o rótulo correto sem ler o SQLite; cota e autenticação retiram a conta correta; se a mesma assinatura existir em outro runtime, uma falha impede novo despacho nos dois. A fatia só começa após D1, D2 e D3 |
| F4 Setup, sandbox, MCP, documentação e onboarding | Runtime no setup, mapeamento de variante e permissões, host MCP por sessão, `AGENTS.md`, playbook, referência e onboarding | A postura mais frouxa sem confirmação recusa; regras `deny` não são removidas; o MCP expõe apenas as ferramentas autorizadas; `node core/dist/index.js docs verificar` passa com a documentação do runtime e do provedor escolhido |
| F5 Ensaio real | Uma thread `#Fast` conduzida de ponta a ponta pelo `opencode`, na linha, no provedor e na conta decididos | A sessão real fecha com fonte externa, claims verificados e verify verde; consumo identifica provedor e conta; o ledger não usa auto-relato como prova; divergência dos termos ou contratos interrompe a homologação e volta ao dono |
| F6 Host de condução | Adaptador de Camada 1 `opencode` em `ork adapter install`, como o do Codex: entrada de condução e catálogo em arquivos do projeto que o runtime lê (`AGENTS.md` e agentes do projeto (O10, O20)), sem configuração global; MCP do dono por `ork mcp serve --host opencode`; prova de ativação lida da exportação da sessão (`opencode session export`, O1), sem ler o banco do runtime | `ork adapter install opencode --dry-run` lista só arquivos do projeto; numa sessão nova do dono, a entrada chama o `ork` e a prova de ativação acha a frase de entrada; o MCP do dono expõe só as ferramentas de condução enumeradas; a #TAG vira `--mode` e a validação fica no núcleo. Só começa depois da F5 aprovada |

- **Premissas / riscos / mitigação:**
  - **Duas linhas ativas:** V1 e V2 compartilham o binário, mas mudam API, plugins e pacotes (O3). Mitigação: D3 fixa a linha e o adaptador recusa versão fora da faixa homologada.
  - **Vários provedores:** cada um tem autenticação, cota, custo e termos próprios. Mitigação: D2 fixa uma combinação inicial e F3 registra identidade sem segredo; outros provedores exigem homologação separada.
  - **Termos em camadas:** os termos do OpenCode cobrem site, inferência e software hospedado, enquanto o software aberto executado localmente segue a licença; o provedor de modelo aplica termos próprios (O16). Mitigação: avaliar OpenCode e provedor separadamente, sem estender uma permissão à outra.
  - **Assinaturas já usadas:** ChatGPT ou Claude Agent podem reutilizar contas que `codex` ou `claude-bg` já consomem. Mitigação: não habilitar rotação até existir identidade compartilhada entre runtimes; a alternativa recomendada de D2 usa conta dedicada.
  - **Isolamento incompleto:** as fontes não confirmam que as variáveis documentadas separem todo o perfil. Mitigação: F3 prova config, banco, sessão e processo antes de aceitar dois perfis.
  - **Permissão não é sandbox:** o runtime tem regras detalhadas, mas isolamento do sistema no Linux não está confirmado. Mitigação: manter a proteção do host e provar o acesso real antes de habilitar GO.
- **Não-objetivos:** homologar todos os provedores ou as duas linhas; prometer que a licença MIT autoriza o uso de um serviço hospedado; reutilizar conta sem estado compartilhado; escolher prioridade, meta, janela ou piloto pelo dono.

### Decisões do dono

**D1. Modo de autenticação do OpenCode no Orkastery.** O runtime aceita chave, OAuth, comando e ambiente (O4). Os termos do OpenCode vigentes desde 08/11/2026 limitam os serviços hospedados ao uso interno, vedam processos ativos quando a pessoa não está autenticada e dizem que o software aberto executado localmente segue a própria licença; os termos do provedor de modelo continuam aplicáveis (O16). Os termos da OpenAI e da Anthropic para uso de assinatura pelo OpenCode não foram verificados.

| Alternativa | O que significa | Custo e risco |
| --- | --- | --- |
| **a (recomendada)** | Usar chave de API de um provedor escolhido em D2, em conta dedicada ao OpenCode | Separa cota e autorização de uma assinatura de consumidor. Há cobrança por uso e a política atual de `provider-pago`, que nunca despacha, precisa de uma exceção explícita e restrita |
| b | Usar uma assinatura por OAuth ou por integração que reutiliza login existente | Pode evitar cobrança direta por chamada, mas compartilha cota e risco de bloqueio com outro runtime. Os termos do provedor para essa integração não foram verificados; nos serviços hospedados do OpenCode, O16 também restringe processos sem login ativo |
| c | Esperar confirmação dos fornecedores e maturação das linhas | Evita risco de termos e custo imediato; o runtime não entra no rodízio, e apenas as fatias sem credencial real podem avançar |

**D2. Provedor e conta iniciais.** A escolha define qual cota a RM-064 observa e como a RM-040 identifica a mesma conta entre projetos e runtimes.

| Alternativa | O que significa | Custo e risco |
| --- | --- | --- |
| **a (recomendada)** | OpenAI por chave de API, em conta e perfil dedicados ao OpenCode | Isola orçamento e cota dos perfis `codex`. Exige custo por uso, verificação dos termos da API e suporte explícito a perfil pago no Orkastery |
| b | OpenAI por ChatGPT Plus ou Pro, reutilizando uma conta já elegível no `codex` | Compartilha a cota da assinatura; hoje o estado de conta usa `runtime:diretório-real`, então `codex` e `opencode` não se bloqueiam mutuamente. F3 teria de criar identidade cruzada sem guardar credencial. Termos da OpenAI para este uso: não verificados |
| c | Claude Agent, reutilizando o Claude Code instalado e autenticado | Compartilha login e cota com `claude-bg`, com o mesmo problema de identidade cruzada. O provedor depende de outro runtime instalado, e os termos da Anthropic para este uso: não verificados |

OpenCode Go, Copilot, Bedrock, Vertex, Azure e outros provedores permanecem fora da primeira homologação; cada um exige política, conta e prova próprias (O13, O14).

**D3. Linha do OpenCode a homologar.** As linhas compartilham o binário, mas não o contrato completo (O3, O19).

| Alternativa | O que significa | Custo e risco |
| --- | --- | --- |
| **a (recomendada)** | Homologar V2, pacote `@opencode/cli`, com a documentação, os plugins e os pacotes de integração atuais | Contrato atual e documentação ativa; ainda muda com frequência, então exige faixa de versão fechada e testes do stream |
| b | Homologar V1, pacote `opencode-ai` | Preserva compatibilidade com instalações existentes, mas usa API e pacotes anteriores e cria migração futura já conhecida |
| c | Esperar a consolidação das linhas | Evita manter dois contratos ou migrar cedo; adia toda homologação real |

**Decididas pelo dono em 11/11/2026, no terminal:**

- **D1, alternativa a:** chave de API do provedor escolhido em D2, em conta dedicada ao OpenCode. Exige a exceção explícita e restrita para perfil pago, porque hoje `provider-pago` nunca recebe despacho.
- **D2, alternativa a com a ressalva do dono:** o OpenCode **não** usa OpenAI. O provedor é o OpenRouter ou servidores de GPU locais com endpoint no padrão OpenAI, sempre por chave de API, em conta e perfil dedicados. A chave do OpenRouter fica no cofre de segredos e nunca entra em repositório, log ou ledger. A escolha entre OpenRouter e GPU local fica por perfil, e a RM-064 observa a cota de cada um.
- **D3, alternativa a:** homologar a linha V2, pacote `@opencode/cli`, com faixa de versão fechada.

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

- O1: <https://opencode.ai/docs/cli/commands>
- O2: <https://opencode.ai/docs/>
- O3: <https://opencode.ai/docs/migrate-v1>
- O4: <https://opencode.ai/docs/cli/providers>
- O5: <https://opencode.ai/docs/troubleshooting>
- O6: <https://opencode.ai/docs/config>
- O7: <https://opencode.ai/docs/models>
- O8: <https://opencode.ai/docs/permissions>
- O9: <https://opencode.ai/docs/mcp-servers>
- O10: <https://opencode.ai/docs/instructions>
- O11: <https://opencode.ai/docs/cli/acp>
- O12: <https://opencode.ai/docs/build/sdk> e <https://opencode.ai/docs/build/client>
- O13: <https://opencode.ai/docs/providers>
- O14: <https://opencode.ai/docs/console/go>
- O15: <https://opencode.ai/docs/claude-agent>
- O16: <https://opencode.ai/legal/terms-of-service>
- O17: <https://docs.opencode.ai/docs/cli/> (V1)
- O18: <https://github.com/anomalyco/opencode> (`packages/cli/src/run/run.ts`, `packages/core/src/session/to-session-error.ts` e lista de versões)
- O19: <https://registry.npmjs.org/opencode-ai> e <https://registry.npmjs.org/@opencode/cli>
- O20: <https://opencode.ai/docs/agents>
- O21: <https://docs.opencode.ai/docs/rules/> (V1)

Pontos que a página não confirma: flag de diretório da V2; eventos finais de execução; lista de erros na documentação; isolamento integral de perfil com `XDG_*`, `OPENCODE_DB` e `--standalone`; sandbox do sistema operacional no Linux; termos da OpenAI e da Anthropic para usar assinaturas pelo OpenCode.

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: condutor da thread `ork-kimicodeeope`, somente para esta página; A: Julio; C: A definir; I: A definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** página redigida por agente em #Fast a partir do pedido do dono, do código atual e das fontes citadas; revisor humano: Julio. Nenhum código nem teste foi alterado.
- **Próxima ação, responsável e prazo:** Julio decide D1, D2, D3, prioridade, meta, janela e piloto; sem prazo definido.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-09 | Item criado em Discovery, com cinco fatias propostas e D1 a D3 abertas | Pedido do dono de 09/11/2026; código atual e fontes O1 a O21 | Julio |
| 2026-11-09 | F6 "host de condução" acrescentada, para depois do ensaio real, na mesma ordem que o Codex seguiu | Decisão do dono no terminal, em 09/11/2026 (alternativa a) | Julio |
| 2026-11-11 | D1 a D3 decididas: chave de API; OpenRouter ou GPU local com endpoint no padrão OpenAI, sem OpenAI; linha V2 | Decisão do dono no terminal, em 11/11/2026 | Julio |
