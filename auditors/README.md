# auditors/

Packs de auditoria periodica (feature mandatoria do PO), somente leitura, cuja saida e
sempre **proposta de ajuste para o roadmap**, nunca correcao aplicada direto.

Implementados no bloco B5. O catalogo dos 7 packs vive no nucleo
(`core/src/auditoria.ts`), porque ele e regra deterministica e tem teste; este diretorio
guarda os **templates de prompt** que um projeto queira versionar por cima dos embutidos.

## Os 7 packs

| Pack | Fonte | Regras | O que audita |
|---|---|---|---|
| `clean-code` | codigo | CC1..CC5 | tamanho sem razao, duplicacao, nome que mente, erro engolido, comentario de "o que" |
| `reuse` | codigo | RU1..RU4 | utilitario reimplementado, componente fora do design system, dependencia redundante, regra repetida |
| `architecture` | codigo | AR1..AR5 | ciclo, camada violada, responsabilidade sem dono, estado global, fronteira sem contrato |
| `data-model` | codigo | DM1..DM5 | indice que ignora soft-delete, migracao sem rollback, integridade, nullable mentiroso, desnormalizacao sem dono |
| `ux` | codigo | UX1..UX5 | estado vazio, erro sem saida, progresso, acessibilidade, destrutivo sem confirmacao |
| `security-privacy` | codigo | SP1..SP12 | segredo, a LGPD (PII em log, retencao, consentimento, direito de exclusao), validacao, CVE, e a **superficie de ataque de rede** (SP8..SP12) |
| `process` | ledger | PR1..PR6 | meta-auditor sobre ledger, POSTMORTEMs e MASTER logs do proprio metodo |

Cada regra declara **a evidencia que precisa**, porque e essa evidencia que vira claim: o
auditor nao tem direito a self-report, e `ork audit verify` reexecuta a alegacao de cada
achado no HEAD real, pelo mesmo julgamento do `ork verify`.

## Superficie de ataque de rede: SP8..SP12, com varredura deterministica

O pack `security-privacy` cobria seguranca de codigo e LGPD. As regras SP8 a SP12 cobrem o
que o produto PUBLICA, e sao as unicas do B5 com **varredura deterministica no proprio
`ork`**: nao ha LLM no meio, o resultado e igual em toda maquina e cada achado ja nasce com
o comando que o reexecuta.

| Regra | O que ela acha |
|---|---|
| `SP8` | rota de servidor HTTP/API declarada em producao sem camada de autenticacao/autorizacao |
| `SP9` | endpoint privado de administracao ou operacao (admin, console, debug, swagger/openapi, health detalhado, metricas, `pprof`) exposto sem restricao de rede nem oAuth |
| `SP10` | rota sem limite de taxa, sujeita a brute-force, enumeracao e DDoS de aplicacao |
| `SP11` | CORS permissivo demais (origem global com credenciais, ou origem aberta em servico com dado sensivel) |
| `SP12` | definicao de rota sem esquema/validacao do payload na borda (complementa o SP6, que olha o USO do dado no handler) |

Frameworks lidos: Express, Fastify, Hono, Koa, NestJS, Next.js (route handler e `pages/api`),
FastAPI, Flask, Django (urlconf), gin e echo. Onde o framework nao e reconhecido, a chamada so
vira rota se o receptor tiver cara de roteador e o primeiro argumento for um caminho comecando
em `/`: e o que mantem `axios.get(url)` fora da lista.

```bash
ork audit surface                          # a superficie inteira do repositorio
ork audit surface servidor --regra SP9     # so um diretorio, so uma regra
ork audit surface --json                   # para o CI (sai != 0 quando ha achado)
ork audit run security-privacy --tudo      # a varredura periodica, ja registrando no board
ork audit surface --registrar <rodada>     # grava no board os achados de uma rodada em ensaio
```

### Confianca declarada, em vez de certeza fingida

Cada achado sai com um nivel de confianca, e ele governa a severidade:

- **alta**: o framework foi reconhecido e o marcador do controle nao existe em ponto nenhum do arquivo;
- **media**: o framework foi inferido pela forma da chamada, ou o marcador existe no arquivo e nao no bloco da rota;
- **baixa**: ha middleware que o `ork` nao sabe classificar. O achado sai com severidade `menor` e o titulo diz **REQUER CONFIRMACAO HUMANA**. Ele aponta onde olhar; quem decide se procede e a pessoa.

Duas armadilhas MEDIDAS durante a construcao desta extensao, e que a varredura trata:

1. **Comentario nao protege rota.** Em portugues, "guarda" casa com o marcador `guard` e
   "sem oAuth" casa com `auth`: sem recortar comentario, a rota com um TODO em cima dizendo
   que falta autenticacao seria justamente a que passaria por protegida. O detector recorta
   comentario de linha, e o comando da claim faz o MESMO recorte com `sed`.
2. **O nome do endpoint nao protege o endpoint.** `/internal/metrics` casa sozinho com o
   marcador de restricao de rede e `/auth/token` casa com o de autenticacao. O caminho da
   rota sai do texto antes da procura, dos dois lados (detector e claim).

O escopo da varredura e o mesmo escopo da rodada: com `--since` (ou o `since_padrao` do
manifesto) ela le so o que mudou na janela, e com `--tudo` ela le a arvore inteira. Escopo
vazio e declarado como escopo vazio, e nunca como superficie limpa.

## Hardening gradual por estagio do produto (`project.stage`)

| Estagio | Packs ativos | Postura |
|---|---|---|
| nascente | clean-code, reuse, process | so `warn`: o builder cria livre e o auditor anota |
| crescendo | + architecture, data-model, ux | achado critico vira proposta prioritaria no roadmap |
| maduro | + security-privacy (LGPD e superficie de ataque de rede) | a recorrencia PROPOE promover a policy de `warn` para `block` (2 propoem controle, 3 propoem bloqueante) |

Pack inativo no estagio nem chega a montar prompt: `ork audit run` reprova com o motivo
tipado `pack.inativo-no-estagio`.

## Contrato de disparo

```bash
# quem dispara: o orquestrador (cron do Hermes, schedule do OpenClaw, hook do Claude Code)
ork audit run <pack> --profile <perfil> --since 7d

# quem executa: o runtime adapter que ja existe (claude-bg), o mesmo do `ork phase run`
# o que sai: achados + PROPOSTAS para o roadmap, gravadas no board de divida
ork audit ingest <rodada> --arquivo .orkastery/audits/<rodada>/achados.json
ork audit verify <rodada>       # o auditor sujeito a claims
ork audit report <rodada>       # bloco OBRIGATORIO de propostas
ork audit divida                # o board, com a recorrencia por regra

# o que o humano faz: decide o que vira thread
ork thread new "<nome>" --from-finding F1
```

## Governanca de custo (visao, secao 5.3)

Declarada em `audit:` no `orkastery.yaml`: janela ociosa da assinatura (fora dela a rodada
so anda com `--agora "<quem>"`, e a autorizacao fica no `run.json` e no ledger), esforco
`eco` por padrao, escopo incremental por `--since`, e Graphify no lugar da leitura bruta
quando ele existe na maquina (`ausente` quando nao existe, dito em voz alta).

## Templates versionados por projeto

O template embutido e `auditoria-padrao`. Para sobrescrever, grave neste diretorio:

- `auditoria-padrao.md`, para trocar o prompt de todos os packs;
- `auditoria-<pack>.md`, para trocar so o de um pack.

`ork audit lint` reprova template que perdeu o bloco obrigatorio de propostas, a regra
central da auditoria ou que declara variavel que nao usa. Ele e o MESMO `lintTemplate` do
bloco B4, com outro `ContratoDeTemplate`: limite de bytes, segredo no corpo e idioma
continuam valendo. Os templates de auditoria nao moram em `prompts/` porque o lint de
`ork prompt lint` cobra secoes que so existem em prompt de fase (ciclo canonico, modo de
conducao, pausa) e auditoria nao e fase.

## Pitfall medido: a rodada roda com as permissoes do agente, nao com as do contrato

Em 03/09/2026 uma rodada real de `reuse` neste repositorio rodou `git reset --hard` e
apagou o trabalho nao commitado da arvore, apesar de o prompt declarar a rodada como
somente leitura. O contrato do prompt nao e sandbox: quem impede acao destrutiva e o guard
do host (`adapters/claude-code/hooks/ork-guard.js`, bloco B4). Duas consequencias praticas:

1. **Commite antes de disparar** uma rodada na mesma arvore em que ha trabalho aberto.
2. **Instale o adaptador do host** (`ork adapter install claude-code`) antes de agendar
   auditoria periodica: e o guard que transforma "nao faca" em "nao consegue".

`ork audit process --json` deriva PR1, PR2 e PR3 do estado canônico sem LLM.
Com `--registrar`, materializa os achados e seus comandos no board; a mesma
evidência não duplica o achado. Em nascente, a postura continua `warn`.
