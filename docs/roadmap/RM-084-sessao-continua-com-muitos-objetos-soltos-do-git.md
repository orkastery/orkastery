---
id: RM-084
tipo: roadmap
titulo: Sessão continua com muitos objetos soltos do Git
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-07T16:41:25-03:00
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

# RM-084: Sessão continua com muitos objetos soltos do Git

> **Em uma frase:** o núcleo empacota objetos soltos sem perda antes que a guarda de metadados interrompa a sessão, ou sinaliza a condição antes do despacho sem afrouxar a segurança.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz uma fase pode perder o andamento quando uma operação de Git do MCP recusa o repositório por excesso de objetos soltos, embora a correção segura exija uma operação que a sessão não pode executar.
- **Evidências e fonte:** em 07/11/2026, uma sessão de GO parou no meio porque `ork_git_status` encontrou mais entradas em `.git/objects` do que `arvoreMetadados` aceita. A recusa já orientava `git repack -d`, mas a sessão não tinha autorização para executar Git e a condução precisou intervir. O limite e a receita estão em `core/src/mcp-git.ts`.
- **Objetivo/OKR:** nenhuma sessão para por acúmulo de objetos soltos do Git.
- **Hipótese:** se o processo do núcleo detectar a aproximação do limite e executar a manutenção segura fora do sandbox da sessão, então a guarda pode permanecer estrita sem transferir a correção para o agente.
- **Métrica principal / linha de base / meta / janela / fonte:** sessões interrompidas por excesso de entradas em `.git/objects`. Linha de base: o incidente de 07/11/2026. Meta: zero. Janela: por fase. Fonte: recusas tipadas do MCP, `doctor` e status da thread.
- **Métricas de proteção:** nenhuma recusa de segurança de `arvoreMetadados` é removida ou relaxada; a manutenção não perde objetos; hooks, filtros e caminhos externos continuam sem execução.

## Escopo e validação

- **Incluído:**
  - detecção preventiva da quantidade de objetos soltos no `doctor`, no status da thread e antes de despachar uma fase que usará as operações Git do MCP;
  - manutenção pelo processo do núcleo, fora do sandbox da sessão, com `git repack -d` e lease do repositório;
  - nova execução da guarda `arvoreMetadados` sem alterar o limite, as recusas de link, o teto de profundidade ou a validação de caminhos;
  - quando a manutenção estiver ocupada ou indisponível, espera tipada e aviso antes do despacho, com próxima ação; a sessão já ativa não recebe como tarefa a execução de Git;
  - `ork_git_status` e as demais operações Git retomam depois da manutenção e preservam seus contratos de HEAD esperado;
  - paridade entre pt-BR e inglês em toda mensagem que tenha os dois idiomas.
- **Fora de escopo:** aumentar ou remover o limite de entradas, aceitar metadado inseguro, executar `git gc` destrutivo, alterar hooks ou filtros, ou conceder Git de shell à sessão.
- **Entregáveis e critérios de aceite:**
  - com muitos objetos soltos, o núcleo executa `git repack -d` fora do sandbox e `ork_git_status` conclui sem pedir Git à sessão;
  - os objetos permanecem legíveis depois do empacotamento e nenhum objeto alcançável é perdido;
  - se a manutenção não puder começar, `doctor` e status da thread avisam antes do limite e o despacho espera com causa tipada;
  - uma sessão em andamento não para para solicitar a receita de manutenção;
  - as mesmas fixtures de link simbólico, hard link fora do armazém, profundidade e caminho externo continuam recusadas;
  - um mutante que afrouxe cada recusa de segurança morre.
- **Piloto, medição e critérios de expansão/interrupção:** piloto em repositório temporário com objetos soltos acima da faixa preventiva; interromper se o empacotamento perder objeto, atravessar o lease ou reduzir a cobertura da guarda.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** prioridade a definir pelo dono; incidente de condução em 07/11/2026.
- **Horizonte / alvo / previsão / confiança / marcos:** a definir pelo dono; primeiro o aviso preventivo, depois a manutenção automática fora do sandbox e a retomada das operações MCP.
- **Dependências e bloqueios (ID, owner, próxima revisão):** `core/src/mcp-git.ts`, `doctor`, status da thread e leases de repositório; owner: Julio; próxima revisão no planejamento da fatia.
- **Premissas / riscos / mitigação:** empacotamento concorrente com outra operação Git pode disputar metadados; mitigação: lease do repositório e revalidação completa depois da manutenção. Aviso tardio ainda interrompe a fase; mitigação: sondar antes do despacho e no status.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  1. Aumentar o limite de `arvoreMetadados`: adia o incidente e enfraquece a fronteira.
  2. Pedir que a sessão execute Git: contradiz o perfil e para a fase.
  3. Manutenção segura pelo núcleo, com aviso preventivo e guarda inalterada (recomendada).

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-11-07 | Julio |
| Documentação | Rascunho | — | 2026-11-07 | Julio |
| Código | Não iniciado | — | 2026-11-07 | Julio |
| Testes | Não iniciados | — | 2026-11-07 | Julio |
| Deploy | Não implantado | — | 2026-11-07 | Julio |
| Exposição | Flag desligada | — | 2026-11-07 | Julio |
| Habilitação | Pendente | — | 2026-11-07 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão condutora da thread que pegar o item; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela condução a pedido do builder; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** o dono define a prioridade e a condução planeja a manutenção preventiva sem alterar a guarda.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-07 | Item criado em Discovery | `ork_git_status` recusou o excesso de entradas em `.git/objects` e a sessão não podia executar a receita segura | Builder (pedido de 07/11/2026) |
