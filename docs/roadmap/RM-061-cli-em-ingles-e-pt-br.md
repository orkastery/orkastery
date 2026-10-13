---
id: RM-061
tipo: roadmap
titulo: CLI em inglês e pt-BR
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-12T20:23:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Em andamento
evidencias:
  codigo:
    commit: 4a889fc
    pr: 113
sdlc:
  thread: null
  modo: null
---

# RM-061 — CLI em inglês e pt-BR

> **Em uma frase:** o CLI do Orkastery fala inglês e pt-BR como línguas de primeira classe, escolhidas pelo onboarding ou pelo locale do ambiente, com o pt-BR idêntico byte a byte e o `--json` intocado.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Decisão do dono de 12/10/2026:** o CLI fala inglês e pt-BR desde agora. A decisão é sobre a prova de conceito do CLI por locale, o PR [#113](https://github.com/orkastery/orkastery/pull/113) (achados EN1, EN6 e EN7 do ensaio em inglês). O #113 foi mesclado em 12/10/2026 (`4a889fc`) e é a F1 do item: `doctor` e `init` por locale e a regra de idioma do EN9. Esta página planeja as fatias F2 e F3 e fixa o contrato do todo.

Relações: [RM-049](RM-049-lancamento.md) (lançamento), [RM-016](RM-016-experiencia-do-builder.md) (experiência do builder) e [RM-044](RM-044-documentacao-como-codigo.md) (documentação como código). Detalhes em [Relação com outros itens](#relação-com-outros-itens).

## Problema e resultado

- **Público e problema:** quem chega ao Orkastery em inglês encontra o CLI, as datas e boa parte das mensagens só em pt-BR. O lançamento ([RM-049](RM-049-lancamento.md)) tem canais em inglês, e a primeira experiência dessas pessoas termina num texto que não leem. Com `LANG=en_US.UTF-8` e `owner.language` `en-US`, a saída de ajuda, `demo`, `doctor`, `init`, onboarding, `thread new`, `verify`, `ship`, `pulse`, `board`, `master`, adaptadores e `mcp` está toda em português, assim como os arquivos gerados.
- **Evidências e fonte:**
  - achados EN1, EN6 e EN7 do recibo [`ensaio-2026-10-03-en.json`](evidencias/RM-049/ensaio-2026-10-03-en.json), ensaio da primeira experiência em inglês: EN1 (toda a saída do CLI em português), EN6 (datas `03/10 06:30` lidas por um leitor dos EUA como 10 de março) e EN7 (escolher `en-US` no onboarding muda só a conversa no host, não o CLI);
  - corpo do PR [#113](https://github.com/orkastery/orkastery/pull/113), com a prova de conceito e a contagem do custo (feita antes do merge): cerca de 3.240 literais de texto de pessoa em posição de saída, em 159 arquivos de `core/src`, e a ajuda do `ork` com 357 linhas. A prova cobre 92 entradas do catálogo (68 mensagens e 24 nomes de check), cerca de 3%. As contagens são medidas do #113, feitas pela árvore sintática do TypeScript. Desde a F2a o contador está no repositório, em `core/scripts/contar-mensagens-de-saida.cjs`, reimplementado pelo método que o #113 descreve (veja [Cobertura medida](#cobertura-medida)).
- **Objetivo:** inglês e pt-BR como línguas de primeira classe do CLI, sem degradar quem já usa em português.
- **Resultado esperado:**
  - **língua:** vem da escolha do onboarding (`owner.language`) e, sem ela, do locale do ambiente (`LC_ALL`, `LC_MESSAGES`, `LANG`, a primeira não vazia, como no POSIX). Só `en*` vira inglês; as demais línguas e `C`/`POSIX` ficam em pt-BR;
  - **pt-BR idêntico byte a byte:** um snapshot do texto atual passa antes e depois da mudança;
  - **contrato intocado:** o `--json`, o ledger e os dados gravados não mudam com a língua; só a impressão para pessoas é traduzida;
  - **datas pelo locale:** com `en`, a data sai em ISO (`2026-10-03 06:30`) e a legenda do fuso em inglês; com pt-BR, o formato atual.
- **Hipótese:** se o texto de saída passar por um catálogo tipado, com o pt-BR como fonte e o inglês obrigado a ter as mesmas chaves e assinaturas, então o CLI cobre a primeira experiência em inglês sem regressão no pt-BR, porque chave faltando ou assinatura diferente não compila.
- **Métrica principal / linha de base / meta / janela / fonte:** cobertura de mensagens de saída que passam pelo catálogo, contadas pelo contador do #113 (literais de texto de pessoa em posição de saída: `console.*`, `process.std*.write`, `Error(...)`, `push(...)`, `return` e campos como `detalhe`, `correcao` e `mensagem`). Linha de base: 92 de cerca de 3.240, cerca de 3%, no estado do #113 antes do merge. Meta: todo o caminho da primeira experiência ao fim da F2 e o resto do CLI ao fim da F3. Janela: a cada PR de fatia, com o contador rodando em `core/src`.
- **Métricas de proteção:**
  - pt-BR idêntico byte a byte nos comandos migrados, provado pelo snapshot;
  - `--json` igual com qualquer `LANG`, inclusive `modos`, `doctor --modo fast` e `projetos --json`;
  - nenhum comando fica pela metade: ou passou pelo catálogo, ou fala só pt-BR;
  - nenhum dado gravado muda por causa da língua (`Check.nome`, detalhes gravados e ledger).

## Escopo e validação

- **Incluído:**
  - catálogo tipado `msg()` e `core/src/locale.ts` (`resolverLocale(owner.language, env)`), sem dependência nova;
  - datas e legendas de fuso seguindo o locale ativo em `horario.ts`;
  - a ativação explícita por comando, sem `--json` e sem `--modo`;
  - as três fatias abaixo.
- **Fora de escopo:**
  - tradução do `--json`, que é contrato;
  - outras línguas além de inglês e pt-BR; a estrutura permite acrescentar, mas cada língua nova é decisão própria;
  - mudar o nome dos comandos e das flags; os aliases em inglês (`modes`, `--to`, `--by`) são outra decisão, fora desta página;
  - o achado EN8 (desconto de `ship_blocked` no índice do #Fast), que muda o índice derivado e segue com decisão própria do dono.

### Fatias

| Fatia | Resultado | Critério de aceite verificável | Dependências |
| --- | --- | --- | --- |
| F1: Prova de conceito e docs (mesclada) | `doctor` e `init` por locale, com catálogo tipado, datas pelo locale e `owner.language` valendo para o CLI; mais os achados EN9 (mesclado) e EN5 (quickstart em inglês do site, ainda aberto no recibo), que são só documentação | Snapshot pt-BR passa também no código da base; teste confere que as chaves pt-BR e en são as mesmas; `modos`, `doctor --modo fast` e `projetos --json` iguais byte a byte com `LANG=en_US`; `ork docs verificar` verde nos achados de docs. Cobertos pelo #113 e pelo teste `locale-cli` | Nenhuma |
| F2: Caminho da primeira experiência | Onboarding, `thread new`, `phase list`, `verify`, `ship`, `pulse`, `master` e a ajuda, em PRs por família de comando | Cada PR tem o snapshot pt-BR do comando, o equivalente em inglês e os testes que leem texto com o locale fixado; o contador mostra o caminho inteiro coberto | F1 |
| F3: O resto do CLI | Demais comandos; arquivos gerados (comentários do `orkastery.yaml`, blocos do `AGENTS.md` e do `CLAUDE.md`, modelos do `ork docs init`); skills e prompts; referência do CLI em inglês | Contador cobre o conjunto; arquivos gerados nascem na língua escolhida; `docs/referencia/cli.md` tem a versão em inglês e `ork docs verificar` fecha a paridade | F2 |

A F2 sai em duas metades: a F2a (`doctor` inteiro, o erro de `init` fora do repositório, onboarding, `experiencia show`, `thread new`, `thread status`, `phase list`, `phase run` e a ajuda) e a F2b (`verify`, `ship`, `pulse`, `master`, `retry` e `roadmap status`).

A F3 também sai em duas: a F3a (os arquivos gerados, a referência do CLI em inglês e a cobertura medida) e a F3b (o resto das mensagens do CLI e as skills); os prompts, `decisao registrar` e `network roadmap` ficam para a F3c.

Os aceites acima são o que cada fatia terá de provar; não são provas já executadas. Os achados EN5 e EN9 entram na F1 porque são só de documentação: EN9 é a regra de idioma do guia de pull request em relação ao `CONTRIBUTING.md`, já corrigida na `main` ("em pt-BR ou em inglês"); EN5 é o quickstart em inglês do site, que para em `ork thread new`, `thread status` e `phase list`, e cujos exemplos seguem em português, e continua aberto.

### Estimativa de custo (do #113)

- **F1:** cerca de 2 h de agente para a infraestrutura e as 92 entradas (já entregue).
- **F2:** de 700 a 900 strings, em 4 a 6 PRs por família de comando, de 2 a 3 dias de fábrica, mais a revisão humana do inglês.
- **F3:** o restante, cerca de 3.240 strings no total, mais os arquivos gerados e a ajuda: de 25 a 35 h de agente em 10 a 14 PRs, mais de 1 a 2 dias de revisão do inglês.

São estimativas do #113, não medidas desta página. Cada fatia as reconfere antes de começar.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** a decisão do dono de 12/10/2026 põe o item em desenvolvimento. A posição no [índice de prioridade](README.md#prioridade-para-a-comunidade-de-product-builders) segue com o dono; esta página não inventa uma pontuação.
- **Horizonte / alvo / previsão / confiança / marcos:** marcos F1, F2 e F3, na ordem. Sem data de entrega nesta página; a confiança sobe a cada fatia que passa no snapshot e no contador.
- **Dependências e bloqueios (ID, owner, próxima revisão):** a F1, já mesclada, é a base da F2 (fábrica; a próxima revisão é a abertura da F2); revisão humana do inglês em cada fatia (Julio).
- **Premissas / riscos / mitigação:**

| Risco | Probabilidade / impacto | Mitigação e contingência |
| --- | --- | --- |
| Quem tem `LANG=en_*` e nenhum `owner.language` passa a ver inglês | Alta / médio | A saída é `ork onboarding set maestro --conteudo '{"owner":{"language":"pt-BR"}}'`; o `CHANGELOG.md` e o glossário do README avisam |
| Testes que leem texto herdam o `LANG` de quem roda | Alta / médio | Cada comando migrado fixa o locale nos testes que leem o texto dele (no #113 foram 3 testes; há 144 arquivos de teste que chamam o CLI sem fixar o `LANG`) |
| Inglês com erro ou termo estranho | Média / médio | Revisão humana do inglês por fatia; glossário de termos do produto (HITL, ledger, lease, pulse, maestro) mantido junto do catálogo |
| Doctor misto, com linhas em inglês e linhas em pt-BR, enquanto a migração é parcial | Alta / baixo | Registrado nas fatias; a F2 cobre o doctor inteiro, e o contador mostra o que falta |
| Texto de saída usado como contrato por alguém | Baixa / médio | `--json` é o contrato e não muda; adaptadores usam código de saída; reverter uma fatia não exige migração de dado, porque nada gravado muda |

- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  - **D1. O CLI fala inglês e pt-BR desde agora.** Decidida pelo dono em 12/10/2026, sobre o #113. Alternativas descartadas: só documentação agora (EN5 e EN9) e internacionalização depois; anunciar como "pt-BR first" e deixar o CLI no roadmap; adiar tudo. Como mudar: o dono registra outra escolha e a página muda com o histórico. Custo de reverter agora: fechar o #113 e ajustar esta página; com a F1 já mesclada: reverter os commits da fatia, sem migração de dado.
  - **D2. Datas em inglês saem em ISO (`2026-10-03 06:30`).** É o que o #113 implementa (alternativa a do EN6); já está na `main`; fica sujeita à revisão do dono na F2.

### Relação com outros itens

- **[RM-049](RM-049-lancamento.md), lançamento:** é a origem do ensaio em inglês e dos achados; o CLI em inglês fecha o atrito que o ensaio registrou. A RM-049 continua dona do site, dos marketplaces e do anúncio.
- **[RM-016](RM-016-experiencia-do-builder.md), experiência do builder:** o caminho da primeira experiência (F2) é a jornada que a RM-016 descreve; a língua passa a ser parte dela.
- **[RM-044](RM-044-documentacao-como-codigo.md), documentação como código:** a referência do CLI em inglês e a paridade (`ork docs verificar`) seguem as regras dela; a F3 depende disso.

### Não-objetivos

- Traduzir contrato, ledger ou `--json`.
- Mudar o comportamento dos comandos além da língua e das datas.
- Publicar versão ou tag por causa desta página.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-12 | Julio |
| Documentação | Em revisão | — | 2026-10-12 | Julio |
| Código | Mesclado | commit `4a889fc` · PR #113 | 2026-10-12 | Julio |
| Testes | Em execução | — | 2026-10-12 | Julio |
| Deploy | Não implantado | — | 2026-10-12 | Julio |
| Exposição | Flag desligada | — | 2026-10-12 | Julio |
| Habilitação | Em andamento | — | 2026-10-12 | Julio |

<!-- ork-docs:estado:fim -->

### Cobertura medida

Medida por `node core/scripts/contar-mensagens-de-saida.cjs --json`, com o recibo em [`cobertura-f2a.json`](evidencias/RM-061/cobertura-f2a.json). O contador reimplementa o método do #113: na árvore da F1 ele lê as mesmas 92 entradas do catálogo e 3.162 literais de saída, contra cerca de 3.240 que o #113 contou antes do merge.

| Medida | F1 (`4a889fc`) | Só a F2a (`47afbe8`) | F2a final (`6f6a7e0`) |
| --- | --- | --- | --- |
| Entradas do catálogo | 92 | 356 | 382 |
| Literais de saída fora do catálogo | 3.162 | 2.972 | 3.085 |
| Cobertura | 2,8% | 10,7% | 11,0% |
| Ajuda do `ork` | fora do catálogo, 355 linhas | no catálogo, em pt-BR e em inglês | no catálogo, 365 linhas nas duas línguas |

A coluna "Só a F2a" mede a fatia antes do merge da `origin/main`; a final já traz as frentes mescladas (RM-037, RM-047, RM-049, RM-058, RM-059 e RM-060), que somam literais de saída fora do catálogo e dez linhas da ajuda.

Fica fora da F2a, por decisão da thread (D1 e D14), o texto que já é dado gravado (erro do ledger, recusa registrada, policy avaliada) e o que vem de módulo compartilhado ainda sem família no catálogo (o validador do manifesto, o regime de memória e o erro de estado durante a gravação): ele sai como o módulo dono escreve, em pt-BR, até a família migrar. O cabeçalho `Projeto consultado:` é contrato do RM-052 com os hosts e fica igual nas duas línguas.

A F2b mede no mesmo contador, com o recibo em [`cobertura-f2b.json`](evidencias/RM-061/cobertura-f2b.json):

| Medida | F2a na `main` (`17bbdea6`) | F2b (`5ec8387e`) |
| --- | --- | --- |
| Entradas do catálogo | 389 | 835 |
| Literais de saída fora do catálogo | 3.077 | 2.795 |
| Cobertura | 11,2% | 23,0% |

- As famílias novas são `verify` (46 entradas), `ship` (112), `retry` (115, com a política dos 26 motivos), `master` (47), `pulse` (94, com a descrição dos 26 motivos de gate) e `roadmap` (29).
- O texto que o comando monta e também grava, ou devolve no `--json` (o detalhe da claim, o bloqueio do ship, a razão do retry), nasce em pt-BR e só a impressão o remonta no locale. O que o próprio `pulse` monta ao ler o estado (as paradas do monitor, o estado e a recomendação do radar, a consulta do runtime, a descrição de cada motivo, as alternativas do impedimento do despacho e a correção das vagas do escalonador) também passa pelo catálogo.
- Seguem como o módulo dono escreve, além da fronteira da F2a: o próximo passo e o estado da entrega de uma thread parada no condutor (família de entregas), o que outro processo gravou no ledger e, pela D14 da F2a, a recusa `ship.remoto-invalido` do `--remoto` inválido.
- Em inglês, a impressão traduz alguns valores de estado (a ação do `registrar-pr`, o tipo da autorização do `ship`, o veredito e a cobertura do CHECK-REVERIFY, o status da thread e a classe do item do `pulse`); motivo tipado, código e o `--json` saem iguais nas duas línguas. Os adaptadores do Hermes e do OpenClaw transportam o texto do comando: com `owner.language` ou o locale do host em `en`, o dono o recebe em inglês.

A F3a mede no mesmo contador, com o recibo em [`cobertura-f3a.json`](evidencias/RM-061/cobertura-f3a.json):

| Medida | F2b na `main` (`583a0c40`) | F3a (`988fd588`) |
| --- | --- | --- |
| Entradas do catálogo | 835 | 877 |
| Literais de saída fora do catálogo | 2.795 | 2.786 |
| Cobertura | 23,0% | 23,9% |

- **O que mudou:** a família nova `gerados` (42 entradas) traz o texto dos arquivos que o CLI escreve: os comentários do `orkastery.yaml` (24), o bloco do `AGENTS.md` do `ork init` (11), o bloco da experiência que `ork adapter install` põe no `CLAUDE.md` ou no `AGENTS.md` (4) e o que o `ork docs init` imprime (3). Os arquivos nascem na língua do dono no momento da geração (`owner.language`, senão o locale do ambiente).
- **Fora da régua:** o contador conta literais nos `.ts` de `core/src`, e um arquivo gerado inteiro contava como um literal só. Os sete arquivos do `ork docs init` em inglês (seis `.md` e o `.jsonc` do markdownlint) moram em `core/assets/docs-en/` e ficam fora do método.
- **O dado não muda:** chaves, valores e marcadores dos arquivos são os mesmos nas duas línguas. Nos modelos do `docs init`, o que o `ork docs verificar` lê (chaves e valores do frontmatter, nomes das seções e a linha `Em uma frase`) segue em pt-BR em qualquer língua; um verificador bilíngue fica para a F3b ou para a [RM-044](RM-044-documentacao-como-codigo.md).
- **Língua fixa:** sem `owner.language`, a língua dos arquivos segue o locale de quem roda o comando; num projeto conduzido de máquinas com locales diferentes, fixe `owner.language`, senão os blocos versionados trocam de língua a cada execução. Seguem em pt-BR, até a F3b, o `.orkastery/.gitignore` que o `ork init` cria e os arquivos do adaptador que o `ork adapter install` copia.
- **Referência do CLI:** [`docs/referencia/cli.en.md`](../referencia/cli.en.md) é a versão em inglês de [`cli.md`](../referencia/cli.md), ligada nos dois sentidos; um teste confere, seção por seção, as mesmas invocações `ork`, tabelas e blocos de código.

A F3b mede no mesmo contador, com o recibo em [`cobertura-f3b.json`](evidencias/RM-061/cobertura-f3b.json):

| Medida | Base da F3b na `main` (`1f3d73ff`) | F3b (`a32cfdb6`) |
| --- | --- | --- |
| Entradas do catálogo | 1.020 | 1.653 |
| Literais de saída fora do catálogo | 3.019 | 2.514 |
| Cobertura | 25,3% | 39,7% |

- **O que mudou:** seguem o locale `ork thread list`, `thread close` e `thread entrega`, `ork worktree`, `ork claims`, `ork decisao placar`, `ork accounts`, `ork network` (fora `network roadmap`), `ork roadmap reservas`, `pegar`, `soltar` e `feat`, `ork docs verificar` e `docs sincronizar`, `ork adapter` e os erros de estado (`estado.*`, `transporte.rastreado`, `ponteiro.fora-da-raiz`). As famílias novas do catálogo são `worktree`, `estado`, `claims`, `decisao`, `accounts`, `network`, `reservas`, `docs` e `adapter`.
- **O dado não muda:** o texto que vai ao ledger, ao `claims.jsonl` ou ao `--json` (o detalhe de um check da worktree, o achado do `docs verificar`, a lacuna da rede, a soltura de uma reserva órfã) nasce em pt-BR e só a impressão o remonta; motivo tipado, código, estado da claim e do perfil saem iguais no `--json` e só a impressão os traduz. O que o `ork docs verificar` lê nas páginas (chaves, valores, seções e a linha `Em uma frase`) segue em pt-BR em qualquer língua.
- **Skills na língua do dono:** com `owner.language` (ou o locale) em `en`, o `ork adapter install` copia as 18 skills do catálogo, as seis checklists, os comandos e os subagentes do Claude Code, a skill `ork` do Codex e a skill do Hermes em inglês (43 variantes em `core/assets/skills-en/`, `references-en/` e `adapters-en/`), no mesmo destino; o recibo `INSTALADO.json` guarda a origem real, e trocar a língua troca no lugar a cópia intacta. As variantes têm a estrutura do original, linha a linha, e um teste acusa a que foi traduzida de outra versão do original. O par `orchestration-experience` já era bilíngue. As variantes ficam fora da régua do contador, como os modelos do `docs init`.
- **Seguem em pt-BR, para a F3c:** o `.orkastery/.gitignore` que o `ork init` cria, `ork decisao registrar` (as recusas são do contrato HITL v2, também do MCP), `ork network roadmap` (o texto é contrato com os hosts e com a prova de ativação), `ork thread new --from-finding`, os prompts de fase (`ork prompt` e o prompt que o `ork phase run` monta, que saem de cinco módulos e da `REGRA CENTRAL`), os demais comandos fora da lista, os mods, as tools do OpenClaw e as cópias dos marketplaces (geradas do catálogo pt-BR).

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: fábrica Orkastery nas fatias; A: Julio; C: revisão humana do inglês; I: quem usa o CLI em inglês.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** agente Claude Code redigiu esta página em #Fast, restrita à documentação. O código da F1 vem do #113, mesclado por outra thread. Revisor humano: Julio.
- **Próxima ação, responsável e prazo:** revisar o inglês da F2a à F3b (as frases mais visíveis estão no PR da F3b), abrir a F3c (prompts de fase, `decisao registrar`, `network roadmap`, `thread new --from-finding` e o `.orkastery/.gitignore`) e fechar o EN5; responsável: fábrica, com a revisão do inglês pelo dono; sem data definida nesta página.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-12 | Item criado em Desenvolvimento, com F1 a F3; F1 já mesclada (#113) | Decisão do dono sobre a prova de conceito #113 e o recibo `ensaio-2026-10-03-en.json` | Julio |
| 2026-10-12 | F2 dividida em F2a e F2b; a F2a leva o caminho da primeira experiência ao catálogo, com a cobertura medida | Thread `ork-rm061f2a` e o recibo `cobertura-f2a.json` | Fábrica, pelo pedido do dono |
| 2026-10-12 | A F2b leva `verify`, `ship`, `pulse`, `master`, `retry` e `roadmap status` ao catálogo, com a cobertura medida | Thread `ork-rm061f2b` e o recibo `cobertura-f2b.json` | Fábrica, pelo pedido do dono |
| 2026-10-12 | F3 dividida em F3a e F3b; a F3a leva os arquivos gerados à língua do dono, cria a referência do CLI em inglês e mede a cobertura | Thread `ork-rm061f3a` e o recibo `cobertura-f3a.json` | Fábrica, pelo pedido do dono |
| 2026-10-12 | A F3b leva ao catálogo o resto da lista do dono e instala as skills na língua do dono; os prompts, `decisao registrar` e `network roadmap` ficam para a F3c | Thread `ork-rm061f3b` e o recibo `cobertura-f3b.json` | Fábrica, pelo pedido do dono |
