# Changelog

As mudanças do pacote [`@orkastery/cli`](https://www.npmjs.com/package/@orkastery/cli), da mais
nova para a mais antiga. O detalhe de cada item, com a evidência de merge, está no
[roadmap](docs/roadmap/README.md).

## 0.3.0 — 27/09/2026

### Adicionado

- **Modo `#Fast`** ([RM-042](docs/roadmap/RM-042-modo-fast.md)): uma fase só (GO), sem pausa,
  para pedido pequeno e claro.
  - Prova mínima: teste focado, claim de até dois comandos ou ausência declarada com
    `ork claims ausente`.
  - Não autoriza push sozinho e não commita arquivo de contrato público.
  - Default próprio: `claude-bg/sonnet/high`, com fallback `codex:gpt-5.6-terra:high`.
- **Condução multicanal** ([RM-036](docs/roadmap/RM-036-maestro-multicanal.md)): um dono,
  vários canais, e nunca duas execuções na mesma worktree.
  - Despacho, `ork verify`, GO-FIX, retomada e o `ork_verify` do MCP tomam o lease
    `exec:<thread>`, e o segundo pedido sai na hora com quem conduz e três ações: esperar
    (`--esperar`), acompanhar (`ork conducao status`) e assumir (`ork conducao assumir`).
  - A mesma fase com o mesmo pedido devolve a sessão em andamento, sem sessão nova.
  - Todo despacho grava o canal de origem, e a linha "conduzido agora por ..." é a mesma no
    board, no monitor, no pulse, no `ork thread status` e no panorama do Maestro.
- **Reservas de item do roadmap entre máquinas**
  ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)): `ork roadmap reservas`,
  `ork roadmap pegar` e `ork roadmap soltar`, e `ork thread new --roadmap RM-NNN`. A reserva é
  gravada por push atômico numa branch própria: duas máquinas não pegam o mesmo item.
- **HITL em camadas** ([RM-041](docs/roadmap/RM-041-hitl-invertido.md)): a decisão óbvia vem
  tomada e chega no resumo (`ork decisao registrar`). Pergunta real vem com contexto,
  alternativas e recomendação, e o dono responde em lote.
- **Documentação como código** ([RM-044](docs/roadmap/RM-044-documentacao-como-codigo.md)):
  `ork docs verificar`, `ork docs sincronizar` e `ork docs init` conferem a documentação de
  produto e o roadmap contra o código e o git.
- **Pulse enxuto** ([RM-045](docs/roadmap/RM-045-pulse-enxuto.md)): a fila só traz quem pode
  responder, e a varredura cabe no teto de tempo.
- **Rotação de contas dos runtimes** ([RM-033](docs/roadmap/RM-033-rotacao-de-contas.md)):
  `ork accounts` e ordem de fallback por bloco (`ork setup <modo> --bloco N --fallback`). O
  login é sempre do próprio CLI do runtime.
- **Horário do dono** ([RM-035](docs/roadmap/RM-035-horario-do-dono.md)): `owner.timezone` no
  manifesto vale em toda superfície humana.
- **Radar e entrega** ([RM-001](docs/roadmap/RM-001-radar-ork-pulse.md),
  [RM-003](docs/roadmap/RM-003-hitl-bidirecional-telegram.md),
  [RM-005](docs/roadmap/RM-005-master-e-digest.md)): `ork pulse`, HITL pelo Telegram e digest
  semanal do MASTER.
- **Telemetria, onboarding e playbook** ([RM-007](docs/roadmap/RM-007-telemetria-economica.md),
  [RM-015](docs/roadmap/RM-015-onboarding-do-nucleo.md),
  [RM-009](docs/roadmap/RM-009-playbook-dos-runtimes.md)): `ork ledger stats`, `ork onboarding`
  e limites por bloco.
- **Estado de conta compartilhado entre projetos**
  ([RM-040](docs/roadmap/RM-040-estado-de-conta-compartilhado.md)): cota esgotada, login perdido
  e credencial paga valem para a conta em todos os projetos do mesmo usuário, e nenhuma fábrica
  despacha numa conta que outra já viu esgotada.
- **Verify que diz por que falhou** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  - estouro de prazo vira o motivo `verify.timeout`, que o retry reexecuta, em vez de reprovar a
    alegação;
  - `verify.timeout_ms` e `verify.timeout_ms_por_comando` no manifesto;
  - o ledger guarda, por comando que falha, a causa, o prazo, a duração, os testes que caíram e o
    trecho da saída redigido.
  - o lint do comando de claim: `ork claims add` avisa, e `ork ci prepare` recusa a claim que
    roda a suíte inteira do npm no runner do CI;
  - `verify.preparo` compila uma vez por rodada e confere o produto do preparo ao fim; comando que
    não rodou nunca vira verificado (`verify.sem-veredito`).
- **Cadência do pulse pela tag do dono**
  ([RM-039](docs/roadmap/RM-039-cadencia-do-pulse-por-tag.md)): o dono manda `#OrkPulseOff` (8h,
  às 08h, 16h e 00h), `#OrkPulseOn` (2h) ou `#OrkPulseOn-15m`, `-30m`, `-60m` no Telegram, ou usa
  `ork pulse cadencia`, sem editar o crontab. Pergunta nova sai na hora, qualquer que seja a tag.
- **Fábrica compartilhada entre máquinas**
  ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)): `ork fabrica entrar` dá nome à
  máquina e a faz publicar o retrato das próprias threads na branch `ork/fabrica-estado`.
  `ork board`, `ork fabrica` e o resumo do pulse mostram as outras máquinas, e pergunta que
  espera o dono em outra máquina chega na hora. Guia: [Várias máquinas](docs/guias/varias-maquinas.md).
- **Setup por bloco versionado** ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)):
  `ork setup versionar` grava `orkastery.setup.json` no repositório, e todas as máquinas despacham
  com o mesmo runtime, modelo e esforço por bloco.
- **Loop de aprendizado** ([RM-008](docs/roadmap/RM-008-loop-de-aprendizado.md)): a lição das
  threads fechadas pelo MASTER volta no GOAL e no PLAN da próxima thread, em qualquer regime de
  memória, e a mesma falha em 3 threads em 30 dias vira proposta de policy (`ork licoes`).
- **`ork demo`** ([RM-046](docs/roadmap/RM-046-go-to-open-source.md)): em 30 segundos, offline e sem
  conta, uma afirmação falsa do agente reprovada pelo `ork verify` e a corrigida aceita.
- **Entrega por PR fecha pelo MASTER** (`ork ship registrar-pr`): o merge `ship(<thread>)` com CI
  verde vira `ship_done`, e a thread entregue por PR deixa de ficar aberta para sempre.
- `ork --version` imprime só a versão.

### Mudado

- O template do cron do pulse bate de 15 em 15 minutos e o núcleo decide o que sai. Quem tem a
  linha de hora em hora troca `0 * * * *` por `*/15 * * * *` e reinstala os adaptadores do
  Telegram.

- **`#Look` e `#Ork` aposentados** ([RM-043](docs/roadmap/RM-043-aposentadoria.md)). Quem
  escreve um deles recebe a recusa tipada `modo.aposentado`, e o que já foi gravado continua
  legível para sempre. `ork modos migrar` limpa o `orkastery.yaml` e o `setup.json`.
- `ork objective` saiu: as duas garantias viraram `--exige-runtime-diferente` e `--done` em
  `ork thread new`.
- A fila de `ork master --batch` saiu: a entrega fecha com o índice derivado do ledger, e a nota
  humana, quando vier, sobrescreve.
- A versão do `ork` sai do `package.json`, e o pacote deixa de levar testes e arquivos internos.
- **README canônico em inglês** ([RM-046](docs/roadmap/RM-046-go-to-open-source.md)): o
  `README.md` do repositório e o do pacote no npm passam a ser em inglês, e a versão em
  português do repositório fica em `README.pt-BR.md`, com seletor nas duas. O titular da
  licença MIT passa a ser Julio Pessoa.

### Corrigido

- `ork --version` imprimia a ajuda inteira.
- Uma thread `#Fast` entregue derrubava `ork master`, o aceite por omissão e o pulse com "fase
  MASTER não pertence a nenhum bloco". O ciclo do `#Fast` não tem MASTER: o score dele é de lote.
- `ork ci run` não rodava o `verify.preparo` do manifesto: a claim que usava a compilação do
  preparo passava no `ork verify` local e reprovava no CI. Agora os dois rodam o mesmo preparo.
- Fase despachada de dentro de uma worktree lia o setup da própria worktree e caía no default; o
  setup local agora vem da raiz de estado.

## 0.2.0 — 05/09/2026

Primeira versão publicada no npm: núcleo `ork` com threads de seis fases, cinco modos por #TAG,
claims, `ork verify`, `ork ship` com push provado, worktrees e leases, board, retry tipado,
handoff e memória opcional.
