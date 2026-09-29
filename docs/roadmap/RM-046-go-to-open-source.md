---
id: RM-046
tipo: roadmap
titulo: GoToOpenSource, o Orkastery aberto, seguro e fácil de adotar
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-09-28T21:09:17-03:00
estado:
  ciclo: Concluído
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Geral
  habilitacao: Concluída
evidencias:
  codigo:
    commit: 10ca416
    pr: null
sdlc:
  thread: ork-gotoopensour
  modo: "#Fast"
  fase: GO
  status: fechada
---

# RM-046 — GoToOpenSource, o Orkastery aberto, seguro e fácil de adotar

> **Em uma frase:** abrir o repositório e o site sem vazar nada, com uma promessa clara, instalação em um comando e documentação que leva quem chega ao primeiro ciclo em até 5 minutos.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** Não aplicável — iniciativa transversal de distribuição e documentação
- **Threads:** `ork-i48opensourc` (fase 1, narrativa e documentação) e `ork-gotoopensour` (decisões de 27/09/2026 aplicadas)

## Problema e resultado

- **Problema:** o repositório e o site são privados, e o npm distribui a versão 0.2.0 de 05/09/2026, anterior à I-41, à I-43 e à I-44: quem instala hoje recebe modos aposentados e não recebe o `#Fast`.
- **Objetivo:** o Orkastery público, seguro e adotável.
- **Evidências (26/09/2026):** os projetos de agentes que se espalharam no GitHub têm em comum promessa clara, instalação em um comando e um canal de lançamento; o tamanho do README e a comunidade não explicam a adoção.
- **Hipótese:** Se o Orkastery se diferenciar pelo mecanismo que só ele tem (re-executar cada afirmação do agente no HEAD real e num runner independente), então ele vira categoria própria em vez de mais um pacote de skills, porque os pacotes de skills não provam o que o agente diz.
- **Métrica principal:** adoção (instalações do `@orkastery/cli` e contribuições no repositório público); a meta fica com o dono.
- **Métricas de proteção:** zero segredo ou dado pessoal publicado; tempo até o primeiro valor abaixo de 5 minutos; issues com diagnóstico anexado.
- **Linha de base:** repositório privado e `@orkastery/cli` 0.2.0 no npm.

## Escopo e validação

- **Fase 0, segurança (bloqueante):** varredura de segredos e dados pessoais na árvore e em todo o histórico; decisão entre reescrever o histórico e publicar a partir de um histórico novo; retirar do repositório público o que é artefato interno (handoffs, planos, estado das threads, tags de preservação).
- **Fase 1, narrativa e documentação:** README canônico em inglês com seletor pt-BR; descrição e tópicos do GitHub alinhados ao produto atual; documentação organizada por tipo (começar, guias, referência, conceitos); zero texto informal, marca de autoria de LLM ou afirmação de ambiente específico; paridade cobrada por `ork docs verificar` e markdownlint.
- **Fase 2, distribuição:** release 0.3.0 no npm com CHANGELOG e GitHub Releases; instalação em um comando; plugin do Claude Code e skills do Codex nos marketplaces oficiais; um modo de demonstração que mostra uma afirmação falsa sendo reprovada.
- **Fase 3, página do projeto:** site no GitHub Pages com o domínio `orkastery.com`, hero com as seis fases e uma gravação de terminal, três pilares ("verificado, não relatado", "o humano decide só o que importa", "não para") e documentação gerada do próprio docs-as-code, em inglês e português.
- **Fase 4, comunidade e lançamento:** CONTRIBUTING, SECURITY, código de conduta, formulários de issue, Discussions, proteção da `main` (gratuita em repositório público, fecha a [RM-012](RM-012-ci-check-independente.md)); ensaio em inglês para o Hacker News, thread no X e versão em português.
- **Movido para a [RM-049](RM-049-lancamento.md) em 28/09/2026 (decisão do dono):** a documentação do site gerada do próprio docs-as-code em inglês e português, o plugin e as skills nos marketplaces oficiais, e o lançamento (Hacker News, X e a versão em português).
- **Fora de escopo:** mudar o comportamento do produto; o que muda é o que ele mostra e como se instala.
- **Critério de aceite:** repositório e site públicos sem nenhum achado bloqueante da varredura; `npx @orkastery/cli` instala a versão atual; um visitante entende a promessa e roda o primeiro ciclo em até 5 minutos.

## Plano e decisões

- **Prioridade:** a mais alta do roadmap (proposta de 26/09/2026, a confirmar com Julio): destrava adoção, contribuidores e a proteção da `main`.
- **Dependências:** [RM-042](RM-042-modo-fast.md) para a release 0.3.0 já trazer o `#Fast`; Trusted Publishing do pacote configurado pelo dono no npm; acesso do dono ao DNS de `orkastery.com`.
- **Decisões de Julio (27/09/2026, no Telegram):**
  - repositório novo com histórico limpo, e o atual vira arquivo privado;
  - a credencial do ambiente local que aparecia no histórico foi trocada no mesmo dia;
  - README canônico em inglês, com seletor para o português;
  - titular da licença Julio Pessoa, e e-mail público dos commits `maestro@orkastery.com`;
  - site no GitHub Pages com o domínio `orkastery.com`;
  - publicação no npm pelo CI com Trusted Publishing.

## Estado com evidências

- Refinamento: pesquisa de referências e auditoria de prontidão feitas em 26/09/2026.
- Fase 1 em desenvolvimento na thread `ork-i48opensourc` (27/09/2026):
  - docs reorganizados em Começar, Guias, Referência e Conceitos, com página inicial e links reescritos;
  - README com selos, imagem de destaque e versão em inglês, e o lint de Markdown cobrindo 99 arquivos;
  - material interno de construção (relatório, planos, visão de fusão, docs de GO e PLAN, histórico, auditoria interna e estado das threads) arquivado no repositório privado e fora do público;
  - página do GitHub com descrição e tópicos alinhados ao produto, e o site apontando para o npm enquanto o domínio não serve o site;
  - imagem de prévia social em `docs/assets/social-preview.png`, para o dono subir em Settings;
  - modelos de issue e de PR revisados, e publicação no npm pelo CI com Trusted Publishing (PR #29).
- Auditoria de 26/09/2026, na árvore e em todo o histórico dos dois repositórios:
  - **bloqueantes:** uma credencial de ambiente local em testes e no histórico (trocar antes de abrir); nome de cliente dentro do código; dados pessoais nos metadados de commit;
  - **importantes:** 80 arquivos de construção interna (16% da árvore), estado das threads versionado, comentários com referências internas, acentuação irregular, descrição do GitHub desalinhada do produto, pacote npm que levaria arquivos de teste e de build;
  - **limpo:** nenhuma chave de serviço de terceiro, token de bot ou chave privada em nenhum momento do histórico; 520 de 523 links funcionando.
- Estimativa: de 2 a 3 dias para abrir sem bloqueantes; de 6 a 9 dias com a documentação no nível de lançamento.
- Fase 2, modo de demonstração na thread `ork-i56orkdemoaa` (27/09/2026): `ork demo` mostra, em meio segundo e offline, a afirmação falsa reprovada pelo `ork verify` e a corrigida aceita, num repositório temporário.
- Pacote npm 0.3.0 preparado na thread `ork-i46npm030` (27/09/2026):
  - fora do pacote: testes, estado interno e runbook de ativação;
  - sem caminho pessoal, nome de cliente nem história interna nos arquivos distribuídos;
  - README do npm reescrito, CHANGELOG criado e versão lida do `package.json`.
  - Falta o dono configurar o Trusted Publishing no npm para o CI publicar.
- Decisões de 27/09/2026 aplicadas na thread `ork-gotoopensour`:
  - o `README.md` passou a ser a versão em inglês, a em português ficou em `README.pt-BR.md`, com seletor nas duas, e o README do pacote npm também saiu em inglês;
  - o titular da licença MIT passou a ser Julio Pessoa;
  - os scripts internos de higiene da I-02 e de propagação para o repositório oficial foram arquivados no repositório privado e saíram da árvore;
  - o caminho pessoal que restava num teste virou genérico.
- Bloqueantes da auditoria em 27/09/2026:
  - a credencial foi trocada;
  - a varredura da árvore não acha nome de cliente nem caminho pessoal;
  - os dados pessoais dos metadados de commit ficam no arquivo privado, porque o repositório público nasce de um histórico novo.

- No ar em 27 e 28/09/2026:
  - repositório público `orkastery/orkastery` com histórico novo, e o antigo arquivado privado; `main` protegida com os 4 checks obrigatórios;
  - `@orkastery/cli` publicado pelo CI com Trusted Publishing: 0.3.0 em 27/09 e 0.4.1 em 28/09, com prova de origem assinada;
  - os sites orkastery.com e orkmind.com no GitHub Pages, publicados só por promoção, com o domínio apontado e HTTPS obrigatório desde 28/09/2026;
  - logo, favicons, avatar e prévia social aplicados.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Concluído | — | 2026-09-28 | Julio |
| Documentação | Em revisão | — | 2026-09-28 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-28 | Julio |
| Testes | Aprovados | — | 2026-09-28 | Julio |
| Deploy | Produção | — | 2026-09-28 | Julio |
| Exposição | Geral | — | 2026-09-28 | Julio |
| Habilitação | Concluída | — | 2026-09-28 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio. Publicar e tornar público são atos do dono.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-26 | proposto | pedido do dono: abrir o repositório e o site com segurança e qualidade | Julio |
| 2026-09-27 | fase 2: `ork demo` | critério de aceite: o visitante entende a promessa em até 5 minutos | Julio |
| 2026-09-27 | repositório público com histórico novo e npm 0.3.0 | corte D6; `publicar.yml` com Trusted Publishing | Julio |
| 2026-09-28 | npm 0.4.1, sites no GitHub Pages e marca | PRs #5 a #8 | Julio |
| 2026-09-28 | escopo restante movido para a RM-049; fecha quando o DNS apontar o domínio | decisão do dono no Telegram (H6) | Julio |
| 2026-09-28 | concluído | orkastery.com e orkmind.com no ar pelo domínio, com HTTPS obrigatório; o escopo restante segue na RM-049 | Julio |
