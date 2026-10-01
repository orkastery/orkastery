# Adaptador Hermes

Na callback Discord autenticada, `/ork offer <thread> <pedido>` apresenta a
pergunta e a oferta nativa sem responder. O gateway assina uma prova efêmera de
host, sessão, identidade e mensagem e consulta `gate context --native-offer-stdin`.
Somente a prova aceita pelo núcleo anuncia o canal nativo disponível naquela
conversa, sem exigir Telegram. Chave/binding isolados ou payload do modelo não
comprovam callback. Testes simulados não substituem homologação live pós-SHIP.

## Transporte determinístico do pulse

`bin/ork-pulse-enviar.py` chama a API `send_message_tool` do Hermes instalado e retorna
código 0 somente com `success: true`. Não abre chat nem chama modelo. Use o Python do
venv do Hermes e um destino explícito `telegram:chat_id[:topic_id]`:

```json
{
  "executavel": "/caminho/hermes-agent/venv/bin/python3",
  "argumentos": ["/repo/adapters/hermes/bin/ork-pulse-enviar.py", "--target", "telegram:CHAT_ID", "--message", "{{mensagem}}"]
}
```

Grave a configuração em `.orkastery/monitor/pulse-host.json`. `HERMES_HOME` e
`HERMES_AGENT_DIR` permitem localizar outra instalação; por padrão usa `~/.hermes`.
O adaptador carrega o ambiente do host internamente, sem imprimir credenciais. Marcadores
`MEDIA:` presentes no texto do runtime são neutralizados para não anexar arquivos locais.

O Hermes vira **podio** do Orkastery: uma skill roteadora fina, um plugin que a declara e um script
que abre thread a partir do pedido cru do builder.

## Instalacao

```bash
ork adapter install hermes                       # instala em <projeto>/.hermes
ork adapter install hermes --dir ~/.hermes       # instala para a maquina
ork adapter install hermes --dry-run             # lista o que seria escrito
```

## O que entra

| Arquivo | Papel |
|---|---|
| `skills/orkastery-devmaster/SKILL.md` | O roteador: le a #TAG, chama o `ork`, apresenta os gates |
| `hermes.plugin.json` | Declara a skill, o binario do `ork` e as tags de conducao |
| `bin/ork-abrir-thread.sh` | Abre a thread com o modo lido do pedido, em um comando |
| `bin/ork-brain.sh` | Consulta o Company Brain pelo contrato e identidade autenticada do OrkMind |
| `bin/ork-maestro.sh` | `ork_maestro`: o panorama Maestro do projeto pedido (`ork maestro --json`) |
| `bin/ork-roadmap-status.sh` | `ork_roadmap_status`: o status report do roadmap so desta maquina (`ork roadmap status`) |
| `bin/ork-network-roadmap.sh` | `ork_network_roadmap`: o roadmap da rede (`ork network roadmap`), com as threads de todas as maquinas, fonte, hora e lacunas; a fonte do status do roadmap e o panorama da frase `orkastery maestro` sem projeto (RM-054) |

## Tickets `obj-*` aposentados

`ork_objective_status` e `ork_objective_message` sairam com o `ork objective` na I-43: o nucleo
recusa qualquer subcomando com `objective.aposentado` e saida != 0. O estado de uma entrega vem de
`ork thread status <thread>`; os ciclos ligados a um produto, projeto ou iniciativa, de
`ork portfolio inspect <id> --json`. Mensagem de conversa continua sem aprovar gate: a decisao do
dono passa pelo `/ork gate <thread> <pedido> <resposta>` correlacionado.

## O encolhimento, que e o ponto

A skill devmaster do Hermes carregava a metodologia inteira em prosa: era ela quem "lembrava" das
regras das fases, dos gates e do score. O roteador tem pouco mais de cem linhas e **nao perde
capacidade nenhuma**, porque o que ele deixou de dizer o `ork` passou a executar. O mesmo ciclo
real roda antes e depois; o que mudou e quem garante.

Se esta skill comecar a crescer de novo com metodologia, isso e bandeira vermelha: a regra nova
pertence ao nucleo, com teste, e nao a esta prosa.

## Contas por runtime (I-33)

Este host tem superfície CLI, e a paridade com os hosts MCP vem pelos mesmos comandos do
núcleo; a superfície MCP de `accounts` não existe neste ciclo (o `add` é interativo e local, e
a leitura de estado já sai de `ork_observe`).

```bash
ork accounts list [--json]                          # perfis por runtime, sem segredo
ork accounts add <id> --runtime claude-bg|codex --dir <diretorio>
ork accounts check [<id>]                           # confere o login pelo proprio CLI
ork accounts remove <id>                            # desativa; diretorio e login ficam
ork setup <modo> --bloco N --fallback codex:<modelo>
```

O login roda no terminal do operador, pelo próprio CLI do runtime com o env do perfil; o
adaptador nunca recebe, guarda ou repassa credencial, e a conversa nunca é canal de login.
Quando uma conta esgota a cota, o crédito ou o limite do plano, ou perde o login, o
`ork retry run` rotaciona e grava `runtime_profile_rotated`; o host só apresenta o evento e a
pendência humana quando houver. A troca para outro perfil do mesmo runtime por esgotamento vem
ligada por padrão desde a decisão do dono de 19/09/2026
(`runtime_profiles.rotate_same_runtime_on_quota: true`; `false` desliga), vale só para perfis
que o operador cadastrou e autenticou pelo CLI oficial, para contas que ele tem direito de usar
sob os termos do provedor, e nunca acontece no rate limit comum, que espera a janela na fila
(ver `SECURITY.md` e `docs/guias/verificacao.md` na raiz do repositório).

## Os 3 pitfalls de instalacao

1. **`ork` fora do PATH do Hermes.** O host costuma rodar com um ambiente mais enxuto que o do
   terminal do builder, e `~/.local/bin` pode nao estar la. O `hermes.plugin.json` grava o caminho
   absoluto em `requires.comando` e o script honra `ORK_BIN`. Prove antes de confiar:
   `ORK_BIN=$(command -v ork) ; "$ORK_BIN" doctor`.

2. **Reimplementar o parse da #TAG no host.** E a tentacao obvia, sao cinco strings. Duas
   implementacoes divergem na primeira tag nova, e a divergencia aparece como thread aberta no modo
   errado, o que ninguem percebe ate a pausa que nao veio. Use `ork modos --do-pedido`, sempre.

3. **Validar `allowed_modes` no host.** Um host que recusa o modo antes de chamar o `ork` recusa
   com a regra que ele tem em cache, nao com a do manifesto do projeto. Deixe o
   `ork thread new` recusar: o erro vem tipado, com a lista permitida do projeto certo.

## Transporte do digest MASTER

`bin/ork-master-enviar.py --target telegram:<chat_id>[:<topico>]` recebe no stdin uma
página JSON `ork.master-digest-page/v1`, com `texto` e `opcoes`. Usa a configuração Telegram
do Hermes e só devolve `success: true` quando recebe `message_id`. Um erro não imprime
credencial nem resposta bruta da API. O transporte não executa comandos do Ork.

As opções são um teclado de respostas: o toque envia o texto escolhido como mensagem do
humano pelo gateway já autenticado. Não há callback privado para o host interpretar.
O núcleo gera o texto com thread, classe e identificador da proposta, e o host encaminha
a resposta ao comando de ratificação com o nome do humano autenticado. Enviar a página
não ratifica nada. Cada página oferece no máximo doze opções e cabe em 3.900 unidades UTF-16.

Contrato do teclado: [Telegram ReplyKeyboardMarkup](https://core.telegram.org/bots/api#replykeyboardmarkup).
Prova local: `python3 -m unittest discover -s adapters/hermes/test -p master_transport_test.py`.

## Respostas HITL no Telegram

O gateway autenticado entrega o update original por stdin a `bin/ork-hitl-answer.py ork_gate_answer <thread> <pedido>` ou `ork_session_answer`. Configure `ORK_BIN`, `ORK_HITL_TELEGRAM_USERS` e `ORK_HITL_TELEGRAM_CHATS` com os ids permitidos. Responda ao alerta que contém a linha `ork-hitl <thread> <pedido>`; botões usam `ork:<thread>:<pedido>:<número>`. O transporte recusa bots, chat/usuário não autorizado e resposta sem correlação. O núcleo decide sobre prazo, modo e validade do pedido.

O script deve receber eventos diretamente do gateway, cuja autenticação do Telegram é a fronteira de confiança. JSON criado por um agente não é evidência humana. O canário usa um transporte controlado; ele não mede a rede Telegram real. Para aposentar `ork-watchdog-5min`, desative o job no agendador do host e guarde o recibo; nenhum watchdog deve chamar aprovação em nome do builder.

Verificação: `python3 -m unittest discover -s adapters/hermes/test -p hitl_answer_test.py -v`.

## Confirmação pelo plugin nativo HITL

O plugin `hitl-ingress/` recebe `/ork gate <thread> <pedido> <resposta>` e
`/ork session <thread> <pedido> <resposta>` em `pre_gateway_dispatch`. Esse hook
instalado é **síncrono e anterior à autenticação do gateway**: o callback valida
`MessageEvent`/`telegram.Message`, a autorização do host, usuário, chat, bot,
texto/id coincidentes, encaminhamento, data de até 60 s e configuração HMAC.
Todo comando `/ork ` é consumido com `action: skip`, inclusive quando recusado.
Sem loop ativo, ele recusa; não cria outro loop para o cliente HTTP do bot.

O callback reserva a mensagem e agenda o trabalho no loop do gateway. O CLI recebe
o envelope HMAC por stdin UTF-8, sem shell, em executor, com timeout de 10 s
(11 s incluindo espera pelo executor). Somente `ok: true`, `pedidoId` coincidente,
`estado` compatível e `repetida` booleano permitem confirmar o efeito. Sessão exige
também `sessionId`. A correlação de thread e mensagem vem da invocação CLI exata
e do envelope validado pelo núcleo; o recibo atual do CLI não ecoa esses campos.
A prova dirigida simula esse núcleo e não substitui seu CHECK integrado.

`Message.reply_text` usa o bot e chat do objeto autenticado no mesmo loop. Os únicos
textos são “Orkastery: resposta ao gate registrada pelo núcleo.” e “Orkastery:
resposta entregue à sessão pelo núcleo.” Não há quote da resposta humana,
parse mode, stdout ou exceção no conteúdo. Recusa de gate também é uma resposta
registrada; a mensagem não diz que houve aprovação. A confirmação tem orçamento
total de 3 s e os quatro timeouts do PTB explícitos. Sucesso exige um `Message`
nativo retornado, id positivo e bot/chat/texto correspondentes.

Retorno do hook e logs distinguem `effect` de `confirmation`:

| Situação | effect | confirmation |
|---|---|---|
| Validação recusada, sem loop ou limite atingido | unconfirmed | not_attempted |
| Trabalho agendado | pending | not_attempted |
| CLI iniciado sem recibo válido, timeout ou cancelamento | unknown | not_attempted |
| Recibo do núcleo válido; confirmação falhou ou ficou ambígua | confirmed | unknown |
| Recibo do núcleo e recibo Telegram válidos | confirmed | sent |

O retorno inicial é um retrato do agendamento; o log de conclusão registra o
resultado final com referência opaca derivada da identidade da mensagem. Não é
um ledger durável de entrega. Há no máximo 16 trabalhos pendentes e 1.024 reservas;
reservas concluídas podem ser removidas após 61 s, e mensagens com data vencida são
recusadas. O cache guarda apenas metadados, sem resposta humana, chave ou stdout.

Replay idêntico no mesmo processo apenas consulta o estado: não chama o CLI nem
repete a confirmação. Reutilizar a mesma mensagem com operação, resposta, usuário,
thread ou pedido divergente é recusado. Após restart/perda do cache, a idempotência
durável é do núcleo: `repetida: true` confirma o efeito, mas deixa o canal como
`unknown` e suprime novo envio. Timeout do CLI pode ocorrer depois do efeito;
timeout do Telegram pode ocorrer depois da entrega. Não há rollback do efeito,
retry automático ou garantia de entrega/leitura exatamente uma vez. Em particular,
um crash entre efeito e confirmação pode deixar o remetente sem confirmação.

Prova dirigida com ambiente removido antes dos imports, casas temporárias, bloqueio
de rede no verificador e transportes **SIMULADOS**. Exercita as classes, o loader,
a descoberta opt-in/cache e `invoke_hook` do Hermes instalado, além das regressões
Python deste adaptador. Não inicia gateway, não usa chaves operacionais nem API real:

```sh
env -i HOME="$HOME" PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 "$HOME/.hermes/hermes-agent/venv/bin/python" adapters/hermes/test/verify_hitl_confirmation.py
```

O comando imprime contagem, falhas, limites e hashes das fontes instaladas; falha
se faltar o contrato local, houver teste ignorado ou tentativa bloqueada de ler
segredo operacional/rede. Não exige build de core. O plano de instalação revisável,
hashes do pacote e preservação/rollback do agente Hermes instalado pertencem ao
checkpoint de instalação; instalação e aceite Telegram real são etapas posteriores.
# HITL nativo e Maestro

`orkastery maestro` consulta panorama por `ork_maestro`. Prioridade máxima da
conversa: tópicos, recomendação e escolhas claras, preservando resposta e cancelamento.
Telegram é opcional. O callback instalado `pre_gateway_dispatch` pode receber
Discord sem Telegram, com `discord.Message`, usuário autorizado, sessão existente
e binding privado `ORK_HITL_NATIVE_BINDING_HERMES`/`ORK_HITL_NATIVE_KEY_HERMES`.
Chaves e bindings nunca são publicados ao modelo ou herdados pela sessão filha.
Terminal/ACP sem callback de identidade homologado permanece indisponível; hooks de
aprovação de comando são observadores e não aprovam gates Orkastery.
O plugin lê o pedido pelo CLI do núcleo e responde na mesma conversa só após recibo.
Loader fixture não prova homologação live; instalação e sessão nova pós-SHIP são pendentes.
