---
id: RM-049
tipo: roadmap
titulo: Lançamento do Orkastery, com documentação no site, marketplaces e anúncio
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-09-28T16:08:06-03:00
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

# RM-049 — Lançamento do Orkastery, com documentação no site, marketplaces e anúncio

> **Em uma frase:** levar o Orkastery a quem constrói produto com agentes: documentação no site gerada do próprio repositório, plugin e skills nos marketplaces oficiais e um anúncio em inglês e português.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem constrói produto com agentes ainda não encontra o Orkastery; a documentação do site é escrita à mão, só em português, e pode divergir do repositório.
- **Evidências e fonte:** a [RM-046](RM-046-go-to-open-source.md) deixou no ar o repositório público, o pacote no npm e os sites; faltam os canais de chegada.
- **Objetivo/OKR:** quem chega pelo anúncio ou pelo marketplace instala e roda o primeiro ciclo em até 5 minutos.
- **Hipótese:** Se a documentação do site sair do mesmo docs-as-code do repositório, em inglês e português, e o plugin estiver nos marketplaces oficiais, então o caminho do anúncio ao primeiro ciclo não quebra, porque não existem duas versões da verdade.
- **Métrica principal / linha de base / meta / janela / fonte:** adoção (instalações do `@orkastery/cli` e primeiros ciclos); a meta fica com o dono.
- **Métricas de proteção:** nenhum dado pessoal ou interno publicado; a documentação do site nunca diverge da do repositório.

## Escopo e validação

- **Incluído:**
  1. documentação do orkastery.com gerada no build a partir de `docs/`, em inglês e português;
  2. plugin do Claude Code e skills do Codex nos marketplaces oficiais;
  3. textos do anúncio: ensaio em inglês para o Hacker News, thread no X e versão em português. Publicar é ato do dono.
- **Fora de escopo:** mudar o comportamento do produto.
- **Entregáveis e critérios de aceite:** a documentação do site bate com `docs/` na checagem do CI; o plugin e as skills aparecem nos marketplaces; os textos são aprovados pelo dono.
- **Piloto, medição e critérios de expansão/interrupção:** a definir no GOAL da thread.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** continuação da RM-046, por decisão do dono em 28/09/2026.
- **Horizonte / alvo / previsão / confiança / marcos:** a definir no GOAL.
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-046 (o domínio orkastery.com servindo o site).
- **Premissas / riscos / mitigação:** a aprovação nos marketplaces depende de terceiros; o item não trava por ela.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** escopo movido da RM-046 (Julio, 28/09/2026).

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

- **RACI (R / A / C / I):** R: agentes do Orkastery · A: Julio · C: — · I: —
- **Agentes envolvidos, atuação, autonomia e revisor humano:** execução por agente dentro do modo da thread; publicar e anunciar são atos do dono.
- **Próxima ação, responsável e prazo:** abrir a thread do item quando o dono priorizar.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-28 | proposto | escopo restante da RM-046 (H6 do dono) | Julio |
