---
id: RM-036
tipo: roadmap
titulo: Condução multicanal do Maestro no núcleo
categoria: iniciativa
pai: null
features: [FEAT-029]
owner: Julio
atualizado_em: 2026-10-03T01:10:00-03:00
estado:
  ciclo: Piloto
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Parcial
  habilitacao: Pendente
evidencias:
  codigo:
    commit: 10ca416
    pr: null
sdlc:
  thread: ork-i36multicana
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-036 — Condução multicanal do Maestro no núcleo

> **Em uma frase:** Um Maestro, vários canais: o despacho que chega de outro canal é o próprio dono, e o núcleo coordena em vez de derrubar a sessão.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Piloto | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-029](../produto/FEAT-029-conducao-multicanal.md) Condução multicanal da thread
- **Thread:** `ork-rm036leasesd` (a mais recente, fatia dos leases); antes, `ork-i36multicana`

## Problema e resultado

- **Problema:** uma conversa em outro canal era tratada como intrusa. Em 19/09/2026 duas sessões de canais diferentes rodaram build e teste juntas na mesma worktree, o `verify` gravou `code: -1` como reprovação, e o único jeito de destravar foi matar a sessão do outro canal.
- **Resultado:** uma execução por worktree, em qualquer canal; o segundo pedido recebe na hora quem conduz e o que fazer; a mesma fase com o mesmo pedido não abre sessão nova; handoff explícito, sem matar processo por fora.
- **Métrica:** execuções concorrentes na mesma worktree (meta: zero) e recusas `conducao.em-andamento` que viraram handoff ou espera, contadas no ledger.

## Escopo e validação

- **Escopo:** lease de execução `exec:<thread>` nos pontos de entrada que executam (`ork phase run`, `ork verify`, `ork fix`, `ork retry run` e o `ork_verify` do MCP); canal e correlação no despacho; recusa tipada com as três ações; despacho idempotente; `ork conducao status|assumir`; recuperação de condução órfã com prova; a mesma linha de condução em todas as telas e hosts.
- **Fora de escopo:** multi-dono, interface web, contrato de HITL e desempenho do `ork verify`.
- **Validação:** 20 testes novos (`core/test/conducao-*.test.ts`), incluindo o caso de aceite do incidente: dois `ork verify` reais na mesma worktree, e só um executa.
- **Fatia dos leases (thread `ork-rm036leasesd`, 03/10/2026):** todas as famílias de lease, não só o `exec:`, moram no estado canônico do projeto (o `.orkastery/leases` da raiz), e um `ork` chamado da raiz e outro de uma worktree se excluem em `main-tree`, `worktree-write`, `path`, `board`, `service` e na fila por colisão. O lock de espera do `ork portfolio` também foi para a raiz. Cenários executáveis: [exclusão entre checkouts](../../core/test/rm036-leases-canonicos.test.ts) e [legado não confiável e corridas de escrita](../../core/test/rm036-leases-gofix.test.ts).

## Plano e decisões

- **Ordem acordada em 20/09/2026:** depois de #Fast ([RM-042](RM-042-modo-fast.md)) e do verify rápido ([RM-037](RM-037-verify-rapido-e-confiavel.md)).
- **Decisão do dono sobre o segundo pedido (D2, 27/09/2026):** recusa imediata, com `--esperar` como opção, e explicando sempre para o humano quem conduz e o que fazer.
- **Decisões do PLAN seguidas:** família nova `exec` (D1); prazo do teto real da operação, renovado (D3); reentrada pela identidade do despacho (D4); registro de seis canais separado do de HITL (D5); canal declarado pela borda, sem autoridade (D6); vida provada pelo kernel ou pelo runtime (D7); encerramento pelo controle do runtime (D8); leitura e texto em um lugar só (D9); idempotência por fase e sha do prompt (D10).

## Estado com evidências

- GO entregue na thread `ork-i36multicana` (27/09/2026): o lease mora no estado canônico do projeto, e a raiz e as worktrees disputam o mesmo arquivo.
- A recusa chega igual pelo CLI (código de saída `3`) e pelo MCP; os adaptadores Hermes e OpenClaw declaram o canal deles.
- Fatia dos leases (thread `ork-rm036leasesd`, 03/10/2026): os leases das famílias antigas passam ao domínio canônico em [leases.ts](../../core/src/leases.ts), e o lock de espera do portfólio acompanha seu dado em [portfolio.ts](../../core/src/portfolio.ts). O legado de worktrees registradas e com vínculo de volta válido só é consultado na janela de 30 minutos iniciada na primeira consulta desta versão, mesmo sem legado, marcada em `.orkastery/leases/.legado`. Arquivo regular válido, com nome correspondente, thread no formato de id, datas ISO e prazo de até 30 minutos (com tolerância de 1 segundo entre as leituras do relógio), barra enquanto vivo, aparece no `ork lease list` e nunca prova posse canônica nem ganha segunda cópia. Arquivo inválido ou ilegível não bloqueia; aparece como diagnóstico durante a janela. O diagnóstico mostra apenas o arquivo, sem comando de remoção. Links simbólicos são ignorados. Depois de encerrada, a janela não reabre com arquivos legados novos. A aquisição preserva o legado vencido. A fila legada não é lida; a espera se refaz no próximo pedido. Limite: um `ork` da versão anterior ainda rodando numa worktree durante a troca não vê os leases canônicos; os do CLI vencem em 30 minutos. O legado nunca é apagado: o descarte grava uma marca `dev:ino:ctime` em `.orkastery/leases/.legado-ignorado-<dev>-<ino>-<ctime>` no estado canônico. Se existe cópia canônica, `release` atua somente nela; sem ela, a dona do legado (ou `--forcar`) apenas registra a marca. A poda e o fechamento também usam marcas, e uma substituição por outro inode ou `ctime` continua visível. O `ctime` usa `ctimeMs` e é conferido novamente antes de gravar a marca. O diagnóstico do legado não sugere `release`; o motivo exposto é sempre `(legado)`. Nenhuma liberação é anunciada quando nada saiu. A retomada automática funciona em Linux e macOS, inclusive sem `/usr/bin/flock`: candidatos exclusivos e tickets publicados por `rename` atômico serializam as retomadas, inclusive entre transportes diferentes; sob essa exclusão, o núcleo relê o conteúdo, confere dispositivo e inode e cria com `wx`. Ausência, bloqueio do spawn, timeout ou erro de `flock` usam o caminho portátil. Candidatos com PID morto são descartados; PID reutilizado ou sem permissão de consulta continua como vivo e pode exigir inspeção humana, sem expiração que remova um candidato vivo. `nlink === 0` é `lease.busy`, com fila normal e preservação do vencedor. Hard link ou link simbólico recebem `lease.resume-unavailable`, com escalada humana e sem retry automático. Após avaliar a posse, a correção explícita é `ork lease release <nome> --forcar`, seguida de nova aquisição. Contenção normal do `flock` ou dos tickets continua como `lease.busy`.
- Conhecido, fora da fatia dos leases (não são locks): os objetivos, o journal de criação, a fila de retomada (`.orkastery/retry/fila.jsonl`), a dívida, as auditorias e os perfis do board ainda moram no checkout de quem chama.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-10-03 | Julio |
| Documentação | Em revisão | — | 2026-10-03 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-10-03 | Julio |
| Testes | Aprovados | — | 2026-10-03 | Julio |
| Deploy | Produção | — | 2026-10-03 | Julio |
| Exposição | Parcial | — | 2026-10-03 | Julio |
| Habilitação | Pendente | — | 2026-10-03 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-19 | thread aberta | thread `ork-i36multicana` | Julio |
| 2026-09-27 | D2 respondida: recusa imediata, sempre explicada para o humano | Telegram, 27/09 10:53 | Julio |
| 2026-09-27 | GO entregue | thread `ork-i36multicana`, PR da entrega | Julio |
| 2026-10-03 | fatia dos leases: todas as famílias e a fila por colisão no estado canônico, legado validado na janela de 30 minutos, lock do portfólio na raiz | thread `ork-rm036leasesd`, testes `rm036-leases-canonicos` e `rm036-leases-gofix`, revisão pendente | Agentes |
