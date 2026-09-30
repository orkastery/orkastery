# Referência do CLI `ork`

Fonte de verdade: `ork --help`. Este documento organiza a mesma informação por tarefa, e
explica o **porque** de cada grupo de comandos.

Todo comando sai com código diferente de zero quando reprova, o que torna qualquer um deles
utilizável como gate de pipeline.

---

## Ambiente e configuração

| Comando | O que faz |
| --- | --- |
| `ork doctor` | O que vale nesta máquina agora. **Sai diferente de zero se bloqueado**, nunca por um `warn` |
| `ork demo [--manter] [--dir D]` | A promessa em 30 s: num repositório temporário, a afirmação falsa do agente é reprovada pelo `ork verify` e a corrigida é aceita; offline, sem conta nem modelo (I-56) |
| `ork init [--force] [--name N] [--abbrev A]` | Gera o `orkastery.yaml` do repositório |
| `ork modos` | A tabela dos **4 modos vivos** de condução por #TAG |
| `ork modos --do-pedido "<texto>" [--json]` | Lê a #TAG de um pedido. **E o que os adaptadores chamam**, para não reimplementar o parse. #TAG aposentada sai != 0 com `modo.aposentado`, em vez de virar o default em silêncio |
| `ork modos migrar [--dry-run] [--por Q] [--json]` | Tira modo aposentado do `orkastery.yaml` e do `setup.json`. Idempotente, com backup, e não toca em histórico |
| `ork ciclos` | As 5 variantes de ciclo de `ork thread new --ciclo` |
| `ork setup <modo> --bloco N [--runtime R] [--model M] [--effort E]` | Edita o bloco do modo e carimba `setup_configured` no ledger do projeto |
| `ork setup <modo> --bloco N --fallback R:M[:E],...` | Ordem de fallback de runtime do bloco (I-33); `--fallback ""` remove |
| `ork setup versionar` | Leva o setup que vale para `orkastery.setup.json`, na raiz do checkout: por PR, vale em todas as máquinas e passa a ser o arquivo editado (I-52) |
| `ork accounts list [--json]` | Perfis de conta por runtime: id, runtime, diretório, estado, prazo, último uso e última falha. **Sem segredo**, porque o store não guarda nenhum |
| `ork accounts add <id> --runtime R --dir D [--sem-login]` | Cria o perfil e o diretório (0700) e roda o login do **próprio CLI** com o env do perfil (`claude auth login --claudeai`, `codex login`); sem TTY, imprime o comando. Nunca copia credencial |
| `ork accounts remove <id>` | Desativa o perfil; o diretório e o login do CLI ficam onde estão |
| `ork accounts check [<id>]` | Confere o login de cada perfil ativo (`claude auth status`, `codex login status`) e marca o store: `sem-auth` sai do rodízio; login por API key, `api_key_helper`, Console ou nuvem vira `provider-pago` e nunca despacha; login de assinatura refeito volta; conferência inconclusiva (timeout, binário ausente, resposta ilegível) mantém o estado e registra a falha. Sai diferente de zero com perfil sem login de assinatura conferido |

O `ork doctor` tem o check "contas por runtime" (lê e relata, sem marcar o store) e a sonda de
umask e das permissões de `.orkastery` e `.orkastery/private`. Sem perfil configurado, cada
runtime despacha pelo ambiente do processo, como antes da I-33. A superfície MCP de `accounts`
não existe neste ciclo: o `add` é interativo e local, e a leitura de estado já vem do
`ork_observe`. Nos hosts de superfície CLI (Hermes, OpenClaw), a paridade é por estes comandos.

A troca automática entre perfis do **mesmo** runtime obedece ao bloco `runtime_profiles` do
`orkastery.yaml` (D14, D16). Só booleano vale direto (N2): texto ou número que diz sim ou não
sem ambiguidade (`off`, `"false"`, `0`, `"no"`, `nao`, `on`, `"true"`, `1`, `sim`) vale o que
diz, com aviso; qualquer outro valor vale o padrão, com aviso. O aviso sai no próprio
`ork phase run`, `ork retry` e `ork accounts`, além do `ork doctor`:
`rotate_same_runtime_on_quota` (padrão `true` desde a decisão do dono de 19/09/2026, ver
SECURITY.md: esgotamento de cota, crédito ou limite do plano troca para o próximo perfil ativo
do mesmo runtime; `false` desliga) e `rotate_same_runtime_on_auth` (padrão `true`: login
perdido troca para o próximo perfil com login). Rate limit comum de curta janela nunca troca de
perfil: espera a janela na fila (critério único em [verificacao.md](../guias/verificacao.md)). A troca
manual pelos comandos acima não depende dessas chaves.

### Horários para pessoas: o fuso do dono (I-35)

Origem: ordem do dono em 19/09/2026, "nunca mais use horários UTC para se comunicar comigo".
Todo horário que o CLI mostra a uma pessoa sai no fuso de `owner.timezone` (nome IANA no
`orkastery.yaml`; sem a chave, o fuso do sistema, com piso `UTC`; valor inválido avisa uma vez
no stderr e cai no default, sem mudar o código de saída). O domicílio único é
`core/src/horario.ts`.

O fuso é resolvido uma vez por processo. Toda entrada de processo registra a fonte pelo
manifesto do projeto (o `main` do CLI, o `ork mcp serve` e a entrada do cron do pulse,
`dist/pulse-delivery.js`); `core/test/horario-entradas.test.ts` reprova entrada nova que não
registre nem declare por que não mostra horário. Cada execução do CLI e do cron lê o valor
novo de `owner.timezone`; o `ork mcp serve` e os gateways que o mantêm aberto (Hermes,
OpenClaw) só o enxergam depois de reiniciados.

| Regra | Como aparece |
| --- | --- |
| Data e hora | `19/09 15:16`; com o ano (`19/09/2025 15:16`) só quando não é o ano corrente |
| Hoje | Onde ajuda (`desde`), só a hora: `15:16`; em outro dia, a data completa |
| Tabelas de ledger | `ork phase list` e `ork audit show --ledger` mantêm os segundos: `19/09 15:13:34` |
| Prazo | `19/09 16:16 (horário de Brasília), em 1h00` ou `venceu há 5min` |
| Rótulo do fuso | Uma vez por mensagem: `horário de Brasília` para `America/Sao_Paulo`, `UTC`, e `<IANA>, <sigla>` nos demais |

Vale para `ork phase list`, `ork retry list`/`plan`/`run`/`resume`/`parse`,
`ork orquestracao status` (`ork monitor`), `ork board`, `ork lease list`/`acquire`,
`ork pulse`, `ork audit show`, a janela ociosa do `ork audit run`, `ork doctor`,
`ork thread status`, `ork verify`, `ork master`, `ork ship`, `ork ledger stats`,
o texto do `ork maestro` e a apresentação HITL.

Dado de máquina não muda: ledger, `--json`, contratos, recibos, claims e hashes continuam em
UTC ISO. Texto gravado como prova (detalhe, evidência, correção) guarda o ISO e é localizado
só na exibição. JSON lido por um host para mostrar a uma pessoa ganha campos opcionais,
absolutos e rotulados, ao lado do ISO: `prazoLocal` em `ork gate context` e em
`ork_hitl_pending`, e `deadlineLocal`, `receiptAtLocal`, `expiresAtLocal` e
`availableAtLocal` nos fatos do `ork maestro --json`.

O digest semanal do MASTER usa a sexta-feira do fuso do dono. Com o dono (ou o sistema) em
`America/Sao_Paulo` o dia é o mesmo de antes em qualquer `TZ` do processo; uma instalação sem
`owner.timezone` num servidor em UTC passa a usar a sexta de UTC, então configure a chave. A
janela ociosa da auditoria (`audit.janela_ociosa`) também é avaliada no fuso do dono; sem a
chave, no fuso do sistema, como antes.

Fora do escopo: documentos de handoff e prompts para a próxima sessão de agente, registros de
memória do OrkMind e citações literais (logs do runtime, artefatos, diff). O teste
`core/test/horario-lint.test.ts` reprova, em `core/src`, `scripts/` e `monitor/`, a volta de
`replace('T', ' ')`, de fuso fixo fora de `horario.ts` e de campo ISO cru em texto
(`...Em`, `...At`, `...Ate`, `.ts`, `.prazo` ou `toISOString()`), seja interpolado,
concatenado, guardado numa variável local que vai para o texto ou passado direto ao
`console.*`.

---

## Projeto-alvo (RM-052)

Todo comando lê **um** projeto. Qual, em ordem de precedência:

1. `--projeto <nome|caminho>`, opção global, em qualquer posição do comando;
2. a variável `ORK_PROJETO`, com o mesmo formato;
3. no host sem diretório de projeto (`ORK_PROJETO_EXPLICITO=1`, que OpenClaw e Hermes declaram): o único projeto conhecido, ou a recusa `projeto.escolha` com os candidatos;
4. o diretório atual, como sempre, no terminal.

Nome ambíguo ou desconhecido **recusa com a lista de candidatos, na saída 4**; o `ork` nunca escolhe no lugar de quem pediu.

| Comando | O que faz |
| --- | --- |
| `ork projetos [--json]` | Os projetos conhecidos desta máquina, do registro `~/.orkastery/projetos.json` (`ork.projetos/v1`): nome, abbrev, raiz, remoto sem credencial, se ainda está no disco. Sem segredo |
| `ork projetos registrar [caminho]` | Registra a cópia que já existia antes do registro. `ork init`, `ork thread new` e `ork fabrica entrar` já registram sozinhos |
| `ork projetos esquecer <nome\|caminho>` | Tira do registro a cópia que sumiu ou sobrou; nada no disco é apagado |

Toda resposta de `maestro`, `board`, `board plan`, `fabrica` e `roadmap status` começa dizendo o projeto consultado e o que não foi lido. O contrato completo, para quem consome o registro (RM-053, RM-054), está em [projetos-rm052](contratos/projetos-rm052.md).

## Threads e fases

| Comando | O que faz |
| --- | --- |
| `ork thread new <nome> --modo <MODO>` | Cria a thread, o slug de 3 partes e o ledger |
| `ork thread new <nome> --modo <MODO> --exige-runtime-diferente` | O CHECK desta thread precisa de runtime que o GO não usou (I-43, viga (a) do envelope) |
| `ork thread new <nome> --modo <MODO> --done "<critério> :: <comando>"` | Critério de pronto **executável**, que vira claim do núcleo e roda no `ork verify`. `;;` separa vários; critério sem comando é recusado (I-43, viga (b)) |
| ↳ opções | `[--slug S] [--assunto A] [--worktree auto\|DIR] [--ciclo C] [--dry-run]` |
| `ork thread new <nome> --modo <MODO> --roadmap RM-NNN` | Reserva o item do roadmap para esta máquina **antes** de criar a thread; outra máquina com o mesmo item recebe `roadmap.reservado` e não cria nada (I-47) |
| `ork roadmap status [--json]` | Status report único do roadmap no formato aprovado: grupos com ícones, `#HITL` no que espera o dono e o fecho com o que precisa dele e o que vem a seguir. Leitura pura; os canais transportam o texto (RM-048) |
| `ork roadmap reservas [--json]` | Com quem está cada item do roadmap, lido da branch `ork/roadmap-reservas` do remoto |
| `ork roadmap pegar RM-NNN [--thread T] [--nota N]` | Reserva o item por push atômico: o primeiro vence. `--forcar --motivo M` toma a reserva de uma máquina parada, e o motivo fica registrado |
| `ork roadmap soltar RM-NNN` | Devolve o item quando o trabalho termina |
| `ork fabrica entrar [--maquina NOME]` | Esta máquina entra na fábrica compartilhada, com esse nome (`~/.orkastery/maquina.json`), e publica o primeiro retrato |
| `ork fabrica [--json] [--sem-remoto]` | O que cada máquina conduz, lido da branch `ork/fabrica-estado` |
| `ork fabrica publicar [--forcar] [--json]` | Grava o retrato desta máquina na branch, com push sem força; depois de entrar, sai sozinho ao criar thread, despachar fase, entregar e fechar, e a cada batida do pulse |
| `ork fabrica sair` | Para de publicar daqui e tira o retrato desta máquina da branch |
| `ork thread new <nome> --from-finding <ID>` | Abre a thread a partir de um achado de auditoria. Evidência, claim e proposta viajam junto |
| `ork thread list [--todas] [--json]` | As threads NAO fechadas do projeto; `--todas` inclui as fechadas, `--json` devolve JSON |
| `ork thread status <thread-id> [--json]` | O estado da thread, cruzado com o runtime; `--json` devolve o thread.json |
| `ork phase run <thread> <FASE> --prompt "<texto>"` | Despacha a fase como background agent. Com `concurrency.max_parallel_threads` sessões vivas em outras threads do projeto (condução `exec:<thread>` de sessão, de qualquer runtime ou conta), recusa com `concurrency.limite`, diz quem ocupa, grava `slot_refused` e sai com 3 (espera, como a condução); sessão parada (sem trabalho há `concurrency.stale_after_min`), escalada ao dono, bloqueada no runtime ou em silêncio pelo pulse não ocupa, e a que segue rodando depois de uma pausa prevista ou de um verify reprovado ocupa; com `--esperar`, espera a vaga. No codex, bloco com GO sem baseline sai com a baseline gravada pelo despacho, também no redespacho do `ork retry`; pelo MCP (`ork_phase_run`), que não roda a suíte, a falta dela volta como `baseline.pendente` com o comando do CLI (RM-037) |
| ↳ opções | `[--model M] [--effort E] [--dry-run]` |
| `ork phase list <thread>` | O histórico do ledger, **com o modelo e o esforço reais de cada fase** |

> Passar só `--model` assume `--effort high`: quem informa apenas o modelo está pedindo o
> despacho mais capaz. O par efetivo vai ao ledger como fato verificável, em sucesso, em falha
> e em `--dry-run`.

### Sessões do runtime

| Comando | O que faz |
| --- | --- |
| `ork sessions [--all]` | As sessões vivas do runtime, cruzadas com as threads |
| `ork sessions logs <sessao> [--linhas N]` | Os logs de uma sessão, lidos na conta onde ela está (processo ou perfil claude-bg) |
| `ork sessions stop <sessao>` | Para uma sessão com o `CLAUDE_CONFIG_DIR` da conta onde ela está: a do processo ou a de um perfil claude-bg do projeto, inclusive desativado; achada em mais de uma conta, pede o id completo |
| `ork sessions attach <sessao>` | Imprime o comando de attach (precisa de TTY), com o prefixo `CLAUDE_CONFIG_DIR=<dir>` quando a sessão é de um perfil |
| `ork sessions hitl [--json]` | Radar das sessões que exigem ação humana AGORA |

O `ork sessions hitl` é o lado das SESSÕES da conduta proativa; o `ork monitor` é o lado
das THREADS. Ele parte de `claude agents --json --all`, classifica o estado de cada
sessão e, só nas que estão paradas, lê o dump de tela para saber o que a sessão pergunta.
Por isso ele enxerga a sessão `claude --bg` que travou sem ter thread nenhuma no ork.

| Opção | O que muda |
| --- | --- |
| `--json` | Entrega o radar inteiro, que é o que o orquestrador consome |
| `--so-paradas` | Deixa de fora quem não precisa do humano |
| `--sem-logs` | Não lê os logs: mais barato, mas não diz o que cada sessão pergunta |
| `--so-da-raiz` | Limita a varredura às sessões sob a raiz do projeto |
| `--atencao N` | Minutos a partir dos quais a parada é destacada (padrão 30) |
| `--exigir-limpo` | Sai != 0 enquanto houver sessão esperando o humano (watchdog) |

Classes de sessão, na tipologia que o `--json` entrega:

| Classe | Estado do runtime | Precisa de humano | O que é |
| --- | --- | --- | --- |
| `hitl` | `blocked`, job vivo | sim | Espera resposta agora; a pergunta e as opções vêm no JSON |
| `abandonada` | `blocked`, job já saiu | sim | Morreu esperando resposta: o trabalho ficou pela metade |
| `falha` | `failed` | sim | Alguém decide entre retomar, corrigir ou abandonar |
| `desconhecida` | fora do catálogo | sim | Estado novo do runtime: o ork avisa a mais, nunca a menos |
| `trabalhando` | `working` | não | Em execução |
| `concluida` | `done` | não | Concluiu |
| `interrompida` | `stopped` | não | Parada por decisão humana já tomada |
| `interativa` | `idle` | não | Sessão manual, conduzida por alguém no terminal |

Dentro de `hitl`, o sub-tipo diz o que muda a ação: `hitl.credencial` (a sessão pede um
segredo, como o código 2FA de um publish), `hitl.permissao` (prompt de permissão),
`hitl.pergunta` (escolha de rumo) e `hitl.desconhecido` (parada com o menu fora da tela).
Cada sessão parada sai com as `alternativas` que ela mesma ofereceu e com UMA
`recomendacao`, derivada do tipo.

A leitura de tela entende os dois formatos de menu que o runtime desenha: o numerado
(`1. Passo o codigo agora`) e o de seleção (`[✔] codegraph`), que é o dos prompts de
permissão de servidor MCP. Quando os dois aparecem na tela, o numerado manda, porque uma
lista de tarefas com caixinha também casa o segundo formato e tarefa concluída não é
alternativa de resposta.

Para rodar em laço, `scripts/varredura-hitl.sh` chama esse comando, compara com a
varredura anterior e imprime só a novidade (sai `10` quando há novidade, `0` quando não
há, `1` quando o runtime não respondeu).

---

## Verdade: claims, verify e gates

| Comando | O que faz |
| --- | --- |
| `ork claims add <thread> <arquivo> --claim "<alegacao>"` | Registra alegação verificável; o lint avisa na hora sobre comando que roda a suíte inteira, fixa SHA intermediário ou compara contagem de commits (I-53) |
| ↳ opções | `[--verificar "<comando>"] [--fase F]` |
| `ork claims list <thread>` | As claims e o estado de cada uma |
| `ork claims verificar <thread> <claim-id> --comando "<cmd>"` | Anexa o comando que comprova uma claim já feita |
| `ork claims retirar <thread> <claim-id> --motivo "<motivo>"` | Retira a alegação. **O histórico fica no `claims.jsonl`** |
| `ork verify <thread> [--baseline] [--so-claims]` | Reexecuta claims e verify do manifesto **no HEAD real** |
| `ork gate next <thread> [--proximo FASE]` | Gate de tokens: mesma sessão ou nova sessão |
| ↳ opções | `[--ocupacao 0..1] [--fonte F] [--transcript ARQ] [--janela N] [--refazer]` |
| `ork gate request <thread> [--motivo M]` | Abre o pedido correlacionado à pausa ou escalação atual |
| `ork gate request <thread> --formato telegram\|terminal` | O mesmo pedido no contrato curto `ork.hitl-curto/v1`, com o código estável na última linha (RM-048) |
| `ork gate answer <thread> <pedido> --resposta-stdin --origem telegram --por ID --mensagem REF` | Recebe o envelope assinado do gateway e publica a decisão humana quando aprovada |
| `ork pulse responder --resposta-stdin --origem telegram --canal C --por ID --mensagem REF [--conta ID]` | Recebe o que o dono digitou no canal do resumo (`P4EJ a` ao resumo, `1a 2c` ao lote, `#OrkPulseOn-15m` à cadência) e devolve o texto que o canal repassa a ele |
| `ork pulse cadencia [<tag>] [--por P] [--json]` | Mostra a cadência do resumo em vigor, ou troca pela tag (`OrkPulseOn`, `OrkPulseOn-15m`, `-30m`, `-60m`, `OrkPulseOff`); pergunta nova ao dono sai na hora, qualquer que seja a tag |
| `ork decisao registrar <thread> --decidido D --porque P --como-mudar C --custo-agora A --custo-depois B --criterio TIPO:REF --quem Q --evidencia E [--razao R] [--reverte ID]` | Registra a decisão tomada sem perguntar ao dono: chega a ele no próximo resumo. Cada campo é uma linha; `--decidido`, `--porque` e `--como-mudar` vão até 200 caracteres, os custos até 140, e a recusa diz o campo e o tamanho. Na sessão sem acesso ao ledger (codex), a ferramenta MCP `ork_decision_record` grava pelo mesmo contrato |
| `ork decisao placar <thread> [--json]` | Decididas contra perguntas por fase, reversões, decisões sem rastro e o limiar de revisão (13 por fase) |

`--baseline` grava o estado do mundo **antes do GO**. E o que permite separar `verify.regression`
(defeito desta thread) de dívida pré-existente.

`gate approve` está aposentado e sempre recusa. A evidência nasce do ingresso autenticado,
é vinculada ao pedido e revalidada criptograficamente em cada `memory sync`. No Telegram,
o gateway entrega o envelope por stdin. Em Codex e Claude Code, o servidor MCP usa a
resposta protocolar de elicitation e guarda um recibo privado assinado, sem o texto bruto.
Escrever o nome de uma pessoa no ledger não transforma automação em ato humano.

I-41 (GO-FIX 1): `ork pulse responder` é chamado pelo ingresso do Telegram (Hermes ou OpenClaw),
nunca por pessoa ou agente. O ingresso assina, com a chave do próprio canal e o corpo
`ork.hitl-answer/v2` de sempre, o endereço do pulse (`pulse`, `resposta`) e o texto exato que o
dono digitou; o núcleo confere essa assinatura com `autenticarResposta` antes de ler o texto.
`P4EJ a` responde ao resumo e devolve o lote de até cinco perguntas; `1a 2c` responde ao lote, e
cada resposta vira `human_gate` pelo `responderGate` de sempre, com recibo durável. Número ou
letra inexistente, duas letras para a mesma pergunta e pergunta já respondida recebem resposta
em texto, nunca silêncio. `--criterio` de `ork decisao registrar` aceita `manifesto:CHAVE`,
`ledger:<thread>#evento:N` ou o `eventId`, e `medicao:COMANDO`; critério que não resolve recusa
a decisão antes de ela existir.

---

## Autonomia: retry, rate limit e correções

| Comando | O que faz |
| --- | --- |
| `ork retry policy [--motivo M] [--json]` | A política de retry por motivo tipado, com o porque de cada ação |
| `ork retry plan <thread> [--motivo M] [--fase F]` | O que o `ork` faria pelo último gate reprovado. **Calcula, não executa, não gasta tentativa** |
| `ork retry run <thread> [--reverify] [--por Q] [--dry-run]` | Executa a ação tipada. `--por` autoriza quando o bloco do modo pausa. Em `runtime.quota-exhausted` e `runtime.auth-missing`, segue com o mesmo prompt: outro perfil do mesmo runtime só com a troca ligada no manifesto (`runtime_profiles.rotate_same_runtime_on_quota`, padrão `true` desde a D16; `runtime_profiles.rotate_same_runtime_on_auth`, padrão `true`), depois o fallback do bloco e a fila (I-33); rate limit comum espera a janela, sem troca. Em `runtime.model-unavailable`, o mesmo prompt vai a outro perfil do mesmo runtime com o mesmo modelo e depois ao fallback do bloco, sem tirar o perfil do rodízio; sem destino, escala com a correção `ork setup <modo> --bloco N --model` (RM-037) |
| `ork retry list [--json]` | A fila **durável** de rate limit do projeto |
| `ork retry resume [--id R1] [--agora ISO] [--ocupacao 0..1]` | Retoma a fase morta por rate limit na janela seguinte |
| ↳ opções | `[--forcar] [--dry-run]` (playbooks: mesma-sessão, nova-sessão, escalada) |
| `ork retry cancel <id> --motivo M` | Tira um pedido da fila, com motivo registrado |
| `ork retry parse --stderr "<texto>"` | Lê o horário de reset do stderr do adapter |
| `ork fix open <thread> [--so-claims] [--reverify] [--json]` | GO-FIX: deriva a spec exata do CHECK reprovado |
| `ork fix list <thread> [--rodada N]` | As correções da rodada e o veredito de cada uma |
| `ork fix reverify <thread> [--rodada N] [--parcial] [--json]` | CHECK-REVERIFY com veredito **por correção** |

`--parcial` e **recusado** se a rodada tiver qualquer correção de tipo B: parcial depois de
tipo B não é CHECK.

---

## Memória, handoff e recall

| Comando | O que faz |
| --- | --- |
| `ork handoff export <thread> [--proxima-fase FASE] [--slug S]` | Handoff triado; em OrkMind, publica pelo G3 com pacote integral e readback |
| `ork handoff recall <thread> <ponteiro>` | Resolve um ponteiro `path#ancora` de volta ao conteúdo |
| `ork recall <thread> --fase FASE` | Recuperação tardia de ponteiros e descoberta de handoffs por tenant, thread e fase |
| ↳ opções | `[--id ptr-N] [--todos] [--forcar] [--sem-conteudo] [--json]` |
| `ork memory status [--json]` | O regime efetivo (`files` ou `orkmind`), o tenant e a degradação |
| `ork memory sync [<thread>] [--json]` | Publica decisões, policies, handoff, lição, roadmap e human gates elegíveis somente da thread informada; sem id, apenas policies |
| `ork memory inventory --escopo <threads> [--json]` | Inventário somente leitura de fontes atuais, históricos e tenants excluídos |
| `ork memory migrate --operadora <thread> --escopo <threads> [--dry-run] [--json]` | Migração aditiva pelo G3, com identidade por tenant/origem/hash e readback da cadeia |
| `ork memory search --tags '<json>' [--colecao C] [--limite N]` | Busca deterministica por tag |

Um ponteiro pedido fora do seu `retrieve_when` volta como `fora-do-momento`, **sem conteúdo**.
`--forcar` ignora o momento e declara no resultado que ignorou.

```bash
ork memory search --colecao handoff --tags '{"project":["orkastery"],"skill":["GOAL"]}' --json
ork recall <thread> --fase GOAL --json
```

Tags usam arrays: `project=<tenant>`, `skill=<FASE>`, `situation=<classe>` e
`agent=<runtime>:<modelo>`, com aliases legados. Runtime histórico ausente é declarado
desconhecido. `memory migrate` preserva arquivos, entries anteriores e pacote completo;
a reexecução da mesma origem/hash conserva IDs e contagens. `memory migrate` retorna código
não zero se houver falhas. `memory sync` reprova se o manifesto pede `orkmind` e a publicação
falha, inclusive por colisão de proveniência preexistente ou degradação. Quando o manifesto
pede `files`, o sync retorna zero como relatório informativo, declarando que nada foi publicado.
O relatório JSON distingue falhas de exclusões do inventário. Exportação que falha não
serve de prova de coleção vazia.

Decisões humanas elegíveis são revalidadas contra o pedido original. O Telegram vincula a
opção ao MAC do ingresso; o MCP local assina opção, estado, fase e assunto com uma chave
privada fora das threads. O sync exige um único `human_gate` por pedido e exclui qualquer
inversão de recusa para aprovação. No caminho local, a conta do sistema operacional é a
fronteira de confiança; qualquer processo sob o mesmo UID, inclusive um agente com acesso
integral aos arquivos, também pode ler a chave. Use outra conta ou sandbox para separar o
servidor MCP desses processos. O sync de gates Telegram exige a mesma chave do canal que
assinou e falha explicitamente quando ela não está disponível: `ORK_HITL_INGRESS_KEY_HERMES`
para o Hermes, `ORK_HITL_INGRESS_KEY_OPENCLAW` para o OpenClaw, e `ORK_HITL_INGRESS_KEY`
somente para o envelope `v1` legado, que não declara canal. Uma chave não cobre o outro
canal, e não há fallback para a global num envelope `v2`.

Somente o tenant `orkastery` está ativo na fábrica, usando o nome de variável
`ORKASTERY_ORKMIND_DATABASE_URL`. O schema OrkMind deve estar inicializado; o health check
não provisiona tabelas (`memory.schema.absent`). A ponte Python vai no pacote npm,
usa JSON por stdin e credencial no ambiente do filho, sem embedder ou provider pago.
Veja [os contratos de governança e migração](../guias/memoria-e-handoff.md).

---

## Isolamento: worktree e leases

| Comando | O que faz |
| --- | --- |
| `ork worktree ensure <thread>` | Garante a worktree da thread, com a base resolvida pelo `ork` |
| `ork worktree sync <thread> [--dry-run]` | Rebasa a branch da thread quando a base avançou. Branch sem commit próprio é recriada no SHA da base (`git reset --keep`), sem rebase; com commit próprio e sem ancestral comum com a base (base reescrita), recusa com o `git rebase --onto` exato |
| `ork worktree audit <thread>` | Confere a worktree **no próprio git**. Sai diferente de zero se divergir |
| `ork worktree release <thread> [--forcar]` | Remove a worktree e limpa o registro |
| `ork lease list` | Os leases, as famílias e as filas (merge e colisão de região) |
| `ork lease acquire <nome> --thread T --motivo M` | Toma um lease tipado. Entra na fila se colidir |
| `ork lease release <nome> [--thread T] [--forcar]` | Libera |
| `ork conducao status <thread> [--json]` | Quem conduz a thread agora: canal, sessão ou processo, fase e desde quando. Libera, com prova, a condução sem dono |
| `ork conducao assumir <thread> --por Q --motivo M [--canal C]` | Handoff: encerra a condução atual pelo runtime, registra quem assumiu, de qual canal e por que, e reserva a vez para esse canal |

Famílias: `main-tree`, `worktree-write:<thread>`, `path:<glob>`, `board:<card>`,
`service:<porta>` e `exec:<thread>`. A `exec` (I-36) é a condução: protege a **execução** na
worktree da thread e mora no estado canônico do projeto, e não no checkout de quem chamou.

`ork verify`, `ork phase run`, `ork fix open`, `ork fix reverify` e `ork retry run` aceitam
`--canal <claude-code|hermes|openclaw|codex|mcp|cli>` (sem ele, o que o host declara),
`--correlacao <id>` (conversa ou mensagem de origem) e `--esperar [min]` (espera a vez, até 30
minutos sem valor, em vez de recusar na hora). No `ork phase run`, `--esperar` também espera a vaga
do projeto quando o limite de sessões está cheio.

---

## Entrega e score

| Comando | O que faz |
| --- | --- |
| `ork ship <thread> --para <branch>` | Merge `--no-ff` serializado por lease, e push **provado** |
| `ork ship registrar-pr <thread>\|--todas` | A entrega feita por PR vira `ship_done`: o merge `ship(<thread>)` dentro da ponta remota e o CI verde no head do PR; depois, `ork master --aceitar-omissao` fecha (I-57) |
| `ork ship registrar-pr <thread> --repo <dono/nome> --pr <n>` | PR mesclado em repositório externo declarado em `ci.external_repositories` vira `ship_done`: o PR mesclado na branch padrão do repositório, com o id da thread no título, no corpo ou na branch, e o merge dentro da ponta da base, conferidos pela API do GitHub, e o check declarado verde no head do PR (vazio declara repositório sem CI). Repositório não declarado é recusado (RM-037) |
| ↳ opções | `[--de <branch>] [--remoto origin] [--autorizar-push <quem>] [--sem-push] [--dry-run]` |
| `ork master <thread> --score 0-5 --justificativa "<texto>"` | Fecha a thread: POSTMORTEM, MASTER log e score. Só do terminal: de processo de host é recusado com `master.prova-de-canal` |
| `ork master pedir <thread> [--formato telegram\|terminal\|json]` | Pede a nota ao dono com código curto; ele responde pelo Telegram (`<código> <0 a 5> <porquê>`) e a nota vai ao ledger com o recibo do ingresso (RM-048) |
| ↳ opções | `[--classe C[,C]] [--resumo R] [--por Q] [--refazer]` |
| `ork master [--todas] [--json]` | As entregas, com o **índice derivado do ledger**; e as aceitas por omissão |
| `ork master --aceitar-omissao [--json]` | Aceita por default as entregues, gravando índice, insumos e quem decidiu |
| `ork master classes` | As classes de falha fixas do POSTMORTEM |
| `ork licoes [--json]` | O que volta no GOAL e no PLAN da próxima thread (POSTMORTEM e MASTER) e as propostas de policy por recorrência (I-55), dizendo quais já são executáveis (RM-008, fatia 3) |
| `ork ci prepare <thread>` | Exporta as claims e os comandos do manifesto para `.ork-ci/bundle.json` da worktree da thread (da raiz ou da worktree, o arquivo vai para a branch dela), que o runner do CI reexecuta; recusa claim que roda a suíte inteira do npm e avisa sobre SHA intermediário e contagem de commits (I-53) |
| `ork ci run [<thread>] [--bundle ARQ]` | Executa o CHECK no runner independente |
| `ork ci status [--sha SHA] [--remoto origin]` | Consulta o check exato publicado no GitHub para o SHA |

---

## Visão e escalonamento

| Comando | O que faz |
| --- | --- |
| `ork board [--all] [--sem-remoto]` | A visão única das threads. `--all` traz todos os perfis desta máquina; com a fábrica compartilhada, mostra também as outras máquinas |
| `ork board plan` | O escalonador: quem avança agora, quem espera, e por que |

---

## Prompts e adaptadores

| Comando | O que faz |
| --- | --- |
| `ork prompt list` | Os templates de prompt (embutidos e os do projeto) |
| `ork prompt lint [--template ID]` | **Reprova template quebrado antes de ele virar despacho** |
| `ork prompt render <thread> --fase F [--pedido "<texto>"] [--template ID]` | O prompt exato, com o sha256 que vai ao ledger |
| `ork prompt render --exemplo --fase F --modo M` | Renderiza sem thread nenhuma, para revisar o texto |
| `ork adapter list` | Os adaptadores de host (Camada 1) e o destino de cada um |
| `ork adapter show <host>` | Os 3 pitfalls de instalação do host |
| `ork adapter install <host> [--dir D] [--dry-run] [--force]` | Instala o adaptador (`hermes`, `openclaw`, `claude-code`). Divergência classificada pelo recibo: a segura resolve sozinha, o resto mostra o diff e pergunta |
| `ork adapter install <host> --dir D --aceitar-catalogo <arquivo>` | Sobrescreve a cópia com o catálogo, arquivo a arquivo |
| `ork adapter install <host> --dir D --manter-copia <arquivo>` | Deixa a cópia como está; a divergência continua sendo detectada depois |

Um template do projeto (`prompts/<id>.md`) sobrescreve o embutido de mesmo id.

---

## Avaliação

| Comando | O que faz |
| --- | --- |
| `ork eval [--skill S] [--canario C] [--so-canarios] [--so-skills] [--json]` | Canários de comportamento e corpus das skills |

Sai diferente de zero em qualquer falha. Canários: `fx-happy`, `fx-hallucination`,
`fx-stale-base`, `fx-wiki-destroy`, `fx-schema-drift`, `fx-concurrency`.

---

## Auditoria

| Comando | O que faz |
| --- | --- |
| `ork audit packs [--estagio E] [--pack P]` | Os 7 packs, o estágio que os ativa e a postura |
| `ork audit run <pack> [--profile P] [--since Nd] [--tudo]` | Monta o prompt do pack e despacha pelo runtime adapter |
| ↳ opções | `[--effort E] [--model M] [--agora "<quem>"] [--forcar] [--dry-run]` |
| `ork audit list` | As rodadas de auditoria do projeto |
| `ork audit show <rodada> [--ledger]` | Contexto, achados e propostas de uma rodada |
| `ork audit prompt <pack> [--since Nd]` | O prompt exato do pack, com o sha256 que vai ao ledger |
| `ork audit lint` | Reprova template de auditoria quebrado (`auditors/`) |
| `ork audit ingest <rodada> --arquivo J` | Registra em lote os achados que o auditor escreveu |
| `ork audit finding add <rodada> --regra R --titulo T` | Registra um achado com evidência, claim e proposta |
| ↳ opções | `--arquivo caminho:linha --impacto I --fix F --estimativa E` |
| ↳ opções | `[--severidade critico\|maior\|menor] [--irreversivel "<passo>"] [--verificar "<comando>"]` |
| `ork audit verify <rodada>` | Reexecuta as claims dos achados. **Auditor sem self-report** |
| `ork audit report <rodada> [--publicar]` | Relatório com o bloco **obrigatório** de propostas |
| `ork audit divida [--pack P] [--todos]` | O board de dívida: propostas abertas e recorrência |
| `ork audit finding estado <id> <estado>` | Carimba o achado: `aberto`, `adiado`, `resolvido`, `descartado` |
| `ork audit surface [<dir>] [--regra SPn] [--limite N] [--json]` | Varredura **deterministica** da superfície de ataque de rede |
| `ork audit surface --registrar <rodada>` | Grava os achados da varredura no board da rodada |

`ork audit surface` sai diferente de zero quando há achado, e não usa LLM nenhum. Serve
diretamente como gate de CI.

---

## Vocabulário fixo do CLI

Estas listas não são extensiveis pelo executor. Uma delas mudar é uma mudança de contrato.

| Categoria | Valores |
| --- | --- |
| **Fases** | `GOAL` `PLAN` `GO` `CHECK` `SHIP` `MASTER` |
| **Modos** | `#Classic` `#Maestro` `#Auto` (`#Look` e `#Ork` aposentados na I-43: escrever recusa, ler continua) |
| **Ciclos** | `greenfield` `merge-branch` `goal-plan` `gap` `feature-xl-faseada` |
| **Famílias de lease** | `main-tree` `worktree-write:<thread>` `path:<glob>` `board:<card>` `service:<porta>` |
| **Fontes de medida** | `runtime_reported` `estimated` `informada` `unavailable` |
| **Motivos de gate** | os 16 de `ork retry policy` |
| **Ações de retry** | `reexecutar` `corrigir-dirigido` `sincronizar-worktree` `escalar-esforco` `esperar-janela` `escalar-humano` `sem-retry` |
| **Classes de falha** | `sem-falha` `erro-de-spec` `base-avancou` `conflito` `rate-limit` `modelo` `processo` `scope-creep` `outra` |
| **Hosts de Camada 1** | `claude-code` `hermes` `openclaw` |
| **Packs de auditoria** | `clean-code` `reuse` `architecture` `data-model` `ux` `security-privacy` `process` |
| **Estágios do produto** | `nascente` `crescendo` `maduro` |
| **Coleções de memória** | `decision` `handoff` `rule` `learning` `roadmap` |

---

## Códigos de saída

| Código | Significa |
| --- | --- |
| `0` | Passou |
| `3` | Pedido recusado porque outra condução executa na thread (`conducao.em-andamento`), com quem conduz e as três ações; ou `ork phase run` recusado por vaga (`concurrency.limite`), com as sessões que ocupam (RM-037) |
| `4` | Projeto-alvo não resolvido (`projeto.escolha`, `projeto.ambiguo`, `projeto.desconhecido`, `projeto.sem-manifesto`, `projeto.nenhum`), com os candidatos; `--json` devolve o mesmo em objeto (RM-052) |
| diferente de `0` | Reprovou, com o motivo tipado impresso |

Comandos que servem bem como gate de CI: `ork doctor`, `ork verify`, `ork eval`,
`ork audit surface`, `ork worktree audit`, `ork prompt lint`, `ork audit lint`.

## I-01: `ork pulse`

```bash
ork pulse [--json] [--registrar --escopo <threads>] [--linhas 20] [--sem-runtime]
ork sessions hitl --registrar --escopo <threads> --linhas 20
ork sessions hitl --registrar --registrar-maquina --linhas 20
```

O contrato `ork.pulse/v1` tem `consultadoEm`, `runtime`, `precisaDeHumanoAgora`,
`acoesAutomaticas` e `resumo`. Cada item informa classe, motivo, thread, sessão, fase,
`desdeEm`, `paradaHaMin`, impacto, pergunta, opções, recomendação, comando de resposta,
fontes e evidência. Uma sessão e sua pausa correspondente no monitor formam um item;
impedimentos distintos e score pendente continuam separados. A espera maior vem antes;
em empate, a fase de maior impacto vem antes, inclusive SHIP antes de GOAL.

`paradaHaMin` é `null` até haver observação registrada do bloqueio. O relógio começa no
primeiro `sessao_bloqueada`; não tenta recuperar retroativamente o que o runtime não
informa. `sessao_destravada` exige estado conhecido de saída. Consulta falha, estado
incerto ou sessão ausente não provam desbloqueio. O ledger da thread fica na main;
sessões sem thread exigem `--registrar-maquina` para escrever em
`${ORKASTERY_HOME:-~/.orkastery}/sessoes.jsonl`. Leitura não autoriza carimbo.
Fora do escopo, os alertas permanecem no radar sem escrita na thread. O launcher lê
`monitor/pulse-write-scope.json` do projeto alvo. A versão 2 declara
`activation: receipt-required`; a versão 1 antiga continua sendo uma lista de candidatos.
Nenhuma das versões concede escrita por instalação ou rebuild. D17 limita os candidatos
iniciais deste repositório a `ork-i06orkmindfa`; novos IDs exigem decisão explícita.

`ORK_PULSE_PROJECT` seleciona o projeto. O escopo efetivo vem do recibo de
`ork activation enable`, vinculado ao projeto, tenant, HEAD e bytes do runtime instalado.
`ORK_PULSE_WRITE_SCOPE` sozinho não ativa o launcher; se informado, precisa coincidir com
esse recibo. Sem ativação válida, o núcleo observa e continua entregando alertas. Recibo
obsoleto é diagnosticado e não concede carimbo. Configuração inválida, alias ou conflito
produz `pulse.scope.*`. O launcher não carrega credenciais; threads protegidas são recusadas.
O uso manual de `pulse --registrar --escopo ...` conserva sua autorização explícita de CLI.

A ativação na main exige SHIP desbloqueado pelo fluxo `ork ship`, reconstrução de
`core/dist` no checkout consumido pelo cron e prova operacional restrita ao escopo
autorizado. A troca do checkout e do executável precisa ser coordenada no SHIP para
evitar uma rodada com código antigo. Merge sozinho não prova contenção. Preservar
as demais entradas do crontab, os alertas e a deduplicação; confirmar o push com
`git ls-remote origin refs/heads/main`. Essa ativação permanece pendente na I-06.

`--linhas` aceita de 1 a 200. Quando não há menu, `contextoLogs` contém as últimas linhas
limpas, limitadas e com padrões conhecidos de credencial redigidos. A classificação
`fase_orfa` usa `runtime.silencio` após `liveness.silencio_max_min` (padrão 10 minutos),
considerando evento da sessão, commit na worktree ou crescimento do rollout Codex ou da
transcrição Claude. Consulta indisponível não diagnostica nem registra fase órfã. Conclusão
ou impedimento explícito têm precedência. O retry permanece no núcleo:

```bash
ork retry plan <thread> --motivo runtime.silencio --fase GO
ork retry run <thread> --motivo runtime.silencio --fase GO
```

A rotina de alerta não executa esses retries nem LLM. Ela publica a situação; o caminho
explícito de retry conta tentativas e escala ao atingir `retry.max_tentativas` em #Auto.
Falha de consulta sai com código 1, com diagnóstico; `--sem-runtime` é uma leitura
explicitamente parcial. O cron deve exigir consulta completa antes de consumir novidades.

Para cron com PATH mínimo, a rotina inclui `$HOME/.local/bin`. Instalações em outro
prefixo definem `ORK_PULSE_RUNTIME_BIN`. O adaptador Hermes possui uma verificação
explícita do parser instalado, sem envio de mensagem:
`python3 adapters/hermes/test/pulse_transport_test.py --parser-real`.

A entrega I-01 mantém os recibos, a entrada instalada do cron e o início da janela real
em `.orkastery/threads/ork-i01orkpulser/evidence/ship/`, sempre na main. O acompanhamento
não converte sete dias futuros em uma verificação já realizada. O score continua humano
quando o dono reclama; sem reclamação, a entrega é aceita por omissão **com registro**
(I-43): o evento `aceite_por_omissao` no ledger, com o índice e os insumos que o
produziram, e `regime: 'omissao'` no score, distinguível de nota humana.

## MASTER ratificado e fechamento administrativo

| Comando | Comportamento |
| --- | --- |
| `ork master propor ID --score N --justificativa J --por Codex` | Grava proposta e postmortem pendentes; não fecha nem publica aprendizado humano |
| `ork master ID --score N --justificativa J --por Julio` | Ratifica entrega com autoria humana declarada |
| `ork master --json` | Lista as entregas com índice e as aceitas por omissão |
| `ork master batch --aceitar ID:HASH,... --por Julio` | Ratifica a seleção explícita de **propostas de agente** após preflight integral (não é a fila, que saiu na I-43) |
| `ork master ratificar --resposta "ratificar ID HASH CLASSE" --por Julio` | Processa escolha humana de classe recebida pelo host |
| `ork master digest responder --resposta "ratificar-lote DATA HASH" --por Julio` | Aceita todas as propostas do digest recebido, se continuam iguais |
| `ork thread close ID --motivo orfa --por Codex --justificativa J` | Encerra administrativamente; motivos fixos: orfa, engano, superada |
| `ork thread entrega ID --arquivo A --sha256 H --por Codex` | Registra artefato verificável; o hash é revalidado ao pontuar |
| `ork master migrar --dry-run --por Codex` | Mostra correções do legado; sem dry-run preserva originais antes de corrigir |
| `ork master digest enviar` | Envia às sextas no fuso do dono (`owner.timezone`; sem a chave, o do sistema) com recibos e retry por página |
| `ork master audit --json` | Audita KPIs operacionais e sai 1 quando falta evidência |
| `ork audit process --registrar` | Materializa PR1, PR2 e PR3 no board; em nascente usa warn |

O host deve vincular `--por` à identidade humana recebida pelo gateway. O CLI não
introduz autenticação própria. A configuração do transporte e o cron estão em
[`core/README.md`](../../core/README.md#master-proposto-ratificação-humana-e-digest).

Threads ativas fora de MASTER são adiadas pela migração. O lote faz preflight
integral dos dados; falha física de escrita pode preservar as ratificações
anteriores e exigir nova seleção das pendências. Identidades genéricas como
`humano` ou `operador` não são nomes de avaliador aceitos.

A migração exige allowlist `--escopo` e audita somente em `--operadora`; replay não
acumula eventos de sucesso. Legado sem identidade comprovável permanece falha tipada
`memory.legacy.provenance-collision`, sem alterar conteúdo, source ou histórico.
Aprovação humana persistida com falha posterior de memória continua confirmada:
`memory.human.publication-pending` informa recuperação por `ork memory sync <thread>`.
Snapshot de liveness inválido é preservado e diagnosticado como `liveness.snapshot.invalid`.
Silêncio mantém alerta humano até haver prova terminal da mesma sessão; o retry
reconsulta o runtime antes de despachar. A baseline Codex não fornece essa prova;
a integração do contrato de I-04 permanece separada.

### Ativação de escrita e perfil de publicação

Publicar o pacote ou reconstruir `core/dist` não executa `activation enable`. O plano inclui
HEAD do projeto e SHA-256 dos arquivos do runtime, ponte e launcher, varridos recursivamente:
incluir, alterar, remover ou mover qualquer arquivo `.js`, `.cjs`, `.mjs`, `.py`, `.json` ou `.sh`
em qualquer nível, inclusive `core/dist/adapters`, invalida um aceite antigo mesmo quando o HEAD do
projeto alvo não muda. Artefato temporário, arquivo de teste, `node_modules` e `__pycache__` ficam
de fora. Link simbólico, dispositivo ou socket dentro dessas raízes recusa com
`write.activation.runtime-invalid`, com ou sem extensão de runtime, e o mesmo vale para
profundidade acima de oito níveis ou mais de quatro mil arquivos: o hash recusa em vez de ignorar
em silêncio. As raízes efetivas são o diretório do runtime instalado, o diretório `assets/` da
ponte e o diretório `monitor/` do launcher.

`activation status` mostra o estado e `estadoSha256`, sem conceder escrita. Quando o contexto do
plano deixa de valer, por HEAD novo, manifesto alterado ou bytes de runtime trocados, o status sai
com código 0 relatando `ativa: false`, motivo tipado, `plano: null` e o `estadoSha256` do estado
privado, que é o hash exigido pelo `disable`: o rollback durável continua ao alcance de quem não
guardou o hash anterior. Toda escrita permanece recusada nesse estado. Estado privado ilegível,
fora do modo `0600` ou apresentado como link simbólico recusa com `write.activation.artifact-invalid`,
sem imprimir corpo algum.

Exemplo de preparo, com ID sintético substituído pelo escopo autorizado:

```sh
ork activation plan --escopo thread-exemplo --alvos pulse,memory --perfil fabrica --saida plano.json
ork activation status
```

O plano é criado com modo `0600` e seu hash é exibido. O enable exige esse arquivo, seu SHA-256,
um arquivo de aceite de CHECK e o SHA-256 desse aceite. O aceite usa `ork.write-acceptance/v1`,
`aprovado: true`, `fase: CHECK`, revisor nomeado, `planoSha256`, HEAD, tenant e perfil coincidentes.
Ele deve resultar de revisão; o comando de preparo não produz nem presume aprovação.
A operadora deve estar no escopo e possuir os leases `path:.orkastery/monitor` e
`worktree-write:<operadora>`, adquiridos normalmente. Nenhum lease vencido concede ativação.

```sh
ork activation enable --plano plano.json --plano-sha256 HASH_DO_PLANO --aceite aceite.json --aceite-sha256 HASH_DO_ACEITE --operadora thread-exemplo --por executor-nomeado
ork activation disable --operadora thread-exemplo --por executor-nomeado --estado-sha256 HASH_DO_ESTADO
```

Cada alteração gera recibo privado em `.orkastery/monitor/write-activation-receipts/`.
O disable usa comparação do hash de estado, cria um recibo compensatório e preserva dados,
recibos anteriores, alertas e histórico. Não altera cron, banco ou ACL. Nenhum desses comandos
foi aplicado operacionalmente na retomada 4 da I-06.

`memory sync <thread> --perfil fabrica --json` publica decisões e handoffs G3 da thread.
A saída enumera `colecoesForaDoPerfil`: `rule`, `learning` e `roadmap`; ausência de tentativa
nessas coleções é explícita. O perfil não declara sucesso do sync integral nem resolve legado.
O sync sem `--perfil` continua integral. No CLI, sync e migração OrkMind exigem ativação da
thread; ampliar de `fabrica` para `integral` exige aceite próprio. Sob esse aceite, colisões
legadas continuam `memory.legacy.provenance-collision`, com falha e exit 1. Em `files`, o
relato informativo anterior permanece. Onboarding explícito da I-15 mantém seu contrato.

Os ganchos automáticos de publicação, aprovação humana e exportação de handoff conservam
os arquivos e a aprovação durable quando a escrita está inativa; a publicação fica pendente.
APIs com memória/driver explicitamente injetado continuam disponíveis para fixtures e dry-run;
essa injeção não é uma opção do CLI operacional. Propostas globais não herdam escopo de thread.

Quando a ativação recusa `memory sync --json`, o comando conserva JSON em stdout com
`estado`, `regime`, `publicacao.estado: pendente`, `erro` tipado e `falhas > 0`, além
de exit 1. Esse diagnóstico declara que o sync não foi executado e que a colisão
legada não foi reavaliada. A degradação para o driver de arquivos conserva seu
relatório anterior de tentativas recusadas; ela não concede escrita nativa.

<!-- maestro-i32:begin -->
## Panorama Maestro e contexto HITL (I-32, candidato em GO)

`ork maestro --json` retorna `ork.maestro-snapshot/v1`. `ork maestro --help` descreve
`--thread ID` e `--section NOME --offset N`. A frase `orkastery maestro` é entrada da
conversa, não um comando shell. CLI/MCP só consultam; ações usam endpoints tipados
existentes e revalidam estado. Erros: `maestro.project.missing`,
`maestro.project.ambiguous`, `maestro.arguments.invalid`, `maestro.source.unavailable`.

O contrato limita 50 itens/seção e 64 KiB; cobertura/omissões e fontes indisponíveis
são explícitas. Prazo de fonte nativa é 2 s, orçamento total 10 s. Medições de fixture
não são SLA. Ação omitida ou redigida não é executável a partir do snapshot.

`ork gate context <thread> <pedido>` é leitura para callbacks autenticados: devolve
pedido, contexto, hash, apresentação e oferta de canais sem criar gate. O flag
`--native-offer-stdin` recebe a prova HMAC efêmera `ork.hitl-native-offer/v1` da
callback, limitada a 8 KiB e 60 segundos, vinculada a host, instalação, conexão,
sessão, identidade, mensagem e pedido. Só a prova válida torna o transporte nativo
daquele host disponível; configuração isolada, prova falsa ou vencida não bastam.
Hermes/OpenClaw apresentam essa oferta com `/ork offer <thread> <pedido>` na
callback autenticada, sem responder nem aprovar o pedido.

`ork receipt-verifiers --json` é o helper fixo do gateway OpenClaw: prepara provas
públicas de recibos legados autenticados no projeto confiável `ORK_HITL_ROOT` e
exporta somente verificadores públicos antes da sanitização do executor. Ausência
do projeto com chave privada presente recusa o helper. Falha do helper ou ausência
dos verificadores com autoridade privada presente recusa a tool.

Respostas humanas entram pelo transporte
privado do host, nunca por argumento livre de ferramenta do modelo. Não copie chave,
binding ou envelope para a conversa. Telegram é opcional, não requisito da consulta.

Usabilidade HITL tem prioridade máxima. Autoridade continua no núcleo; sem controle web.
CHECK/verify oficial, SHIP e provas live seguem pendentes deste candidato.
<!-- maestro-i32:end -->

> **`ork objective` foi aposentado na I-43.** O comando sai com código diferente de
> zero e a recusa tipada `objective.aposentado`. O texto abaixo descreve o mecanismo
> como ele era, e fica como registro do que os envelopes já gravados significam.
> As duas vigas que ele guardava saíram vivas, como propriedade de thread comum:
> `ork thread new ... --exige-runtime-diferente` e `ork thread new ... --done
> "<critério> :: <comando>"`. Veja a aposentadoria na
> [RM-043](../roadmap/RM-043-aposentadoria.md).

Para criar um novo envelope com validação no mesmo harness, usava-se `ork objective new <titulo> --request <pedido> --done <criterio> --execution-runtime codex --validation-runtimes codex --independence sessions`.
O modo era opt-in; envelopes anteriores mantêm seus hashes e regras de ensemble.
Neste modo, os revisores suportados são do runtime `codex`; informe explicitamente
`--validation-runtimes codex`. O runtime de execução pode continuar `claude-bg`.
O sensor Claude comprova `Stop` de turno, mas ainda não fornece recibo autenticado
de conclusão CHECK. Exigir revisão `claude-bg` (ou outro runtime sem esse recibo)
retorna `maestro.authority.runtime-unsupported` antes de persistir objetivo ou threads.
Em `objective validate`, `--sessions '<JSON>'` contém os seletores `conductor`, `executor` e `reviewer`, cada um com `threadId`, `sessionId` e `worktree` absoluta.
O núcleo exige três sessões distintas com despacho verificado e prompt íntegro; executor e revisor pertencem à mesma thread/worktree.
Também exige resultado CHECK concluído observado pelo núcleo, correlacionado à sessão revisora; ID informado ou despacho ainda em curso não prova revisão.
Com `--verdict rejected`, um CHECK terminal negativo (`claims.failed`,
`claims.unverifiable`, `verify.regression`, `verify.failed` ou `ci.failed`) também
é aceito: a rejeição é registrada e o objetivo fica `paused` por `ensemble.rejected`.
O recibo precisa provar encerramento normal do transporte; interrupção, indisponibilidade,
espera humana ou falta de correlação continuam incompletas e não registram um voto.
O recibo de validação preserva os eventos de despacho e resultado usados. Esses seletores não aprovam gates e não mudam permissões do host.

Com `--threads 1 --independence sessions --validation-runtimes codex`, a thread única
concentra condução, execução e revisão. Seu papel cadastrado `discovery` e o hash do
envelope são preservados; PLAN, GO e CHECK exigem três sessões distintas verificadas.
O resultado deve corresponder ao último GO e ao envelope aprovado vigente. Com mais
de uma thread, executor e revisor continuam obrigatoriamente na thread `delivery`.
