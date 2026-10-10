---
id: RM-050
tipo: roadmap
titulo: Guia de contribuição nos repositórios e nos sites
categoria: melhoria
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-10T03:45:24-03:00
estado:
  ciclo: Piloto
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Geral
  habilitacao: Em andamento
evidencias:
  codigo:
    commit: 3c7e8a7
    pr: 22
    orkmind: "orkastery/orkmind PR #6, merge c78a7f3"
  testes:
    ci: "verde no push do merge (run 36564117438), no da v0.5.0 (run 36815186450) e no PR #6 do OrkMind (run 36583041988)"
  deploy:
    release: v0.5.0; guias na main dos dois repositórios
  habilitacao:
    rotulos: needs triage nos dois repositórios; criação confirmada pela condução em 2026-10-03; piloto externo pendente
    piloto: zero PRs de fora nos dois repositórios em 2026-10-10 (node core/scripts/medir-piloto-de-contribuicao.cjs)
sdlc:
  thread: ork-rm050guiadec
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-050 — Guia de contribuição nos repositórios e nos sites

> **Em uma frase:** quem chega ao Orkastery ou ao OrkMind encontra, no GitHub e no site, um caminho curto para contribuir: o que vale a pena, como preparar o ambiente, como provar a mudança e como o PR é revisado.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Piloto | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** pessoas convidadas a colaborar (os primeiros convites saíram em 28/09/2026) e quem chega pelos repositórios públicos. Hoje cada repositório tem um `CONTRIBUTING.md` único e longo, com dado que envelhece (o do Orkastery fixa uma contagem de testes), e nenhum dos dois sites tem página de contribuição.
- **Evidências e fonte:** pedido direto do dono em 28/09/2026. Não há PR externo até esta data, então não há linha de base de tempo até o primeiro PR verde.
- **Objetivo/OKR:** a primeira contribuição sai sem perguntar nada ao mantenedor.
- **Hipótese:** se o guia for dividido por tarefa (começar, desenvolver, testar, documentar, abrir PR, publicar) e existir nos dois repositórios e nos dois sites, então o primeiro PR de quem chega passa no CI já na primeira execução, porque o caminho e a prova esperada estão escritos antes.
- **Métrica principal / linha de base / meta / janela / fonte:** PRs externos cujo CI passa na primeira execução / sem medida (zero PRs externos em 28/09/2026 e em 10/10/2026) / 80% / 60 dias depois da publicação / checks do GitHub, medidos por `node core/scripts/medir-piloto-de-contribuicao.cjs`.
- **Métricas de proteção:** o guia não promete o que o CI não confere; nenhum dado privado, pessoal ou meta interna; paridade PT/EN nos repositórios e PT/EN/ES nos sites.

## Escopo e validação

- **Incluído:**
  1. **Índice curto em cada repositório** (`CONTRIBUTING.md`) apontando para uma pasta com um guia por tarefa:
     - o que contribuir: quando abrir discussão antes (feature nova), issue (defeito) ou PR direto (docs, correção pequena);
     - desenvolvimento local: requisitos, build e como rodar o CLI ou o pacote a partir do checkout;
     - testes: suíte, canários e `ork verify`, e como separar falha anterior de regressão;
     - documentação: onde cada tipo de doc mora, padrão de escrita, paridade de idioma e como o site importa o texto;
     - pull request: título, descrição, evidência esperada, checks obrigatórios e identidade dos commits;
     - lint e estilo;
     - triagem: rótulos, primeira issue e prazo de resposta;
     - versões e publicação: quem publica, canais (npm e PyPI) e changelog.
  2. **Contribuir com o próprio ork:** abrir uma thread, registrar claims e anexar o verify no PR, como caminho recomendado e não obrigatório.
  3. **Página "Contribuir" nos dois sites**, em PT/EN/ES, alimentada pelo catálogo de fontes dos sites a partir do guia do repositório, sem cópia manual.
  4. **Rótulos e modelos no GitHub** (primeira issue, documentação; modelos de issue e de PR) alinhados ao guia, nos dois repositórios.
  5. **Fim do dado que envelhece:** o guia cita o comando, não o número de testes.
- **Fora de escopo:** CLA, programa de embaixadores, patrocínio e tradução do código.
- **Entregáveis e critérios de aceite:**
  - guia nos dois repositórios → `ork docs verificar` verde e links internos válidos;
  - página nos dois sites → build com os auditores verdes (links, idiomas, conteúdo público);
  - teste de fumaça: uma pessoa de fora segue só o guia, do clone ao PR verde, e o tempo fica registrado.
- **Piloto, medição e critérios de expansão/interrupção:** piloto com os colaboradores já convidados; o item fecha quando dois PRs externos passarem pelo guia sem ajuda do mantenedor. A medida sai de `node core/scripts/medir-piloto-de-contribuicao.cjs` (rede e `gh` autenticado): os PRs de fora, a conclusão da primeira execução do CI de cada um e o critério de fechamento, com as regras no guia de [triagem](../guias/contribuir/triagem.md#medir-os-prs-de-fora).

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** proposta 13 na fila da comunidade; o dono pediu "em algum momento" em 28/09/2026. Sobe se os convites a colaboradores aumentarem.
- **Horizonte / alvo / previsão / confiança / marcos:** outubro de 2026 / confiança média / guia no Orkastery → guia no OrkMind → página nos dois sites.
- **Dependências e bloqueios (ID, owner, próxima revisão):** catálogo de docs dos sites mesclado (thread `ork-docsdossites`); [RM-044](RM-044-documentacao-como-codigo.md) para a paridade; [RM-049](RM-049-lancamento.md) se beneficia deste item.
- **Premissas / riscos / mitigação:** o guia envelhece rápido → cada página cita comandos em vez de números. O build do site confere só o snapshot de fontes; a fonte mudada aqui aparece lá com `npm run docs:check -- --source <clone>`, e daqui `node core/scripts/checar-fontes-do-site.cjs` diz que página revisar.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** decisões autônomas da thread `ork-rm050guiadec` em 28/09/2026, no ledger da thread, a ratificar pelo dono:
  - guias em `docs/guias/contribuir/`, com o `CONTRIBUTING.md` como índice;
  - guias em pt-BR, como todo `docs/`; o índice mantém a nota em inglês;
  - rótulos com os nomes padrão do GitHub, e `needs triage` como o único novo;
  - primeira resposta em até 7 dias, a mesma meta do `SECURITY.md`;
  - a checagem dos comandos dos guias entra como claim da thread e teste da suíte, sem passo novo no CI.
- **Decisões da rodada de 10/10/2026:** autônomas da thread `ork-rm050guia3`, D1 a D8 no ledger da thread, a ratificar pelo dono:
  - escopo só neste repositório; a revisão da página nos sites e o guia do OrkMind ficam como próxima ação;
  - PR de fora é o de autor que não é dono nem membro da organização, nem bot; convidado com acesso de escrita conta;
  - a primeira execução é o primeiro run do CI sobre um commit do PR; liberar o CI do fork não conta, e reexecutar até passar não vira verde;
  - sem ajuda quer dizer nenhum commit de outra pessoa nem commit sem login do GitHub; ajuda em comentário o mantenedor confere;
  - os dois comandos não entram no CI e a suíte os testa sem rede.

## Estado com evidências

- Parte do repositório do Orkastery (itens 1, 2, 4 e 5), na thread `ork-rm050guiadec`: índice no `CONTRIBUTING.md`, nove guias em `docs/guias/contribuir/`, modelos de issue e de PR e a checagem `core/scripts/checar-comandos-dos-guias.cjs`. Na `main` pelo PR #22 (merge `3c7e8a7`), com o CI verde no push do merge (run 36564117438), e na versão 0.5.0 (tag `v0.5.0`, merge `2418a4e`, PR #36).
- Guia do OrkMind: entregue pela thread `ork-rm050guiade2` no `orkastery/orkmind`, pelo PR #6 ("Guia de contribuição por tarefa", merge `c78a7f3`, estado MERGED no GitHub), com o CI do OrkMind verde (run 36583041988).
- Página "Contribuir" (item 3) no ar nos dois sites, em PT, EN e ES, desde 29/09/2026, pela thread `ork-siteshomesco`: <https://orkastery.com/docs/contribuir/> (`orkastery/orkastery.com` PR #6, merge `e29d05e`) e <https://orkmind.com/docs/contribuir/> (`orkastery/orkmind.com` commit `5adde94`). As versões em inglês e espanhol ficam em `/en/docs/contribuir/` e `/es/docs/contribuir/`.
- O rótulo `needs triage`, já usado pelos modelos de issue, existe nos dois repositórios. A condução confirmou a criação em 03/10/2026; é configuração do GitHub, sem commit de produto. Os modelos do Orkastery vieram no PR #22 (`3c7e8a7`). Consulta reproduzível: `gh label list --repo orkastery/orkastery --search "needs triage"` e `gh label list --repo orkastery/orkmind --search "needs triage"`.
- Rodada de 10/10/2026, thread `ork-rm050guia3`: `gh label list` mostra nos dois repositórios os 11 rótulos da tabela de [triagem](../guias/contribuir/triagem.md), com `needs triage`; o Discussions tem as categorias `ideas` e `q-a` que os modelos citam; os checks obrigatórios da `main` são os quatro do `CONTRIBUTING.md`. O guia de [documentação](../guias/contribuir/documentacao.md#como-o-site-usa-este-texto) passou a descrever o catálogo dos dois sites, e a triagem ganhou a medida do piloto.
- A página `contribuir` do orkastery.com está atrás da fonte: o snapshot do site (`src/data/docs-sources.json`, revisado em 03/10) é anterior ao caminho curto em inglês do `CONTRIBUTING.md` (commit `1b212e36`, 03/10) e aos guias desta rodada. O build do site não acusa, porque sem `--source` confere só o snapshot. Consulta reproduzível: `gh api repos/orkastery/orkastery.com/contents/src/data/docs-sources.json -H 'Accept: application/vnd.github.raw' | node core/scripts/checar-fontes-do-site.cjs --snapshot -`.
- Piloto: em 10/10/2026, `node core/scripts/medir-piloto-de-contribuicao.cjs` não acha PR de fora nos dois repositórios desde 29/09. A taxa segue sem medida, e o fechamento está em 0 de 2. O ensaio da medida sobre PRs do mantenedor (`--tratar-como-externo`) bate com o GitHub: o #117 sai reprovado na primeira execução (run 37127788195), o #118 verde (run 37132186392) e o #87 reprovado na tentativa 1 do run 37106955227, hoje verde na tentativa 2.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-10-10 | Julio |
| Documentação | Em revisão | — | 2026-10-10 | Julio |
| Código | Mesclado | commit `3c7e8a7` · PR #22 · orkmind: orkastery/orkmind PR #6, merge c78a7f3 | 2026-10-10 | Julio |
| Testes | Aprovados | ci: verde no push do merge (run 36564117438), no da v0.5.0 (run 36815186450) e no PR #6 do OrkMind (run 36583041988) | 2026-10-10 | Julio |
| Deploy | Produção | release: v0.5.0; guias na main dos dois repositórios | 2026-10-10 | Julio |
| Exposição | Geral | — | 2026-10-10 | Julio |
| Habilitação | Em andamento | rotulos: needs triage nos dois repositórios; criação confirmada pela condução em 2026-10-03; piloto externo pendente · piloto: zero PRs de fora nos dois repositórios em 2026-10-10 (node core/scripts/medir-piloto-de-contribuicao.cjs) | 2026-10-10 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** executor da thread / Julio / colaboradores convidados / comunidade.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** executores das threads `ork-rm050guiadec` e `ork-rm050guia3` em #Auto; o merge, a criação dos rótulos e a decisão final ficam com Julio.
- **Próxima ação e responsável:** no repositório do orkastery.com, revisar a página `contribuir` (e as outras que o `checar-fontes-do-site.cjs` lista) em PT, EN e ES, a partir de `npm run docs:sync -- --source <clone>`, e publicar. Depois, acompanhar o piloto com `node core/scripts/medir-piloto-de-contribuicao.cjs` e registrar o teste de fumaça de uma pessoa de fora, do clone ao PR verde. O mantenedor confere o critério de dois PRs externos e a ajuda em comentário.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-28 | Item criado | Pedido do dono em 28/09/2026 | Julio |
| 2026-09-28 | Parte do repositório do Orkastery em PR | Thread `ork-rm050guiadec` (#Auto), itens 1, 2, 4 e 5; sites e OrkMind em outra thread | Julio |
| 2026-09-29 | Parte do repositório do Orkastery mesclada na `main` | PR #22, merge `3c7e8a7` | Julio |
| 2026-09-29 | Guia do OrkMind mesclado | `orkastery/orkmind` PR #6, merge `c78a7f3`; thread `ork-rm050guiade2` | Julio |
| 2026-10-01 | Parte do Orkastery na versão 0.5.0 | tag `v0.5.0` (PR #36) | Julio |
| 2026-10-03 | o texto registra a página "Contribuir" no ar nos dois sites | `curl` 200 em `orkastery.com/docs/contribuir/` e `orkmind.com/docs/contribuir/` (PT, EN e ES); `orkastery.com` PR #6 (`e29d05e`), `orkmind.com` `5adde94`; thread `ork-b3fatosdoroa`, item B3 | Claude (agente, #Auto), revisão de Julio pendente |
| 2026-10-03 | Rótulo needs triage criado nos dois repositórios; item em piloto, com exposição geral | Confirmação da condução; modelos no PR #22 (`3c7e8a7`) e guia do OrkMind no PR #6 (`c78a7f3`); falta medir os dois PRs externos do critério de aceite | Codex (agente, #Fast), revisão pendente |
| 2026-10-10 | Guia de documentação com o catálogo dos dois sites; comandos para ver que página do site revisar e para medir o piloto | Thread `ork-rm050guia3` (#Auto), decisões D1 a D8 no ledger da thread; medida de 10/10: zero PRs de fora; página `contribuir` do orkastery.com atrás da fonte desde `1b212e36` | Claude (agente, #Auto), revisão de Julio pendente |
