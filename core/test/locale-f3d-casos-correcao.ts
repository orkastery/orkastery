/**
 * RM-061, F3d (snapshot pt-BR): `fix`, `handoff`, `recall`, o complemento do `retry` (policy, parse, list, resume e
 * cancel) e o `ledger` (stats e estimate).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { textoDaRodada, textoDoReverify } from '../src/fix';
import { textoDoHandoff } from '../src/handoff';
import { textoDoRecall } from '../src/recall';
import { textoDaRetomada } from '../src/retry';
import { tabelaDaFila } from '../src/ratelimit';
import { linhaDoHitlDeConducao, textoDasEstatisticas } from '../src/ledger-stats';
import { Ambiente, caso, Casos, dirTemp, idDaThread, ork, projeto, SHA_64, T0, T1, T2, texto } from './locale-f3d-apoio';

/** Grava linhas JSONL (o formato dos armazens append-only do nucleo). */
function gravarJsonl(arquivo: string, itens: readonly object[]): void {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, itens.map((i) => JSON.stringify(i)).join('\n') + '\n');
}

/**
 * A unica mudanca pretendida do pt-BR na F3d (decisao G2 do GO-FIX 1, evento `c236c96a` no ledger da thread): na linha
 * `custo referencia` do `ork ledger stats`, o travessao da base virou parenteses nas duas linguas (o catalogo nao leva
 * U+2014). A base imprime a linha com o travessao; aqui so essa linha passa a forma nova antes de comparar. No codigo
 * da F3d nao ha o que trocar, e o resto da linha segue conferido byte a byte.
 */
const TRAVESSAO = String.fromCharCode(0x2014);
function custoComParenteses(texto: string): string {
  return texto.replace(new RegExp(`^(  custo referencia .*) ${TRAVESSAO} (estimativa por tarifa publica, nao gasto/fatura)$`, 'gm'), '$1 ($2)');
}

function dirDaThread(repo: string, id: string): string {
  return path.join(repo, '.orkastery', 'threads', id);
}

function correcao(id: string, tipo: 'A' | 'B', origem: string, alvo: string, verificar: string[], estado = 'aberta') {
  return { id, thread: 'loc-fix', rodada: 1, tipo, origem, alvo, spec: `corrigir ${alvo}`, verificar, evidencia: 'saida real',
    estado, vereditoEm: null, detalheDoVeredito: '', criadaEm: T0 };
}

function casosDoFixPuro(casos: Casos): void {
  const b = correcao('FX1', 'B', 'claims.failed', 'claim C1', ['test -f SUMIU.md', 'true']);
  const a = correcao('FX2', 'A', 'claims.unverifiable', 'claim C2', []);
  const rodada = { thread: 'loc-fix', rodada: 2, veredito: 'PRECISA DE MUDANCA', correcoes: [b, a], temTipoB: true,
    spec: 'GO-FIX da thread loc-fix, rodada 2.\n\nRegras desta rodada:\n- Corrija o ARTEFATO.',
    motivos: ['claims.failed', 'claims.unverifiable'], abertaEm: T0 };
  caso(casos, 'fix: rodada sem correcao', () => textoDaRodada({ ...rodada, rodada: 0, veredito: 'PASSOU', correcoes: [], temTipoB: false,
    spec: '', motivos: [] } as never));
  caso(casos, 'fix: rodada com tipo B', () => textoDaRodada(rodada as never));
  caso(casos, 'fix: rodada so de tipo A bloqueada', () => textoDaRodada({ ...rodada, veredito: 'BLOQUEADO', correcoes: [a], temTipoB: false,
    motivos: ['claims.unverifiable'] } as never));
  const execucao = (comando: string, ok: boolean) => ({ nome: 'FX1.1', comando, ok, code: ok ? 0 : 1, resumo: '' });
  const reverify = { thread: 'loc-fix', rodada: 3, cobertura: 'completa',
    vereditos: [
      { correcao: b, aprovada: false, execucoes: [execucao('test -f SUMIU.md', false), execucao('true', true)],
        detalhe: '"test -f SUMIU.md" ainda sai com codigo 1' },
      { correcao: a, aprovada: true, execucoes: [], detalhe: 'sem comando proprio de verificacao: o veredito depende do verify completo' },
    ],
    verify: { commit: SHA_64.slice(0, 40), ok: false, motivos: ['claims.failed', 'verify.regression'] },
    veredito: 'BLOQUEADO', rodadas: 3, limite: 3, escalado: true, motivos: ['claims.failed', 'verify.regression'],
    razao: 'limite de escalacao atingido: 3 rodada(s) de GO-FIX para o limite de 3 do manifesto.' };
  caso(casos, 'fix: reverify bloqueado e escalado', () => textoDoReverify(reverify as never));
  caso(casos, 'fix: reverify parcial que passou', () => textoDoReverify({ ...reverify, cobertura: 'parcial', verify: null,
    vereditos: [{ ...reverify.vereditos[0], aprovada: true, execucoes: [execucao('true', true)], detalhe: '1 comando(s) reexecutado(s)' }],
    veredito: 'PASSOU', rodadas: 1, escalado: false, motivos: [], razao: '1 correcao(oes) aprovada(s)' } as never));
  caso(casos, 'fix: reverify com o verify verde', () => textoDoReverify({ ...reverify, verify: { commit: SHA_64.slice(0, 40), ok: true, motivos: [] },
    veredito: 'PRECISA DE MUDANCA', rodadas: 2, escalado: false, motivos: [], razao: '1 correcao(oes) ainda reprovada(s)' } as never));
}

function casosDoHandoffEDoRecallPuros(casos: Casos): void {
  const prov = (arquivo: string, ancora: string) => ({ source: arquivo, location: `${arquivo}#${ancora}`, sha256: SHA_64 });
  const thread = '.orkastery/threads/loc-hand/thread.json';
  const claims = '.orkastery/threads/loc-hand/claims.jsonl';
  const ledger = '.orkastery/threads/loc-hand/ledger.jsonl';
  const handoff = { versao: 1, thread: 'loc-hand', geradoEm: T0, memory: 'orkmind',
    de: { slug: 'loc-hand-go', fase: 'GO' }, para: { slug: 'loc-hand-check', fase: 'CHECK' },
    inline: [
      { id: 'inline-1', tier: 'CRITICO', titulo: 'Estado do mundo da thread', conteudo: 'x', proveniencia: prov(thread, 'json:base') },
      { id: 'inline-2', tier: 'CRITICO', titulo: 'Regra de pausa do bloco CHECK-SHIP', conteudo: 'x', proveniencia: prov(thread, 'json:blocos') },
    ],
    pointers: [
      { id: 'ptr-1', tier: 'IMPORTANTE', titulo: 'Claim C1 ja verificada: o readme existe', source: claims, location: `${claims}#claim:C1`,
        sha256: SHA_64, retrieve_via: `ork handoff recall loc-hand "${claims}#claim:C1"`, retrieve_when: 'CHECK' },
      { id: 'ptr-2', tier: 'IMPORTANTE', titulo: 'Handoff anterior desta thread', source: 'docs/h.json', location: 'docs/h.json#tudo',
        sha256: SHA_64, retrieve_via: 'ork handoff recall loc-hand "docs/h.json#tudo"', retrieve_when: 'MASTER', orkmind: 'orkmind://handoff/h-1' },
    ],
    summaries: [{ id: 'sum-1', tier: 'RESUMIVEL', text: '3 eventos no ledger da thread', provenance: prov(ledger, 'evento:3') }] };
  caso(casos, 'handoff: texto com os tres niveis', () => textoDoHandoff(handoff as never, '/repo/.orkastery/threads/loc-hand/handoff.json'));
  caso(casos, 'handoff: texto vazio', () => textoDoHandoff({ ...handoff, memory: 'files', de: { slug: 'loc-hand', fase: null },
    para: { slug: 'loc-hand-goal', fase: 'GOAL' }, inline: [], pointers: [], summaries: [] } as never, 'handoff.json'));
  const ponteiro = (id: string, titulo: string, location: string, quando: string, extra: object = {}) => ({ id, titulo, location, orkmind: null,
    retrieve_when: quando, resolvido: false, motivo: 'fora-do-momento', via: null, conteudo: '', metodo: '', sha256: SHA_64, intervalo: null,
    detalhe: '', ...extra });
  const recall = { thread: 'loc-rec', momento: 'CHECK', regime: 'orkmind', regimeDoHandoff: 'files', resolvidoEm: T1,
    resolvidos: [
      ponteiro('ptr-1', 'Readme do projeto', 'README.md#tudo', 'CHECK', { resolvido: true, motivo: 'ok', via: 'files',
        conteudo: 'linha um\nlinha dois', metodo: 'arquivo inteiro', intervalo: { inicio: 1, fim: 2 } }),
      ponteiro('ptr-2', 'Handoff anterior', 'docs/h.json#tudo', 'CHECK', { resolvido: true, motivo: 'ok', via: 'orkmind',
        orkmind: 'orkmind://handoff/h-1', conteudo: 'resumo do handoff', metodo: 'entrada handoff recuperada por tag na memoria semantica' }),
    ],
    adiados: [ponteiro('ptr-3', 'Licao da thread anterior', 'docs/licao.json#json:resumo', 'MASTER')],
    falhas: [ponteiro('ptr-4', 'Notas que sumiram', 'sumiu.md#tudo', 'CHECK', { motivo: 'nao-resolve',
      detalhe: 'ponteiro nao resolve: arquivo "sumiu.md" nao existe a partir de /repo' })] };
  caso(casos, 'recall: texto com resolvidos, adiados e falhas', () => textoDoRecall(recall as never));
  caso(casos, 'recall: texto de todos sem conteudo', () => textoDoRecall({ ...recall, momento: null, falhas: [] } as never, false));
}

function pedido(id: string, thread: string, estado: string, liberaEm: string, estimada: boolean, tentativas: number) {
  return { id, thread, fase: 'GO', slug: `${thread}-go`, promptPath: `.orkastery/threads/${thread}/prompts/go.md`, promptSha256: SHA_64,
    cwd: '/repo', model: null, effort: null,
    sinal: { resetEm: estimada ? null : liberaEm, fonte: estimada ? 'sem-horario' : 'iso', trecho: 'usage limit reached' },
    liberaEm, janelaEstimada: estimada, tentativas, estado, criadoEm: T0, atualizadoEm: T0, detalhe: 'limite de uso do runtime' };
}

function casosDoRetryPuro(casos: Casos): void {
  const fila = dirTemp('fila', '<FILA>');
  caso(casos, 'retry: fila vazia', () => tabelaDaFila(fila, T1));
  gravarJsonl(path.join(fila, '.orkastery', 'retry', 'fila.jsonl'), [
    pedido('R1', 'loc-ret', 'aguardando', T2, false, 0), pedido('R2', 'loc-ret', 'retomado', T1, true, 1),
    pedido('R3', 'loc-ret', 'escalado', T1, true, 3), pedido('R4', 'loc-ret', 'cancelado', T0, false, 0),
    pedido('R5', 'loc-ret', 'aguardando', T1, true, 2),
  ]);
  caso(casos, 'retry: fila com os quatro estados', () => tabelaDaFila(fila, T0));
  const base = pedido('R1', 'loc-ret', 'retomado', T1, true, 1);
  const resultado = (p: object, playbook: string, extra: object) => ({ pedido: p, playbook, slug: 'loc-ret-go', despachada: false,
    sessionId: null, verificada: false, motivo: null, detalhe: '', dryRun: false, ...extra });
  caso(casos, 'retry: retomada vazia', () => textoDaRetomada([]));
  caso(casos, 'retry: retomada com os quatro estados', () => textoDaRetomada([
    resultado(base, 'nova-sessao', { slug: 'loc-ret-go-2', despachada: true, sessionId: 'sessao-loc-1', verificada: true,
      detalhe: 'redespachada na sessao sessao-loc-1' }),
    resultado({ ...base, id: 'R2', estado: 'aguardando' }, 'mesma-sessao', { motivo: 'runtime.rate-limited',
      detalhe: `a janela ainda nao liberou (libera em ${T2})` }),
    resultado({ ...base, id: 'R3', estado: 'escalado' }, 'escalada', { motivo: 'human.pending',
      detalhe: '3 retomada(s) do pedido R3 para o limite de 3: escalacao tipada pausa qualquer modo, inclusive #Auto' }),
    resultado({ ...base, id: 'R4', estado: 'cancelado' }, 'mesma-sessao', { detalhe: 'cancelado pelo dono' }),
  ] as never));
}

function casosDoLedgerPuro(casos: Casos): void {
  const hitl = { pedidos: 2, respondidos: 1, semResposta: 0, abertos: 1, paradoMs: 2_700_000, medianaRespostaMs: 240_000,
    maiorRespostaMs: 240_000, metaMedianaMs: 300_000, dentroDaMeta: true, emTexto: { comDependenciaTecnica: 0, foraDaExcecao: 1 } };
  const stats = { schema: 'ork.ledger-stats/v1', periodo: { desde: T0, ate: T2, intervalo: '[desde,ate)' },
    filtros: { thread: null, modo: null, runtime: null }, threads: 2, sessoes: { despachadas: 5, concluidas: 4, retries: 1 },
    throughput: { ships: 1 }, execucao: { milissegundos: 5_400_000, horas: 1.5, cobertura: { medidas: 4, semMedida: 1 } },
    tokens: { input: 1200, cachedInput: 300, uncachedInput: 900, output: 450, total: 1650, cobertura: { medidas: 4, semMedida: 1 } },
    custoReferencia: { natureza: 'estimated_reference', moeda: 'USD', valor: null, sessoesPrecificadas: 0, sessoesSemTarifa: 4,
      tarifasVerificadasEm: T0, fontes: [] },
    leadTime: { mediaMs: null, amostras: 0 }, esperaHumana: { milissegundos: 1_800_000, fechadas: 1, abertas: 1 }, hitlDeConducao: hitl,
    riscosPreventivos: { total: 2, porMotivo: { 'claims.failed': 2 } }, estimativasPlano: { amostras: 1, semIaHoras: 4, iaSemOrkHoras: 2 },
    qualidade: { ledgersCorrompidos: 0, observacoes: ['1 sessao(oes) sem medicao de tokens', 'tarifa ausente para 4 sessao(oes)'] } };
  caso(casos, 'ledger: estatisticas sem cobertura de custo', () => custoComParenteses(textoDasEstatisticas(stats as never)));
  caso(casos, 'ledger: hitl acima da meta', () => linhaDoHitlDeConducao({ ...hitl, medianaRespostaMs: 420_000, dentroDaMeta: false } as never));
  caso(casos, 'ledger: hitl sem resposta medida', () => linhaDoHitlDeConducao({ ...hitl, respondidos: 0, medianaRespostaMs: null,
    maiorRespostaMs: null, dentroDaMeta: null } as never));
}

function casosDoFixCli(casos: Casos, amb: Ambiente): void {
  const repo = projeto('fix', 'loc', amb);
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'fix-a', '--sem-worktree'));
  caso(casos, 'cli fix: sem subcomando', () => texto(ork(repo, amb, 'fix')));
  caso(casos, 'cli fix: subcomando desconhecido', () => texto(ork(repo, amb, 'fix', 'voar', id)));
  caso(casos, 'cli fix: open sem thread', () => texto(ork(repo, amb, 'fix', 'open')));
  caso(casos, 'cli fix: list sem thread', () => texto(ork(repo, amb, 'fix', 'list')));
  caso(casos, 'cli fix: reverify sem thread', () => texto(ork(repo, amb, 'fix', 'reverify')));
  caso(casos, 'cli fix: list sem rodada', () => texto(ork(repo, amb, 'fix', 'list', id)));
  caso(casos, 'cli fix: reverify sem rodada', () => texto(ork(repo, amb, 'fix', 'reverify', id)));
  caso(casos, 'cli fix: open com o CHECK verde', () => texto(ork(repo, amb, 'fix', 'open', id, '--so-claims')));
  ork(repo, amb, 'claims', 'add', id, 'README.md', '--claim', 'o arquivo de notas existe', '--verificar', 'test -f SUMIU.md');
  ork(repo, amb, 'claims', 'add', id, 'README.md', '--claim', 'o readme explica o produto');
  caso(casos, 'cli fix: open com claim reprovada', () => texto(ork(repo, amb, 'fix', 'open', id, '--so-claims')));
  caso(casos, 'cli fix: list da rodada', () => texto(ork(repo, amb, 'fix', 'list', id)));
  caso(casos, 'cli fix: list de rodada que nao existe', () => texto(ork(repo, amb, 'fix', 'list', id, '--rodada', '7')));
  caso(casos, 'cli fix: reverify parcial com tipo B', () => texto(ork(repo, amb, 'fix', 'reverify', id, '--parcial')));
  // O verify completo imprime o sha curto do HEAD, que muda a cada rodada (o commit do repo leva o instante) e pode
  // sair so com letras, fora do alcance do normalizador comum.
  const semSha = (s: string) => s.replace(/(Verify completo no HEAD )[0-9a-f]{7,40}/g, '$1<SHA7>');
  caso(casos, 'cli fix: reverify completo', () => semSha(texto(ork(repo, amb, 'fix', 'reverify', id))));
  caso(casos, 'cli fix: open com reverify', () => semSha(texto(ork(repo, amb, 'fix', 'open', id, '--so-claims', '--reverify'))));
  caso(casos, 'cli fix: open com reverify ate a escalacao', () => semSha(texto(ork(repo, amb, 'fix', 'open', id, '--so-claims', '--reverify'))));
  const outra = idDaThread(ork(repo, amb, 'thread', 'new', 'fix-b', '--sem-worktree'));
  gravarJsonl(path.join(dirDaThread(repo, outra), 'fixes.jsonl'), [
    { ...correcao('FX1', 'B', 'verify.regression', 'comando test', ['test -f README.md'], 'reprovada'), thread: outra },
    { ...correcao('FX2', 'A', 'claims.unverifiable', 'claim C2', [], 'aprovada'), thread: outra },
  ]);
  caso(casos, 'cli fix: list gravada a mao', () => texto(ork(repo, amb, 'fix', 'list', outra, '--rodada', '1')));
}

function casosDoHandoffCli(casos: Casos, amb: Ambiente): void {
  const repo = projeto('handoff', 'loc', amb);
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'hand-a', '--sem-worktree'));
  fs.writeFileSync(path.join(repo, 'dados.json'), JSON.stringify({ a: { b: 'valor guardado' } }) + '\n');
  caso(casos, 'cli handoff: sem subcomando', () => texto(ork(repo, amb, 'handoff')));
  caso(casos, 'cli handoff: subcomando desconhecido', () => texto(ork(repo, amb, 'handoff', 'voar', id)));
  caso(casos, 'cli handoff: export sem thread', () => texto(ork(repo, amb, 'handoff', 'export')));
  caso(casos, 'cli handoff: recall sem thread', () => texto(ork(repo, amb, 'handoff', 'recall')));
  caso(casos, 'cli handoff: recall sem ponteiro', () => texto(ork(repo, amb, 'handoff', 'recall', id)));
  caso(casos, 'cli handoff: recall do arquivo inteiro', () => texto(ork(repo, amb, 'handoff', 'recall', id, 'README.md')));
  caso(casos, 'cli handoff: recall de campo do json', () => texto(ork(repo, amb, 'handoff', 'recall', id, 'dados.json#json:a.b')));
  caso(casos, 'cli handoff: recall de arquivo que nao existe', () => texto(ork(repo, amb, 'handoff', 'recall', id, 'sumiu.md')));
  caso(casos, 'cli recall: sem thread', () => texto(ork(repo, amb, 'recall')));
  caso(casos, 'cli recall: sem handoff', () => texto(ork(repo, amb, 'recall', id)));
  // O sha de arquivo com instante dentro (thread.json, ledger) e o carimbo do historico mudam a cada rodada.
  caso(casos, 'cli handoff: export', () => texto(ork(repo, amb, 'handoff', 'export', id, '--proxima-fase', 'PLAN'))
    .replace(/\b[0-9a-f]{12}\b/g, '<SHA12>').replace(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/g, '<CARIMBO>'));
  const ponteiro = (n: number, titulo: string, location: string, quando: string) => ({ id: `ptr-${n}`, tier: 'IMPORTANTE', titulo,
    source: location.split('#')[0], location, sha256: SHA_64, retrieve_via: `ork handoff recall ${id} "${location}"`, retrieve_when: quando });
  fs.writeFileSync(path.join(dirDaThread(repo, id), 'handoff.json'), JSON.stringify({ versao: 1, thread: id, geradoEm: T0, memory: 'files',
    de: { slug: `${id}-go`, fase: 'GO' }, para: { slug: `${id}-check`, fase: 'CHECK' }, inline: [], summaries: [],
    pointers: [ponteiro(1, 'Readme do projeto', 'README.md#tudo', 'GO'), ponteiro(2, 'Notas que sumiram', 'sumiu.md#tudo', 'GO'),
      ponteiro(3, 'Primeira linha do readme', 'README.md#L1', 'CHECK')] }, null, 2) + '\n');
  caso(casos, 'cli recall: momento GO', () => texto(ork(repo, amb, 'recall', id, '--fase', 'GO')));
  caso(casos, 'cli recall: sem momento', () => texto(ork(repo, amb, 'recall', id)));
  caso(casos, 'cli recall: todos sem conteudo', () => texto(ork(repo, amb, 'recall', id, '--todos', '--sem-conteudo')));
}

function casosDoRetryCli(casos: Casos, amb: Ambiente): void {
  const repo = projeto('retry', 'loc', amb);
  caso(casos, 'cli retry: policy', () => texto(ork(repo, amb, 'retry', 'policy')));
  caso(casos, 'cli retry: policy de um motivo automatico', () => texto(ork(repo, amb, 'retry', 'policy', '--motivo', 'claims.failed')));
  caso(casos, 'cli retry: policy de um motivo sem retry', () => texto(ork(repo, amb, 'retry', 'policy', '--motivo', 'cost.violation')));
  caso(casos, 'cli retry: policy de motivo desconhecido', () => texto(ork(repo, amb, 'retry', 'policy', '--motivo', 'voar')));
  caso(casos, 'cli retry: parse sem texto', () => texto(ork(repo, amb, 'retry', 'parse')));
  caso(casos, 'cli retry: parse sem sinal', () => texto(ork(repo, amb, 'retry', 'parse', '--stderr', 'tudo certo por aqui')));
  caso(casos, 'cli retry: parse com hora iso', () => texto(ork(repo, amb, 'retry', 'parse', '--stderr',
    `Error: rate limit reached, resets at ${T2}`)));
  caso(casos, 'cli retry: parse sem hora', () => texto(ork(repo, amb, 'retry', 'parse', '--stderr', 'Error: 429 Too Many Requests')));
  caso(casos, 'cli retry: sem subcomando', () => texto(ork(repo, amb, 'retry')));
  caso(casos, 'cli retry: subcomando desconhecido', () => texto(ork(repo, amb, 'retry', 'voar')));
  caso(casos, 'cli retry: list vazio', () => texto(ork(repo, amb, 'retry', 'list')));
  caso(casos, 'cli retry: resume com a fila vazia', () => texto(ork(repo, amb, 'retry', 'resume')));
  caso(casos, 'cli retry: cancel sem motivo', () => texto(ork(repo, amb, 'retry', 'cancel', 'R1')));
  caso(casos, 'cli retry: cancel de pedido que nao existe', () => texto(ork(repo, amb, 'retry', 'cancel', 'R9', '--motivo', 'teste')));
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'retry-a', '--sem-worktree'));
  gravarJsonl(path.join(repo, '.orkastery', 'retry', 'fila.jsonl'), [
    pedido('R1', id, 'aguardando', T2, false, 0), pedido('R2', id, 'retomado', T1, true, 1),
    pedido('R3', id, 'escalado', T1, true, 3), pedido('R4', id, 'cancelado', T0, false, 0), pedido('R5', id, 'aguardando', T1, true, 3),
  ]);
  caso(casos, 'cli retry: list com os quatro estados', () => texto(ork(repo, amb, 'retry', 'list')));
  caso(casos, 'cli retry: resume antes da janela', () => texto(ork(repo, amb, 'retry', 'resume', '--id', 'R1', '--agora', T0)));
  caso(casos, 'cli retry: resume sem pedido vencido', () => texto(ork(repo, amb, 'retry', 'resume', '--agora', T0)));
  caso(casos, 'cli retry: resume escalado', () => texto(ork(repo, amb, 'retry', 'resume', '--id', 'R5', '--agora', T2)));
  caso(casos, 'cli retry: cancel', () => texto(ork(repo, amb, 'retry', 'cancel', 'R1', '--motivo', 'o dono retoma a fase a mao')));
  caso(casos, 'cli retry: list depois do cancel', () => texto(ork(repo, amb, 'retry', 'list')));
}

function casosDoLedgerCli(casos: Casos, amb: Ambiente): void {
  const repo = projeto('ledger', 'loc', amb);
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'ledger-a', '--sem-worktree'));
  caso(casos, 'cli ledger: sem subcomando', () => texto(ork(repo, amb, 'ledger')));
  caso(casos, 'cli ledger: stats sem periodo', () => texto(ork(repo, amb, 'ledger', 'stats')));
  caso(casos, 'cli ledger: estimate sem campos', () => texto(ork(repo, amb, 'ledger', 'estimate', id, '--sem-ia', '4')));
  caso(casos, 'cli ledger: estimate', () => texto(ork(repo, amb, 'ledger', 'estimate', id, '--sem-ia', '4', '--ia-sem-ork', '2.5',
    '--por', 'sessao PLAN', '--metodo', 'pontos por tarefa', '--premissas', 'sem bloqueio externo')));
  caso(casos, 'cli ledger: stats de periodo sem evento', () => custoComParenteses(texto(ork(repo, amb, 'ledger', 'stats',
    '--desde', '2025-09-19T00:00:00.000Z', '--ate', '2025-09-20T00:00:00.000Z'))));
}

export function gerarGrupo(casos: Casos, amb: Ambiente): void {
  casosDoFixPuro(casos);
  casosDoHandoffEDoRecallPuros(casos);
  casosDoRetryPuro(casos);
  casosDoLedgerPuro(casos);
  casosDoFixCli(casos, amb);
  casosDoHandoffCli(casos, amb);
  casosDoRetryCli(casos, amb);
  casosDoLedgerCli(casos, amb);
}
