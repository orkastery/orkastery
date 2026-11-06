---
id: RM-079
tipo: roadmap
titulo: Claims de revisão que a correção passa e retirada tipada com substituta
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-06T16:02:33-03:00
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
  thread: ork-rm079claimsq
  modo: Auto
  fase: GO
  status: aberta
---

# RM-079: Claims de revisão que a correção passa e retirada tipada com substituta

> **Em uma frase:** toda claim nova afirma o comportamento correto e passa com a correção; a retirada tipada registra autor e motivo, e a forma em texto livre continua aceita com recibo não tipado.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** quem conduz em `#Auto` precisa resolver claims que nenhuma implementação correta passa e retiradas sem registro suficiente.
- **Evidências e fonte:** Achados de uma rede de três VPS que conduz um roadmap em `#Auto` com o ork 0.5.6 (30 e 31/10/2026), conferidos contra a main da 0.6.2 em 31/10/2026.
  - Um CHECK registrou como claim uma sonda que reproduz o defeito, isolando uma função com contexto mínimo; com o código corrigido, a função recusa e a sonda também falha. A claim ficou impossível e só o dono podia retirá-la.
  - Um agente GO retirou uma claim obsoleta depois de uma mudança de regra; a thread esperou a dispensa do dono mesmo com a cobertura nova verde.
  - Na 0.6.2, a orientação do CHECK (`skills/phases/check-quality`, `adapters/claude-code/agents/ork-check.md`, `locale-prompts.ts`) não diz que a claim deve passar com a correção.
  - O lint de claims (`claim-lint.ts`) não pega sonda isolada.
  - Qualquer um retira uma claim, com motivo em texto livre e sem registro de quem retirou (`claims.ts`).
  - Não existe ferramenta MCP para retirar claim.
  - A exigência de dispensa vista na outra rede não existe no núcleo: vem do processo dela. O núcleo precisa de uma regra tipada para não repetir o problema.
- **Objetivo/OKR:** uma claim criada no CHECK passa com a correção; a retirada tipada registra autor e motivo, enquanto a retirada em texto livre continua aceita e o recibo a marca como não tipada.
- **Hipótese:** se a orientação e o lint exigirem claim que passa com a correção, e a retirada com substituta verificada for tipada, então o caso comum se resolve na revisão sem pedir uma decisão ao dono.
- **Métrica principal / linha de base / meta / janela / fonte:** retiradas de claim que precisaram do dono. Linha de base: a medir. Meta: só retiradas sem substituta. Janela: por release. Fonte: `claims.jsonl` e ledger.
- **Métricas de proteção:** retirada sem substituta continua indo ao dono; nenhuma claim é enfraquecida para passar.

## Escopo e validação

- **Incluído:**
  - uma regra, em pt-BR e EN, na orientação do CHECK: a claim nova afirma o comportamento correto e passa com a correção, e a reprodução do defeito vai no parecer;
  - regra de lint que avisa quando a claim executa função isolada com contexto artificial (por exemplo `node -e` com parser de AST, `vm.runIn*`, `new Function`);
  - regra de lint que avisa quando a claim lê o bundle `.ork-ci` da própria thread ou outro artefato gerado pelo fechamento;
  - `ork claims retirar ... --substituida-por <Cn>` com motivo tipado (`substituicao`, `obsoleta`, `erro`) e autor (sessão ou dono) no ledger, conferindo que a substituta existe, está ativa e passou no último `verify_run`;
  - o `verify_run` guarda a impressão SHA-256 da lista `verificar`, nunca o texto bruto, e a retirada compara essa impressão com a substituta atual;
  - motivos e textos derivados do parecer passam pela redação de credenciais antes de recibo, ledger ou saída da CLI;
  - retirada sem substituta abre pedido tipado ao dono (por exemplo `claims.retirada-sem-substituta`);
  - a mesma operação como ferramenta MCP.
  - `ork fix open` lê o veredito e os achados estruturados de `docs/check.md`; `ork fix status` mostra arquivo, linha, estado, commit de fechamento e o que falta.
- **Fora de escopo:** mudar o formato das claims.
- **Entregáveis e critérios de aceite:**
  - claim criada no CHECK passa com uma implementação correta, sem retirada pelo dono;
  - troca de regra com substituta verde não para a thread;
  - retirada sem substituta vira pedido ao dono;
  - alteração do comando da substituta depois do verify é recusada pela impressão, sem copiar o comando para o recibo;
  - parecer negativo com achado sem claim abre uma rodada de correção e exige um novo CHECK verde para fechar;
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
| Ciclo do item | Em desenvolvimento | — | 2026-11-06 | Julio |
| Documentação | Em revisão | — | 2026-11-06 | Julio |
| Código | Branch criada | — | 2026-11-06 | Julio |
| Testes | Em execução | — | 2026-11-06 | Julio |
| Deploy | Não implantado | — | 2026-11-06 | Julio |
| Exposição | Flag desligada | — | 2026-11-06 | Julio |
| Habilitação | Pendente | — | 2026-11-06 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: a sessão condutora da thread que pegar o item; A: Julio; C: a definir; I: a definir.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** item aberto pela condução da VPS a pedido do dono, a partir dos achados de outra rede; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** a condução abre a thread pela fila da seção "Achados de condução em rede" do índice do roadmap.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-31 | Item criado em Discovery | Achados de condução em rede, conferidos contra a 0.6.2 | Julio (pedido de 31/10/2026) |
| 2026-11-06 | Implementação em GO na thread `ork-rm079claimsq` | orientação bilíngue, lint educativo, retirada tipada e ciclo de correção derivados dos critérios da RM-079 | sessão Codex (#Auto) |
| 2026-11-06 | GO-FIX 2 substituiu o comando bruto do recibo por impressão versionada e redigiu textos livres do fluxo | falha determinística de `verify-timeout` e auditoria dos campos novos da RM-079 | sessão Codex (#Auto) |
