/**
 * RM-061, fatia F3b: os casos do snapshot pt-BR. Cada caso produz um texto que a F3b passa pelo catalogo de
 * mensagens (`thread list|close|entrega`, `worktree`, `claims`, `decisao`, `accounts`, `network`, `roadmap
 * reservas|pegar|soltar|feat`, `docs verificar|sincronizar`, `adapter`, os erros de estado, as skills que o
 * `adapter install` copia e o prompt de fase): as funcoes de texto sao chamadas com entradas fixas nos ramos que a
 * fatia toca, e o CLI roda em repositorios temporarios com HOME proprio, PATH controlado, uma forja e um `claude`
 * falsos. Os campos de texto que vao ao ledger, ao `claims.jsonl` e ao recibo do install entram no caso do CLI que
 * os grava: o dado tambem fica igual byte a byte.
 *
 * A fixture `fixtures/locale-f3b-pt-BR.json` foi gerada UMA vez por estes casos sobre o codigo da base (a F3a na
 * `main`, antes da F3b); o teste `locale-f3b-snapshot` so compara e nunca regrava. O que varia de uma maquina ou de
 * uma execucao para outra (pastas temporarias, horarios, sha, usuario, versao) e normalizado aqui, igual na geracao
 * e na comparacao.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { definirFusoDoDono } from '../src/horario';
import { textoDoAudit, ResultadoAudit } from '../src/worktree';
import { textoDaConferencia, ResultadoDaConferencia } from '../src/claims-conferir';
import { COLUNAS_DE_PERFIS, linhasDePerfis, StoreDePerfis } from '../src/runtime-profiles';
import { textoDosEsgotamentos, RelatorioDeEsgotamentos } from '../src/esgotamentos';
import { textoDaRede, StatusDaRede } from '../src/rede-status';
import { textoDasReservas, PainelDeReservas } from '../src/roadmap-reservas';
import { textoDaSincronizacao, textoDaVerificacao, verificarDocs, Documento, Achado } from '../src/docs';
import { tabelaDeHosts, textoDaInstalacao, textoDosPitfalls, ResultadoInstalacao, ArquivoInstalado } from '../src/hosts';
import { estadoCanonico, exigirEstadoSemLink, raizDoEstado } from '../src/estado-thread';
import { exec, noPath, tabela } from '../src/util';
import { cliNoProcesso, saidaCompativel } from './cli-in-processo';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const SP = 'America/Sao_Paulo';
/** Instantes fixos fora do ano corrente: a data mostra o ano em qualquer ano de execucao. */
const T0 = '2025-09-19T18:16:00.000Z';
const T1 = '2025-09-19T18:21:30.000Z';
const T2 = '2025-09-19T19:40:00.000Z';
const SHA_A = 'a1b2c3d4'.repeat(5);
const SHA_64 = 'a1b2c3d4'.repeat(8);

/** Pastas temporarias deste lote de casos, trocadas por marcadores na normalizacao. */
const marcadores: Array<[string, string]> = [];

function dirTemp(nome: string, marcador: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ork-locale-f3b-${nome}-`)));
  marcadores.push([dir, marcador]);
  return dir;
}

/** O que varia entre maquinas e execucoes vira marcador; o resto fica byte a byte. */
export function normalizar(texto: string): string {
  let t = texto;
  for (const [dir, marcador] of [...marcadores].sort((a, b) => b[0].length - a[0].length)) t = t.split(dir).join(marcador);
  return t
    .split(CLI).join('<CLI>')
    .split(path.resolve(__dirname, '../../..')).join('<CATALOGO>')
    .replace(/\b\d{2}\/\d{2}(?:\/\d{4})? \d{2}:\d{2}(?::\d{2})?\b/g, '<DATA>')
    .replace(/\b\d{2}\/\d{2}, \d{2}:\d{2}\b/g, '<DATA>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '<ISO>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}\b/g, '<ISO>')
    .replace(/\b[0-9a-f]{64}\b/g, '<SHA256>')
    .replace(/\b[0-9a-f]{40}\b/g, '<SHA>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<UUID>')
    // SHA curto de 7 letras precisa de contexto: sem ele, palavras comuns como "acabada" também são hexadecimais.
    .replace(/(\b(?:commit|merge|remoto)\s+|@\s*)[0-9a-f]{7}\b/g, '$1<SHA7>')
    // Os outros contextos de commit que o CLI imprime: "branch <b> em <sha>" e "(<sha>, N tentativa(s))". Só com o
    // sha fechando o trecho, para "em acabada" ou "(decafed)" no meio de uma frase continuarem como estão.
    .replace(/(\bem\s+)[0-9a-f]{7}(?=\n|$)/gm, '$1<SHA7>')
    // Entre parênteses o CLI só imprime sha: "(<sha>)", "(<sha>, N tentativa(s))", "(<sha>);". E as setas e verbos que
    // levam um sha: "avancou para <sha>", "(ship_done <sha>)", "x → <sha>", "<sha> -> <sha>", "--is-ancestor <sha>".
    .replace(/(\(|\b(?:para|ship_done|ancestor)\s+|(?:→|->)\s*)[0-9a-f]{7}(?=[\s),;.]|$)/gm, '$1<SHA7>')
    // Com um dígito, 7 ou 8 hexadecimais não se confundem com uma palavra comum.
    .replace(/\b(?=[a-f]*\d)[0-9a-f]{7,8}\b/g, '<SHA7>')
    .replace(/\b(ha|há) (?:menos de )?\d+ ?(?:h\d{2}|min|s|h|d)\b/g, '$1 <DURACAO>')
    .replace(/\bconta [0-9a-f]{12}\b/g, 'conta <CONTA>')
    .replace(/\bhostname [A-Za-z0-9._-]+/g, 'hostname <HOSTNAME>')
    .replace(/\b(versao|version|v)\d+\.\d+\.\d+\b/g, '$1<VERSAO>')
    .replace(/\bork \d+\.\d+\.\d+\b/g, 'ork <VERSAO>')
    .replace(/"versao": "\d+\.\d+\.\d+"/g, '"versao": "<VERSAO>"');
}

function repoComCommit(nome: string, marcador: string): string {
  const dir = dirTemp(nome, marcador);
  exec('git', ['init', '-q', '-b', 'main'], dir);
  exec('git', ['config', 'user.email', 'teste@orkastery.local'], dir);
  exec('git', ['config', 'user.name', 'Teste Orkastery'], dir);
  exec('git', ['config', 'commit.gpgsign', 'false'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# locale f3b\n');
  exec('git', ['add', '--', 'README.md'], dir);
  exec('git', ['commit', '-q', '-m', 'inicial'], dir);
  return dir;
}

interface Ambiente { casa: string; bin: string; stub: string }

/** O `claude` falso das contas: `auth status --json` responde login de assinatura; o resto, como o do `apoio.ts`. */
const CLAUDE_DAS_CONTAS = `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  if [ -f "$CLAUDE_CONFIG_DIR/sem-login" ]; then echo '{"loggedIn":false}'; exit 1; fi
  echo '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}'
  exit 0
fi
if [ "$1" = "--version" ]; then echo "stub de teste 0.0.1"; exit 0; fi
echo '[]'
exit 0
`;

/**
 * HOME, um bin so com o git, o bash e o que os scripts usam, e um `claude` falso: nenhum `claude`, `codex`, `gh`
 * ou `glab` de quem roda entra no PATH, em maquina nenhuma.
 */
function ambiente(nome: string): Ambiente {
  const casa = dirTemp(`${nome}-casa`, '<CASA>');
  const bin = dirTemp(`${nome}-bin`, '<BIN>');
  const stub = dirTemp(`${nome}-stub`, '<STUB>');
  for (const ferramenta of ['git', 'cat', 'cut', 'date', 'rm', 'bash', 'sh', 'test', 'true', 'false']) {
    const achado = noPath(ferramenta);
    if (!achado) throw new Error(`${ferramenta} fora do PATH de quem roda os testes`);
    fs.symlinkSync(path.resolve(achado), path.join(bin, ferramenta));
  }
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  fs.writeFileSync(path.join(stub, 'claude'), CLAUDE_DAS_CONTAS, { mode: 0o755 });
  return { casa, bin, stub };
}

interface Saida { status: number | null; stdout: string; stderr: string }

/** A CLI com ambiente montado do zero: HOME, PATH, LANG pt-BR e o fuso. */
function ork(dir: string, amb: Ambiente, ...args: string[]): Saida {
  return orkComEnv(dir, amb, {}, ...args);
}

function orkComEnv(dir: string, amb: Ambiente, extra: Record<string, string>, ...args: string[]): Saida {
  const env = { HOME: amb.casa, LANG: 'C.UTF-8', TZ: SP, PATH: `${amb.stub}:${amb.bin}`, ORK_USUARIO_DIR: path.join(amb.casa, '.orkastery'),
    ORK_MAQUINA: 'pc-loc', ORK_REDE_PUBLICAR: '0', ORK_FABRICA_PUBLICAR: '0', ORK_BINARIOS_EXTRA: '', ...extra };
  // Estes casos provam a fronteira com executaveis falsos no PATH; pela RM-074, continuam processo real.
  if (extra.PATH !== undefined || args[0] === 'accounts' || args[0] === 'network') {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }
  return saidaCompativel(cliNoProcesso({ cwd: dir, args, env }));
}

function texto(s: Saida): string {
  return `[saida ${s.status}]\n${s.stdout}${s.stderr ? `[stderr]\n${s.stderr}` : ''}`;
}

/** Os campos de texto que o comando gravou no ledger da thread, na ordem dos eventos. */
function textosDoLedger(repo: string, thread: string, tipos: readonly string[]): string {
  const ledger = path.join(repo, '.orkastery', 'threads', thread, 'ledger.jsonl');
  if (!fs.existsSync(ledger)) return '<sem ledger>';
  const campos = ['detalhe', 'correcao', 'motivo', 'razao', 'decidido', 'porque'];
  return fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((e) => tipos.includes(String(e.tipo)))
    .map((e) => {
      const partes = campos.filter((c) => typeof e[c] === 'string').map((c) => `${c}=${String(e[c])}`);
      const checks = Array.isArray(e.checks)
        ? (e.checks as Array<Record<string, unknown>>).map((c) => `check ${String(c.nome)} ${String(c.nivel)} ${String(c.detalhe)}`) : [];
      return [`${String(e.tipo)}: ${partes.join(' | ')}`, ...checks].join('\n');
    }).join('\n');
}

function limparTudo(): void {
  const pausa = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(pausa, 0, 0, 200);
  for (const [dir] of marcadores) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  marcadores.length = 0;
}

/** Roda `fn` e guarda o texto (ou `ERRO: mensagem`) normalizado. */
function caso(casos: Record<string, string>, nome: string, fn: () => string | null | undefined): void {
  if (nome in casos) throw new Error(`caso repetido: ${nome}`);
  let saida: string;
  try {
    const r = fn();
    saida = r === null ? '<null>' : r === undefined ? '<undefined>' : r;
  } catch (e) { saida = `ERRO: ${(e as Error).message}`; }
  casos[nome] = normalizar(saida);
}

/** Projeto com manifesto, verify `build` e `test` de verdade (bash) e o fuso do dono fixo. */
function projeto(nome: string, abbrev: string, amb: Ambiente): string {
  const repo = repoComCommit(nome, '<REPO>');
  const init = ork(repo, amb, 'init', '--name', nome, '--abbrev', abbrev);
  if (init.status !== 0) throw new Error(`init falhou: ${init.stderr}`);
  const yaml = path.join(repo, 'orkastery.yaml');
  fs.writeFileSync(yaml, fs.readFileSync(yaml, 'utf8')
    .replace('  # build: nao detectado', '  build: "true"')
    .replace('  # test: nao detectado', '  test: "test -f README.md"'));
  exec('git', ['add', '--', 'orkastery.yaml', 'AGENTS.md'], repo);
  exec('git', ['commit', '-q', '-m', 'manifesto'], repo);
  return repo;
}

function idDaThread(s: Saida): string {
  const m = /^ {2}id {8}(\S+)$/m.exec(s.stdout) ?? /\bid\s+(\S+-\S+)/.exec(s.stdout);
  if (!m) throw new Error(`thread sem id na saida: ${s.stdout}\n${s.stderr}`);
  return m[1];
}

// ---------------------------------------------------------------------------
// Funcoes de texto com entradas fixas
// ---------------------------------------------------------------------------

function casosDeFuncao(casos: Record<string, string>): void {
  // worktree audit
  const auditOk: ResultadoAudit = { ok: true, divergencias: 0, dir: '/repo/.worktrees/loc-a', branch: 'ork/loc-a-full', checks: [
    { nome: 'existe', nivel: 'ok', detalhe: '/repo/.worktrees/loc-a' },
    { nome: 'registro', nivel: 'ok', detalhe: 'aparece em `git worktree list --porcelain`' },
    { nome: 'branch', nivel: 'ok', detalhe: 'ork/loc-a-full em check-out' },
    { nome: 'arvore', nivel: 'ok', detalhe: 'sem alteracao nao commitada' },
  ] as never };
  caso(casos, 'worktree: audit consistente', () => textoDoAudit('loc-a', auditOk));
  caso(casos, 'worktree: audit com divergencias', () => textoDoAudit('loc-a', { ...auditOk, ok: false, divergencias: 2, checks: [
    { nome: 'registro', nivel: 'fail', detalhe: '/repo/.worktrees/loc-a nao aparece em `git worktree list`', correcao: 'git worktree prune && ork worktree ensure loc-a' },
    { nome: 'base', nivel: 'warn', detalhe: 'a base main avancou para a1b2c3d4 e nao esta na branch da thread', correcao: 'ork worktree sync loc-a' },
  ] as never }));

  // claims conferir
  const conferencia: ResultadoDaConferencia = {
    formato: 'ork.claims-conferencia/v1' as never, thread: 'loc-a', commit: SHA_A, cwd: '/repo', executor: 'codex-sandbox',
    reciboOficial: false, prazoTotalMs: 120000, alvo: { tipo: 'claims', ids: ['C1', 'C2'] }, ok: true, motivos: [],
    itens: [{ id: 'C1', alegacao: 'o readme existe', arquivo: 'README.md', verificado: true, motivo: null, detalhe: '1 comando(s) reexecutado(s) com sucesso', execucoes: [] }] as never,
  };
  caso(casos, 'claims: conferencia que passou', () => textoDaConferencia(conferencia));
  caso(casos, 'claims: conferencia da tarefa que nao passou', () => textoDaConferencia({ ...conferencia, ok: false,
    motivos: ['claims.failed'] as never, alvo: { tipo: 'tarefa', tarefa: 'T2', plano: { arquivo: 'docs/plan.md', sha256: SHA_A + 'a1b2c3d4a1b2c3d4a1b2c3d4' }, comando: 'npm test' },
    itens: [{ id: 'C2', alegacao: 'a suite passa', arquivo: null, verificado: false, motivo: 'claims.failed', detalhe: 'comando saiu 1',
      execucoes: [{ ok: false, fim: 'linha um\nlinha dois' }] }] as never }));

  // accounts
  const store: StoreDePerfis = { contrato: 'ork.runtime-profiles/v1' as never, perfis: [
    { id: 'p1', runtime: 'claude-bg', configDir: '/srv/perfis/claude-p1', estado: 'ativo', esgotadoAte: null, ultimaFalha: null, ultimoUso: T0, criadoEm: T0 },
    { id: 'p2', runtime: 'codex', codexHome: '/srv/perfis/codex-p2', estado: 'esgotado', esgotadoAte: T2, ultimaFalha: { motivo: 'quota.exhausted', em: T1, detalhe: 'x' }, ultimoUso: null, criadoEm: T0 },
    { id: 'p3', runtime: 'claude-bg', configDir: '/srv/perfis/claude-p3', estado: 'sem-auth', esgotadoAte: null, ultimaFalha: null, ultimoUso: null, criadoEm: T0 },
    { id: 'p4', runtime: 'claude-bg', configDir: '/srv/perfis/claude-p4', estado: 'provider-pago', esgotadoAte: null, ultimaFalha: null, ultimoUso: null, criadoEm: T0 },
    { id: 'p5', runtime: 'codex', codexHome: '/srv/perfis/codex-p5', estado: 'desativado', esgotadoAte: null, ultimaFalha: null, ultimoUso: null, criadoEm: T0 },
  ] as never };
  caso(casos, 'accounts: tabela de perfis', () => tabela(COLUNAS_DE_PERFIS, linhasDePerfis(store)));
  const relatorio: RelatorioDeEsgotamentos = {
    contrato: 'ork.esgotamentos/v1' as never, periodo: { desde: T0, ate: T2, intervalo: '[desde,ate)' },
    marcas: [{ conta: 'c1', runtime: 'claude-bg', estado: 'esgotado', motivo: 'quota.exhausted', em: T0, esgotadoAte: T2, projeto: 'loc' },
      { conta: 'c2', runtime: 'codex', estado: 'sem-auth', motivo: 'runtime.auth-missing', em: T1, esgotadoAte: null, projeto: 'outro' }] as never,
    projetos: [{ nome: 'loc', presente: true, despachosComPerfil: 3 }, { nome: 'sumido', presente: false, despachosComPerfil: 0 }],
    despachos: [{ em: T1, projeto: 'loc', thread: 'loc-a', fase: 'GO', runtime: 'claude-bg', perfil: 'p1', conta: 'c1', marcadaPor: 'outro' },
      { em: T2, projeto: 'loc', thread: 'loc-b', fase: null, runtime: 'claude-bg', perfil: 'p1', conta: 'c1', marcadaPor: 'outro' }],
    total: 2, limite: 'so os ledgers dos projetos registrados nesta maquina; despacho sem perfil nao entra',
  };
  caso(casos, 'accounts: esgotamentos', () => textoDosEsgotamentos(relatorio));
  caso(casos, 'accounts: esgotamentos vazio', () => textoDosEsgotamentos({ ...relatorio, marcas: [], projetos: [], despachos: [], total: 0 }));

  // network status
  const membro = (maquina: string, extra: Record<string, unknown> = {}) => ({ maquina, origem: 'rede', publicadoEm: T0, idadeMs: 95 * 60000,
    hostname: `${maquina}.local`, adesao: 'rede', pessoa: null, forjas: [{ forja: 'github', usuario: 'pessoa-teste' }, { forja: 'gitlab', usuario: null }],
    runtimes: [{ runtime: 'claude-bg', versao: '9.9.9' }, { runtime: 'codex', versao: null }], hosts: [{ host: 'hermes', versao: '1.0', adaptador: 'orkastery' }],
    projetos: [{ nome: 'loc', remoto: 'github.com/pessoa-teste/loc', caminho: '/repo' }, { nome: 'outro', remoto: null, caminho: null }], versaoOrk: '0.5.5', ...extra });
  const rede: StatusDaRede = {
    contrato: 'ork.rede-status/v1', consultadoEm: T2,
    casa: { forja: 'github', host: 'github.com', dono: 'pessoa-teste', repositorio: 'orkastery-network', origem: 'rede.json' } as never,
    estaMaquina: { maquina: 'pc-a', membro: true, adesao: 'rede', publicada: true, nomeEmUso: false } as never,
    fontes: [{ fonte: 'rede', ref: 'main', ponta: SHA_A, atualizado: true }, { fonte: 'fabrica-estado', ref: 'ork/fabrica-estado', ponta: null, atualizado: false, projeto: 'loc' }],
    membros: [membro('pc-a'), membro('pc-b', { origem: 'fabrica-estado', adesao: 'fabrica', pessoa: 'Pessoa Teste', hostname: null, versaoOrk: null })] as never,
    lacunas: [], naoConsultado: ['roadmap', 'reservas', 'threads'],
  };
  caso(casos, 'network: status com casa e membros', () => textoDaRede(rede));
  caso(casos, 'network: status sem casa, fora da rede e com lacunas', () => textoDaRede({ ...rede, casa: null, fontes: [], membros: [],
    estaMaquina: { maquina: 'pc-c', membro: false, adesao: null, publicada: false, nomeEmUso: false } as never,
    lacunas: [{ tipo: 'forja.ausente', detalhe: 'nenhuma forja (gh ou glab) nesta maquina' }, { tipo: 'maquina.sem-batida', detalhe: 'pc-x sem batida ha 4h', maquina: 'pc-x' }] }));
  caso(casos, 'network: status de membro herdado com nome em uso e copia local', () => textoDaRede({ ...rede,
    fontes: [{ fonte: 'rede', ref: 'main', ponta: null, atualizado: false }],
    estaMaquina: { maquina: 'pc-a', membro: true, adesao: 'fabrica', publicada: false, nomeEmUso: true } as never }));

  // roadmap reservas
  const reserva = (item: string, extra: Record<string, unknown> = {}) => ({ item, por: 'pessoa-teste', maquina: 'pc-loc', thread: `loc-${item.toLowerCase()}`,
    desdeEm: T0, nota: null, ...extra });
  const painel: PainelDeReservas = { reservas: [reserva('RM-001'), reserva('RM-002', { thread: null, nota: 'fatia 2' })] as never,
    feats: [{ feat: 'FEAT-07', maquina: 'pc-loc', thread: 'loc-a' }, { feat: 'FEAT-08', maquina: 'pc-b', thread: null }] as never, atualizado: true, ponta: SHA_A };
  caso(casos, 'reservas: painel com feats e orfa', () => textoDasReservas(painel, [{ reserva: reserva('RM-001') as never, sucessora: 'loc-z' }],
    { remoto: 'origin', projeto: 'loc', temRemoto: true }));
  caso(casos, 'reservas: painel da copia local, orfa sem sucessora', () => textoDasReservas({ ...painel, atualizado: false },
    [{ reserva: reserva('RM-002') as never, sucessora: null }], { remoto: 'origin', projeto: 'loc', temRemoto: true }));
  caso(casos, 'reservas: nenhuma reserva, com feats', () => textoDasReservas({ ...painel, reservas: [] }, [], { temRemoto: true }));
  caso(casos, 'reservas: nenhuma reserva, sem feats', () => textoDasReservas({ ...painel, reservas: [], feats: [] }, [], { temRemoto: true }));
  caso(casos, 'reservas: sem remoto', () => textoDasReservas(painel, [], { remoto: 'origin', projeto: 'loc', temRemoto: false }));
  caso(casos, 'reservas: sem remoto e sem projeto', () => textoDasReservas(painel, [], { temRemoto: false }));
  caso(casos, 'reservas: sem copia', () => textoDasReservas({ ...painel, atualizado: false, ponta: null }, [], { remoto: 'origin', temRemoto: true }));

  // docs
  const docs: Documento[] = [
    { arquivo: 'docs/produto/FEAT-01-a.md', tipo: 'feature', id: 'FEAT-01', dados: {}, corpo: '' },
    { arquivo: 'docs/roadmap/RM-001-a.md', tipo: 'roadmap', id: 'RM-001', dados: {}, corpo: '' },
    { arquivo: 'docs/produto/PLAT-01-a.md', tipo: 'plataforma', id: 'PLAT-01', dados: {}, corpo: '' },
  ];
  const achados: Achado[] = [
    { arquivo: 'docs/roadmap/RM-001-a.md', id: 'RM-001', regra: 'docs.frontmatter.chave', gravidade: 'erro', mensagem: 'falta a chave owner', correcao: 'copie a chave do modelo' },
    { arquivo: 'docs/produto/FEAT-01-a.md', regra: 'docs.leitura.paragrafo', gravidade: 'aviso', mensagem: 'parágrafo com 900 caracteres' },
  ];
  caso(casos, 'docs: verificacao reprovada', () => textoDaVerificacao(docs, achados));
  caso(casos, 'docs: verificacao com aviso', () => textoDaVerificacao(docs, [achados[1]]));
  caso(casos, 'docs: verificacao limpa', () => textoDaVerificacao(docs, []));
  const mudancas = [{ id: 'RM-001', arquivo: 'docs/roadmap/RM-001-a.md', campo: 'estado.codigo', de: '', para: 'Mesclado', fonte: 'ship_done a1b2c3d' },
    { id: 'RM-001', arquivo: 'docs/roadmap/RM-001-a.md', campo: 'evidencias.codigo.commit', de: 'x', para: 'a1b2c3d', fonte: 'ledger' }];
  caso(casos, 'docs: sincronizacao a gravar', () => textoDaSincronizacao({ mudancas, indices: ['docs/roadmap/README.md'] }, false));
  caso(casos, 'docs: sincronizacao gravada', () => textoDaSincronizacao({ mudancas, indices: [] }, true));
  caso(casos, 'docs: sincronizado', () => textoDaSincronizacao({ mudancas: [], indices: [] }, false));

  // adapter
  caso(casos, 'adapter: tabela dos hosts', () => tabelaDeHosts());
  for (const host of ['claude-code', 'codex', 'hermes', 'openclaw'] as const) {
    caso(casos, `adapter: pitfalls do ${host}`, () => textoDosPitfalls(host));
  }
  const arquivo = (relativo: string, estado: ArquivoInstalado['estado'], divergencia?: ArquivoInstalado['divergencia']): ArquivoInstalado =>
    ({ origem: `/catalogo/${relativo}`, destino: `/repo/.claude/plugins/orkastery/${relativo}`, relativo, sha256: SHA_A, bytes: 10, executavel: false,
      estado, ...(divergencia ? { divergencia } : {}) });
  const instalacao: ResultadoInstalacao = { host: 'claude-code', projeto: '/repo', catalogo: '/catalogo', destino: '/repo/.claude/plugins/orkastery',
    dryRun: false, arquivos: [arquivo('commands/goal.md', 'novo'), arquivo('agents/ork-go.md', 'igual')], conflitos: [], precisamDeDecisao: [],
    ok: true, orkBin: '/usr/bin/ork', pitfalls: [], experiencia: { ativa: true, arquivos: ['CLAUDE.md'], skill: 'orchestration-experience-pt-br' } };
  caso(casos, 'adapter: instalacao do claude-code', () => textoDaInstalacao(instalacao));
  caso(casos, 'adapter: instalacao do codex com aviso do ork', () => textoDaInstalacao({ ...instalacao, host: 'codex', destino: '/repo/.agents/skills/orkastery',
    avisoOrk: 'o ork do PATH (/usr/bin/ork, 0.4.3) não é o que roda este install', experiencia: { ativa: false, arquivos: [], skill: '', aviso: 'Pacote de experiência pulado: x.' } }));
  caso(casos, 'adapter: simulacao com removidos e catalogo que andou', () => textoDaInstalacao({ ...instalacao, dryRun: true, experiencia: { ativa: false, arquivos: [], skill: '' },
    arquivos: [arquivo('skills/x/SKILL.md', 'sobrescrito', 'catalogo-andou')], conflitos: [arquivo('skills/x/SKILL.md', 'sobrescrito', 'catalogo-andou')],
    removidos: ['mods/ork-velho/hooks/a.ts'] }));
  caso(casos, 'adapter: instalacao barrada com recibo vizinho', () => textoDaInstalacao({ ...instalacao, ok: false, experiencia: undefined,
    destino: '/repo/plugins', reciboVizinho: '/repo/plugins/.claude/plugins/orkastery/INSTALADO.json',
    arquivos: [arquivo('commands/goal.md', 'sobrescrito', 'copia-editada')], conflitos: [arquivo('commands/goal.md', 'sobrescrito', 'copia-editada')],
    precisamDeDecisao: [arquivo('commands/goal.md', 'sobrescrito', 'copia-editada')] }));
  caso(casos, 'adapter: instalacao do hermes', () => textoDaInstalacao({ ...instalacao, host: 'hermes', experiencia: undefined }));

  // erros de estado
  const raizFalsa = dirTemp('estado', '<ESTADO>');
  fs.writeFileSync(path.join(raizFalsa, '.git'), 'nada aqui\n');
  caso(casos, 'estado: .git invalido', () => raizDoEstado(raizFalsa));
  const raizSemComum = dirTemp('estado-comum', '<ESTADO2>');
  const gitdir = path.join(raizSemComum, 'gitdir');
  fs.mkdirSync(gitdir);
  fs.writeFileSync(path.join(gitdir, 'commondir'), '../comum\n');
  fs.mkdirSync(path.join(raizSemComum, 'comum'));
  fs.writeFileSync(path.join(raizSemComum, '.git'), `gitdir: ${gitdir}\n`);
  caso(casos, 'estado: arvore principal nao resolvida', () => raizDoEstado(raizSemComum));
  caso(casos, 'estado: id de thread invalido', () => estadoCanonico(raizSemComum, '../x'));
  const comLink = dirTemp('estado-link', '<ESTADO3>');
  fs.mkdirSync(path.join(comLink, 'fora'));
  fs.symlinkSync(path.join(comLink, 'fora'), path.join(comLink, '.orkastery'));
  caso(casos, 'estado: link simbolico no estado', () => { exigirEstadoSemLink(comLink, ['.orkastery', 'threads', 'x']); return 'sem erro'; });
}

// ---------------------------------------------------------------------------
// O CLI
// ---------------------------------------------------------------------------

function casosDeThread(casos: Record<string, string>, amb: Ambiente): void {
  const repo = projeto('thread', 'loc', amb);
  caso(casos, 'cli thread: list vazio', () => texto(ork(repo, amb, 'thread', 'list')));
  caso(casos, 'cli thread: list vazio com --todas', () => texto(ork(repo, amb, 'thread', 'list', '--todas')));
  caso(casos, 'cli thread: padrao vazio', () => texto(ork(repo, amb, 'thread')));
  const a = idDaThread(ork(repo, amb, 'thread', 'new', 'loc-a', '--sem-worktree'));
  const b = idDaThread(ork(repo, amb, 'thread', 'new', 'loc-b', '--sem-worktree', '--modo', 'auto'));
  caso(casos, 'cli thread: list com duas', () => texto(ork(repo, amb, 'thread', 'list')));
  caso(casos, 'cli thread: close sem id', () => texto(ork(repo, amb, 'thread', 'close')));
  caso(casos, 'cli thread: close com motivo invalido', () => texto(ork(repo, amb, 'thread', 'close', b, '--motivo', 'cansei', '--por', 'teste', '--justificativa', 'sem uso')));
  caso(casos, 'cli thread: close sem justificativa', () => texto(ork(repo, amb, 'thread', 'close', b, '--motivo', 'orfa', '--por', 'teste')));
  caso(casos, 'cli thread: close de thread que nao existe', () => texto(ork(repo, amb, 'thread', 'close', 'loc-nada', '--motivo', 'orfa', '--por', 'teste', '--justificativa', 'sem uso')));
  caso(casos, 'cli thread: close', () => texto(ork(repo, amb, 'thread', 'close', b, '--motivo', 'engano', '--por', 'teste', '--justificativa', 'aberta por engano')));
  caso(casos, 'cli thread: close com outro motivo', () => texto(ork(repo, amb, 'thread', 'close', b, '--motivo', 'orfa', '--por', 'teste', '--justificativa', 'aberta por engano')));
  caso(casos, 'cli thread: list com fechada omitida', () => texto(ork(repo, amb, 'thread', 'list')));
  caso(casos, 'cli thread: list --todas', () => texto(ork(repo, amb, 'thread', 'list', '--todas')));
  caso(casos, 'cli thread: entrega sem autoria', () => texto(ork(repo, amb, 'thread', 'entrega', a, '--arquivo', 'README.md', '--sha256', SHA_A)));
  caso(casos, 'cli thread: entrega com sha invalido', () => texto(ork(repo, amb, 'thread', 'entrega', a, '--arquivo', 'README.md', '--sha256', 'x', '--por', 'teste')));
  const fora = dirTemp('thread-fora', '<FORA>');
  fs.writeFileSync(path.join(fora, 'x.txt'), 'x\n');
  caso(casos, 'cli thread: entrega fora do projeto', () => texto(ork(repo, amb, 'thread', 'entrega', a, '--arquivo', path.join(fora, 'x.txt'), '--sha256', SHA_64, '--por', 'teste')));
  caso(casos, 'cli thread: entrega de diretorio', () => texto(ork(repo, amb, 'thread', 'entrega', a, '--arquivo', '.orkastery', '--sha256', SHA_64, '--por', 'teste')));
  caso(casos, 'cli thread: entrega com hash divergente', () => texto(ork(repo, amb, 'thread', 'entrega', a, '--arquivo', 'README.md', '--sha256', SHA_64, '--por', 'teste')));
  const sha = createHash('sha256').update(fs.readFileSync(path.join(repo, 'README.md'))).digest('hex');
  caso(casos, 'cli thread: entrega', () => texto(ork(repo, amb, 'thread', 'entrega', a, '--arquivo', 'README.md', '--sha256', sha, '--por', 'teste')));
  caso(casos, 'cli thread: entrega de thread fechada', () => texto(ork(repo, amb, 'thread', 'entrega', b, '--arquivo', 'README.md', '--sha256', sha, '--por', 'teste')));
  caso(casos, 'cli thread: subcomando desconhecido', () => texto(ork(repo, amb, 'thread', 'voar')));
}

function casosDeWorktree(casos: Record<string, string>, amb: Ambiente): void {
  const repo = projeto('worktree', 'loc', amb);
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'loc-w', '--sem-worktree'));
  caso(casos, 'cli worktree: sem argumentos', () => texto(ork(repo, amb, 'worktree')));
  caso(casos, 'cli worktree: audit sem worktree', () => texto(ork(repo, amb, 'worktree', 'audit', id)));
  caso(casos, 'cli worktree: sync sem worktree', () => texto(ork(repo, amb, 'worktree', 'sync', id)));
  caso(casos, 'cli worktree: ensure', () => texto(ork(repo, amb, 'worktree', 'ensure', id)));
  caso(casos, 'cli worktree: ensure de novo', () => texto(ork(repo, amb, 'worktree', 'ensure', id)));
  caso(casos, 'cli worktree: audit', () => texto(ork(repo, amb, 'worktree', 'audit', id)));
  caso(casos, 'cli worktree: sync --dry-run em dia', () => texto(ork(repo, amb, 'worktree', 'sync', id, '--dry-run')));
  caso(casos, 'cli worktree: sync em dia', () => texto(ork(repo, amb, 'worktree', 'sync', id)));
  fs.writeFileSync(path.join(repo, 'novo.txt'), 'base andou\n');
  exec('git', ['add', '--', 'novo.txt'], repo);
  exec('git', ['commit', '-q', '-m', 'base andou'], repo);
  caso(casos, 'cli worktree: audit com a base adiante', () => texto(ork(repo, amb, 'worktree', 'audit', id)));
  caso(casos, 'cli worktree: sync --dry-run sem commit proprio', () => texto(ork(repo, amb, 'worktree', 'sync', id, '--dry-run')));
  const dir = path.join(repo, '.worktrees', id);
  const wt = fs.existsSync(dir) ? dir : (JSON.parse(fs.readFileSync(path.join(repo, '.orkastery', 'threads', id, 'thread.json'), 'utf8')) as { worktree: string }).worktree;
  fs.writeFileSync(path.join(wt, 'da-thread.txt'), 'trabalho\n');
  exec('git', ['add', '--', 'da-thread.txt'], wt);
  exec('git', ['-c', 'user.email=teste@orkastery.local', '-c', 'user.name=Teste', 'commit', '-q', '-m', 'trabalho da thread'], wt);
  caso(casos, 'cli worktree: sync --dry-run com rebase', () => texto(ork(repo, amb, 'worktree', 'sync', id, '--dry-run')));
  caso(casos, 'cli worktree: sync com rebase', () => texto(ork(repo, amb, 'worktree', 'sync', id)));
  fs.writeFileSync(path.join(wt, 'sujo.txt'), 'sem commit\n');
  caso(casos, 'cli worktree: sync com arvore suja', () => texto(ork(repo, amb, 'worktree', 'sync', id)));
  caso(casos, 'cli worktree: audit com arvore suja', () => texto(ork(repo, amb, 'worktree', 'audit', id)));
  caso(casos, 'cli worktree: release com arvore suja', () => texto(ork(repo, amb, 'worktree', 'release', id)));
  caso(casos, 'cli worktree: release --forcar', () => texto(ork(repo, amb, 'worktree', 'release', id, '--forcar')));
  caso(casos, 'cli worktree: release sem diretorio', () => texto(ork(repo, amb, 'worktree', 'release', id)));
  caso(casos, 'cli worktree: subcomando desconhecido', () => texto(ork(repo, amb, 'worktree', 'voar', id)));
  caso(casos, 'cli worktree: ledger', () => textosDoLedger(repo, id, ['worktree_ensured', 'worktree_synced', 'worktree_audited', 'worktree_released']));
}

function casosDeClaims(casos: Record<string, string>, amb: Ambiente): void {
  const repo = projeto('claims', 'loc', amb);
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'loc-c', '--sem-worktree'));
  caso(casos, 'cli claims: add sem argumentos', () => texto(ork(repo, amb, 'claims', 'add', id)));
  caso(casos, 'cli claims: add', () => texto(ork(repo, amb, 'claims', 'add', id, 'README.md', '--claim', 'o readme existe', '--verificar', 'test -f README.md')));
  caso(casos, 'cli claims: add negativa sem comando', () => texto(ork(repo, amb, 'claims', 'add', id, 'README.md', '--claim', 'nenhum teste quebrou')));
  caso(casos, 'cli claims: add com a suite inteira', () => texto(ork(repo, amb, 'claims', 'add', id, 'README.md', '--claim', 'a suite passa', '--verificar', 'npm --prefix core test')));
  caso(casos, 'cli claims: add com fase', () => texto(ork(repo, amb, 'claims', 'add', id, 'README.md', '--claim', 'o readme continua', '--verificar', 'test -f README.md', '--fase', 'GO')));
  caso(casos, 'cli claims: add com fase invalida', () => texto(ork(repo, amb, 'claims', 'add', id, 'README.md', '--claim', 'x', '--fase', 'VOO')));
  caso(casos, 'cli claims: verificar sem argumentos', () => texto(ork(repo, amb, 'claims', 'verificar', id)));
  caso(casos, 'cli claims: verificar', () => texto(ork(repo, amb, 'claims', 'verificar', id, 'C2', '--comando', 'test -f README.md')));
  caso(casos, 'cli claims: verificar claim que nao existe', () => texto(ork(repo, amb, 'claims', 'verificar', id, 'C99', '--comando', 'true')));
  caso(casos, 'cli claims: retirar sem argumentos', () => texto(ork(repo, amb, 'claims', 'retirar', id)));
  caso(casos, 'cli claims: retirar', () => texto(ork(repo, amb, 'claims', 'retirar', id, 'C3', '--motivo', 'suite inteira nao cabe na claim')));
  caso(casos, 'cli claims: ausente sem argumentos', () => texto(ork(repo, amb, 'claims', 'ausente', id)));
  caso(casos, 'cli claims: ausente', () => texto(ork(repo, amb, 'claims', 'ausente', id, '--paths', 'a.ts,b.ts', '--motivo', 'so docs')));
  caso(casos, 'cli claims: list sem id', () => texto(ork(repo, amb, 'claims', 'list')));
  caso(casos, 'cli claims: list', () => texto(ork(repo, amb, 'claims', 'list', id)));
  caso(casos, 'cli claims: list padrao', () => texto(ork(repo, amb, 'claims')));
  caso(casos, 'cli claims: conferir sem alvo', () => texto(ork(repo, amb, 'claims', 'conferir', id)));
  caso(casos, 'cli claims: subcomando desconhecido', () => texto(ork(repo, amb, 'claims', 'voar')));
  const id2 = idDaThread(ork(repo, amb, 'thread', 'new', 'loc-c2', '--sem-worktree'));
  caso(casos, 'cli claims: list vazio', () => texto(ork(repo, amb, 'claims', 'list', id2)));
  caso(casos, 'cli claims: o claims.jsonl', () => fs.readFileSync(path.join(repo, '.orkastery', 'threads', id, 'claims.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => { const c = JSON.parse(l) as Record<string, unknown>;
      return ['id', 'alegacao', 'estado', 'negativa', 'motivoRetirada', 'motivo'].filter((k) => k in c).map((k) => `${k}=${JSON.stringify(c[k])}`).join(' '); }).join('\n'));
}

function casosDeDecisao(casos: Record<string, string>, amb: Ambiente): void {
  const repo = projeto('decisao', 'loc', amb);
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'loc-d', '--sem-worktree', '--modo', 'auto'));
  const campos = ['--decidido', 'usar a fila', '--porque', 'menos carga', '--como-mudar', 'trocar a flag', '--custo-agora', 'nenhum',
    '--custo-depois', 'baixo', '--quem', 'sessao GO', '--evidencia', 'medida local'];
  caso(casos, 'cli decisao: sem subcomando', () => texto(ork(repo, amb, 'decisao')));
  caso(casos, 'cli decisao: registrar sem thread', () => texto(ork(repo, amb, 'decisao', 'registrar')));
  caso(casos, 'cli decisao: registrar sem campo', () => texto(ork(repo, amb, 'decisao', 'registrar', id, '--decidido', 'x')));
  caso(casos, 'cli decisao: registrar com criterio invalido', () => texto(ork(repo, amb, 'decisao', 'registrar', id, ...campos, '--criterio', 'palpite:x')));
  caso(casos, 'cli decisao: registrar com criterio que nao resolve', () => texto(ork(repo, amb, 'decisao', 'registrar', id, ...campos, '--criterio', 'ledger:nao-existe')));
  caso(casos, 'cli decisao: registrar com campo longo', () => texto(ork(repo, amb, 'decisao', 'registrar', id, ...campos.slice(0, 1), 'x'.repeat(240), ...campos.slice(2),
    '--criterio', 'medicao:wc -l x')));
  caso(casos, 'cli decisao: registrar com reverte que nao existe', () => texto(ork(repo, amb, 'decisao', 'registrar', id, ...campos, '--criterio', 'medicao:wc -l x', '--reverte', 'nada')));
  caso(casos, 'cli decisao: registrar', () => texto(ork(repo, amb, 'decisao', 'registrar', id, ...campos, '--criterio', 'medicao:wc -l x')));
  caso(casos, 'cli decisao: placar sem thread', () => texto(ork(repo, amb, 'decisao', 'placar')));
  caso(casos, 'cli decisao: placar', () => texto(ork(repo, amb, 'decisao', 'placar', id)));
  caso(casos, 'cli decisao: subcomando desconhecido', () => texto(ork(repo, amb, 'decisao', 'voar', id)));
  ork(repo, amb, 'thread', 'close', id, '--motivo', 'orfa', '--por', 'teste', '--justificativa', 'acabou o teste');
  caso(casos, 'cli decisao: registrar em thread fechada', () => texto(ork(repo, amb, 'decisao', 'registrar', id, ...campos, '--criterio', 'medicao:wc -l x')));
  caso(casos, 'cli decisao: ledger', () => textosDoLedger(repo, id, ['autonomous_decision']));
}

/** Pasta de comprimento fixo em `/tmp` (e nao no TMPDIR): o caminho entra na tabela, e a largura da coluna depende dele. */
function dirFixo(prefixo: string, marcador: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(`/tmp/${prefixo}-`));
  marcadores.push([dir, marcador]);
  return dir;
}

function casosDeAccounts(casos: Record<string, string>, amb: Ambiente): void {
  const repo = projeto('accounts', 'loc', amb);
  const perfil = dirFixo('ork-f3b-pa', '<PERFIL1>');
  const semLogin = dirFixo('ork-f3b-pb', '<PERFIL2>');
  fs.writeFileSync(path.join(semLogin, 'sem-login'), '');
  caso(casos, 'cli accounts: list vazio', () => texto(ork(repo, amb, 'accounts')));
  caso(casos, 'cli accounts: add sem argumentos', () => texto(ork(repo, amb, 'accounts', 'add', 'p1')));
  caso(casos, 'cli accounts: add com runtime invalido', () => texto(ork(repo, amb, 'accounts', 'add', 'p1', '--runtime', 'gpt', '--dir', perfil, '--sem-login')));
  caso(casos, 'cli accounts: add', () => texto(ork(repo, amb, 'accounts', 'add', 'p1', '--runtime', 'claude-bg', '--dir', perfil, '--sem-login')));
  caso(casos, 'cli accounts: add sem login', () => texto(ork(repo, amb, 'accounts', 'add', 'p2', '--runtime', 'claude-bg', '--dir', semLogin, '--sem-login')));
  caso(casos, 'cli accounts: list', () => texto(ork(repo, amb, 'accounts', 'list')));
  caso(casos, 'cli accounts: check', () => texto(ork(repo, amb, 'accounts', 'check')));
  caso(casos, 'cli accounts: check de perfil que nao existe', () => texto(ork(repo, amb, 'accounts', 'check', 'p9')));
  caso(casos, 'cli accounts: remove sem id', () => texto(ork(repo, amb, 'accounts', 'remove')));
  caso(casos, 'cli accounts: remove', () => texto(ork(repo, amb, 'accounts', 'remove', 'p2')));
  caso(casos, 'cli accounts: remove de perfil que nao existe', () => texto(ork(repo, amb, 'accounts', 'remove', 'p9')));
  caso(casos, 'cli accounts: add reativa', () => texto(ork(repo, amb, 'accounts', 'add', 'p2', '--runtime', 'claude-bg', '--dir', semLogin, '--sem-login')));
  caso(casos, 'cli accounts: esgotamentos', () => texto(ork(repo, amb, 'accounts', 'esgotamentos')));
  caso(casos, 'cli accounts: esgotamentos com periodo invalido', () => texto(ork(repo, amb, 'accounts', 'esgotamentos', '--desde', 'ontem')));
  caso(casos, 'cli accounts: subcomando desconhecido', () => texto(ork(repo, amb, 'accounts', 'voar')));
}

/** A forja falsa da RM-053, tirada do proprio teste da rede (a mesma fonte, sem copia que envelhece). */
function scriptDaForjaFalsa(): string {
  const fonte = fs.readFileSync(path.resolve(__dirname, '../../test/rede.test.ts'), 'utf8');
  const m = /const SCRIPT_FALSO = `([\s\S]*?)`;\n/.exec(fonte);
  if (!m) throw new Error('forja falsa nao achada em rede.test.ts');
  return m[1].replace('${process.execPath}', process.execPath).replace(/\\\\/g, '\\');
}

function casosDeNetwork(casos: Record<string, string>, amb: Ambiente): void {
  const fora = dirTemp('network-fora', '<FORA>');
  caso(casos, 'cli network: status sem forja', () => texto(ork(fora, amb, 'network', 'status', '--sem-remoto')));
  caso(casos, 'cli network: uso com forja invalida', () => texto(ork(fora, amb, 'network', 'entrar', '--forja', 'bitbucket')));
  caso(casos, 'cli network: subcomando desconhecido', () => texto(ork(fora, amb, 'network', 'voar')));
  caso(casos, 'cli network: publicar fora da rede', () => texto(ork(fora, amb, 'network', 'publicar')));
  const forja = dirTemp('network-forja', '<FORJA>');
  const binDaForja = dirTemp('network-forja-bin', '<FORJABIN>');
  const script = scriptDaForjaFalsa();
  for (const cli of ['gh', 'glab', 'codex', 'openclaw']) fs.writeFileSync(path.join(binDaForja, cli), script, { mode: 0o755 });
  const comForja = { PATH: `${binDaForja}:${amb.stub}:${amb.bin}`, GLAB_FAKE_DIR: forja };
  const casaA = dirTemp('network-casa-a', '<CASA_A>'), casaB = dirTemp('network-casa-b', '<CASA_B>');
  const comoA = { ...comForja, HOME: casaA, ORK_USUARIO_DIR: path.join(casaA, '.orkastery'), ORK_MAQUINA: '' };
  const comoB = { ...comForja, HOME: casaB, ORK_USUARIO_DIR: path.join(casaB, '.orkastery'), ORK_MAQUINA: '' };
  caso(casos, 'cli network: entrar e criar a casa', () => texto(orkComEnv(fora, amb, comoA, 'network', 'entrar', '--maquina', 'pc-a')));
  caso(casos, 'cli network: entrar na casa que existe', () => texto(orkComEnv(fora, amb, comoB, 'network', 'entrar', '--maquina', 'pc-b')));
  caso(casos, 'cli network: status', () => texto(orkComEnv(fora, amb, comoB, 'network')));
  caso(casos, 'cli network: publicar igual', () => texto(orkComEnv(fora, amb, comoA, 'network', 'publicar')));
  caso(casos, 'cli network: publicar --forcar', () => texto(orkComEnv(fora, amb, comoA, 'network', 'publicar', '--forcar')));
  caso(casos, 'cli network: entrar com ORK_MAQUINA diferente', () => texto(orkComEnv(fora, amb, { ...comoA, ORK_MAQUINA: 'outro-nome' }, 'network', 'entrar', '--maquina', 'pc-a')));
  caso(casos, 'cli network: sair', () => texto(orkComEnv(fora, amb, comoB, 'network', 'sair')));
  caso(casos, 'cli network: sair de novo', () => texto(orkComEnv(fora, amb, comoB, 'network', 'sair')));
  caso(casos, 'cli network: status depois de sair', () => texto(orkComEnv(fora, amb, comoB, 'network', 'status', '--sem-remoto')));
  caso(casos, 'cli network: roadmap fora de projeto', () => texto(orkComEnv(fora, amb, comoA, 'network', 'roadmap', '--sem-remoto')));
  caso(casos, 'cli network: roadmap uso', () => texto(orkComEnv(fora, amb, comoA, 'network', 'roadmap', 'x')));
}

function casosDeReservas(casos: Record<string, string>, amb: Ambiente): void {
  const repo = projeto('reservas', 'loc', amb);
  fs.mkdirSync(path.join(repo, 'docs', 'roadmap'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'roadmap', 'RM-001-teste.md'), '# RM-001 teste\n');
  fs.writeFileSync(path.join(repo, 'docs', 'roadmap', 'RM-002-outro.md'), '# RM-002 outro\n');
  exec('git', ['add', '--', 'docs'], repo);
  exec('git', ['commit', '-q', '-m', 'roadmap'], repo);
  caso(casos, 'cli roadmap: reservas sem remoto', () => texto(ork(repo, amb, 'roadmap', 'reservas')));
  caso(casos, 'cli roadmap: padrao sem remoto', () => texto(ork(repo, amb, 'roadmap')));
  caso(casos, 'cli roadmap: soltar orfas sem remoto', () => texto(ork(repo, amb, 'roadmap', 'reservas', '--soltar-orfas')));
  caso(casos, 'cli roadmap: uso', () => texto(ork(repo, amb, 'roadmap', 'voar')));
  caso(casos, 'cli roadmap: pegar sem item', () => texto(ork(repo, amb, 'roadmap', 'pegar')));
  const remoto = dirTemp('reservas-remoto', '<REMOTO>');
  exec('git', ['init', '--bare', '-q', remoto], repo);
  exec('git', ['remote', 'add', 'origin', remoto], repo);
  exec('git', ['push', '-q', 'origin', 'main'], repo);
  caso(casos, 'cli roadmap: reservas vazias', () => texto(ork(repo, amb, 'roadmap', 'reservas')));
  caso(casos, 'cli roadmap: pegar', () => texto(ork(repo, amb, 'roadmap', 'pegar', 'RM-001', '--nota', 'fatia 1')));
  caso(casos, 'cli roadmap: pegar de novo', () => texto(ork(repo, amb, 'roadmap', 'pegar', 'RM-001')));
  caso(casos, 'cli roadmap: pegar item que nao existe', () => texto(ork(repo, amb, 'roadmap', 'pegar', 'RM-099')));
  caso(casos, 'cli roadmap: pegar item invalido', () => texto(ork(repo, amb, 'roadmap', 'pegar', 'XX-1')));
  caso(casos, 'cli roadmap: pegar com outra pessoa', () => texto(orkComEnv(repo, amb, { ORK_MAQUINA: 'pc-outro' }, 'roadmap', 'pegar', 'RM-002', '--thread', 'loc-x')));
  caso(casos, 'cli roadmap: pegar item de outra maquina', () => texto(ork(repo, amb, 'roadmap', 'pegar', 'RM-002')));
  caso(casos, 'cli roadmap: soltar item de outra maquina sem forcar', () => texto(ork(repo, amb, 'roadmap', 'soltar', 'RM-002')));
  caso(casos, 'cli roadmap: soltar item de outra maquina com forcar sem motivo', () => texto(ork(repo, amb, 'roadmap', 'soltar', 'RM-002', '--forcar')));
  caso(casos, 'cli roadmap: reservas', () => texto(ork(repo, amb, 'roadmap', 'reservas')));
  caso(casos, 'cli roadmap: feat', () => texto(ork(repo, amb, 'roadmap', 'feat', '--thread', 'loc-a')));
  caso(casos, 'cli roadmap: feat sem thread', () => texto(ork(repo, amb, 'roadmap', 'feat')));
  caso(casos, 'cli roadmap: soltar', () => texto(ork(repo, amb, 'roadmap', 'soltar', 'RM-001')));
  caso(casos, 'cli roadmap: soltar livre', () => texto(ork(repo, amb, 'roadmap', 'soltar', 'RM-001')));
  caso(casos, 'cli roadmap: soltar tomando', () => texto(ork(repo, amb, 'roadmap', 'soltar', 'RM-002', '--forcar', '--motivo', 'maquina sumiu')));
  caso(casos, 'cli roadmap: reservas com feats', () => texto(ork(repo, amb, 'roadmap', 'reservas')));
  caso(casos, 'cli roadmap: soltar orfas', () => texto(ork(repo, amb, 'roadmap', 'reservas', '--soltar-orfas')));
}

function casosDeDocs(casos: Record<string, string>, amb: Ambiente): void {
  const repo = projeto('docs', 'loc', amb);
  ork(repo, amb, 'docs', 'init');
  const modelo = fs.readFileSync(path.join(repo, 'docs', 'roadmap', '_modelo-item.md'), 'utf8');
  fs.writeFileSync(path.join(repo, 'docs', 'roadmap', 'RM-001-teste.md'), modelo.replace(/RM-NNN/g, 'RM-001'));
  fs.writeFileSync(path.join(repo, 'docs', 'roadmap', 'RM-02-ruim.md'), '---\nid: RM-02\ntipo: roadmap\n---\n\n# Sem nada\n\nTexto.\n');
  fs.writeFileSync(path.join(repo, 'docs', 'produto', 'FEAT-01-x.md'), '---\nid: FEAT-01\ntipo: feature\npai: MOD-09\n---\n\n# FEAT-01 x\n\n' +
    `${'palavra '.repeat(130)}\n\n[link](nao-existe.md)\n`);
  caso(casos, 'cli docs: verificar', () => texto(ork(repo, amb, 'docs', 'verificar')));
  caso(casos, 'cli docs: verificar --pr', () => texto(ork(repo, amb, 'docs', 'verificar', '--pr')));
  caso(casos, 'cli docs: padrao', () => texto(ork(repo, amb, 'docs')));
  caso(casos, 'cli docs: achados do --json', () => {
    const r = ork(repo, amb, 'docs', 'verificar', '--json');
    const j = JSON.parse(r.stdout) as { achados: Achado[] };
    return j.achados.map((a) => `${a.regra} | ${a.mensagem} | ${a.correcao ?? '-'}`).join('\n');
  });
  caso(casos, 'cli docs: sincronizar', () => texto(ork(repo, amb, 'docs', 'sincronizar')));
  caso(casos, 'cli docs: sincronizar --so sem item', () => texto(ork(repo, amb, 'docs', 'sincronizar', '--so')));
  caso(casos, 'cli docs: sincronizar --so invalido', () => texto(ork(repo, amb, 'docs', 'sincronizar', '--so', 'XX')));
  caso(casos, 'cli docs: sincronizar --so', () => texto(ork(repo, amb, 'docs', 'sincronizar', '--so', 'RM-001')));
  caso(casos, 'cli docs: sincronizar --todos --escrever', () => texto(ork(repo, amb, 'docs', 'sincronizar', '--todos', '--escrever')));
  caso(casos, 'cli docs: subcomando desconhecido', () => texto(ork(repo, amb, 'docs', 'voar')));
  caso(casos, 'docs: achados de verificarDocs', () => verificarDocs(repo, { baseBranch: 'main' }).achados
    .map((a) => `${a.regra} | ${a.mensagem} | ${a.correcao ?? '-'}`).join('\n'));
}

/**
 * O que o install copiou: cada arquivo do recibo com o sha256 do conteudo instalado, depois de trocar os caminhos que
 * variam de maquina (catalogo, pasta temporaria) por marcadores. E a prova de que o dono pt-BR recebe os mesmos
 * arquivos de hoje: 16 hex do sha bastam e nao caem no normalizador.
 */
function recibo(destino: string): string {
  const r = JSON.parse(fs.readFileSync(path.join(destino, 'INSTALADO.json'), 'utf8')) as { arquivos: { arquivo: string }[] };
  return r.arquivos.map((a) => {
    const conteudo = normalizar(fs.readFileSync(path.join(destino, a.arquivo), 'utf8'));
    return `${a.arquivo} sha:${createHash('sha256').update(conteudo).digest('hex').slice(0, 16)}`;
  }).join('\n');
}

function casosDeAdapter(casos: Record<string, string>, amb: Ambiente): void {
  const repo = projeto('adapter', 'loc', amb);
  caso(casos, 'cli adapter: list', () => texto(ork(repo, amb, 'adapter', 'list')));
  caso(casos, 'cli adapter: padrao', () => texto(ork(repo, amb, 'adapter')));
  caso(casos, 'cli adapter: show', () => texto(ork(repo, amb, 'adapter', 'show', 'claude-code')));
  caso(casos, 'cli adapter: show de host desconhecido', () => texto(ork(repo, amb, 'adapter', 'show', 'vscode')));
  caso(casos, 'cli adapter: install de host desconhecido', () => texto(ork(repo, amb, 'adapter', 'install', 'vscode')));
  caso(casos, 'cli adapter: install --dry-run', () => texto(ork(repo, amb, 'adapter', 'install', 'claude-code', '--dry-run', '--ork', '/usr/bin/ork')));
  caso(casos, 'cli adapter: install claude-code', () => texto(ork(repo, amb, 'adapter', 'install', 'claude-code', '--ork', '/usr/bin/ork')));
  caso(casos, 'cli adapter: install claude-code de novo', () => texto(ork(repo, amb, 'adapter', 'install', 'claude-code', '--ork', '/usr/bin/ork')));
  caso(casos, 'cli adapter: recibo do claude-code', () => recibo(path.join(repo, '.claude', 'plugins', 'orkastery')));
  const goal = path.join(repo, '.claude', 'plugins', 'orkastery', 'commands', 'goal.md');
  fs.appendFileSync(goal, '\neditado a mao\n');
  caso(casos, 'cli adapter: install claude-code com copia editada', () => texto(ork(repo, amb, 'adapter', 'install', 'claude-code', '--ork', '/usr/bin/ork')));
  caso(casos, 'cli adapter: install codex', () => texto(ork(repo, amb, 'adapter', 'install', 'codex', '--ork', '/usr/bin/ork')));
  caso(casos, 'cli adapter: recibo do codex', () => recibo(path.join(repo, '.agents', 'skills', 'orkastery')));
  const hermes = dirTemp('adapter-hermes', '<HERMES>');
  caso(casos, 'cli adapter: install hermes', () => texto(ork(repo, amb, 'adapter', 'install', 'hermes', '--dir', hermes, '--ork', '/usr/bin/ork')));
  caso(casos, 'cli adapter: recibo do hermes', () => recibo(hermes));
  caso(casos, 'cli adapter: subcomando desconhecido', () => texto(ork(repo, amb, 'adapter', 'voar')));
}

function casosDePrompt(casos: Record<string, string>, amb: Ambiente): void {
  const repo = projeto('prompt', 'loc', amb);
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'loc-p', '--sem-worktree', '--modo', 'auto'));
  caso(casos, 'cli prompt: render de exemplo', () => texto(ork(repo, amb, 'prompt', 'render', '--exemplo', '--fase', 'GOAL', '--modo', 'auto',
    '--pedido', 'um pedido de teste')));
  caso(casos, 'cli prompt: render de exemplo classic no PLAN', () => texto(ork(repo, amb, 'prompt', 'render', '--exemplo', '--fase', 'PLAN', '--modo', 'classic',
    '--pedido', 'outro pedido')));
  caso(casos, 'cli prompt: render da thread', () => texto(ork(repo, amb, 'prompt', 'render', id, 'GOAL', '--pedido', 'pedido da thread')));
}

export function gerarCasos(): Record<string, string> {
  definirFusoDoDono(SP);
  const casos: Record<string, string> = {};
  try {
    casosDeFuncao(casos);
    const amb = ambiente('cli');
    casosDeThread(casos, amb);
    casosDeWorktree(casos, amb);
    casosDeClaims(casos, amb);
    casosDeDecisao(casos, amb);
    casosDeAccounts(casos, amb);
    casosDeNetwork(casos, amb);
    casosDeReservas(casos, amb);
    casosDeDocs(casos, amb);
    casosDeAdapter(casos, amb);
    casosDePrompt(casos, amb);
  } finally {
    definirFusoDoDono(undefined);
    limparTudo();
  }
  return casos;
}
