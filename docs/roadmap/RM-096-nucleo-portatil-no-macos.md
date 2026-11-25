---
id: RM-096
tipo: roadmap
titulo: Núcleo portátil no macOS
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-25T00:00:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Branch criada
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: ork-macosportave
  modo: auto
---

# RM-096 — Núcleo portátil no macOS

> **Em uma frase:** o CI instala o pacote, cria uma worktree, registra uma claim e roda o verify no macOS, e a publicação só prossegue com essa prova verde.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem instala o CLI no macOS recebe prontidão do doctor, mas a criação de thread e a demonstração param em dependências fixas do Linux; a execução de evidência também confunde shell indisponível com claim falsa.
- **Evidências e fonte:** [issue #303](https://github.com/orkastery/orkastery/issues/303), confirmada em `core/src/creation-operation-store.ts`, `core/src/hitl-lock.ts`, `core/src/conducao.ts` e `core/src/fila-pesada.ts`; [issue #304](https://github.com/orkastery/orkastery/issues/304), confirmada em `core/src/verify.ts` e `core/src/check-paralelo.ts`. As reproduções herméticas e os vereditos de cada afirmação estão no GOAL da thread `ork-macosportave`.
- **Objetivo/OKR:** tornar demo, criação, coordenação e execução de evidência alcançáveis no pacote instalado no macOS, com diagnóstico ambiental tipado e prova em CI.
- **Hipótese:** se a fábrica controlar a trava e o shell por contratos portáteis e o doctor exercitar ambos, então o primeiro ciclo deixa de depender de utilitários exclusivos do Linux sem ampliar caminhos de execução.
- **Métrica principal / linha de base / meta / janela / fonte:** passagem do job `macos-latest` com o tarball do commit. A linha de base é o job inexistente e as reproduções vermelhas das issues; a fonte é o recibo do CI.
- **Métricas de proteção:** exclusão nunca é transferida por TTL; identidade desconhecida conserva a posse; shell não vem de PATH ou variável pública; comando não executado não aprova nem reprova a claim; Linux mantém seu protocolo atual.

## Escopo e validação

- **Incluído:** trava portátil de criação, HITL, condução e fila pesada; resolução determinística do Bash; recibo de caminho e versão; doctor; causa `verify.sem-veredito`; auditoria que exige evidência executada; job com o pacote do commit; documentação pública.
- **Fora de escopo:** Windows; #Noctum fora do Linux; shells arbitrários; dependência nativa; comentário público nas issues; publicação, push ou merge nesta thread.
- **Entregáveis e critérios de aceite:** candidatos únicos garantem exclusão, recuperação após morte e prazo tipado; verify e CHECK paralelo compartilham o shell controlado; doctor bloqueia infraestrutura indisponível; o pacote instalado conclui demo e a primeira thread em `macos-latest`.
- **Piloto, medição e critérios de expansão/interrupção:** o job de macOS é o piloto e o requisito para publicar. Expandir a documentação apenas após o verde do CI. Interromper se houver posse tomada por relógio, executor vindo do ambiente ou caminho do quickstart que não rode pelo pacote.

### Fatias

| Ordem | Fatia | Critério de aceite verificável |
| --- | --- | --- |
| F1 | Trava portátil | criação, HITL, condução e fila pesada preservam exclusão e liberam candidato de processo comprovadamente morto |
| F2 | Evidência portátil | shell absoluto e versionado atende verify e CHECK paralelo; indisponibilidade vira `verify.sem-veredito` |
| F3 | Diagnóstico honesto | doctor exercita trava e shell antes do veredito; auditoria exige claim executada para aprovar |
| F4 | Pacote provado | jobs Linux e macOS empacotam o commit, instalam o tarball e percorrem demonstração, inicialização, doctor, worktree, `ork claims add` e `ork verify`; publicar exige o job macOS |
| F5 | Narrativa | requisitos, limites e changelog refletem apenas o que o CI prova |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** ordem zero, “Issues de usuários”, por decisão do dono em 24/11/2026. As issues são insumo; a triagem do GOAL define o que entrou.
- **Horizonte / alvo / previsão / confiança / marcos:** implementação na thread `ork-macosportave`; suporte público condicionado ao job macOS verde; sem previsão temporal declarada.
- **Dependências e bloqueios (ID, owner, próxima revisão):** fatia de causa e executor em [RM-080](RM-080-saida-completa-e-causa-tipada-no-verify.md); CI do repositório; revisão independente no CHECK. Owner: Julio; revisão na integração desta thread.
- **Premissas / riscos / mitigação:** sistema de arquivos deve oferecer criação exclusiva e rename atômico; candidato de identidade incerta não é removido. Bash antigo continua compatível e aparece como aviso. #Noctum preserva o gate Linux tipado.
- **Dívida aceita do GO-FIX:** a fila portátil ainda não publica idade, artefato, ordem e batida equivalentes ao protocolo Linux; as sondas repetem consulta de processo e medição de Bash; concorrentes sem espera podem ambos recusar aquisição. Corrigir isso exige alterar protocolo ou introduzir cache com invalidação, fora dos bloqueadores desta entrega; fica nesta iniciativa para uma fatia própria, sem ampliar a promessa atual.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** D1–D6 no ledger da thread escolhem nome público, código existente, ausência de override, saída geral, candidatos por identidade e domicílio dividido com RM-080. O modo #Auto autorizou seguir as recomendações registradas.

## Estado com evidências

A implementação local, os testes focados e os jobs obrigatórios existem na thread `ork-macosportave`. O item permanece não implantado e não habilitado; o suporte público depende do CHECK, do job `macos-latest` verde e do merge.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-11-25 | Julio |
| Documentação | Em revisão | — | 2026-11-25 | Julio |
| Código | Branch criada | — | 2026-11-25 | Julio |
| Testes | Em execução | — | 2026-11-25 | Julio |
| Deploy | Não implantado | — | 2026-11-25 | Julio |
| Exposição | Flag desligada | — | 2026-11-25 | Julio |
| Habilitação | Pendente | — | 2026-11-25 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: thread `ork-macosportave`; A: Julio; C: revisão de código, testes e segurança no CHECK; I: quem instala o CLI no Linux ou no macOS.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão #Auto triou as issues, registrou decisões e implementou o GO; uma conta independente executará o CHECK.
- **Próxima ação, responsável e prazo:** executar CHECK independente e o job macOS; responsáveis: condução da thread e CI; sem prazo declarado.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-24 | Item reservado como prioridade de issues de usuários | Ordem do dono e fontes #303/#304 | Julio |
| 2026-11-25 | GO implementou a fatia, ainda sem CHECK, CI remoto ou deploy | Thread `ork-macosportave` e claims prospectivas | Sessão #Auto, por delegação do dono |
