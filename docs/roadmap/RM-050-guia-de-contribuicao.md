---
id: RM-050
tipo: roadmap
titulo: Guia de contribuição nos repositórios e nos sites
categoria: melhoria
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-01T02:24:38-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: 3c7e8a7
    pr: 22
    orkmind: "orkastery/orkmind PR #6, merge c78a7f3"
  testes:
    ci: "verde no push do merge (run 36564117438), no da v0.5.0 (run 36815186450) e no PR #6 do OrkMind (run 36583041988)"
  deploy:
    release: v0.5.0; guias na main dos dois repositórios
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
| Em desenvolvimento | Mesclado | Aprovados | Produção | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** pessoas convidadas a colaborar (os primeiros convites saíram em 28/09/2026) e quem chega pelos repositórios públicos. Hoje cada repositório tem um `CONTRIBUTING.md` único e longo, com dado que envelhece (o do Orkastery fixa uma contagem de testes), e nenhum dos dois sites tem página de contribuição.
- **Evidências e fonte:** pedido direto do dono em 28/09/2026. Não há PR externo até esta data, então não há linha de base de tempo até o primeiro PR verde.
- **Objetivo/OKR:** a primeira contribuição sai sem perguntar nada ao mantenedor.
- **Hipótese:** se o guia for dividido por tarefa (começar, desenvolver, testar, documentar, abrir PR, publicar) e existir nos dois repositórios e nos dois sites, então o primeiro PR de quem chega passa no CI já na primeira execução, porque o caminho e a prova esperada estão escritos antes.
- **Métrica principal / linha de base / meta / janela / fonte:** PRs externos cujo CI passa na primeira execução / sem medição (zero PRs externos em 28/09/2026) / 80% / 60 dias depois da publicação / checks do GitHub.
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
- **Piloto, medição e critérios de expansão/interrupção:** piloto com os colaboradores já convidados; o item fecha quando dois PRs externos passarem pelo guia sem ajuda do mantenedor.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** proposta 13 na fila da comunidade; o dono pediu "em algum momento" em 28/09/2026. Sobe se os convites a colaboradores aumentarem.
- **Horizonte / alvo / previsão / confiança / marcos:** outubro de 2026 / confiança média / guia no Orkastery → guia no OrkMind → página nos dois sites.
- **Dependências e bloqueios (ID, owner, próxima revisão):** catálogo de docs dos sites mesclado (thread `ork-docsdossites`); [RM-044](RM-044-documentacao-como-codigo.md) para a paridade; [RM-049](RM-049-lancamento.md) se beneficia deste item.
- **Premissas / riscos / mitigação:** o guia envelhece rápido → cada página cita comandos em vez de números, e o build dos sites reprova quando a fonte muda sem revisão.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** decisões autônomas da thread `ork-rm050guiadec` em 28/09/2026, no ledger da thread, a ratificar pelo dono:
  - guias em `docs/guias/contribuir/`, com o `CONTRIBUTING.md` como índice;
  - guias em pt-BR, como todo `docs/`; o índice mantém a nota em inglês;
  - rótulos com os nomes padrão do GitHub, e `needs triage` como o único novo;
  - primeira resposta em até 7 dias, a mesma meta do `SECURITY.md`;
  - a checagem dos comandos dos guias entra como claim da thread e teste da suíte, sem passo novo no CI.

## Estado com evidências

- Parte do repositório do Orkastery (itens 1, 2, 4 e 5), na thread `ork-rm050guiadec`: índice no `CONTRIBUTING.md`, nove guias em `docs/guias/contribuir/`, modelos de issue e de PR e a checagem `core/scripts/checar-comandos-dos-guias.cjs`. Na `main` pelo PR #22 (merge `3c7e8a7`), com o CI verde no push do merge (run 36564117438), e na versão 0.5.0 (tag `v0.5.0`, merge `2418a4e`, PR #36).
- Guia do OrkMind: entregue pela thread `ork-rm050guiade2` no `orkastery/orkmind`, pelo PR #6 ("Guia de contribuição por tarefa", merge `c78a7f3`, estado MERGED no GitHub), com o CI do OrkMind verde (run 36583041988).
- Página "Contribuir" (item 3) no ar nos dois sites, em PT, EN e ES, desde 29/09/2026, pela thread `ork-siteshomesco`: <https://orkastery.com/docs/contribuir/> (`orkastery/orkastery.com` PR #6, merge `e29d05e`) e <https://orkmind.com/docs/contribuir/> (`orkastery/orkmind.com` commit `5adde94`). As versões em inglês e espanhol ficam em `/en/docs/contribuir/` e `/es/docs/contribuir/`.
- O rótulo `needs triage` ainda não existe em nenhum dos dois repositórios (`gh label list`).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-01 | Julio |
| Documentação | Em revisão | — | 2026-10-01 | Julio |
| Código | Mesclado | commit `3c7e8a7` · PR #22 · orkmind: orkastery/orkmind PR #6, merge c78a7f3 | 2026-10-01 | Julio |
| Testes | Aprovados | ci: verde no push do merge (run 36564117438), no da v0.5.0 (run 36815186450) e no PR #6 do OrkMind (run 36583041988) | 2026-10-01 | Julio |
| Deploy | Produção | release: v0.5.0; guias na main dos dois repositórios | 2026-10-01 | Julio |
| Exposição | Flag desligada | — | 2026-10-01 | Julio |
| Habilitação | Pendente | — | 2026-10-01 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** executor da thread / Julio / colaboradores convidados / comunidade.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** executor da thread `ork-rm050guiadec` em #Auto; o merge, a criação dos rótulos e a decisão final ficam com Julio.
- **Próxima ação, responsável e prazo:** criação do rótulo `needs triage` nos dois repositórios; condução. Os merges do PR #22, do guia do OrkMind (`orkastery/orkmind` #6) e da página "Contribuir" nos dois sites já aconteceram.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-28 | Item criado | Pedido do dono em 28/09/2026 | Julio |
| 2026-09-28 | Parte do repositório do Orkastery em PR | Thread `ork-rm050guiadec` (#Auto), itens 1, 2, 4 e 5; sites e OrkMind em outra thread | Julio |
| 2026-09-29 | Parte do repositório do Orkastery mesclada na `main` | PR #22, merge `3c7e8a7` | Julio |
| 2026-09-29 | Guia do OrkMind mesclado | `orkastery/orkmind` PR #6, merge `c78a7f3`; thread `ork-rm050guiade2` | Julio |
| 2026-10-01 | Parte do Orkastery na versão 0.5.0 | tag `v0.5.0` (PR #36) | Julio |
| 2026-10-03 | o texto registra a página "Contribuir" no ar nos dois sites | `curl` 200 em `orkastery.com/docs/contribuir/` e `orkmind.com/docs/contribuir/` (PT, EN e ES); `orkastery.com` PR #6 (`e29d05e`), `orkmind.com` `5adde94`; thread `ork-b3fatosdoroa`, item B3 | Claude (agente, #Auto), revisão de Julio pendente |
