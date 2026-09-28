# Onboarding do projeto

O núcleo fornece uma entrevista retomável, independente de Hermes, Claude Code, OpenClaw
ou uma futura UI. `ork onboarding` mostra a pauta e o estado de cada etapa. O host conduz
a conversa; a ordem e a validação vivem em `core/src/onboarding.ts`.

```bash
ork onboarding
ork onboarding show --json
ork onboarding set maestro --conteudo '{"nome":"Equipe","objetivo":"Conduzir o produto","fuso":"America/Sao_Paulo"}' --por equipe
ork onboarding set credenciais --conteudo '{"provedor":"exemplo","env":["EXEMPLO_API_KEY"]}' --por equipe
ork onboarding set bancos --conteudo '{"banco":"postgres","env":["PROJETO_DATABASE_URL"]}' --por equipe
ork onboarding set memoria --conteudo '{"modo":"files"}' --por equipe
ork onboarding sync --json
```

As nove etapas são maestro, credenciais, bancos, memoria, produtos, topologia, arquitetura,
skills e auditores. Consulte a pauta do CLI para as perguntas atuais. Respostas não são
preenchidas pelo init ou inferidas pelo modo de autonomia.

## Contrato e retomada

`.orkastery/onboarding.json` tem contrato `ork.onboarding/v1`, `atualizadoEm` e `etapas`.
Cada etapa é `null` quando pendente ou um objeto com `respondidaEm`, `por` e `conteudo`.
Arquivo ausente significa tudo pendente. Arquivo inválido ou legado é normalizado na leitura;
respostas com formato ou conteúdo inseguro permanecem pendentes. A leitura não regrava arquivos.
O estado da entrevista fica separado de `orkastery.yaml`.

`set` altera somente a etapa indicada. JSON equivalente, inclusive com outra ordem de chaves,
preserva bytes do arquivo, timestamps, autoria e eventos. Ordem de arrays é significativa.
`--por` omitido usa `owner`; isso não atribui resposta a Julio ou a outro humano.

Set e reset serializam leitura, alteração e evento sob a mesma trava e relêem o documento
depois de adquiri-la. Escritores concorrentes preservam as demais respostas e a idempotência.
A espera é limitada a cinco segundos; `onboarding.busy` pede nova tentativa. Após interrupção
abrupta, uma trava residual `onboarding.json.lock` exige conferir o encerramento de todos os
escritores antes de removê-la; o núcleo não toma a trava por idade.

Uma mutação que descartaria resposta legada é recusada com `onboarding.legacy.invalid`,
antes de alterar arquivo ou ledger. Isso inclui resposta pública acima do limite, formato
incompatível e conteúdo inseguro. A leitura continua filtrando entradas inválidas. Revise
o arquivo ou use reset explícito da etapa que deseja remover; um reset seletivo também
recusa descartar outra etapa. Documento ilegível, acima de 256 KiB ou com etapa desconhecida
exige revisão do arquivo. O filtro de segredos não é afrouxado para recuperar legado.

`atualizadoEm` considera a data válida mais recente das respostas e do próprio documento,
comparando instantes, inclusive offsets de fuso. Um carimbo posterior de reset é preservado;
set e reset não fazem o carimbo retroceder quando o arquivo contém uma resposta futura válida.

Reset é explícito e idempotente. O primeiro exemplo limpa uma etapa; os demais limpam todas:

```bash
ork onboarding reset skills --por equipe --json
ork onboarding reset --por equipe --json
ork onboarding --reset --json
```

O ledger do projeto recebe `onboarding_recorded`, com `thread: projeto`, ação, etapa, autoria
e SHA-256 do conteúdo canônico. Ele não recebe conteúdo bruto. Alteração idêntica não emite evento.
Reset emite um evento por etapa efetivamente limpa; repetir reset não acrescenta eventos.

## Referências de credenciais

Valores secretos ficam somente em `~/.hermes/.env`. O onboarding não lê esse arquivo.
Nas etapas credenciais/bancos, use um objeto com `env` (array de nomes de variáveis),
`provedor` e/ou `banco` (identificadores públicos). Campos fora desse formato são recusados.
Nos demais conteúdos, referências sensíveis usam nomes terminados em `_env`, com o nome da
variável como valor. Nunca envie senha, token, chave, DSN com credencial ou conteúdo de arquivo.

O núcleo rejeita campos e padrões reconhecidos de segredo antes de escrever, sem ecoar o valor
no erro. Essa validação não descobre todo segredo arbitrário disfarçado de texto público:
quem conduz a entrevista deve coletar apenas dados públicos e referências. JSON tem limite de
16 KiB por resposta e profundidade máxima de 12 níveis. Não interprete conteúdo como shell.

## Memória opcional

`set` é local. `ork onboarding sync` publica somente as etapas respondidas deste projeto,
usando a camada `memoria.ts`/`orkmind.ts`, coleção `decision`, prioridade `medium`, `source: agent`
e `mandatory: false`. A identidade semântica usa tenant e etapa; conteúdo canônico inclui o
tenant para evitar deduplicação cruzada. Repetir sync sem mudança não duplica entradas.
Mudança de conteúdo pode criar nova versão na memória; reset local não apaga versões publicadas.
Sync recusa `--por`, que atribui autoria apenas a set e reset; a recusa não publica nem emite evento.

Regime files retorna motivo `modo.files`. Configuração ausente ou driver indisponível retorna
motivo tipado e preserva a entrevista em arquivos, inclusive após publicação parcial.
Os resultados informam `gravadas`, `duplicadas` e `falhas`; degradação não é prova de publicação.
A gravação real depende do driver configurado; os testes do núcleo usam um driver isolado.

Escolher `{"modo":"orkmind"}` (ou a resposta legada `"sim"`) apenas orienta configurar
`memory.mode: orkmind` e o nome da variável em `memory.database_url_env` no manifesto.
O YAML não é editado automaticamente. `ork doctor` avisa pendências e divergência entre
entrevista e manifesto. Não há migração global de memória no onboarding.

## Fuso do dono (I-35)

A etapa `maestro` pergunta em qual fuso o Orkastery deve mostrar horários. A resposta usa a
chave `fuso` com um nome IANA (`{"fuso":"America/Sao_Paulo"}`); o núcleo valida pelo `Intl` e
recusa nome inválido com `onboarding.input.invalid`. Como na etapa `memoria`, a resposta só
orienta o manifesto: o YAML não é editado. A fonte única é a chave `owner.timezone`:

```yaml
owner:
  timezone: "America/Sao_Paulo"
```

Sem a chave vale o fuso do sistema (`TZ` ou a configuração do SO), com piso `UTC` quando nada
resolve. Valor inválido não reprova o manifesto: vira aviso em `ork doctor` (linha
`fuso do dono`) e no stderr, uma vez por processo, e todo horário cai no default sem mudar o
código de saída do comando. `ork doctor` também avisa (`onboarding fuso`) quando o fuso da
entrevista diverge do manifesto. O `ork init` gera o bloco `owner` com a chave comentada.

O fuso é resolvido uma vez por processo, no primeiro horário formatado. Cada execução do `ork`
lê o valor novo: CLI, cron do pulse (`monitor/varredura-pulse.sh`), digest e as ofertas nativas
do Hermes e do OpenClaw, que chamam o `ork` a cada pedido. Processo de longa duração não: depois
de mudar `owner.timezone`, reinicie o servidor MCP (`ork mcp serve`, aberto por Claude Code e
Codex em cada sessão) e os gateways que mantêm um `ork mcp serve` como servidor MCP (Hermes,
OpenClaw). Até reiniciar, eles continuam no fuso antigo.

## Contratos JSON e hosts

Com `--json`, sucesso escreve somente JSON em stdout; diagnóstico de erro fica em stderr.
Argumento, etapa ou JSON inválido sai com código diferente de zero. Degradação de memória é
um resultado explícito de sucesso local, com `regime` e `motivo`.

| Comando | Contrato retornado |
| --- | --- |
| `ork onboarding [show/set/reset] --json` | `Onboarding`, contrato `ork.onboarding/v1` |
| `ork onboarding sync --json` | Resultado da publicação e motivo de degradação |
| `ork board list --json` | Array de `ThreadNoBoard` |
| `ork board plan --json` | `PlanoDoEscalonador` existente |
| `ork setup --json` | `SetupDeConducao` |
| `ork setup auto --json` | `SetupDeModo` |

Edição e reset de setup também aceitam JSON; as variantes de texto continuam disponíveis.
Hermes recebe a rota na skill devmaster, Claude Code recebe `/onboarding` e OpenClaw recebe
`ork_onboarding`. Instale pelos comandos descritos no [quickstart](../comecar/quickstart.md).
O teste do OpenClaw carrega o plugin instalado com um SDK falso e executa um CLI temporário:
comprova argv, instalação e erro de processo, sem alegar homologação no host operacional.

## Verificação e lacunas

Medição desta implementação: 366 testes passaram, 0 falharam; 10 canários verdes;
18 skills, 92 casos e 184 asserções no eval estrutural. Comandos: `npm --prefix core test`,
`node core/dist/index.js eval --json` e `bash adapters/openclaw/construir.sh`.

A metade comportamental de LLM permanece `unavailable`. `install.sh`, perfis de stack,
cronômetro em máquina limpa e observação de semanas não fazem parte desta entrega.
Veja o [roadmap](../roadmap/README.md) e o item [RM-015](../roadmap/RM-015-onboarding-do-nucleo.md).
