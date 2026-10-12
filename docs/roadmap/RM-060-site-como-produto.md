---
id: RM-060
tipo: roadmap
titulo: "Site como produto: os dois sites públicos com o mesmo rigor do núcleo"
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-12T00:07:23-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Branch criada
  testes: Não iniciados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: ork-rm059erm060p
  modo: "#Fast"
  fase: GO
  status: aberta
---

# RM-060: Site como produto

> **Em uma frase:** tratar os dois sites públicos, o do Orkastery e o do OrkMind, como produto, com o mesmo rigor do núcleo: código sempre inteiro, docs na versão certa, checagens no PR e publicação só com a aprovação do dono.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Item recém-aberto.** As fatias F1 e F2 já têm PR aberto no repositório do site, à espera da aprovação do dono. As demais ainda não começaram. Nada vai ao domínio sem essa aprovação.

## Problema e resultado

- **Público e problema:** quem chega de fora e vê o site primeiro. O site é a vitrine e a porta de instalação; quando fica atrás do código (docs de uma versão, home de outra), quem chega vê um produto inconsistente. Código citado no site precisa sair sempre formatado e inteiro: um bloco que quebra no meio, perde a borda ou o sublinhado, ou muda de escala conforme a tela faz o leitor desconfiar do resto.
- **Evidências e fonte:** hoje os PRs dos sites não têm checagem automática (ver F5), então código quebrado ou versão defasada só aparece na revisão manual.
- **Objetivo:** cada versão do núcleo atualiza docs e site; mudança no site entra por PR com checagens (build, testes do renderizador, checagem visual e checagem de conteúdo público); a publicação no domínio é do dono, por promoção de tag.
- **Hipótese:** se o site passar pelo mesmo caminho do núcleo (PR, CI, prévia, aprovação), então docs e home deixam de divergir da versão publicada, porque a divergência vira falha de build em vez de achado de quem chega.
- **Métrica principal:** divergência entre a versão do núcleo e a versão citada em docs e home, medida no build do site (meta: zero). Linha de base ainda não medida.
- **Métricas de proteção:** nenhum PR de site mergeado e nada publicado no domínio sem a aprovação do dono; nenhum dado interno, caminho de máquina ou segredo no conteúdo público.

## Escopo e validação

**Incluído:** os repositórios dos dois sites públicos (Orkastery e OrkMind): renderizador de docs, home, quickstart, CI e prévia de PR.

**Fora de escopo:** a decisão de quando publicar (é do dono); a documentação do núcleo em si, que segue a [RM-044](RM-044-documentacao-como-codigo.md); o anúncio e os marketplaces, que seguem a [RM-049](RM-049-lancamento.md).

### Fatias

| Fatia | Resultado | Estado |
| --- | --- | --- |
| F1 | Código como unidade que não quebra; guardas visuais de escala, borda e sublinhado; frases de impacto com a identidade de fábrica de software com IA | PR do site já aberto, à espera da aprovação do dono |
| F2 | Quickstart até a primeira thread #Fast fechada, nas docs do site | PR já aberto, à espera da aprovação do dono |
| F3 | A mesma regra de código formatado no site do OrkMind, antes do lançamento dele | Não iniciada |
| F4 | Docs e home atualizados a cada versão do núcleo, inclusive a condução dentro do Claude Code ([RM-059](RM-059-conducao-dentro-do-claude-code.md)), com o número da versão conferido no build | Não iniciada |
| F5 | CI nos repositórios dos sites (hoje os PRs dos sites não têm checagem automática) | Não iniciada |
| F6 | Prévia de cada PR para o dono aprovar antes do merge e da promoção | Não iniciada |

Sequência proposta: F1 e F2 já estão em revisão e seguem como estão. F3 reaproveita a regra de F1. F4 confere a versão no build, o que se apoia em F5. F6 completa o caminho de aprovação.

### Regra de aprovação

Nenhum PR de site é mergeado e nada vai ao domínio sem a aprovação do dono. Uma prévia verde ou um CI verde não substitui essa aprovação: a promoção por tag é ato do dono.

### Validação

Cada fatia de site valida, no repositório do site, com o build, os testes do renderizador, a checagem visual e a checagem de conteúdo público (sem caminho de máquina, e-mail pessoal ou nome de cliente). Esta página, na etapa documental, valida com `node core/dist/index.js docs verificar` e markdownlint; isso confere a documentação do roadmap, não os sites.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** prioridade definida pelo dono; sem pontuação numérica inventada.
- **Horizonte / alvo / previsão / confiança / marcos:** sem previsão. Marcos: F1 e F2 aprovados pelo dono; F5 e F6 prontos; F3 antes do lançamento do OrkMind; F4 a cada versão do núcleo.
- **Dependências e bloqueios:** [RM-049](RM-049-lancamento.md) (lançamento e documentação no site), [RM-050](RM-050-guia-de-contribuicao.md) (guia de contribuição nos sites) e [RM-044](RM-044-documentacao-como-codigo.md) (paridade da documentação). Bloqueio atual: aprovação do dono nos PRs de F1 e F2.
- **Premissas / riscos / mitigação:**
  - Risco: o site divergir do núcleo entre versões. Mitigação: F4 confere o número da versão no build.
  - Risco: conteúdo interno vazar para o site público. Mitigação: checagem de conteúdo público no CI (F5).
  - Risco: mudança visual passar sem ninguém ver. Mitigação: checagem visual (F1) e prévia por PR (F6).
- **Decisões, alternativas e ADRs:** o dono decidiu que os dois sites passam a ser tratados como produto. A regra de aprovação acima é decisão do dono.

### Relação com outros itens

- **[RM-049](RM-049-lancamento.md):** o lançamento entrega a primeira documentação no site; este item mantém o site fiel a cada versão depois dele.
- **[RM-050](RM-050-guia-de-contribuicao.md):** o guia de contribuição nos sites passa pelo mesmo caminho de PR, CI e aprovação.
- **[RM-044](RM-044-documentacao-como-codigo.md):** a paridade da documentação no repositório é a base; F4 estende a conferência ao site.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-12 | Julio |
| Documentação | Em revisão | — | 2026-10-12 | Julio |
| Código | Branch criada | — | 2026-10-12 | Julio |
| Testes | Não iniciados | — | 2026-10-12 | Julio |
| Deploy | Não implantado | — | 2026-10-12 | Julio |
| Exposição | Flag desligada | — | 2026-10-12 | Julio |
| Habilitação | Pendente | — | 2026-10-12 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: fábrica Orkastery, em PR no repositório do site; A: Julio; C: revisores independentes designados por fatia; I: dono pelo canal autorizado.
- **Agentes envolvidos, atuação e autonomia:** a fábrica abre os PRs dos sites; a aprovação, o merge e a promoção ao domínio são do dono. Esta página foi aberta pela thread `ork-rm059erm060p` em #Fast, só documentação.
- **Próxima ação, responsável e prazo:** Julio aprova ou devolve os PRs de F1 e F2; a fábrica abre a F5 em seguida; sem data definida.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-11 | Os dois sites passam a ser tratados como produto | Decisão do dono sobre o roadmap | Julio |
| 2026-10-12 | Página aberta em Em desenvolvimento, código Em andamento | Thread `ork-rm059erm060p` | Fábrica propõe; Julio decide |
