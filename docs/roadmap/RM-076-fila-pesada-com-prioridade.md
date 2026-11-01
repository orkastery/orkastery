---
id: RM-076
tipo: roadmap
titulo: Fila pesada com prioridade e reserva de vaga
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-31T12:00:00-03:00
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

# RM-076: Fila pesada com prioridade e reserva de vaga

> **Em uma frase:** a vaga pesada passa para a thread de maior prioridade na troca de job, fica reservada um ciclo para quem acabou de sair dela e nunca vai para uma thread que espera o dono.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem roda várias threads em paralelo numa máquina com vaga pesada (verify, CHECK, bancada). Hoje a vaga escapa da thread prioritária na troca de job e fica horas com uma que nem pode passar.
- **Evidências e fonte:** Achados de uma rede de três VPS que conduz um roadmap em `#Auto` com o ork 0.5.6 (30 e 31/10/2026), conferidos contra a main da 0.6.2 em 31/10/2026.
  - Ao terminar um job pesado, a thread dona esperou o próximo ciclo de 60 s, e nesse intervalo outra thread pronta, menos prioritária e sem chance de passar, pegou a vaga por horas.
  - Na 0.6.2, `core/src/fila-pesada.ts` é só ordem de chegada (bilhete): sem prioridade, sem reserva e sem saber o estado da thread. O `comRecursoPesado` solta a vaga no `finally`.
  - A prioridade só existe na fila de trabalho do #Noctum (`noctum-fila.ts`), e o passo do arco repete a cada 60 s. O `pendenciaDoDono` (`parado-no-condutor.ts`) já sabe quando uma thread espera o dono, mas a fila pesada não consulta.
- **Objetivo/OKR:** a thread prioritária encadeia verify, CHECK e o verify pós-CHECK sem perder a vaga.
- **Hipótese:** se a vaga respeitar a prioridade do arco e ficar reservada um ciclo para quem acabou de sair, então o paralelismo útil sobe, porque o tempo de vaga gasto por thread que não pode passar cai a zero.
- **Métrica principal / linha de base / meta / janela / fonte:** fração do tempo de vaga pesada usado por thread bloqueada pelo dono ou de prioridade menor que uma pronta. Linha de base: a medir no ledger da fila. Meta: zero. Janela: por arco. Fonte: eventos da fila pesada.
- **Métricas de proteção:** nenhuma thread fica sem vaga para sempre (a reserva expira); o limite de vagas da máquina não muda; a fila continua justa entre threads da mesma prioridade.

## Escopo e validação

- **Incluído:**
  - ao soltar a vaga, se a thread for a de maior prioridade e tiver um próximo passo pesado, gravar uma reserva com prazo de um ciclo, sob a mesma trava do núcleo; outras threads recusam a vaga até a reserva expirar;
  - antes de pegar o bilhete, recusar trabalho pesado de thread com `pendenciaDoDono`, com motivo tipado (por exemplo `fila-pesada.bloqueio-do-dono`);
  - a prioridade vem da mesma ordem da fila do arco, não de uma regra nova.
- **Fora de escopo:** preempção de um job em andamento; mudar o número de vagas.
- **Entregáveis e critérios de aceite:**
  - com duas threads prontas, a de maior prioridade encadeia verify, CHECK e verify pós-CHECK sem perder a vaga;
  - thread bloqueada pelo dono nunca recebe a vaga;
  - reserva expirada libera a vaga para a próxima da fila;
  - um mutante por regra (reserva ignorada, bloqueio do dono ignorado) morre.
- **Piloto, medição e critérios de expansão/interrupção:** piloto num arco do #Noctum com pelo menos três threads disputando a vaga.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** 3ª da fila de achados de condução em rede (31/10/2026). Alta: é onde o paralelismo mais perde tempo.
- **Horizonte / alvo / previsão / confiança / marcos:** a definir pelo dono.
- **Dependências e bloqueios (ID, owner, próxima revisão):** fila pesada da [RM-058](RM-058-modo-noctum.md) (N2) e da [RM-064](RM-064-conta-esgotada-nao-para-a-fase.md) (continuação "fila pesada entre host e sandbox").
- **Premissas / riscos / mitigação:** reserva presa por processo morto; mitigação: prazo curto e limpeza pela mesma trava.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  1. Fila por prioridade pura: resolve a ordem, mas não o intervalo entre jobs.
  2. Prioridade mais reserva de um ciclo (recomendada).

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Discovery | — | 2026-10-31 | Julio |
| Documentação | Rascunho | — | 2026-10-31 | Julio |
| Código | Não iniciado | — | 2026-10-31 | Julio |
| Testes | Não iniciados | — | 2026-10-31 | Julio |
| Deploy | Não implantado | — | 2026-10-31 | Julio |
| Exposição | Flag desligada | — | 2026-10-31 | Julio |
| Habilitação | Pendente | — | 2026-10-31 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão condutora da thread que pegar o item; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela condução da VPS a pedido do dono, a partir dos achados de outra rede; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** a condução abre a thread pela fila da seção "Achados de condução em rede" do índice do roadmap.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-31 | Item criado em Discovery | Achados de condução em rede, conferidos contra a 0.6.2 | Julio (pedido de 31/10/2026) |
