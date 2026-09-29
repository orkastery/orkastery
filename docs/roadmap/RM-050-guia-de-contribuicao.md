---
id: RM-050
tipo: roadmap
titulo: Guia de contribuição nos repositórios e nos sites
categoria: melhoria
pai: null
features: []
owner: Julio
atualizado_em: 2026-09-28T23:50:00-03:00
estado:
  ciclo: Discovery
  documentacao: Rascunho
  codigo: Não iniciado
  testes: Não iniciados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: null
  modo: null
---

# RM-050 — Guia de contribuição nos repositórios e nos sites

> **Em uma frase:** quem chega ao Orkastery ou ao OrkMind encontra, no GitHub e no site, um caminho curto para contribuir: o que vale a pena, como preparar o ambiente, como provar a mudança e como o PR é revisado.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

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
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** nenhuma ainda.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-09-28 | Julio |
| Documentação | Rascunho | — | 2026-09-28 | Julio |
| Código | Não iniciado | — | 2026-09-28 | Julio |
| Testes | Não iniciados | — | 2026-09-28 | Julio |
| Deploy | Não implantado | — | 2026-09-28 | Julio |
| Exposição | Flag desligada | — | 2026-09-28 | Julio |
| Habilitação | Pendente | — | 2026-09-28 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** executor da thread / Julio / colaboradores convidados / comunidade.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a definir quando a thread abrir.
- **Próxima ação, responsável e prazo:** abrir a thread quando houver vaga na fila; condução.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-28 | Item criado | Pedido do dono em 28/09/2026 | Julio |
