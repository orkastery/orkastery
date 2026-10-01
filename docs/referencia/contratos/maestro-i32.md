# Snapshot Maestro I-32

Contrato aditivo `ork.maestro-snapshot/v1`, definido em
`core/src/maestro-contract.ts` e `core/schemas/maestro-snapshot.schema.json`.
É uma projeção de leitura. Não aprova gates, não cria ciclo e não prova SHIP.

Cada seção informa fonte, instante, fingerprint, estado e cobertura. As seções
obrigatórias são portfolio, demands, threads, sessions, blockers, leases,
retries, hitl, ship, master e nextActions. IDs correlacionam fontes; títulos
semelhantes não estabelecem vínculos. `delivered` no catálogo não prova push.

Exemplos executáveis completos e parciais estão em `maestro-contract.test.ts`.
Uma seção vazia tem `state: empty`, `total: 0`, `returned: 0`, `omitted: 0`.
Fonte inacessível tem `state: unavailable`, contagens desconhecidas (`null`)
e lacuna tipada. Mudança durante a leitura produz `conflict` ou `stale` após
uma releitura limitada; não há transação atômica entre disco e runtimes.

Descoberta ambígua retorna `maestro.project.ambiguous`, sem escolher o primeiro
candidato. Ausência e escape de escopo retornam `maestro.project.missing` e
`maestro.project.scope`. Nenhum desses erros cria projeto ou catálogo.

RM-052 (aditivo, opcional no validador e sempre preenchido pelo produtor):
`project.root` é a raiz exibida com `~`, `project.remote` é o remoto da fábrica
sem credencial (`null` sem remoto) e `notConsulted` lista o que o panorama não
lê: roadmap, reservas, outras máquinas e, fora do MCP, quantos outros projetos a
máquina conhece. Zero threads no panorama nunca quer dizer roadmap vazio.
`origin: selection` é o projeto pedido por `--projeto` ou `ORK_PROJETO`.

Limites: 50 itens por seção/página, JSON de até 64 KiB, prazo de fonte remota
de 2 s e total de 10 s. Cobertura registra omissões e o próximo offset.
Esses limites são contrato; tempo real medido exige evidência própria.
Próximas ações declaram operação, precondições, disponibilidade, causa e
readback. A execução revalida a fonte e usa a autoridade existente do núcleo.

## Prova de ativação por host (RM-032)

`node core/scripts/prova-ativacao.cjs <claude-code|openclaw>` abre uma sessão nova e não
interativa no host instalado numa cópia descartável e diz `orkastery maestro`. A conferência
(`core/src/prova-ativacao.ts`) só julga o determinístico: a entrada contratada foi exposta e
chamada (`mcp__orkastery__ork_maestro` no Claude Code, `ork_maestro` no OpenClaw; `ork maestro`
pelo shell do host é desvio, porque o CLI resolve o projeto pelo diretório), o resultado valida
neste contrato, o `project.fingerprint` é o da cópia esperada (a raiz exibida pode vir mascarada),
`notConsulted` existe, a resposta nomeia o projeto e não conclui "roadmap vazio". O roteiro
acrescenta que a consulta não escreveu em `.orkastery` e que os arquivos globais do host têm o
mesmo sha256 antes e depois. O recibo `ork.prova-ativacao/v1` passa por redação antes de ser
gravado. Saídas: 0 aprovada, 1 reprovada, 2 host ausente ou fora da prova, 3 pendente de ação
humana. A prova não aceita procedência, não consente MCP e não reinicia gateway por ninguém.

## Ingresso nativo aditivo (T23)

`ork.hitl-native/v1` vincula instalação/conexão/sessão/conta/canal/conversa/pessoa,
mensagem, thread/pedido, hash do pedido, contexto e prazo. Só o callback autenticado
do host assina o envelope; nenhuma tool do modelo recebe atestado ou chave. Bindings
e chaves por host são configuração privada do processo de ingresso e do núcleo,
nunca argumentos de tool, nunca herança para a sessão filha. Telegram/MCP antigos
conservam bytes e contratos. Configuração não prova ativação ou homologação live.

Inspeção do host instalado (18/09/2026): Hermes `pre_gateway_dispatch` recebe
`MessageEvent`, gateway e session_store, antes da autenticação; o adaptador deve
revalidar autorização e recusar eventos internos/bots. Hooks de aprovação são
observadores de permissões de shell e não podem responder gates Orkastery.
OpenClaw `PluginHookInboundClaimEvent` oferece `sessionKey`, `commandAuthorized`,
conta, sender, conversa e mensagem; campos opcionais ausentes impedem ingresso.
Fontes: [Hermes hooks](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks)
e [OpenClaw SDK](https://docs.openclaw.ai/plugins/sdk-overview/tools-and-commands).
Prova de callback em fixture continua simulada; sessão real pós-SHIP é obrigatória.

Os despachos Claude/Codex e as tools CLI do plugin OpenClaw removem `ORK_HITL_*`
do ambiente do filho, mantendo a configuração do callback no pai. Essa proteção
cobre os processos criados por esses adaptadores; não configura terminais genéricos
do host. A inspeção do Hermes local mostrou que seu filtro de subprocessos não
inclui automaticamente variáveis `ORK_HITL_*`. Antes da ativação nativa, a instalação
deve provar que as tools do modelo não conseguem ler as chaves/bindings por ambiente,
arquivos ou introspecção do host. Sem essa fronteira comprovada, o ingresso nativo
permanece sem homologação; as regras de edição da worktree não provam isolamento de
processos. Esta implementação não modifica o sandbox nem a configuração instalada.

### Verificação de recibos nos workflows despachados

O núcleo acrescenta um sidecar `*.json.public` com assinatura Ed25519 aos recibos
HITL de Telegram e ingresso nativo. Os bytes HMAC originais e o hash referenciado
pelo ledger são preservados. A chave Ed25519 é derivada com separação de domínio
da chave privada do canal e fica somente no processo de ingresso. Antes de um
despacho real de fase ou retry, o núcleo pode acrescentar o sidecar a recibos
legados após revalidar sua autenticação; dry-run não cria essa prova.

`ORK_RECEIPT_VERIFIERS` transporta apenas chaves públicas e hashes dos vínculos
de conta/identidade no ambiente sanitizado. O MCP da sessão recebe esse material
na configuração gerada pelo núcleo, inclusive quando o cliente filtra variáveis
herdadas. A autoridade vem desse startup confiável, nunca da chave declarada em
um recibo ou argumento de ferramenta. A verificação reconfere assinatura, bytes,
pedido, canal, identidade e vínculo com o ledger. Não autentica novas respostas
humanas, não aprova gates por conta própria e não altera permissões nativas.

Recibo legado sem prova pública exige preparo pelo processo que possui a chave;
o filho não o certifica. Prova ausente, adulterada ou de outra autoridade falha
fechada. Mudança de configuração privada exige novo startup confiável: não se
usa uma chave pública antiga como fallback para uma chave privada inválida.
Regressões simuladas: `hitl-dispatch-verification.test.ts` e
`hitl-dispatch-transport.test.ts`; isso não constitui homologação de host live.
