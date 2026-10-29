---
id: RM-061
tipo: roadmap
titulo: CLI em inglês e pt-BR
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-29T15:20:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Em execução
  deploy: Produção
  exposicao: Parcial
  habilitacao: Em andamento
evidencias:
  codigo:
    commit: 4a889fc
    pr: 113
  deploy:
    release: v0.6.0 (F3b, F3c e F3d), @orkastery/cli no npm
sdlc:
  thread: null
  modo: null
---

# RM-061 — CLI em inglês e pt-BR

> **Em uma frase:** o CLI do Orkastery fala inglês e pt-BR como línguas de primeira classe, escolhidas pelo onboarding ou pelo locale do ambiente, com o pt-BR idêntico byte a byte e o `--json` intocado.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Em execução | Produção | Parcial |

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

A F3 sai em cinco fatias: a F3a (os arquivos gerados, a referência do CLI em inglês e a cobertura medida), a F3b (o resto das mensagens do CLI e as skills), a F3c (os prompts, `decisao registrar`, `network roadmap`, `thread new --from-finding` e o `.orkastery/.gitignore`), a F3d (os demais comandos, mods, tools do OpenClaw e cópias dos marketplaces; as três superfícies derivadas ficaram para trabalho próprio) e a F3e (o que a F3d deixou em pt-BR no CLI principal, listado na seção dela).

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

- Em produção na versão 0.6.0 (tag `v0.6.0` e `@orkastery/cli` 0.6.0 no npm, publicado em 27/10/2026): a F3b, a F3c e a F3d; a F1, a F2 e a F3a já estavam no código da `v0.5.6`. A F3e e as superfícies de fora do CLI seguem.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-29 | Julio |
| Documentação | Em revisão | — | 2026-10-29 | Julio |
| Código | Mesclado | commit `4a889fc` · PR #113 | 2026-10-29 | Julio |
| Testes | Em execução | — | 2026-10-29 | Julio |
| Deploy | Produção | release: v0.6.0 (F3b, F3c e F3d), @orkastery/cli no npm | 2026-10-29 | Julio |
| Exposição | Parcial | — | 2026-10-29 | Julio |
| Habilitação | Em andamento | — | 2026-10-29 | Julio |

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

A F3c mede no mesmo contador, com o recibo em [`cobertura-f3c.json`](evidencias/RM-061/cobertura-f3c.json):

| Medida | Base carimbada da F3c (`d38070d5`) | F3c (`7576d416`) | `main` sem a F3c (`8d37c75f`) | F3c integrada à `main` (`2383460b`) |
| --- | --- | --- | --- | --- |
| Entradas do catálogo | 1.800 | 1.998 | 1.948 | 2.157 |
| Literais de saída fora do catálogo | 2.946 | 2.860 | 3.053 | 2.960 |
| Cobertura | 37,9% | 41,1% | 38,9% | 42,2% |

- **O que mudou:** o `.orkastery/.gitignore` gerado pelo `ork init`, as recusas humanas de `ork decisao registrar` no CLI e no MCP (validação HITL v2, critério e rastro), o texto humano de `ork network roadmap`, o resultado e o pedido gerado por `ork thread new --from-finding`, `ork prompt` e o prompt montado pelo `ork phase run` seguem a língua do dono. O prompt inglês preserva as seis fases, os cinco módulos, a `CENTRAL RULE` e o fecho obrigatório do GO da RM-016; o pt-BR continua no template original.
- **Dado gerado e texto impresso:** o que o `ork` grava para depois (o prompt despachado, com sha256 no ledger, e o pedido do achado, que vira o `--prompt` do GOAL) segue só a língua declarada em `owner.language`, sem ela pt-BR: o `LANG` de quem roda e o `--json` não o mudam. O texto impresso segue o locale do CLI, e o `ork prompt render` mostra o prompt na língua do despacho.
- **Templates do projeto:** com o dono em inglês, o template de fase do projeto vence o embutido e o `.en` vem antes no mesmo nível; sem o par `.en`, a fase sai em pt-BR, inteira, e o `ork prompt lint` avisa ([`prompts/README.md`](../../prompts/README.md)).
- **Integração com a `main`:** o merge da `origin/main` (`1e88a932`) trouxe o template pt-BR v4 com o fecho obrigatório do GO. O fecho passou ao catálogo dos prompts (o pt-BR é o texto da `main`, byte a byte) e o template inglês acompanha a v4, com as mesmas variáveis, fases e ordem; um teste reprova a língua que ficar para trás. As duas colunas da direita medem a mesma `main` sem e com a F3c, medidas de novo depois do merge da RM-064 fatia 2 (`8d37c75f`), que trouxe a linha do trabalho retomável ao prompt: o template inglês ganhou a mesma linha, e o snapshot `locale-f3c-pt-BR.json` foi regerado pelos mesmos casos sobre essa `main`.
- **Contratos preservados:** `ork network roadmap` mantém byte a byte as três linhas que os hosts e a prova de ativação leem; códigos do HITL v2, ledger e `--json` não mudam. O snapshot `locale-f3c-pt-BR.json` guarda 355 casos das cinco superfícies em pt-BR, gerados sobre a `main` de integração, e o teste os compara byte a byte. Os quatro snapshots pt-BR das fatias anteriores têm os hashes de antes na F3c e os da `main` na F3c integrada (F2b e F3b mudaram na `main` por outras threads); os dois conjuntos estão no recibo da cobertura.
- **F3d:** as famílias do CLI principal que seguiam fora da lista e as três lacunas vistas na revisão independente da F3c entram no catálogo: o detalhe humano das lacunas de `network roadmap`, o bloco de memória injetada no prompt inglês e as recusas HITL v2 da classe pergunta. Não são todos os comandos: o que segue em pt-BR com o CLI em inglês está listado abaixo, em **Seguem em pt-BR, para a F3e**. `brain` e `activation` continuam contratos JSON, e o servidor de `mcp serve` não ganha uma segunda moldura humana. Os mods, as tools do OpenClaw e as cópias dos marketplaces ficam pendentes: são artefatos derivados e precisam de catálogo de origem, geração reproduzível e fixtures próprias de paridade; uma tradução parcial quebraria o contrato de cópia intacta.

A F3d mede no mesmo contador, com o recibo em [`cobertura-f3d.json`](evidencias/RM-061/cobertura-f3d.json):

| Medida | Base carimbada da F3d (`79d3ebf9`) | F3d (`8520da95`) | `main` (`97c2a446`) | F3d integrada, com o GO-FIX 1 (`bad54969`) |
| --- | --- | --- | --- | --- |
| Entradas do catálogo | 2.157 | 3.367 | 2.178 | 3.391 |
| Literais de saída fora do catálogo | 3.041 | 2.306 | 3.101 | 2.393 |
| Cobertura | 41,5% | 59,35% | 41,26% | 58,63% |

- **Comandos cobertos:** além das três lacunas da revisão, entram `modos`, `ciclos`, `setup`, `projetos`, as rotas complementares de `pulse`, `ledger`, `portfolio`, `creation`, `objective`, `ci`, `retry`, `sessions`, `gate`, `fix`, `handoff`, `recall`, `lease`, `board`, `orquestracao`, `monitor`, `licoes`, `demo`, `fabrica`, `eval`, `memory`, `mcp install`, três rotas de `master` (`master <thread>` com a nota, `master classes` e `master batch`), `conducao`, `grafo` (menos as linhas de extração e o detalhe das recusas tipadas) e `audit`.
- **Escopo de entrada da F3e, implementado pela thread `ork-rm061f3erota`:** antes desta thread, com o CLI em inglês, estas rotas e estes resíduos continuavam em pt-BR. A lista das rotas saiu do código: o que `chaveDoLocale` não achava em `COMANDOS_COM_LOCALE` (`core/src/locale.ts`), conferido contra o `switch` de `core/src/index.ts` e as invocações de [`cli.md`](../referencia/cli.md). Os resíduos dentro das rotas cobertas eram os que os testes e o CHECK independente acharam.
  - `ork master audit`, `master digest`, `master migrar`, `master ratificar` e `master propor`, rotas próprias desde a G3 da F2b.
  - No `ork grafo`: as linhas de extração do `grafo indexar` (`linhasDaExtracao`: a extração incremental ou completa e o que veio da base) e o detalhe das recusas tipadas do índice (`grafo.indice.*`, `grafo.acesso.negado`) e da consulta (`grafo.consulta.*`); o código da recusa é contrato e fica igual.
  - `ork onboarding sync`, `ork experiencia uninstall`, `ork doctor --modo` e a ajuda do `ork maestro`, fora da lista desde a D2 da F2a, e o painel em texto do `ork maestro`, que roda antes de o CLI ativar o locale.
  - `ork brain` e `ork activation`, que imprimem JSON: o erro de uso e o do manifesto.
  - `ork mcp serve` e o `ork mcp` sem subcomando conhecido: o erro de uso; o texto que o servidor devolve aos hosts também segue em pt-BR.
  - `ork receipt-verifiers`, o ajudante JSON do host confiável: o erro de uso.
  - Em qualquer comando, a recusa do projeto-alvo (`--projeto` ou `ORK_PROJETO`) e o `uso: ork <comando> não lê projeto`, que saem antes de o comando ativar o locale.
  - No `ork security-scan`, que chegou da `main` no GO-FIX 4, o caso inverso: o detalhe das recusas `security-scan.config-invalid` e `security-scan.dismissal-invalid` e os motivos `security-scan.parse` e `worktree-failed` de uma ferramenta que falhou saíam em inglês também com o CLI em pt-BR. A F3e decidiu manter códigos, motivos e `ScanReport` como dados canônicos e traduzir no catálogo somente a apresentação humana conhecida (`stdout`, `report.md` e recusas sem `--json`).

A F3e mede no mesmo contador, com o recibo em [`cobertura-f3e.json`](evidencias/RM-061/cobertura-f3e.json):

| Medida | Base carimbada da F3e (`6a30b24c`) | F3e (`9edc75da`) |
| --- | --- | --- |
| Entradas do catálogo | 3.482 | 3.567 |
| Literais de saída fora do catálogo | 2.716 | 2.681 |
| Cobertura | 56,18% | 57,09% |

- **Resultado da F3e:** as rotas entram em `COMANDOS_COM_LOCALE`; as linhas de extração e detalhes humanos tipados do grafo, o preflight do `doctor --modo`, a ajuda e o painel Maestro, as recusas antecipadas de projeto e a apresentação humana do `security-scan` usam o catálogo. Os cinco arquivos de teste focado aprovam 12 de 12 casos pt-BR/en; o `--json`, os códigos tipados e os dados gravados permanecem canônicos.
- **Fora da F3e:** o `--json`, que é contrato em qualquer fatia; as três superfícies derivadas, em trabalho próprio; e `ork noctum`, que o GOAL da F3d deixou fora do escopo.
- **Contratos preservados:** comandos, flags, ids, códigos tipados, ledger e `--json` não são traduzidos. Os quatro snapshots pt-BR anteriores conservaram os mesmos hashes byte a byte; cada família nova tem exercício em pt-BR e inglês no teste focado da F3d.
- **Fora da régua:** o contador mede `core/src`. As superfícies derivadas que ficaram pendentes não seriam representadas com honestidade pela porcentagem e ganham trabalho próprio de geração e paridade.
- **Verificação desta sessão:** o teste focado da F3d aprovou 22 de 22 casos. A suíte integral expirou em 2.400 segundos depois de concluir 16 arquivos (7 aprovados e 9 reprovados), e o diagnóstico mínimo confirmou `spawnSync /bin/sh` com `EPERM`; por isso ela não é declarada verde. O `ork verify` nativo também encerrou sem veredito depois de verificar 86 de 161 claims. O CHECK independente precisa repetir a suíte e o verify fora deste sandbox.
- **GO-FIX 1:** a suíte inteira, rodada fora do sandbox depois do merge da `main` (`97c2a446`), saiu com 15 falhas em 5.341 testes, que o verify oficial chamou de pré-existentes porque a baseline da thread gravou o `test` estourado em 600 s. As causas: a consulta e o CLI do grafo importavam o catálogo e quebravam a fronteira do KG3 e do KG5 (o pt-BR volta a morar na família, e o `index.ts` passa a redação no locale do comando); o catálogo tinha um travessão e 58 folhas iguais ao pt-BR sem a declaração do teste; o `ci prepare` gravava o lint no ledger na língua do comando (agora grava em pt-BR e imprime no locale); nove testes negativos usavam como sonda uma rota que a F3d levou à lista; e um teste da própria F3d esperava um título que a tabela da política nunca teve. Depois do GO-FIX 1, a mesma suíte sai com 0 falha em 5.345 testes. As duas colunas da direita medem a `main` sem e com a F3d: o pt-BR do grafo de volta à família conta como literal de saída, e a cobertura integrada fica em 58,63%.
- **GO-FIX 2:** o CHECK independente da F3d deu PRECISA DE MUDANÇA no `144bf0e3`. As provas do essencial passaram (snapshots pt-BR iguais aos da `main`, o contador de 41,26% para 58,63% e a fronteira do grafo provada por mutação), mas esta página e o `CHANGELOG.md` diziam "comandos restantes" sem os limites, os `touch_paths` do PLAN não cobriam o diff, uma frase inglesa da condução tinha o verbo sem sujeito e a claim do bundle ficou sem recibo do verify no HEAD final. O GO-FIX 2 lista os limites acima, troca a frase por `Wait your turn: the command below repeats this request and proceeds on its own once the current conduction ends (waiting up to 30 min).`, com o teste que a confere e o pt-BR igual, e completa o PLAN da thread.
- **GO-FIX 3:** a rodada 2 do CHECK independente deu PRECISA DE MUDANÇA no `44be2205` por um achado só: a F3d não tinha o snapshot pt-BR próprio previsto no PLAN, e a troca de `Portfólio vazio.` não derrubava teste nenhum. O GO-FIX 3 cria o snapshot no padrão das fatias anteriores: 612 casos em oito grupos (`core/test/locale-f3d-casos-*.ts`), com as funções de texto chamadas com entradas fixas e o CLI em repositórios temporários. A fixture `locale-f3d-pt-BR.json` saiu dos mesmos casos rodados sobre a `main` antes da F3d (`97c2a446`), e o teste a compara byte a byte, um teste por grupo. Os casos leem 1.078 das 1.090 folhas pt-BR que a F3d levou ao catálogo; as 12 restantes não têm caminho alcançável: os rótulos de pausa dos modos aposentados, as linhas do `gate approve` aposentado, dois avisos de instalação sem os analisadores do grafo, um fallback defensivo do `grafo indexar` e o aviso de projeto temporário, que depende de onde fica o checkout. Na primeira rodada, o snapshot achou duas regressões do pt-BR no `audit`: o `ork audit show` dizia `session`, e o `ork audit constructor` imprimia um membro do protótipo do objeto no lugar da recusa. As duas voltam ao texto da `main`. A única mudança pretendida do pt-BR, o travessão do custo de referência (GO-FIX 1), entra como troca explícita no caso do `ledger`. Trocar `Portfólio vazio.`, a linha de lease vazio ou o título da memória injetada no prompt reprova o grupo de cada uma.
- **GO-FIX 4:** o CI do PR da F3d caiu nos jobs do núcleo e no `ork-verify` por um caso só do snapshot, `cli grafo: amostra reprovada`, do grupo `memoria`. A amostra de uma aresta por estrato escolhe pelo `edge_id`, que leva a versão do Node dos extratores; com o Node do runner (20.20.2 e 22.23.3), ela pegava arestas diferentes das da fixture, gerada com o 22.23.2. O caso passa a levar, de cada estrato, a aresta de menor rótulo da amostra inteira, e o texto sai igual nos três Node. O merge da `main` em `ce102584` traz o `ork security-scan` (#186): os snapshots F2a a F3c, regerados pelos casos de cada fatia, saem iguais aos da `main` (o F2a, o F3a e o F3b mudaram nela pelo #186), e a fixture da F3d, regerada pelos mesmos casos sobre a `main` nova, muda só na entrada desse caso. As mensagens que o #186 imprime pelo catálogo já têm o pt-BR e o par inglês; o que ele deixa fora está na lista da F3e acima. O #185 (RM-037), que entrou na `main` durante o GO-FIX 4, também foi mesclado: ele muda a F3b só no hash do hook que alterou, e a fixture da F3d regerada sobre a `main` em `aa3681fe` dá o mesmo sha256. No mesmo contador, a `main` em `aa3681fe` mede 2.231 entradas e 41,28%, e a F3d integrada, 3.444 entradas, 2.466 literais de saída e 58,27%, no recibo em `integrada.goFix4`.

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: fábrica Orkastery nas fatias; A: Julio; C: revisão humana do inglês; I: quem usa o CLI em inglês.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** agente Claude Code redigiu esta página em #Fast, restrita à documentação. O código da F1 vem do #113, mesclado por outra thread. Revisor humano: Julio.
- **Próxima ação, responsável e prazo:** o dono revisa as frases novas em inglês da F3e; as três superfícies derivadas pendentes recebem trabalho próprio de geração e paridade. Responsável pela revisão: Julio; sem data definida nesta página.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-12 | Item criado em Desenvolvimento, com F1 a F3; F1 já mesclada (#113) | Decisão do dono sobre a prova de conceito #113 e o recibo `ensaio-2026-10-03-en.json` | Julio |
| 2026-10-12 | F2 dividida em F2a e F2b; a F2a leva o caminho da primeira experiência ao catálogo, com a cobertura medida | Thread `ork-rm061f2a` e o recibo `cobertura-f2a.json` | Fábrica, pelo pedido do dono |
| 2026-10-12 | A F2b leva `verify`, `ship`, `pulse`, `master`, `retry` e `roadmap status` ao catálogo, com a cobertura medida | Thread `ork-rm061f2b` e o recibo `cobertura-f2b.json` | Fábrica, pelo pedido do dono |
| 2026-10-12 | F3 dividida em F3a e F3b; a F3a leva os arquivos gerados à língua do dono, cria a referência do CLI em inglês e mede a cobertura | Thread `ork-rm061f3a` e o recibo `cobertura-f3a.json` | Fábrica, pelo pedido do dono |
| 2026-10-12 | A F3b leva ao catálogo o resto da lista do dono e instala as skills na língua do dono; os prompts, `decisao registrar` e `network roadmap` ficam para a F3c | Thread `ork-rm061f3b` e o recibo `cobertura-f3b.json` | Fábrica, pelo pedido do dono |
| 2026-10-15 | A F3c leva à língua do dono o `.orkastery/.gitignore`, `decisao registrar`, `network roadmap`, `thread new --from-finding` e os prompts de fase, com o fecho do GO em inglês depois do merge da `main`; os demais comandos, mods, tools do OpenClaw e marketplaces ficam para a F3d | Thread `ork-rm061f3c` e o recibo `cobertura-f3c.json` | Fábrica, pelo pedido do dono |
| 2026-10-20 | A F3d leva ao catálogo as famílias do CLI principal que seguiam fora da lista e as três lacunas da revisão da F3c; o GO-FIX 1 corrige as 15 falhas que a suíte inteira mostrou depois do merge da `main`; mods, tools do OpenClaw e marketplaces ficam pendentes | Thread `ork-rm061f3d` e o recibo `cobertura-f3d.json` | Fábrica, pelo pedido do dono |
| 2026-10-20 | O GO-FIX 2 da F3d lista o que segue em pt-BR com o CLI em inglês e cria a F3e para levar essa lista ao catálogo | CHECK independente da F3d (achado 2) e a lista de `core/src/locale.ts` conferida contra `core/src/index.ts` | Fábrica, pelo pedido do dono |
| 2026-10-27 | F3b, F3c e F3d em produção na 0.6.0; exposição Parcial, porque a F3e segue | Tag `v0.6.0`, com os merges `a6c70768`, `a95a4667` (#177) e `15351f3d` (#187) na tag; seção 0.6.0 do CHANGELOG, de 26/10/2026 | thread `ork-docsda060emp` (#Fast), pelo pedido do dono |
| 2026-10-29 | A F3e leva ao catálogo as rotas e resíduos listados pela F3d; `--json`, superfícies derivadas e `ork noctum` ficam fora | Thread `ork-rm061f3erota`, recibo `cobertura-f3e.json` e decisões D1-D3 do ledger | Agente em #Auto, pelo pedido do dono |
