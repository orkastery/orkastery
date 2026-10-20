/**
 * RM-061, F3d (snapshot pt-BR): `memory` (o bloco `operacao.restante.memory`), a memoria injetada no prompt de fase
 * (`prompts.memoria`) e o `ork grafo`. Sem banco nem embeddings de verdade: as funcoes de texto com entradas fixas, o
 * regime files e um OrkMind falso (script node no lugar do Python da ponte, como no `busca-semantica.test.ts`).
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { textoDaBuscaPorSignificado } from '../src/busca-semantica';
import { textoDoIndice } from '../src/indice-vetorial';
import { AVISO_DE_PARCIALIDADE, textoDaResposta } from '../src/intelligence-graph-query';
import { msg } from '../src/locale';
import { injecaoDaFase, textoDaInjecao, textoDoEstado, textoDosEmbeddings, textoDoSync } from '../src/memoria';
import { exec } from '../src/util';
import { Ambiente, caso, Casos, dirTemp, idDaThread, ork, orkComEnv, projeto, SHA_A, T0, T1, texto } from './locale-f3d-apoio';

/** As datas dos commits do repositorio do grafo: commit igual, revisao igual, em qualquer rodada. */
const COMMIT_A = '2025-09-19T18:16:00Z';
const COMMIT_B = '2025-09-19T18:21:30Z';
const DSN_FALSA = 'postgresql://teste@db.invalido:5432/memoria';

function escrever(raiz: string, relativo: string, conteudo: string): void {
  fs.mkdirSync(path.dirname(path.join(raiz, relativo)), { recursive: true });
  fs.writeFileSync(path.join(raiz, relativo), conteudo);
}

function trocarNoManifesto(repo: string, trocas: ReadonlyArray<readonly [RegExp, string]>): void {
  const arquivo = path.join(repo, 'orkastery.yaml');
  let t = fs.readFileSync(arquivo, 'utf8');
  for (const [de, para] of trocas) {
    if (!de.test(t)) throw new Error(`manifesto sem ${String(de)}`);
    t = t.replace(de, para);
  }
  fs.writeFileSync(arquivo, t);
}

// ---------------------------------------------------------------------------------------------------------------------
// memory: as funcoes de texto, com entradas fixas
// ---------------------------------------------------------------------------------------------------------------------

/** Embeddings sem `memory.embedding` no manifesto: a busca por significado desligada. */
const DESLIGADA = {
  configurado: false, provider: 'none', modelo: null, dim: null, variavelDaChave: '', chavePresente: false,
  fallback: { modelo: null, presente: false, dependencias: false, dim: null }, indices: [], entradas: null, cobertura: null,
  universo: null, aviso: null, falhaDoUniverso: null, ativo: 'nenhum', sondado: false, motivo: 'embeddings.nao-configurado',
  detalhe: 'memory.embedding ausente ou provider none: busca por significado desligada; o recall por tag segue identico',
  correcao: 'declare memory.embedding no manifesto (provider openrouter e api_key_env com o NOME da variavel da chave)',
};
/** Declarados: o primario `org/primario` de 1024 dim, com a chave em LOJA_EMB_KEY. */
const DECLARADA = { ...DESLIGADA, configurado: true, provider: 'openrouter', modelo: 'org/primario', dim: 1024, variavelDaChave: 'LOJA_EMB_KEY' };
const E5 = 'intfloat/multilingual-e5-small';
const SEM_CHAVE = {
  motivo: 'embeddings.chave-ausente',
  correcao: 'exporte LOJA_EMB_KEY com a chave dedicada ao Orkastery; o valor nunca vai ao manifesto',
};

function casosDoEstado(casos: Casos): void {
  const comum = { pedido: 'orkmind', tenant: 'loja', cli: 'orkmind' };
  caso(casos, 'memory: estado degradado sem variavel', () => textoDoEstado({ ...comum, efetivo: 'files', variavel: '', dsnPresente: false,
    motivo: 'dsn.nao-declarado', detalhe: 'memory.database_url_env vazio: sem base declarada o ork nao conecta em base nenhuma',
    correcao: 'declare memory.database_url_env no manifesto com o NOME da variavel da DSN' } as never));
  caso(casos, 'memory: estado ativo com embeddings', () => textoDoEstado({ ...comum, efetivo: 'orkmind', variavel: 'LOJA_DSN',
    dsnPresente: true, motivo: null, detalhe: 'cli:orkmind ativo na base declarada por LOJA_DSN: ponte OrkMind respondeu a sonda health',
    correcao: '', embeddings: DESLIGADA } as never));
}

function casosDosEmbeddings(casos: Casos): void {
  const linhas = (e: object): string => textoDosEmbeddings(e as never).join('\n');
  caso(casos, 'memory: embeddings desligados', () => linhas(DESLIGADA));
  caso(casos, 'memory: embeddings pelo primario com indice', () => linhas({ ...DECLARADA, chavePresente: true, sondado: true,
    ativo: 'primario', fallback: { modelo: E5, presente: true, dependencias: true, dim: 384 },
    universo: { porColecao: { decision: 2, rule: 1 }, foraDaBusca: { injecao: 1, expiradas: 2, outrasColecoes: 3 } }, entradas: 3,
    indices: [{ modelo: 'org/primario', dim: 1024, vetores: 3, coerentes: 2, desatualizados: 1 }, { modelo: E5, dim: 384, vetores: 1 }],
    cobertura: 0.6667, aviso: 'o indice do primario cobre 2 de 3 entradas do universo: rode ork memory index',
    sonda: { ok: true, alvo: 'primario', latenciaMs: 120, motivo: null },
    motivo: null, detalhe: 'primario org/primario (1024 dim) pela chave em LOJA_EMB_KEY', correcao: '' }));
  caso(casos, 'memory: embeddings sem chave e fallback fora do cache', () => linhas({ ...DECLARADA, ...SEM_CHAVE, sondado: true,
    fallback: { modelo: E5, presente: false, dependencias: false, dim: null }, falhaDoUniverso: 'memory.query.window-saturated',
    sonda: { ok: false, alvo: null, latenciaMs: null, motivo: null },
    detalhe: `LOJA_EMB_KEY nao esta no ambiente (valor nunca impresso); fallback ${E5} ausente do cache local: a busca cai para FTS` }));
  caso(casos, 'memory: embeddings com a ponte nao sondada', () => linhas({ ...DECLARADA, ...SEM_CHAVE,
    fallback: { modelo: E5, presente: true, dependencias: false, dim: 384 },
    universo: { porColecao: { decision: 0, rule: 0 }, foraDaBusca: null }, entradas: 0, cobertura: null,
    sonda: { ok: false, alvo: 'fallback', latenciaMs: 30, motivo: 'embeddings.timeout' },
    detalhe: 'LOJA_EMB_KEY nao esta no ambiente (valor nunca impresso); ponte nao sondada: fallback local nao conferido' }));
  caso(casos, 'memory: embeddings sem fallback declarado', () => linhas({ ...DECLARADA, chavePresente: true, sondado: true,
    ativo: 'primario', motivo: 'embeddings.indice-ausente',
    detalhe: 'chave presente em LOJA_EMB_KEY; o indice local de org/primario ainda nao existe',
    correcao: 'rode ork memory index (use --dry-run antes para ver tokens e custo)' }));
}

function casosDoSync(casos: Casos): void {
  const semGravar = (detalhe: string) => ({ ok: false, id: null, duplicada: false, collection: 'rule', detalhe });
  const files = 'regime files: nada foi para a memoria semantica (degradacao honesta)';
  caso(casos, 'memory: sync em regime files', () => textoDoSync({ regime: 'files', thread: null,
    decisoes: { regime: 'files', gravadas: [], detalhe: files },
    policies: { regime: 'files', gravadas: [semGravar('regime files'), semGravar('regime files')], detalhe: files },
    humanos: { elegiveis: 0, excluidos: 0, falhas: 0 }, handoff: null, learning: semGravar('memory.g3.unavailable'), roadmap: null,
    total: 3, falhas: 3, estado: { detalhe: 'manifesto opera em regime files (fallback honesto do B1)',
      correcao: 'para ligar a memoria semantica: memory.mode: orkmind + memory.database_url_env no manifesto' } } as never));
  caso(casos, 'memory: sync da thread com publicacao pendente', () => textoDoSync({ regime: 'orkmind', thread: 'loj-a', perfil: 'fabrica',
    colecoesForaDoPerfil: ['learning', 'roadmap'], publicacao: { estado: 'pendente', motivo: 'write.activation.inactive' },
    decisoes: { regime: 'orkmind', gravadas: [{ ok: true, id: 'd-1', duplicada: false }], detalhe: '1 decisao fechada gravada' },
    policies: { regime: 'orkmind', gravadas: [], detalhe: 'nenhuma policy nova' },
    humanos: { elegiveis: 2, excluidos: 1, falhas: 0 }, handoff: { ok: true, id: 'h-1', duplicada: false },
    learning: { ok: true, id: 'l-1', duplicada: true }, roadmap: semGravar('memory.transport.failed'),
    total: 4, falhas: 1, estado: { detalhe: 'cli:orkmind ativo', correcao: '' } } as never));
}

function casosDoIndiceVetorial(casos: Casos): void {
  caso(casos, 'memory: indice em dry-run com custo', () => textoDoIndice({ alvo: 'primario', dryRun: true, modelo: 'org/primario', dim: 1024,
    universo: 5, porColecao: { decision: 3, rule: 2 }, coerentes: 2, foraDaBusca: { injecao: 1, expiradas: 0, outrasColecoes: 4 },
    embedados: 0, reescritos: 0, removidos: 0, recusados: 1, foraDoLimite: 0, truncados: 0, tokensEstimados: 1200,
    custoEstimadoUsd: 0.0000012, chamadasAoProvider: 0, arquivo: null, motivo: null, detalhe: 'dry-run: nada foi embedado' } as never));
  caso(casos, 'memory: indice do fallback com motivo', () => textoDoIndice({ alvo: 'fallback', dryRun: false, modelo: null, dim: null,
    universo: 0, porColecao: {}, coerentes: 0, foraDaBusca: null, embedados: 2, reescritos: 1, removidos: 1, recusados: 0, foraDoLimite: 1,
    truncados: 3, tokensEstimados: 0, custoEstimadoUsd: null, chamadasAoProvider: 2, arquivo: '.orkastery/memoria/vetores/loja/e5-384.json',
    motivo: 'embeddings.fallback-indisponivel', detalhe: 'sem torch/transformers no interpretador da ponte' } as never));
}

function casosDaBuscaPorSignificado(casos: Casos): void {
  const vazia = { texto: 'como funciona a fila', modo: 'hibrido', origem: 'nenhum', modeloUsado: null, deterministico: false, resultados: [] };
  caso(casos, 'memory: busca por significado em regime files', () => textoDaBuscaPorSignificado({ ...vazia, motivo: 'modo.files',
    detalhe: 'manifesto opera em regime files (fallback honesto do B1); correcao: memory.mode: orkmind' } as never));
  caso(casos, 'memory: busca por significado com resultados', () => textoDaBuscaPorSignificado({ ...vazia, modo: 'vetor',
    origem: 'primario', modeloUsado: 'org/primario', detalhe: 'o indice cobre 2 de 3 entradas do universo', resultados: [
      { collection: 'decision', id: 'd-1', score: 0.0328, fontes: ['vetor', 'fts'], similaridade: 0.91, resumo: 'Usar fila duravel' },
      { collection: 'learning', id: 'l-2', score: 0.0161, fontes: ['fts'], similaridade: null, resumo: 'Rode a baseline antes do GO' },
    ] } as never));
}

/** `injecaoDaFase` com uma memoria falsa ativa e com o regime files; a licao dos POSTMORTEMs vem do disco. */
function casosDaInjecao(casos: Casos): void {
  const raiz = dirTemp('injecao', '<PROJ>');
  escrever(raiz, '.orkastery/threads/loj-velha/POSTMORTEM.json', JSON.stringify({ thread: 'loj-velha',
    classesDeFalha: ['erro-de-spec'], gatesBloqueados: [{ motivo: 'claims.failed' }], geradoEm: T0 }));
  escrever(raiz, '.orkastery/threads/loj-velha/master-log.json', JSON.stringify({ score: 2,
    justificativa: 'faltou prova local das claims', avaliadoEm: T1 }));
  const carregado = { raiz, caminho: path.join(raiz, 'orkastery.yaml'), manifesto: { project: { name: 'loja' }, memory: { tenant: '' } } };
  const entrada = (id: string, collection: string, content: string, situation: string[], mandatory = false) => ({ id, collection, content,
    tags: { project: ['loja'], situation }, priority: 'normal', mandatory, scope: 'project', source: 'agent', metadata: {}, criadaEm: T0 });
  const naMemoria: Record<string, unknown[]> = {
    decision: [entrada('d-1', 'decision', 'Usar fila duravel', ['decisao:D1']),
      entrada('d-3', 'decision', 'Cache com prazo de 5 min', ['decisao:D3']), entrada('d-9', 'decision', 'Decisao gravada sem id', [])],
    learning: [entrada('l-1', 'learning', 'Rode a baseline antes do GO', ['thread:loj-b']),
      entrada('l-2', 'learning', 'Licao sem thread de origem', []), entrada('l-3', 'learning', 'Licao da propria thread', ['thread:loj-a'])],
    rule: [entrada('r-1', 'rule', 'Nunca publique segredo\nconfira o diff antes do push', [], true),
      entrada('r-2', 'rule', 'Regra sem mandatory', [])],
  };
  const ativa = { ativo: true, regime: 'orkmind', leituraRestrita: null, buscar: (q: { collection: string }) => naMemoria[q.collection] ?? [] };
  const emArquivos = { ativo: false, regime: 'files', leituraRestrita: null, buscar: () => [] };
  const thread = { id: 'loj-a', decisoes: [{ id: 'D1', locked: true, decididaPor: 'humano', texto: 'Usar fila duravel\npara o reenvio' },
    { id: 'D2', locked: false, decididaPor: 'agente', texto: 'Ainda aberta' }] };
  caso(casos, 'prompts: memoria injetada no GOAL', () => injecaoDaFase(carregado as never, ativa as never, thread as never, 'GOAL').texto);
  caso(casos, 'prompts: memoria injetada no PLAN em regime files',
    () => injecaoDaFase(carregado as never, emArquivos as never, thread as never, 'PLAN').texto);
  const item = (colecao: string, titulo: string, mandatory: boolean) => ({ id: `inj-${colecao}`, colecao, titulo,
    conteudo: `${titulo}\n\n  com detalhe`, origem: 'orkmind', location: `orkmind://${colecao}/x-1`, mandatory });
  caso(casos, 'prompts: memoria injetada com handoff e roadmap', () => textoDaInjecao([item('roadmap', 'RM-061 em andamento', false),
    item('handoff', 'Handoff do GOAL para o PLAN', true)] as never, 'orkmind' as never));
  caso(casos, 'prompts: memoria injetada vazia', () => textoDaInjecao([], 'files' as never));
}

// ---------------------------------------------------------------------------------------------------------------------
// cli memory
// ---------------------------------------------------------------------------------------------------------------------

/**
 * OrkMind falso, como o do `busca-semantica.test.ts`: um script node no lugar do Python da ponte, com a base vazia e
 * sem gravacao (o handoff e recusado). O arquivo-sinal `universo-falha` faz a leitura do universo da busca recusar
 * (janela saturada).
 */
function orkmindFalso(): { cli: string; falharUniverso: () => void } {
  const dir = dirTemp('orkmind', '<ORKMIND>');
  const ponte = path.join(dir, 'python-falso');
  fs.writeFileSync(ponte, `#!${process.execPath}
const fs = require('fs'), path = require('path');
const q = JSON.parse(fs.readFileSync(0, 'utf8'));
const falha = (codigo) => { console.log(JSON.stringify({ error: codigo })); process.exit(1); };
const contagens = { decision: 0, handoff: 0, rule: 0, learning: 0, roadmap: 0 };
if (q.op === 'health') console.log(JSON.stringify({ contagens, orkmind: 'teste', fallback: { dependencias: false } }));
else if (q.op === 'stats') console.log(JSON.stringify(contagens));
else if (q.op === 'export') console.log('[]');
else if (q.op === 'fts') console.log(JSON.stringify({ ids: [] }));
else if (q.op !== 'universo') falha('memory.bridge.failed');
else if (fs.existsSync(path.join(__dirname, 'universo-falha'))) falha('memory.query.window-saturated');
else console.log(JSON.stringify({ entradas: [], foraDaBusca: null }));
`, { mode: 0o755 });
  const cli = path.join(dir, 'orkmind');
  fs.writeFileSync(cli, `#!${ponte}\n`, { mode: 0o755 });
  return { cli, falharUniverso: () => fs.writeFileSync(path.join(dir, 'universo-falha'), '') };
}

function casosDoMemoryCli(casos: Casos, amb: Ambiente): void {
  const repo = projeto('memoria', 'mem', amb);
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'mem-a', '--sem-worktree'));
  // Duas fontes do inventario: o handoff no contrato (entra) e uma nota em markdown (fica fora).
  escrever(repo, `.orkastery/threads/${id}/handoffs/nota.md`, '# nota de handoff\n');
  escrever(repo, `.orkastery/threads/${id}/handoff.json`, JSON.stringify({ versao: 1, thread: id,
    de: { slug: `${id}-goal`, fase: 'GOAL' }, para: { slug: `${id}-plan`, fase: 'PLAN' }, inline: [], pointers: [], summaries: [] }));
  const tags = JSON.stringify({ project: ['memoria'] });
  const m = (...args: string[]): string => texto(ork(repo, amb, 'memory', ...args));
  caso(casos, 'cli memory: status em regime files', () => m());
  caso(casos, 'cli memory: search sem tags', () => m('search'));
  // A mensagem do JSON.parse e do V8 e muda com a versao do Node: fica o texto do catalogo.
  caso(casos, 'cli memory: search com tags invalidas', () => m('search', '--tags', '{')
    .replace(/(--tags nao e JSON valido: ).*/, '$1<ERRO DO JSON.parse>'));
  caso(casos, 'cli memory: search por tag em regime files', () => m('search', '--tags', tags));
  caso(casos, 'cli memory: search restrito em regime files', () => m('search', '--thread', id, '--colecao', 'decision', '--tags', tags));
  caso(casos, 'cli memory: search por texto com tags', () => m('search', '--texto', 'fila', '--tags', tags));
  caso(casos, 'cli memory: search por texto com modo invalido', () => m('search', '--texto', 'fila', '--modo', 'nada'));
  caso(casos, 'cli memory: search por texto em regime files', () => m('search', '--texto', 'como funciona a fila'));
  caso(casos, 'cli memory: index com modelo invalido', () => m('index', '--modelo', 'x'));
  caso(casos, 'cli memory: index em regime files', () => m('index'));
  caso(casos, 'cli memory: subcomando desconhecido', () => m('voar'));
  caso(casos, 'cli memory: inventory', () => m('inventory', '--escopo', id));
  caso(casos, 'cli memory: sync da thread em regime files', () => m('sync', id));

  // orkmind pedido, sem a DSN no ambiente: degrada para files, e o sync sem ativacao de escrita recusa.
  trocarNoManifesto(repo, [[/^ {2}mode: files$/m, '  mode: orkmind'],
    [/^ {2}database_url_env: ""$/m, '  database_url_env: "TESTE_MEMORIA_DSN"']]);
  caso(casos, 'cli memory: status orkmind sem a dsn', () => m('status'));
  caso(casos, 'cli memory: sync sem ativacao de escrita', () => m('sync'));

  // OrkMind falso ativo, com embeddings declarados e sem a chave no ambiente.
  const falso = orkmindFalso();
  trocarNoManifesto(repo, [[/^ {2}cli: orkmind$/m, `  cli: ${falso.cli}`], [/^ {2}timeout_ms: 15000$/m,
    '  timeout_ms: 15000\n  embedding:\n    provider: openrouter\n    model: "org/primario"\n    dim: 32\n    api_key_env: "TESTE_MEMORIA_CHAVE"']]);
  const comDsn = (...args: string[]): string => texto(orkComEnv(repo, amb, { TESTE_MEMORIA_DSN: DSN_FALSA }, 'memory', ...args));
  caso(casos, 'cli memory: status com orkmind ativo', () => comDsn('status'));
  caso(casos, 'cli memory: search por tag com orkmind ativo', () => comDsn('search', '--tags', tags));
  caso(casos, 'cli memory: index em dry-run com orkmind ativo', () => comDsn('index', '--dry-run'));

  // A migracao pede a ativacao de escrita: as duas leases da operadora, o plano e o aceite de CHECK do hash dele.
  const ativacao = dirTemp('ativacao', '<ATIVACAO>');
  const plano = path.join(ativacao, 'plano.json');
  const aceite = path.join(ativacao, 'aceite.json');
  ork(repo, amb, 'lease', 'acquire', 'path:.orkastery/monitor', '--thread', id);
  ork(repo, amb, 'lease', 'acquire', `worktree-write:${id}`, '--thread', id);
  const planejado = ork(repo, amb, 'activation', 'plan', '--escopo', id, '--alvos', 'memory', '--perfil', 'integral', '--saida', plano);
  if (planejado.status !== 0) throw new Error(`activation plan falhou: ${planejado.stderr}`);
  const shaDoPlano = (JSON.parse(planejado.stdout) as { sha256: string }).sha256;
  const doPlano = JSON.parse(fs.readFileSync(plano, 'utf8')) as { head: string; tenant: string; perfil: string };
  const textoDoAceite = `${JSON.stringify({ schema: 'ork.write-acceptance/v1', aprovado: true, fase: 'CHECK', revisor: 'revisor-teste',
    planoSha256: shaDoPlano, head: doPlano.head, tenant: doPlano.tenant, perfil: doPlano.perfil })}\n`;
  fs.writeFileSync(aceite, textoDoAceite, { mode: 0o600 });
  const habilitada = ork(repo, amb, 'activation', 'enable', '--plano', plano, '--plano-sha256', shaDoPlano, '--aceite', aceite,
    '--aceite-sha256', createHash('sha256').update(textoDoAceite).digest('hex'), '--operadora', id, '--por', 'revisor-teste');
  if (habilitada.status !== 0) throw new Error(`activation enable falhou: ${habilitada.stderr}`);
  caso(casos, 'cli memory: migrate com a ponte recusando o handoff', () => comDsn('migrate', '--operadora', id, '--escopo', id));

  falso.falharUniverso();
  caso(casos, 'cli memory: index sem o universo da busca', () => comDsn('index'));
  caso(casos, 'cli memory: search por texto sem o universo da busca', () => comDsn('search', '--texto', 'como funciona a fila'));
}

// ---------------------------------------------------------------------------------------------------------------------
// grafo
// ---------------------------------------------------------------------------------------------------------------------

/** Git com autor e data fixos e sem a configuracao de quem roda: o mesmo commit, a mesma revisao, em toda rodada. */
function gitFixo(dir: string, amb: Ambiente, quando: string, ...args: string[]): void {
  const r = exec('git', args, dir, 120000, { PATH: process.env.PATH ?? '', HOME: amb.casa, GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Teste Orkastery', GIT_AUTHOR_EMAIL: 'teste@orkastery.local', GIT_AUTHOR_DATE: quando,
    GIT_COMMITTER_NAME: 'Teste Orkastery', GIT_COMMITTER_EMAIL: 'teste@orkastery.local', GIT_COMMITTER_DATE: quando });
  if (!r.ok) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

/**
 * A versao do Node (no analisador de JavaScript e no extrator TypeScript) e a do Unicode entram na chave do indice, no
 * snapshot e nos digests: saem do texto, para o snapshot valer em qualquer Node. O tempo da construcao e o tamanho do
 * pacote JSON do contexto (que leva as versoes) tambem. Revisao, contagens e a redacao ficam.
 */
function semONodeDeQuemRoda(t: string): string {
  return t
    .replace(/\bnode\.\d+\.\d+\.\d+\b/g, 'node.<VERSAO>')
    .replace(/\bunicode([ .])\d+\.\d+\b/g, 'unicode$1<VERSAO>')
    .replace(/\b(idx|snap)-[0-9a-f]{12,64}\b/g, '$1-<HEX>')
    .replace(/\b(digest|relatorio|unidades)( +)[0-9a-f]{16,64}\b/g, '$1$2<HEX>')
    .replace(/^( {2}tempo +)\d+ ms$/gm, '$1<MS> ms')
    .replace(/\b\d+ bytes JSON\b/g, '<N> bytes JSON');
}

/** Tres modulos TypeScript em cadeia e um guia em markdown com links: todas as arestas do indice, num commit fixo. */
function repoDoGrafo(amb: Ambiente): string {
  const repo = dirTemp('grafo', '<GRAFO>');
  gitFixo(repo, amb, COMMIT_A, 'init', '-q', '-b', 'main');
  escrever(repo, 'src/c.ts', 'export function c(): number {\n  return 3;\n}\n');
  escrever(repo, 'src/b.ts', "import { c } from './c';\n\nexport function b(): number {\n  return c() * 2;\n}\n");
  escrever(repo, 'src/a.ts', "import { b } from './b';\n\nexport function a(): number {\n  return b() + 1;\n}\n");
  escrever(repo, 'docs/guia.md', '# Guia\n\nVeja [a funcao a](../src/a.ts) e o [modulo b](../src/b.ts).\n');
  gitFixo(repo, amb, COMMIT_A, 'add', '--', 'src', 'docs');
  gitFixo(repo, amb, COMMIT_A, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'inicial');
  // O manifesto e o AGENTS.md ficam fora do Git: o commit (e a revisao indexada) nao dependem do `ork init`.
  const init = ork(repo, amb, 'init', '--name', 'grafo', '--abbrev', 'gra');
  if (init.status !== 0) throw new Error(`init falhou: ${init.stderr}`);
  return repo;
}

function casosDoGrafoCli(casos: Casos, amb: Ambiente): void {
  const repo = repoDoGrafo(amb);
  const g = (...args: string[]): string => semONodeDeQuemRoda(texto(ork(repo, amb, 'grafo', ...args)));
  const pasta = path.join(repo, '.orkastery', 'grafo');
  caso(casos, 'cli grafo: status sem indice', () => g('status'));
  caso(casos, 'cli grafo: indexar', () => g('indexar'));
  caso(casos, 'cli grafo: indexar com verificacao sem base', () => g('indexar', '--verificar'));
  fs.writeFileSync(path.join(pasta, 'anotacao.txt'), 'nota fora do indice\n');
  caso(casos, 'cli grafo: status com sobras', () => g('status'));
  caso(casos, 'cli grafo: vizinhos', () => g('vizinhos', 'src/b.ts'));
  caso(casos, 'cli grafo: vizinhos com tipo e limite', () => g('vizinhos', 'src/b.ts', '--tipo', 'imports,references', '--limite', '2',
    '--profundidade', '2'));
  caso(casos, 'cli grafo: chamadores', () => g('chamadores', 'c'));
  caso(casos, 'cli grafo: importadores', () => g('importadores', 'src/c.ts'));
  caso(casos, 'cli grafo: caminho', () => g('caminho', 'src/a.ts', 'src/c.ts'));
  caso(casos, 'cli grafo: caminho contra a aresta', () => g('caminho', 'src/c.ts', 'src/a.ts', '--sentido', 'ambos'));
  caso(casos, 'cli grafo: sem caminho', () => g('caminho', 'src/c.ts', 'src/a.ts'));

  // Contexto da thread: a claim no `src/a.ts` e a semente. O pacote JSON que vem depois do texto fica fora.
  const thread = idDaThread(ork(repo, amb, 'thread', 'new', 'ctx-a', '--sem-worktree'));
  ork(repo, amb, 'claims', 'add', thread, 'src/a.ts', '--claim', 'a soma um', '--verificar', 'test -f src/a.ts');
  const contexto = (): string => g('contexto', thread).split('\n').filter((l) => !l.startsWith('{')).join('\n');
  caso(casos, 'cli grafo: contexto', contexto);

  // A amostra gerada, auditada inteira (aprovada) e com tres falhas: sem veredito, aresta fora do indice e trecho trocado.
  const amostra = JSON.parse(ork(repo, amb, 'grafo', 'amostra', '--por-estrato', '1').stdout) as { arestas: Array<Record<string, unknown>> };
  const auditada: Array<Record<string, unknown>> = amostra.arestas.map((a) => ({ ...a, veredito: 'supported', nota: 'conferida no trecho' }));
  const ok = path.join(repo, '.orkastery', 'amostra-ok.json');
  const ruim = path.join(repo, '.orkastery', 'amostra-ruim.json');
  fs.writeFileSync(ok, JSON.stringify({ ...amostra, arestas: auditada }, null, 2));
  fs.writeFileSync(ruim, JSON.stringify({ ...amostra, arestas: auditada.map((a, i) => i === 0 ? { ...a, veredito: null, nota: null }
    : i === 1 ? { ...a, to: { ...(a.to as object), fragment: 'nada' } }
      : i === 2 ? { ...a, evidencia: { ...(a.evidencia as object), trecho_sha256: '0'.repeat(64) } } : a) }, null, 2));
  caso(casos, 'cli grafo: amostra conferida', () => g('amostra', '--conferir', ok));
  caso(casos, 'cli grafo: amostra reprovada', () => g('amostra', '--conferir', ruim));
  caso(casos, 'cli grafo: amostra com por-estrato zero', () => g('amostra', '--por-estrato', '0'));

  // Fonte rastreada mudada sem commit: a resposta e do HEAD, com o aviso e a marca.
  const b = path.join(repo, 'src', 'b.ts');
  const original = fs.readFileSync(b, 'utf8');
  fs.writeFileSync(b, `${original}// nota\n`);
  caso(casos, 'cli grafo: importadores com a arvore modificada', () => g('importadores', 'src/b.ts'));
  caso(casos, 'cli grafo: contexto com a arvore modificada', contexto);
  fs.writeFileSync(b, original);

  // Nome do projeto fora do id de repositorio: sem a chave do indice.
  trocarNoManifesto(repo, [[/^ {2}name: "grafo"$/m, '  name: "grafo dois"']]);
  caso(casos, 'cli grafo: status sem a chave do indice', () => g('status'));
  trocarNoManifesto(repo, [[/^ {2}name: "grafo dois"$/m, '  name: "grafo"']]);

  // Segundo commit: o indice novo prova o incremental a partir do primeiro.
  const antes = new Set(fs.readdirSync(pasta));
  escrever(repo, 'src/c.ts', 'export function c(): number {\n  return 4;\n}\n');
  gitFixo(repo, amb, COMMIT_B, 'add', '--', 'src/c.ts');
  gitFixo(repo, amb, COMMIT_B, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'muda c');
  caso(casos, 'cli grafo: indexar com verificacao incremental', () => g('indexar', '--verificar'));
  const doHead = fs.readdirSync(pasta).find((n) => n.startsWith('idx-') && !antes.has(n));
  if (!doHead) throw new Error('o indice do segundo commit nao apareceu');
  fs.writeFileSync(path.join(pasta, doHead, 'relatorio.json'), '{}');
  caso(casos, 'cli grafo: indexar com indice corrompido', () => g('indexar'));
  caso(casos, 'cli grafo: limpar', () => g('limpar'));

  // Repositorio sem commit (o manifesto copiado basta para o `ork`).
  const vazio = dirTemp('grafo-vazio', '<VAZIO>');
  gitFixo(vazio, amb, COMMIT_A, 'init', '-q', '-b', 'main');
  fs.copyFileSync(path.join(repo, 'orkastery.yaml'), path.join(vazio, 'orkastery.yaml'));
  caso(casos, 'cli grafo: status sem commit', () => semONodeDeQuemRoda(texto(ork(vazio, amb, 'grafo', 'status'))));

  // Erros de uso: um por motivo, conferidos antes de ler o indice.
  const usos: ReadonlyArray<readonly [string, string[]]> = [
    ['sem subcomando', []],
    ['subcomando desconhecido em json', ['voar', '--json']],
    ['opcao repetida', ['indexar', '--forcar', '--forcar']],
    ['bandeira com valor', ['indexar', '--forcar=sim']],
    ['opcao sem valor', ['vizinhos', 'src/a.ts', '--limite']],
    ['opcao desconhecida', ['status', '--rapido']],
    ['argumentos a menos', ['caminho', 'src/a.ts']],
    ['profundidade nao inteira', ['vizinhos', 'src/a.ts', '--profundidade', 'dois']],
    ['tipo desconhecido', ['vizinhos', 'src/a.ts', '--tipo', 'herda']],
    ['sentido desconhecido', ['vizinhos', 'src/a.ts', '--sentido', 'cima']],
    ['teto sem json', ['vizinhos', 'src/a.ts', '--teto-bytes', '100']],
    ['teto zero em json', ['vizinhos', 'src/a.ts', '--json', '--teto-bytes', '0']],
    ['amostra com conferir e por-estrato', ['amostra', '--conferir', 'x.json', '--por-estrato', '2']],
  ];
  for (const [nome, args] of usos) caso(casos, `cli grafo: uso ${nome}`, () => g(...args));
}

/**
 * Nenhum extrator do indice produz trecho `pdf-text`, entao a linha da pagina so sai pela funcao da consulta. O
 * `ork grafo` do HEAD passa a redacao do catalogo (`msg().grafo.consulta`) como segundo argumento; na base ele nao
 * existe (vai `undefined`, e vale o literal), e o texto tem de ser o mesmo.
 */
function casosDaConsulta(casos: Casos): void {
  const redacao = (msg() as unknown as { grafo?: { consulta?: unknown } }).grafo?.consulta;
  const responder = textoDaResposta as unknown as (r: unknown, m?: unknown) => string;
  const fontes = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => ({ path: `docs/${n}.md`, arvore: n === 'g' ? 'ausente' : 'modificada' }));
  caso(casos, 'grafo: resposta com pagina e fontes demais', () => responder({
    consulta: { tipo: 'vizinhos', sentido: 'entrada', profundidade: 1, tipos: ['cites'], limite: null },
    indice: { repository_id: 'loja', revision: SHA_A, chave: `idx-${'ab12'.repeat(16)}`, snapshot_id: `snap-${'cd34'.repeat(16)}`,
      graph_digest: 'ef56'.repeat(16), arvore: 'modificada', extratores: [{ extractor_id: 'ork.md-structure', extractor_version: '1.0.0' }] },
    fontes, alvo: { rotulo: 'file docs/manual.pdf' }, total_arestas: 1, total_nos: 2, truncado: false,
    arestas: [{ kind: 'cites', from: 'file docs/a.md', to: 'file docs/manual.pdf', arvore: 'modificada', evidencias: [{
      extractor_id: 'ork.pdf-text', extraction_method: 'text-location', path: 'docs/manual.pdf',
      span: { type: 'pdf-text', page: 3, byte_start: 120, byte_end: 180 } }] }],
    parcial: AVISO_DE_PARCIALIDADE,
  }, redacao));
}

export function gerarGrupo(casos: Casos, amb: Ambiente): void {
  casosDoEstado(casos);
  casosDosEmbeddings(casos);
  casosDoSync(casos);
  casosDoIndiceVetorial(casos);
  casosDaBuscaPorSignificado(casos);
  casosDaInjecao(casos);
  casosDaConsulta(casos);
  casosDoMemoryCli(casos, amb);
  casosDoGrafoCli(casos, amb);
}
