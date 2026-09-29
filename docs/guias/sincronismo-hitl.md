# Sincronismo entre o orquestrador e as sessões

> Investigação do incidente de 05/09/2026 e o que passou a existir por causa dele.

## O incidente

Uma sessão `claude --bg` da Factory ficou parada em `state: blocked` pedindo o código 2FA
do `npm publish`. O orquestrador não soube. O humano descobriu sozinho, horas depois, e
reclamou. Isso quebra a regra de condução do Orkastery, que manda detectar pausa,
impedimento e HITL de forma proativa e avisar o humano com alternativas e uma
recomendação.

O diagnóstico tem três camadas, e só a terceira era óbvia.

**1. O monitor era thread-cêntrico.** O `ork orquestracao status` deriva paradas de
`thread.json`, `ledger.jsonl` e das filas em disco. A sessão do incidente não tinha
thread: era uma sessão da Factory despachada direto. Nenhuma varredura do ork passava
por ela.

**2. "Viva" não é "trabalhando".** Este era o defeito mais caro, porque atingia até as
threads que o monitor cobria. O monitor perguntava ao runtime quais sessões estavam
vivas e montava um conjunto de `sessionId`. Uma sessão travada em HITL **continua
aparecendo** no `claude agents`, então ela entrava nesse conjunto e o monitor concluía
que o agente ainda trabalhava, imprimindo "a pausa chega quando ela terminar". O sinal
mais forte de que alguém precisava do humano era lido como o oposto.

**3. Ninguém rodava a varredura.** Não havia rotina periódica. O orquestrador dependia de
o humano perguntar, o que é o contrário de condução proativa.

E há um quarto fato, que só apareceu ao medir a máquina: `state: blocked` não é uma coisa
só. Das 7 sessões `blocked` na máquina em 05/09/2026, apenas 2 tinham job vivo. Nas
outras 5 o `claude logs` respondia `job not found` com código 1: o estado ficou carimbado
depois de o job sair. Tratar as duas como a mesma coisa daria mais alarme falso do que
alarme verdadeiro, e alarme falso crônico é como o humano aprende a ignorar o radar.

## A. O mecanismo de varredura (implementado)

`ork sessions hitl` parte das SESSÕES, e não das threads. Uma chamada a
`claude agents --json --all` classifica todas elas; só as paradas pagam o preço de uma
chamada a `claude logs`, que é o que separa a sessão que espera resposta da que morreu
esperando, e é de onde saem a pergunta e as opções que a sessão ofereceu. Medido na
máquina real: 45 sessões, 7 paradas, 8 segundos.

Duas correções vieram de rodar o radar contra as sessões de verdade, e nenhuma delas
aparecia no runtime falso dos testes:

**O `claude logs` não escreve espaço.** Ele desenha a tela andando até a coluna com a
sequência CHA (`ESC[<n>G`). A limpeza de ANSI apagava a sequência junto com o resto, e as
palavras colavam: `2newMCPserversfoundinthisproject`. Isso não só deixava a pergunta
ilegível para o humano, como matava todo o reconhecimento por frase, que é o que separa
`hitl.credencial` de `hitl.permissao`. A limpeza agora repõe os espaços que o terminal
teria desenhado.

**Nem todo menu é numerado.** As duas sessões travadas com job vivo estavam paradas num
menu de seleção (`[✔] codegraph`), o prompt de habilitar servidores MCP. O radar só
enxergava `1. opção`, então elas saíam como `hitl.desconhecido`, sem pergunta e sem
alternativa: o radar dizia que alguém esperava e não dizia esperando o quê. Com os dois
formatos lidos, elas saem como `hitl.permissao`, com a pergunta e as duas opções que a
sessão ofereceu.

A classificação, as opções e a recomendação por tipo estão em [cli.md](../referencia/cli.md). O
comando não grava nada, então é seguro rodar em laço.

Junto dele, `scripts/varredura-hitl.sh` é a rotina periódica: roda o radar, compara com a
varredura anterior e imprime só a novidade, com código de saída `10` quando há novidade.
A comparação é por sessão MAIS classe, então uma sessão que travou e depois morreu volta
a avisar, porque a ação do humano mudou. O cache de "já avisei" mora em
`~/.orkastery/hitl-avisado.json`, fora do repositório: ele é estado do orquestrador, não
do projeto.

```text
*/10 * * * * /caminho/scripts/varredura-hitl.sh >> ~/.orkastery/hitl.log 2>&1
```

O monitor de threads também foi corrigido: `sessaoViva` agora quer dizer TRABALHANDO, e
uma sessão `blocked` vira pausa valendo, com o estado cru declarado em `sessaoEstado` e
uma correção que leva ao que a sessão pede. Os dois comandos se complementam e não se
duplicam: `ork monitor` responde "quais threads estão paradas", `ork sessions hitl`
responde "quais sessões estão paradas", inclusive as que não são de thread nenhuma.

## B. Carimbo de bloqueio e estado único, implementados na I-01

`ork sessions hitl --registrar` grava `sessao_bloqueada` na primeira observação do HITL
e `sessao_destravada` ao observar uma saída conhecida. Repetir o poll não duplica a
transição. `paradaHaMin` passa a ser o tempo desde o carimbo; antes dele é desconhecido,
em vez de idade da sessão. Sem `--registrar`, o radar continua somente leitura.

Sessões com thread escrevem no ledger canônico da main. Sem thread, usam
`${ORKASTERY_HOME:-~/.orkastery}/sessoes.jsonl`. A worktree recebe um link por thread;
`ensure`, criação, despacho e retry conferem esse vínculo. `worktree sync` restaura
vínculos ausentes e preserva backup quando incorpora arquivos legados compatíveis.
Arquivo conflitante reprova com `tree.blocked`; reconciliar as evidências vem antes de
tentar novamente. `worktree audit` compara os caminhos físicos e a contagem dos ledgers.

`ork pulse --json` reúne monitor, sessões e as entregas sem score (`ork master`) no contrato `ork.pulse/v1`.
A fila humana usa tempo real de espera e impacto. Uma mesma pausa observada pelo monitor
e pelo radar não duplica o alerta. `hitl.desconhecido` inclui as últimas N linhas limpas
(`--linhas`, padrão 20), sem inventar pergunta ou opções. Fontes indisponíveis ficam
explicitamente declaradas. O silêncio de fase usa limite padrão de 10 minutos e entra no
retry tipado; apenas a execução de retry consome as tentativas permitidas.

## C. A varredura de sistema

A rotina é `monitor/varredura-pulse.sh`, com deduplicação e transporte em
`core/src/pulse-delivery.ts`. Ela consulta `pulse --registrar`, adquire lock de processo,
envia cada novidade e só então confirma a assinatura no cache. Mudança de pergunta,
classe ou episódio volta a avisar; somente aumentar a duração não gera novo aviso.
Falha de consulta ou envio preserva a possibilidade de reenvio. Cada rodada grava uma
linha JSON em `.orkastery/monitor/hitl.log`, inclusive quando não há novidade.

Configure o transporte determinístico em `.orkastery/monitor/pulse-host.json`. Exemplo
para OpenClaw, substituindo o destino pelo chat autorizado:

```json
{
  "executavel": "/caminho/absoluto/openclaw",
  "argumentos": ["message", "send", "--channel", "telegram", "--target", "CHAT_AUTORIZADO", "--message", "{{mensagem}}", "--json"]
}
```

Os argumentos são passados diretamente ao executável, sem shell ou eval. Um adaptador
Hermes pode fornecer um executável determinístico com a mesma interface e código 0
somente após confirmar a entrega. Não use uma sessão de chat ou cron LLM como transporte.
O template `monitor/pulse.cron` bate de 15 em 15 minutos (`*/15 * * * *`), e o núcleo decide
o que sai em cada batida pela cadência que o dono escolheu com uma tag (seção J). Renderize o
caminho da main e instale junto das entradas existentes. O host precisa encontrar `node`, `claude` e seu
transportador pelo PATH ou por caminhos absolutos. No pacote npm, execute com o projeto
como cwd, ou defina `ORK_PULSE_PROJECT` explicitamente.

Provas de operação:

```bash
npm --prefix core test
node core/dist/index.js eval --json
crontab -l
monitor/varredura-pulse.sh
cat .orkastery/monitor/hitl.log
```

O canário `fx-hitl-latency` usa sessão fake e destino local real: entrega em quatro
minutos simulados e nenhum reenvio sem novidade. Isso não comprova Telegram real nem sete
dias de operação. O replay `fx-fase-orfa` conserva os prefixos dos ledgers originais,
antes do próximo redespacho e da reconciliação posterior, com hash das fontes.

Sete dias de logs com intervalos de cinco minutos são uma observação prolongada de
produção e só podem ser declarados depois dessa janela. A I-01 mantém essa aceitação
pendente até haver a série real e recibo do canal configurado.

## E. HITL omnicanal nos quatro hosts homologados (D12, 16/09/2026)

Até aqui esta página descrevia o HITL por **transporte**: Telegram de um lado, MCP local do
outro. Isso escondia dois buracos, e os dois só aparecem quando se olha o recibo depois.

**O que existia.** Dois transportes. `telegram`, com ingresso nativo no OpenClaw
(`inbound_claim`) e no Hermes (`pre_gateway_dispatch`). `mcp-local`, com `elicitInput` do
servidor MCP, para Claude Code e Codex.

**Buraco 1: o recibo não distinguia Hermes de OpenClaw.** Os dois hosts compartilham chave,
allowlist e transporte, e assinavam o mesmo envelope. O `human_gate` gravava
`origem: telegram` e `autorizadoPor: telegram:<id>`, e mais nada: depois, ninguém sabia por
qual dos dois canais homologados a decisão entrou, e um podia assinar pelo outro. O
`mcp-local` já distinguia (`mcp-local:claude-code` e `mcp-local:codex`); metade dos canais
era anônima no próprio recibo.

**Buraco 2: metade do HITL não era omnicanal.** O HITL tem dois alvos: `gate`, que decide o
bloco, e `session`, que responde à pergunta nativa de uma sessão bloqueada. O ingresso MCP
local recusava alvo não-gate. Codex e Claude Code decidiam o bloco pelo próprio host e
**não** podiam responder à sessão que o dono estava olhando: para isso, só Telegram.

### O registro

`core/src/hitl-canais.ts` é o domicílio único. Um **canal** é o par host + ingresso, porque
é ele que o humano escolhe e é ele que precisa aparecer no recibo. São quatro, e a lista é
fechada por tipo (`Record<Canal, ...>` sobre `Host`): reduzir a lista é erro de compilação,
não configuração.

| Canal | Transporte | Ingresso verificável | Identidade no recibo |
| --- | --- | --- | --- |
| `openclaw` | telegram | `inbound_claim` (`adapters/openclaw/src/hitl-ingress.ts`) | `telegram:<userId>` com `canal=openclaw` e conta autorizada assinados |
| `hermes` | telegram | `pre_gateway_dispatch` (`adapters/hermes/hitl-ingress/__init__.py`) | `telegram:<userId>` com `canal=hermes` assinado |
| `claude-code` | mcp-local | `elicitInput` (`core/src/mcp-server.ts`) | `mcp-local:claude-code` + `connectionId` |
| `codex` | mcp-local | `elicitInput` (`core/src/mcp-server.ts`) | `mcp-local:codex` + `connectionId` |

Os canais Telegram so aparecem como disponiveis quando suas pre-condicoes reais estao
completas. Ambos exigem `ORK_HITL_ROOT`, `ORK_HITL_TELEGRAM_BOT_ID`,
`ORK_HITL_TELEGRAM_USERS` e `ORK_HITL_TELEGRAM_CHATS`. O Hermes acrescenta sua chave
exclusiva `ORK_HITL_INGRESS_KEY_HERMES`; o OpenClaw acrescenta
`ORK_HITL_INGRESS_KEY_OPENCLAW` e a conta homologada `ORK_HITL_OPENCLAW_ACCOUNT`.
Claude Code e Codex autenticam pela conexao MCP local e, por isso, nao exigem segredo de
ingresso em variavel de ambiente. A oferta de canais declara indisponibilidade e o motivo
quando qualquer pre-condicao falta; ela nunca apresenta configuracao parcial como pronta.

Onde cada recibo durável mora, relativo à raiz do projeto: o ingresso de Telegram fica em
`.orkastery/threads/<t>/hitl-ingress/<sha>.json`, com MAC próprio e `sha256` no ledger; o
ingresso MCP local fica em `.orkastery/threads/<t>/hitl-ingress-local/<sha>.json`, assinado
pela chave privada do projeto. Os dois caminhos são os que o registro declara em
`CANAIS[<canal>].recibo`, e o verificador desta rodada confere que o registro e o produto
apontam para a mesma pasta.

`conferirRegistro()` reprova canal sem identidade, correlação, recibo ou adaptador, e
reprova **identidade ambígua**: dois canais com a mesma string de identidade são, na
prática, um canal só com dois nomes. Foi essa asserção que pegou a primeira versão do
próprio registro, que repetia a identidade entre Hermes e OpenClaw.

### O canal entra no corpo assinado

`ork.hitl-answer/v2` leva o canal **dentro** do HMAC. Canal em campo não assinado seria
rótulo, não recibo. O envelope `v1` continua aceito byte a byte — sem `canal`, o corpo
assinado é exatamente o array anterior, e o ingresso durável produz os mesmos bytes e o
mesmo MAC. Um recibo `v1` grava `canal: null` e diz qual contrato o produziu; ele **não**
ganha canal por inferência, porque um `v1` do Telegram tanto podia ser Hermes quanto
OpenClaw.

No `mcp-local` o canal vem da conexão, nunca de argumento de ferramenta. É essa diferença
que impede o agente de responder por quem pediu: transcrito nativo entra por adaptador
verificável, e `recusarIngressoNaoHomologado` recusa qualquer outra origem com
`hitl.canal.transcrito-de-tool`.

### Os dois alvos, nos quatro canais

`responderSessaoLocal` faz a sessão funcionar pelo MCP local. O núcleo da entrega
(`entregarNaSessao`) é o mesmo para os quatro canais: conferência do vínculo nativo, reserva
durável, envio único e confirmação correlacionada. O que muda entre Telegram e MCP local é
só como a resposta foi autenticada.

Na primeira versão isto era verdade da ENTREGA e não da PROVA, e a diferença passou
despercebida porque o texto desta página dizia "o mesmo para os quatro canais" nos dois
alvos. A rodada GO-FIX 1 fechou a distância; o que ela corrigiu está na seção F.

Pergunta aberta **não vira menu**: quando a pergunta nativa aceita texto, o `elicitInput`
monta schema sem `enum`, e a resposta chega literal ao receptor, inclusive quando é um
número. Um menu sobre pergunta aberta muda a pergunta.

O recibo local amarra o **conteúdo**: `reciboDoAtestado` inclui `sha256(resposta)`, como o
Telegram já fazia pelo HMAC. Sem isso o recibo provaria apenas que alguém respondeu daquela
conexão, nunca o que o receptor recebeu. `canal` e `contratoResposta` do evento são
conferidos contra o host que assinou, senão um ledger adulterado trocaria o canal sem
reprovar.

### A oferta ao humano

`ofertaDeCanais` é leitura pura: dado o ambiente observado e as conexões MCP vivas, diz por
quais canais dá para responder um pedido aberto e por que os outros não servem agora
(`hitl.credencial` com as variáveis que faltam, `hitl.canal.sem-conexao`). Sem oferta não
existe escolha de canal, e D12 seria só uma tabela.

### O que isto NÃO prova

O canário `fx-omnicanal` é SIMULADO, em sandbox git: ele prova que os quatro recibos são
distinguíveis e que aprovação cega, transcrito de tool, canal de outro transporte, chave de
outro canal e conta fora da allowlist são recusados. Ele **não** prova rede Telegram real,
nem cliente MCP real, nem operação prolongada. A observação de sete dias de `hitl.log` da
I-01 continua pendente.

## F. A rodada GO-FIX 1 (16/09/2026)

Um CHECK independente leu a seção E contra o código e achou nove bloqueadores. Oito eram
defeitos reais; o nono é de processo e está declarado no fim desta seção. O padrão que une
os oito primeiros é o mesmo: a seção E descrevia uma propriedade e o código entregava uma
versão mais fraca dela, que nenhum teste distinguia da forte.

### FX1 — a chave é do canal, não do transporte

O canal entrou no corpo assinado em D12, e isso resolveu o RECIBO. A CHAVE continuou uma só:
`ORK_HITL_INGRESS_KEY` autenticava Hermes e OpenClaw. Quem vazasse o segredo de um host
assinava envelope do outro, e a conferência aprovava, porque a assinatura conferia mesmo.

Agora cada canal de Telegram tem a sua variável, declarada no registro:

| Canal | Chave de ingresso | Conta homologada |
| --- | --- | --- |
| `hermes` | `ORK_HITL_INGRESS_KEY_HERMES` | não tem: a allowlist é de usuário e chat |
| `openclaw` | `ORK_HITL_INGRESS_KEY_OPENCLAW` | `ORK_HITL_OPENCLAW_ACCOUNT` |

Os dois continuam exigindo `ORK_HITL_TELEGRAM_USERS` e `ORK_HITL_TELEGRAM_CHATS`. Os canais
`claude-code` e `codex` não têm chave de ambiente: a prova deles vem da conexão MCP.

`ORK_HITL_INGRESS_KEY` sobrevive **exclusivamente** para o envelope `v1` legado, que não
declara canal. Não há fallback: um `v2` sem a variável do próprio canal é recusado mesmo com
a chave global presente, porque um fallback devolveria a chave compartilhada exatamente no
dia em que a configuração do canal faltasse.

**Risco legado, declarado:** um envelope `v1` continua valendo byte a byte e continua
autenticado pela chave global compartilhada. Ele não distingue Hermes de OpenClaw nem no
recibo nem na chave. É por isso que nenhum dos dois adaptadores produz `v1` desde D12: o
`v1` existe para não quebrar o que já foi assinado, não para ser emitido de novo.

### FX2 — o `human_gate` é reconferido no momento em que autoriza

`aprovacoesHumanas` decidia por FORMA: campos presentes e `recibo` com cara de sha256. Cada
canal já sabia revalidar o seu recibo durável, e ninguém chamava essas funções no caminho que
autoriza. Quem escrevesse uma linha no `ledger.jsonl` fabricava uma aprovação que `retry` e
`ship` aceitavam. Agora `aprovacaoHumanaProvada` chama `validarEvidenciaDoIngresso` ou
`validarEvidenciaLocal` conforme o canal, e o recibo adulterado deixa de autorizar.

Consequência operacional, e ela é real: reconferir exige a credencial no ambiente de quem
autoriza. Um `ship` de aprovação vinda do Telegram precisa da chave daquele canal; sem ela a
aprovação existe no ledger e não autoriza nada. O canal MCP local não depende de ambiente,
porque a chave dele mora no estado privado do projeto.

### FX3 — um envio pendente órfão tem como ser fechado

A reserva durável guarda `sha(prova)`, nunca a `prova`. Isso está certo e continua assim. O
problema era outro: o único caminho que fechava um `session_answer_sending` exigia que o
MESMO chamador reapresentasse a `RespostaHumana` inteira. Se o processo morresse com ela só
na memória, o pendente ficava para sempre.

`ork sessions reconcile <thread> <pedido>` usa apenas o que está no ledger: `envioId`,
`recibo`, `mensagem`, `autorizadoPor` e o vínculo nativo do pedido. Com isso ele reconstrói a
entrega e pergunta ao receptor, pelo recibo correlacionado, se aquele `envioId` chegou. Ele
**nunca** envia nada, e repetir não muda o desfecho.

Não existe desfecho "cancelado", e a ausência é deliberada: nada observável prova que o
receptor NÃO recebeu. Sem confirmação, o pendente continua pendente.

### FX4 — evidência durável também no alvo `session`

`validarEvidenciaDoIngresso` tinha um `pedido.alvo.tipo !== 'gate'` que devolvia `false` sem
dizer nada. O ingresso durável de uma resposta de sessão por Telegram já existia em disco,
com o mesmo MAC, e nunca era revalidado. Agora a função cobre os dois alvos, e o que ela
amarra muda com o alvo: no `gate`, a opção escolhida e o veredito derivado dela; na
`session`, o envio único, a instância e o prompt nativo que receberam a resposta.

### FX5 — o recibo do OpenClaw prova a conta

`accountId` era conferido no adaptador e morria ali. O recibo durável provava transporte
Telegram genérico. Agora a conta entra no corpo assinado `v2`, em posição fixa (`null` nos
canais sem conta), e no ingresso durável. Trocar a conta no ledger, ou rotacionar a conta
autorizada, derruba a revalidação. O adaptador também parou de tratar `ok: true` como recibo:
ele confere o veredito tipado, `repetida` e, em resposta de sessão, a sessão que recebeu.

### FX6 — a oferta de canais chega ao humano

`ofertaDeCanais` era chamada de um lugar só: o canário. `ofertaDoPedido` agora acompanha o
pedido real no `ork pulse` e em `ork_hitl_pending`, com pré-condições lidas na hora. O Pulse
roda em cron e não é uma conexão MCP: ele passa a lista de conexões vazia de propósito, e os
dois canais locais saem `indisponivel` com `hitl.canal.sem-conexao`. No servidor MCP a
conexão viva é a da própria sessão, e só o host dela pode sair `disponivel`.

### FX7 — a matriz 4x2 num caso integrado

A cobertura anterior era honesta e parcial: Telegram só no `gate`, MCP local só na `session`.
`core/test/hitl-matriz-canais.test.ts` exercita as oito combinações num caso só e exige, de
cada uma, recibo com canal nomeado, evidência durável que revalida e corpo da resposta fora
do ledger. Uma matriz cheia reprova a linha que falta; somas de casos parciais não reprovam.

### FX8 — os números batem com o runtime

`core/scripts/verify-check-c2-b3.cjs` é o verificador desta rodada, com um caso por
bloqueador. Ele não procura strings: assina envelopes com a chave errada e exige recusa,
adultera o ledger e exige que o `ship` pare de autorizar, mata um envio no meio e exige que
a reconciliação feche sem reenviar, monta um Pulse de verdade e lê a oferta que sai dele. O
caso `docs-metrics` compara esta página e o roadmap contra valores obtidos em execução.

### FX9 — conformidade do histórico restaurada

A sessão condutora reescreveu os dois commits ainda não publicados que excediam o limite de
cinco arquivos. O antigo `68a7099` (7 arquivos) virou `T17a`/`T17b`/`T17c`, com 2/2/3
arquivos; o antigo `d790eb9` (8 arquivos) virou `T16a`/`T16b`/`T16c`, com 4/2/2. A
reescrita preservou o conteúdo e a ordem lógica. O caso `commit-dod` executa `git show` em
cada commit de `de34c6c..HEAD` e agora aprova os 24 commits do intervalo, todos dentro do
limite.

## G. Conclusão nativa claude-bg (I-34, 19/09/2026)

O defeito foi reproduzido nas threads `ork-i33rotacaoco` e `ork-i32bootstrap`: o núcleo só
registrava `phase_result` para o runtime Codex. Uma sessão `claude --bg` terminava (`done` no
`claude agents`, Stop ingerido pelo hook), mas nenhum resultado chegava ao ledger. Por isso a
pausa de premissas do #Maestro não abria, o `ork_observe` respondia `nao-inferida` e o radar
de liveness tratava a sessão concluída como parada.

O que mudou:

- `ork phase run` e `ork retry run` registram a fonte nativa da sessão claude-bg
  (`session_sensor_registered` com `nativo: claude-agents` e o `cwd` do despacho) e iniciam o
  mesmo observador destacado do Codex, com o mesmo lock e o mesmo registro. O laço consulta
  `claude agents --json --all` a cada 5 s (cerca de 0,3 s por consulta, medido) e termina no
  primeiro terminal.
- `ork sessions watch --thread T` aceita claude-bg. Para sessão despachada antes da I-34, a
  fonte é derivada do `phase_dispatch` e registrada com `origem: sessions.watch`.
- A classificação exige Stop correlacionado, estado nativo `done` e, desde o GO-FIX 2, prova
  gravada pelo `ork` no intervalo do despacho (artefato da fase, commit conferido no Git da
  worktree depois do HEAD do despacho e worktree limpa, parecer com veredito, score ou ship);
  SHA declarado sem conferência não prova o GO. Sem a prova, `human.pending` com diagnóstico. A tabela
  completa está em [verificacao.md](verificacao.md). `failed`, `stopped` e processo morto sem
  Stop correlacionado, e ausência prolongada, viram `runtime.unavailable`; processo morto ou
  sessão `stopped` depois de um Stop correlacionado segue a regra da prova, e `failed` depois
  do Stop vira `human.pending` com diagnóstico, porque reexecutar redespacharia uma fase que
  pode ter terminado; a pausa prevista vira `human.pending`. O `ork_observe` aplica a mesma
  tabela e não diverge do watcher para o mesmo estado.
- `ork gate request` abre a pausa depois do `phase_result` do despacho corrente, e recusa
  abri-la sobre falha de execução (`runtime.unavailable`, `runtime.silencio`,
  `artifact.missing`). Parecer negativo continua abrindo a pausa.
- O PLAN despachado por claude-bg deixou de usar plan mode. Em `--bg`, o plan mode desabilita
  `ExitPlanMode`, grava o plano em `~/.claude/plans` e bloqueia `ork_artifact_write`, e a
  sessão terminava "pronta para aprovação" sem meio de aprovação. Agora ela roda como sessão
  comum, com `Edit`, `Write` e `NotebookEdit` negados e, entre as ferramentas do Orkastery,
  só as seis consultas e `ork_artifact_write` liberados (nada de commit, claim, verify ou
  ship). Se a
  sessão PLAN terminar sem gravar `docs/plan.md`, o resultado é `gate_blocked`
  `artifact.missing`, com a correção dirigida da política de retry.

Requisito: o plugin do adaptador `claude-code` precisa estar instalado, porque o Stop vem dos
seus hooks. Sem ele, nenhuma sessão claude-bg conclui com sucesso; depois de 10 minutos em
`done` sem Stop, o observador encerra com diagnóstico e sem gate, e o radar de liveness leva o
caso ao humano. Nenhum retry automático reexecuta uma fase que pode ter terminado.

O que isto NÃO prova: o `done` do `claude agents` é a leitura que o Claude Code faz do texto
final do agente, não um terminal de processo; quem diz que o turno terminou é o Stop, e quem
diz que a fase entregou algo é a prova do lado do `ork`. Nada disso diz que o trabalho está
certo, a mesma fronteira do Codex; quem julga o produto continua sendo o CHECK. As regras de ferramenta do
PLAN são permissões nativas do Claude, não sandbox de processo: Bash continua sujeito ao modo
de permissão do usuário.

Rollback: `git revert -m 1 <merge da I-34>` devolve o PLAN em plan mode e a recusa do watcher
para claude-bg. Os `phase_result` claude-bg já gravados continuam válidos no ledger.

## H. Prazo do HITL no fuso do dono (I-35, 19/09/2026)

Origem: ordem do dono em 19/09/2026, depois de receber no Telegram
`Prazo: 2026-09-19T14:00:30.843Z`. O pedido continua assinado com o prazo em UTC ISO; a
apresentação ao humano é que muda:

- `apresentarDecisao` (elicitation MCP de Claude Code e Codex e oferta nativa de Hermes e
  OpenClaw) mostra `Prazo: 19/09 11:00 (horário de Brasília), em 1h00`.
- A mensagem do pulse ao Telegram mostra o prazo e a pergunta no fuso do dono; o item do pulse
  continua com ISO, então a assinatura de deduplicação não muda e nada é reenviado.
- `ork gate context` e `ork_hitl_pending` ganham `prazoLocal` (absoluto e rotulado) ao lado de
  `pedido.prazo`. Hermes e OpenClaw exibem a mensagem do núcleo e, se um núcleo de outra
  versão não trouxer o prazo local nela, acrescentam `prazoLocal`.

Intocados: o contrato `ork.hitl/v1`, `pedido.prazo`, `pedidoSha256`, o `expiresAt` do corpo
assinado pelo ingresso nativo e os recibos. O fuso é o de `owner.timezone` do projeto servido
(o servidor MCP lê o manifesto do `--project`, não o do cwd).

O que isto NÃO prova: os testes usam núcleo real e canais SIMULADOS; não há envio real ao
Telegram nem cliente MCP real. Rollback: `git revert -m 1 <merge da I-35>` devolve o ISO na
apresentação; nenhum dado gravado precisa de migração, porque só o texto mudou.

## I. O caminho de volta do pulse (I-41, GO-FIX 1, 22/09/2026)

Origem: o CHECK independente da I-41 (sessão `cd941214`) mediu que o produto mandava um resumo
perguntando `Posso te mandar as perguntas agora?` e que nada no produto sabia receber o sim; que
o lote pedia `1a` e nada interpretava; e que, na fila real, sairiam zero perguntas. Parecia
funcionar, que é pior do que não funcionar. Esta seção descreve o que a rodada de correção pôs
de pé, e o que ela ainda não prova.

**O resumo conta só o que vai sair.** `Esperando você` conta itens; a linha nova
`Perguntas para você` conta os gates que ainda esperam o dono agora, conferidos por
`prepararPedidoGate`, que faz todas as conferências de `abrirPedidoGate` sem escrever nada.
Pedido velho de thread que já seguiu em frente é história e não conta. Pedido que espera e não
vira pergunta é contado à parte, como conserto nosso. Sem pergunta, o resumo termina com
`Nada aqui pede resposta sua por este canal agora.` e não oferece código.

**O sim tem receptor.** O dono responde no Telegram, sem barra e sem identificador:
`P4EJ a` (sim) ou `P4EJ b` (agora não). O código começa por letra e tem dígito: palavra comum
nunca tem essa forma, e ele nunca se confunde com a resposta ao lote, que começa pelo número da
pergunta. Os ingressos do Hermes e do OpenClaw reconhecem as duas formas pela mesma gramática do
núcleo (`GRAMATICA_DO_PULSE`, conferida texto a texto por teste) e chamam
`ork pulse responder`. O lote é a resposta ao sim, na mesma conversa: o pedido de cada gate é
(re)aberto em `ork.hitl/v2` naquele instante, com prazo contado dali. Um sim serve um lote;
repetir o sim devolve o mesmo lote. O que não coube sai com um código novo na mesma mensagem.

**A resposta do lote tem receptor.** `1a 2c` é casado com o lote que o núcleo serviu e gravou
(`.orkastery/monitor/pulse-lote.json`), e cada resposta vira `human_gate` pelo `responderGate`
de sempre: recibo durável no diretório da thread, uso único, janela, contexto, canal e
publicação na memória. O evento guarda `enderecoAssinado`, com o número e a letra, para a
auditoria refazer o caminho.

**A prova não mudou.** `assinaturaDaResposta` e `autenticarResposta` são as da `main`, byte a
byte (claim C88 confere por sha256). O que mudou é o endereço dentro do corpo assinado: o
gateway não conhece identificador de pedido, então assina o endereço do pulse e o texto do dono,
e o núcleo traduz. Só esse endereço é aceito como prova derivada; envelope assinado para outro
pedido nunca serve de prova para este, e a resposta derivada não pode divergir do envelope em
nenhum campo além da própria resposta.

**A metade que presta contas.** `ork decisao registrar` grava a decisão tomada sem perguntar
(`classe: decidido`, com o que foi decidido, o porquê, como mudar e o custo de reverter agora e
depois) e o rastro tipado (`quemDecidiu`, `evidencia`, `razao`) num evento só; o registro do
ledger recusa `autonomous_decision` sem os três. A decisão chega ao dono uma vez no resumo, e
`ork decisao placar` mostra por fase decididas contra perguntas, reversões e o limiar de
revisão de 13 decisões por fase (o p90 medido no PLAN), que dispara revisão e nunca recusa.

O que isto NÃO prova: os testes usam núcleo real e canais SIMULADOS (gateway, Telegram e chaves
de teste); nenhuma mensagem real foi enviada, e o cron do pulse continua desligado até esta
entrega estar na `main` e instalada. A prova no caminho real foi feita pela sessão de GO-FIX
sobre uma cópia descartável da fila de 22/09 (transporte executável local) e está no relatório
dela; no ledger fica a decisão que a cita, e o teste `pulse-resposta.test.ts` reproduz o mesmo
caminho com threads criadas pelo núcleo num projeto temporário. Pergunta aberta
não é respondida por letra e fica fora do lote de letras; responder aberta pelo Telegram é
trabalho seguinte. Rollback: `git revert` dos commits da rodada devolve o resumo anterior;
`pulse-lote.json` e `pulse-consentimento.json` são estado do monitor, e os `human_gate` já
gravados continuam válidos porque a prova deles é a de sempre.

## J. A cadência do pulse pela tag do dono (I-50, RM-039, 27/09/2026)

Até aqui, trocar a frequência do resumo era editar o crontab da máquina. Agora o dono troca em
conversa, mandando só a tag no canal em que recebe o resumo:

| Tag | Resumo periódico |
| --- | --- |
| `#OrkPulseOff` | de 8 em 8 horas, às 08h, 16h e 00h do fuso do dono |
| `#OrkPulseOn` | de 2 em 2 horas, nas horas pares |
| `#OrkPulseOn-60m` | de hora em hora (o padrão, sem tag gravada) |
| `#OrkPulseOn-30m` | de 30 em 30 minutos |
| `#OrkPulseOn-15m` | de 15 em 15 minutos |

**Pergunta de verdade não espera a cadência.** A cadência governa o status periódico: decisões
informadas e mudanças no que já foi oferecido. Pergunta nova ao dono sai na batida seguinte do
cron, qualquer que seja a tag. A novidade que esperou continua não vista e sai no primeiro resumo
da janela seguinte, ou junto com a próxima pergunta, o que vier antes.

**Como funciona.** O cron bate de 15 em 15 minutos e chama a varredura com a cadência ligada. A
tag gravada fica em `.orkastery/monitor/pulse-cadencia.json` (contrato `ork.pulse-cadencia/v1`,
modo 0600), com quem trocou, por qual canal e quando. Cada tag divide o dia do dono em janelas
ancoradas, e sai no máximo um resumo periódico por janela; o último fica em
`pulse-ultimo-resumo.json`. A troca vale na batida seguinte, sem mexer no crontab. A cadência
curta não encurta o prazo para responder ao resumo: ele nunca fica abaixo dos 60 minutos.

**Pelo Telegram.** A tag é a terceira forma de `GRAMATICA_DO_PULSE`, ao lado de `P4EJ a` e
`1a 2c`, e os ingressos do Hermes e do OpenClaw a reconhecem pelo mesmo texto do núcleo. Ela
começa por `#`, então nunca se confunde com as outras duas. Só vale sozinha na mensagem: tag no
meio de uma frase continua sendo conversa com o assistente. A prova é a de sempre (o envelope
assinado pelo canal, conferido por `autenticarResposta` antes de ler o texto), e o núcleo
responde no mesmo canal com a cadência nova e a hora do próximo resumo no fuso do dono.

**Pelo terminal.** `ork pulse cadencia` mostra a cadência em vigor e quem a trocou;
`ork pulse cadencia OrkPulseOn-15m` troca. O `#` é opcional, porque o shell trata `#` no início
da palavra como comentário (com aspas, `'#OrkPulseOn-15m'` também vale). `--por` registra quem
pediu; sem ele, fica o usuário do sistema.

**Instalação.** Quem já tem a linha de hora em hora no crontab troca `0 * * * *` por
`*/15 * * * *` na linha da varredura do pulse. Sem essa troca, a cadência ainda vale, mas a
batida de hora em hora limita tudo a um resumo por hora, e pergunta nova espera até a hora cheia.
Os adaptadores do Telegram precisam ser reinstalados (`ork adapter install hermes|openclaw`)
para reconhecer a tag.

## K. Condução multicanal (I-36, RM-036, 27/09/2026)

Em 19/09/2026 o Hermes despachou o CHECK de uma thread às 19:41 e esta sessão do Claude Code
despachou o GO-FIX da mesma thread às 19:53. As duas rodaram build e teste juntas na mesma
worktree, e o `verify` das 19:55 gravou `code: -1` como reprovação. O ledger não distinguia os
dois despachos (os dois pelo runtime `claude-bg`), e o único jeito de destravar foi matar a
sessão do outro canal.

- **O recurso:** o lease `exec:<thread>` mora no estado canônico do projeto. Quem roda da raiz e
  quem roda de uma worktree disputam o mesmo arquivo.
- **O canal de condução não é o canal de HITL.** O registro de HITL (seção E) tem os quatro
  hosts, com chave por canal, e existe para o ingresso humano assinado. O de condução tem seis
  canais (`claude-code`, `hermes`, `openclaw`, `codex`, `mcp`, `cli`), é declarado pela borda e
  não concede autoridade. O contrato de HITL não mudou.
- **Todo despacho grava o canal** (`phase_dispatch.canal`) e, quando houver, a conversa ou
  mensagem de origem (`correlacao`). Sessão de antes da I-36 lê como `desconhecido`, nunca como
  `cli`.
- **A mesma resposta em qualquer canal:** `ork thread status`, `ork board`, `ork monitor`,
  `ork pulse`, o panorama `orkastery maestro` e o `ork_thread_status` do MCP leem a mesma função
  do núcleo e imprimem a mesma linha. A recusa do segundo pedido chega igual pelo CLI e pelo MCP.
- **No pulse**, condução em andamento não é pergunta ao dono: `conducao.em-andamento` entra na
  faixa automática, como `lease.busy`. E a varredura libera, com prova, a condução órfã das
  threads do escopo de escrita.

## L. HITL humano no centro (RM-048, 28/09/2026)

Em 27/09/2026 o dono respondeu "1. I-31. Aprovar, 2. D2 ..." e nada foi ao ledger: o ingresso só
conhecia `P4EJ a` e `1a 2c`, e a prosa caiu no assistente. No mesmo dia o pedido `5fdcb00b`
(código `DE6H`) virou `3b2c4b61` (código `SNS5`) em menos de quatro horas: o prazo de uma hora
vencia e o gate renascia com identificador e código novos. A prova do ingresso não mudou em nada;
mudou o que o núcleo traduz depois dela.

- **Pedido curto (`ork.hitl-curto/v1`):** o mesmo contrato no lote do Telegram, no diálogo do host
  e no item do pulse. Pergunta em uma frase, o que trava e desde quando, até quatro alternativas
  de uma linha com a consequência, uma recomendada com o porquê e a última linha dizendo o que
  digitar. No máximo 15 linhas, por construção. `ork gate request <thread> --formato telegram`
  devolve o gate pronto; `<código> detalhes` devolve artefato, claims, riscos e diff.
- **Texto livre inequívoco:** vocabulário fechado (`aprovo`, `sim`, `pode seguir`, `ok`, `revisar`,
  `esperar`, `detalhes` e parentes), letra `a` a `d` e dígito `1` a `4`. A palavra casa a ação da
  alternativa; `não` num gate casa revisar e esperar, e por isso volta como pergunta. Com mais de
  um pedido aberto na mesma thread, palavra não registra. A palavra solta, sem número nem código,
  só vale nos 60 minutos depois de a pergunta sair, com uma pergunta aberta, e nunca para ato sem
  volta. Ela só é interceptada no Telegram enquanto `.orkastery/monitor/pulse-escuta.json`
  (`ork.pulse-escuta/v1`) disser que a janela está aberta; fora dela, vai ao assistente.
- **Linha estável:** o gate reaberto no mesmo contexto mantém o código, e o código só muda quando
  a pergunta muda. Resposta a pedido vencido vai ao pedido renovado quando a essência (pergunta,
  alternativas, recomendada, corpo, ato, código) e o contexto da thread são idênticos, com
  `renovadoDe` no rastro; qualquer diferença recusa. O número do lote vale por 24 horas, e o sim ao
  resumo mais recente vale depois do prazo, porque o lote reconfere cada gate na hora.
- **Dono x orquestrador:** `runtime.*`, `verify.*`, `claims.*`, `artifact.missing`, `hitl.formato`,
  `ci.failed`, `vaga.stale`, `lease.busy` e parentes são do orquestrador. Não viram pergunta e o
  resumo os mostra numa linha "Conosco, impedimento técnico". O resto continua com o dono.
- **Nota do MASTER com prova:** `ork master pedir <thread>` devolve `<código> <0 a 5> <porquê>`; a
  resposta do dono passa pela mesma `autenticarResposta` no endereço do pulse, e o `master_done`
  guarda o remetente autenticado, o canal, a mensagem, o sha da prova e a evidência com o envelope.
  `ork master` com `--por` vindo de processo de host recebe `master.prova-de-canal`.
- **O que isto NÃO prova:** o canal do processo é declarado pelo ambiente e só serve para recusar;
  quem apaga as variáveis do próprio host passa como terminal. O diálogo MCP de nota para Claude
  Code e Codex fica para depois.

## D. Rollback

Desative apenas a entrada identificada da varredura de pulse no crontab, preservando as
demais. Reverter o merge de código é um `git revert -m 1 <merge>` com verificação e push
provado por `git ls-remote`; não usar reset ou force push. Preserve os ledgers, caches,
backups de estado e links de thread na main para não perder a trilha de evidência.
