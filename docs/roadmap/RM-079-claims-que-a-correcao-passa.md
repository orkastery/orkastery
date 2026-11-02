---
id: RM-079
tipo: roadmap
titulo: Claims de revisão que a correção passa e retirada tipada com substituta
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

# RM-079: Claims de revisão que a correção passa e retirada tipada com substituta

> **Em uma frase:** toda claim nova afirma o comportamento correto e passa com a correção; retirar uma claim registra quem retirou e por quê, e a troca por uma substituta verde não para a thread.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Discovery | Não iniciado | Não iniciados | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz em `#Auto` e vira gargalo de claims que nenhuma implementação correta passa, ou de retiradas sem trilha.
- **Evidências e fonte:** Achados de uma rede de três VPS que conduz um roadmap em `#Auto` com o ork 0.5.6 (30 e 31/10/2026), conferidos contra a main da 0.6.2 em 31/10/2026.
  - Um CHECK registrou como claim uma sonda que reproduz o defeito, isolando uma função com contexto mínimo; com o código corrigido, a função recusa e a sonda também falha. A claim ficou impossível e só o dono podia retirá-la.
  - Um agente GO retirou uma claim obsoleta depois de uma mudança de regra; a thread esperou a dispensa do dono mesmo com a cobertura nova verde.
  - Na 0.6.2, a orientação do CHECK (`skills/phases/check-quality`, `adapters/claude-code/agents/ork-check.md`, `locale-prompts.ts`) não diz que a claim deve passar com a correção.
  - O lint de claims (`claim-lint.ts`) não pega sonda isolada.
  - Qualquer um retira uma claim, com motivo em texto livre e sem registro de quem retirou (`claims.ts`).
  - Não existe ferramenta MCP para retirar claim.
  - A trava de dispensa vista na outra rede não existe no núcleo: vem do processo dela. O núcleo precisa de uma regra tipada para não repetir o problema.
- **Objetivo/OKR:** nenhuma claim nascida no CHECK precisa ser retirada pelo dono; toda retirada tem autor e motivo tipado.
- **Hipótese:** se a orientação e o lint exigirem claim que passa com a correção, e a retirada com substituta verde for tipada, então o dono deixa de ser gargalo de claims, porque o caso comum se resolve na revisão.
- **Métrica principal / linha de base / meta / janela / fonte:** retiradas de claim que precisaram do dono. Linha de base: a medir. Meta: só retiradas sem substituta. Janela: por release. Fonte: `claims.jsonl` e ledger.
- **Métricas de proteção:** retirada sem substituta continua indo ao dono; nenhuma claim é enfraquecida para passar.

## Escopo e validação

- **Incluído:**
  - uma regra, em pt-BR e EN, na orientação do CHECK: a claim nova afirma o comportamento correto e passa com a correção, e a reprodução do defeito vai no parecer;
  - regra de lint que avisa quando a claim executa função isolada com contexto artificial (por exemplo `node -e` com parser de AST, `vm.runIn*`, `new Function`);
  - `ork claims retirar ... --substituida-por <Cn>` com motivo tipado (`substituicao`, `obsoleta`, `erro`) e autor (sessão ou dono) no ledger, conferindo que a substituta existe, está ativa e passou no último `verify_run`;
  - retirada sem substituta abre pedido tipado ao dono (por exemplo `claims.retirada-sem-substituta`);
  - a mesma operação como ferramenta MCP.
- **Fora de escopo:** mudar o formato das claims.
- **Entregáveis e critérios de aceite:**
  - claim nascida no CHECK passa com uma implementação correta, sem retirada pelo dono;
  - troca de regra com substituta verde não para a thread;
  - retirada sem substituta vira pedido ao dono;
  - um mutante por regra morre.
- **Piloto, medição e critérios de expansão/interrupção:** piloto nos próximos CHECKs `#Auto`.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** 5ª da fila de achados de condução em rede (31/10/2026). Média: é menos frequente, mas cada caso vira trabalho do dono.
- **Horizonte / alvo / previsão / confiança / marcos:** a definir pelo dono.
- **Dependências e bloqueios (ID, owner, próxima revisão):** lint de claims da [RM-037](RM-037-verify-rapido-e-confiavel.md); políticas do [RM-008](RM-008-loop-de-aprendizado.md); "só sobe ao dono o que é ato dele" da [RM-063](RM-063-fabrica-que-nao-para.md).
- **Premissas / riscos / mitigação:** lint com falso positivo; mitigação: só aviso, nunca recusa.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  1. Só orientação: barato, mas não pega o erro.
  2. Orientação, lint de aviso e retirada tipada (recomendada).

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
