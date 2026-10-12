---
id: RM-061
tipo: roadmap
titulo: CLI em inglês e pt-BR
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-12T09:00:00-03:00
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
  - corpo do PR [#113](https://github.com/orkastery/orkastery/pull/113), com a prova de conceito e a contagem do custo (feita antes do merge): cerca de 3.240 literais de texto de pessoa em posição de saída, em 159 arquivos de `core/src`, e a ajuda do `ork` com 357 linhas. A prova cobre 92 entradas do catálogo (68 mensagens e 24 nomes de check), cerca de 3%. As contagens são medidas do #113, feitas pela árvore sintática do TypeScript; o contador ainda não está no repositório, e a F2 o leva para lá (veja a métrica principal).
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

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: fábrica Orkastery nas fatias; A: Julio; C: revisão humana do inglês; I: quem usa o CLI em inglês.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** agente Claude Code redigiu esta página em #Fast, restrita à documentação. O código da F1 vem do #113, mesclado por outra thread. Revisor humano: Julio.
- **Próxima ação, responsável e prazo:** abrir a F2 (onboarding, `thread new`, `phase list` e a ajuda primeiro) e fechar o EN5; responsável: fábrica; sem data definida nesta página.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-12 | Item criado em Desenvolvimento, com F1 a F3; F1 já mesclada (#113) | Decisão do dono sobre a prova de conceito #113 e o recibo `ensaio-2026-10-03-en.json` | Julio |
