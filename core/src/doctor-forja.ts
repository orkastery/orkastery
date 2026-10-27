/**
 * A secao "forja" do `ork doctor`: a forja resolvida do remoto `origin` e de onde veio cada valor, o alcance das
 * portas HTTPS e SSH, a cadeia TLS, o subcaminho, a CLI e o login, os escopos do token, a versao do servidor, as
 * opcoes de merge do projeto e as capacidades do adaptador.
 *
 * Sem remoto com host de forja e sem o bloco `forja:`, a secao nao se aplica e nao tem linha. Cada linha encerra as
 * que dependem dela (sem HTTPS nao ha TLS; sem login nao ha API). So reprova o que a forja impede de verdade, e so
 * quando o projeto depende dela (`ci.required_for_ship` ou o bloco `forja:`); fora disso, o mesmo achado e aviso: o
 * doctor e gate de despacho. So consulta: nada e escrito na forja. A rede e a CLI sao injetaveis.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { z } from 'zod';
import { CAPACIDADES } from './forja/adaptador';
import { chamadorDaApi, ChamadorDaApi, chaveDoLogin, RodarCli, temLogin } from './forja/api';
import { CLI_DA_FORJA, hostDaApi, versaoAbaixo } from './forja/cli';
import { adaptadorDaForja } from './forja/registro';
import { FAIXAS, lerMetadados } from './forja/versao';
import type { ForjaResolvida } from './forja/contrato';
import { lerEnderecoDoRemoto } from './forja/endereco';
import { rodarCli } from './forja/executor';
import { dirDoCacheDaForja } from './forja/cache';
import { resolverForja, SONDAS_PADRAO, SondasDaForja } from './forja/resolver';
import { msg } from './locale';
import { ManifestoCarregado } from './manifest';
import { projetoNaApi } from './forja/gitlab/pedidos';
import { fixacaoInstalada } from './mcp-ship-transporte';
import { Check } from './types';
import { exec } from './util';

export type EstadoDaPorta = 'aberta' | 'recusada' | 'sem-resposta';
export type ResultadoDoTls = { ok: true } | { ok: false; motivo: string };

export interface SondasDoDoctor {
  /** A URL do remoto (`git remote get-url`); `null` sem ele. */
  urlDoRemoto(raiz: string, remoto: string): string | null;
  sondas: SondasDaForja;
  porta(host: string, porta: number, prazoMs: number): EstadoDaPorta;
  /** A cadeia TLS valida com a CA do sistema, ou so com a `ca` quando ela vem? `motivo` e o codigo do erro do Node. */
  tls(host: string, porta: number, ca: string | null, prazoMs: number): ResultadoDoTls;
  rodar: RodarCli;
  agoraMs(): number;
  /** O diretorio do cache de metadados e da sondagem (`.orkastery/cache`); `null` desliga o cache. */
  cache: string | null;
  /** A plataforma da maquina: fora do Linux, a `ca` do manifesto nao chega ao `gh`. */
  plataforma: NodeJS.Platform;
  /** O transporte do SHIP do MCP fixado para a raiz (`forja-https` empurra com o token da CLI); `null` sem fixacao. */
  transporteDoShip?(raiz: string): string | null;
}

/** O remoto conferido: o mesmo que a CI do `ork ship` consulta por padrao. */
export const REMOTO_DA_FORJA = 'origin';
const PRAZO_DA_REDE_MS = 5_000;

/** Um processo filho do Node mede a porta ou a cadeia TLS e devolve JSON: o doctor e sincrono. */
const SCRIPT_DA_REDE = [
  "const net = require('node:net'), tls = require('node:tls'), fs = require('node:fs');",
  'const [modo, host, porta, prazo, ca] = process.argv.slice(1);',
  'const fim = (r) => { process.stdout.write(JSON.stringify(r)); process.exit(0); };',
  "setTimeout(() => fim(modo === 'tcp' ? { estado: 'sem-resposta' } : { ok: false, motivo: 'sem-resposta' }), Number(prazo));",
  "if (modo === 'tcp') {",
  '  const s = net.connect({ host, port: Number(porta) });',
  "  s.on('connect', () => { s.destroy(); fim({ estado: 'aberta' }); });",
  "  s.on('error', (e) => fim({ estado: e.code === 'ECONNREFUSED' ? 'recusada' : 'sem-resposta' }));",
  '} else {',
  '  const o = { host, port: Number(porta), rejectUnauthorized: true };',
  '  if (!net.isIP(host)) o.servername = host;',
  '  if (ca) o.ca = fs.readFileSync(ca);',
  '  const s = tls.connect(o);',
  "  s.on('secureConnect', () => { s.destroy(); fim({ ok: true }); });",
  "  s.on('error', (e) => fim({ ok: false, motivo: e.code || 'erro' }));",
  '}',
].join('\n');

function sondarRede(argv: readonly string[], prazoMs: number): Record<string, unknown> {
  const r = spawnSync(process.execPath, ['-e', SCRIPT_DA_REDE, ...argv], { encoding: 'utf8', timeout: prazoMs + 2_000, maxBuffer: 64 * 1024 });
  try {
    const j = JSON.parse(r.stdout) as unknown;
    return j && typeof j === 'object' ? j as Record<string, unknown> : {};
  } catch { return {}; }
}

export function sondasPadraoDoDoctor(raiz: string): SondasDoDoctor {
  return {
    urlDoRemoto: (dir, remoto) => {
      const r = exec('git', ['remote', 'get-url', '--', remoto], dir, 10_000);
      return r.ok ? r.stdout.trim() : null;
    },
    sondas: SONDAS_PADRAO,
    porta: (host, porta, prazoMs) => {
      const e = sondarRede(['tcp', host, String(porta), String(prazoMs), ''], prazoMs).estado;
      return e === 'aberta' || e === 'recusada' ? e : 'sem-resposta';
    },
    tls: (host, porta, ca, prazoMs) => {
      const r = sondarRede(['tls', host, String(porta), String(prazoMs), ca ?? ''], prazoMs);
      return r.ok === true ? { ok: true } : { ok: false, motivo: typeof r.motivo === 'string' ? r.motivo : 'sem-resposta' };
    },
    rodar: rodarCli,
    agoraMs: () => Date.now(),
    cache: dirDoCacheDaForja(raiz),
    plataforma: process.platform,
    transporteDoShip: (dir) => { try { return fixacaoInstalada(dir)?.transporte ?? null; } catch { return null; } },
  };
}

type Linha = (nome: string, nivel: Check['nivel'], detalhe: string, correcao?: string) => Check;

const legivel = (arquivo: string): boolean => {
  try { fs.accessSync(arquivo, fs.constants.R_OK); return fs.statSync(arquivo).isFile(); } catch { return false; }
};

function identidade(f: ForjaResolvida, porta: number): string {
  const m = msg().forja.doctor;
  const o = (x: string): string => m.origens[x] ?? x;
  return m.identidade(f.tipo, f.host, porta, f.caminhoBase || '/', f.repo,
    m.origensDosCampos(o(f.origem.tipo), o(f.origem.host), o(f.origem.porta), o(f.origem.caminhoBase)));
}

/** Alcance e TLS; `false` quando o que vem depois nao tem como rodar. */
function alcanceETls(f: ForjaResolvida, portaWeb: number, http: boolean, s: SondasDoDoctor, linha: Linha, checks: Check[]): boolean {
  const m = msg().forja.doctor;
  const sshHost = f.sshHost ?? f.host, sshPorta = f.sshPorta ?? 22;
  const web = s.porta(f.host, portaWeb, PRAZO_DA_REDE_MS), ssh = s.porta(sshHost, sshPorta, PRAZO_DA_REDE_MS);
  const detalhe = m.alcance(m.alcanceDe(f.host, portaWeb, m.portas[web]), m.alcanceDe(sshHost, sshPorta, m.portas[ssh]));
  if (web !== 'aberta') {
    checks.push(linha('forja alcance', 'fail', detalhe, m.webForaCorrecao(f.host, portaWeb)));
    return false;
  }
  checks.push(linha('forja alcance', ssh === 'aberta' ? 'ok' : 'warn', detalhe, m.sshForaCorrecao));
  if (http) {
    checks.push(linha('forja tls', 'warn', m.tlsHttp(f.host), m.tlsHttpCorrecao));
    return true;
  }
  if (f.ca && !legivel(f.ca)) {
    checks.push(linha('forja tls', 'fail', m.caAusente(f.ca), m.caAusenteCorrecao));
    return false;
  }
  const tls = s.tls(f.host, portaWeb, f.ca, PRAZO_DA_REDE_MS);
  if (!tls.ok) {
    checks.push(linha('forja tls', 'fail', m.tlsFalhou(f.host, tls.motivo), m.tlsCorrecao));
    return false;
  }
  // O gh le a CA do manifesto por SSL_CERT_FILE, e o Go so o le no Linux.
  if (f.tipo === 'github' && f.ca && s.plataforma !== 'linux') {
    checks.push(linha('forja tls', 'warn', m.tlsCaForaDoLinux(f.host, f.ca), m.tlsCaForaDoLinuxCorrecao));
    return true;
  }
  checks.push(linha('forja tls', 'ok', m.tlsOk(f.host, f.ca)));
  return true;
}

const PRAZO_DA_CLI_MS = 10_000;

function cliELogin(f: ForjaResolvida, http: boolean, s: SondasDoDoctor, linha: Linha, checks: Check[]): boolean {
  const m = msg().forja.doctor, cli = CLI_DA_FORJA[f.tipo];
  const correcao = m.cliCorrecao(cli.cmd, cli.minima);
  const v = s.rodar({ cmd: cli.cmd, args: ['--version'], prazoMs: PRAZO_DA_CLI_MS, maxBuffer: 1024 * 1024, cwd: os.tmpdir(), reduzido: true });
  if (v.erro === 'ENOENT') { checks.push(linha('forja cli', 'fail', m.cliAusente(cli.cmd, cli.minima), correcao)); return false; }
  const versao = cli.lerVersao(`${v.stdout}\n${v.stderr}`);
  if (!versao) { checks.push(linha('forja cli', 'fail', m.cliIlegivel(cli.cmd), correcao)); return false; }
  if (versaoAbaixo(versao, cli.minima)) { checks.push(linha('forja cli', 'fail', m.cliAbaixo(cli.cmd, versao, cli.minima), correcao)); return false; }
  checks.push(linha('forja cli', 'ok', m.cli(cli.cmd, versao, cli.minima)));
  const alvo = `${hostDaApi(f)}${f.caminhoBase}`;
  if (!temLogin(f, s.rodar)) {
    // O comando que a pessoa roda: com o caminho base no glab (guardado como host, com subfolder) e o token pelo stdin.
    checks.push(linha('forja login', 'fail', m.semLogin(cli.cmd, alvo), m.loginCorrecao(cli.entrar(f, http).join(' '))));
    return false;
  }
  checks.push(linha('forja login', 'ok', m.login(cli.cmd, alvo)));
  return true;
}

/** O subcaminho (com caminho base) e o servidor, pela mesma leitura do metadata. */
function servidor(f: ForjaResolvida, s: SondasDoDoctor, api: ChamadorDaApi, linha: Linha, checks: Check[]): boolean {
  const m = msg().forja.doctor;
  const meta = lerMetadados(f, { cache: s.cache, agoraMs: s.agoraMs(), api });
  if (f.caminhoBase) {
    checks.push(meta.ok ? linha('forja subcaminho', 'ok', m.subcaminho(f.caminhoBase))
      : linha('forja subcaminho', 'fail', m.subcaminhoFalhou(f.caminhoBase, msg().forja.motivo(meta.erro, f.tipo)), m.subcaminhoCorrecao));
  }
  if (!meta.ok) {
    if (!f.caminhoBase) checks.push(linha('forja servidor', 'fail', m.servidorFalhou(msg().forja.motivo(meta.erro, f.tipo)), m.servidorFalhouCorrecao));
    return false;
  }
  const v = meta.valor;
  const cache = v.doCache ? `; ${m.doCache}` : '';
  const piso = FAIXAS[f.tipo]?.piso;
  // A versao ilegivel na forja com faixas (`sem-faixa`) nao prova o piso: reprova como abaixo dele.
  if ((v.faixa === 'abaixo-do-piso' || v.faixa === 'sem-faixa') && piso) {
    checks.push(linha('forja servidor', 'fail', m.servidorAbaixo(v.versao ?? '?', piso) + cache, m.servidorCorrecao(piso)));
    return false;
  }
  checks.push(linha('forja servidor', 'ok', (FAIXAS[f.tipo]
    ? m.servidor(v.versao ?? '?', (v.edicao ?? '?').toUpperCase(), m.faixas[v.faixa] ?? v.faixa)
    : m.servidorSemFaixa(f.host, v.versao)) + cache));
  return true;
}

const TOKEN_DO_GITLAB = z.object({ scopes: z.array(z.string()) });

/** `empurra`: o SHIP do MCP empurra pelo `forja-https`, com o token da CLI; no GitLab, ele precisa de escrita no repositorio. */
function escopo(f: ForjaResolvida, api: ChamadorDaApi, linha: Linha, empurra = false): Check {
  const m = msg().forja.doctor;
  const naoMedivel = (motivo: string): Check => linha('forja escopo', 'warn', m.escopoNaoMedivel(motivo), m.escopoNaoMedivelCorrecao);
  if (f.tipo === 'gitlab') {
    const r = api({ metodo: 'GET', caminho: 'personal_access_tokens/self' });
    if (!r.ok) return naoMedivel(msg().forja.motivo(r.erro, f.tipo));
    const lido = TOKEN_DO_GITLAB.safeParse(r.valor.corpo);
    if (!lido.success) return naoMedivel('personal_access_tokens/self');
    const lista = lido.data.scopes.join(', ') || m.nenhum;
    if (!lido.data.scopes.some((x) => x === 'api' || x === 'read_api')) return linha('forja escopo', 'fail', m.escopoSemLeitura(lista), m.escopoCorrecao);
    if (empurra && !lido.data.scopes.some((x) => x === 'api' || x === 'write_repository')) {
      return linha('forja escopo', 'fail', m.escopoSemEscrita(lista), m.escopoSemEscritaCorrecao);
    }
    return linha('forja escopo', 'ok', m.escopo(lista));
  }
  if (f.tipo === 'github') {
    // `rate_limit` nao gasta a cota e traz o `x-oauth-scopes` do token classico.
    const r = api({ metodo: 'GET', caminho: 'rate_limit' });
    if (!r.ok) return naoMedivel(msg().forja.motivo(r.erro, f.tipo));
    const cabecalho = r.valor.cabecalhos['x-oauth-scopes'];
    if (cabecalho === undefined) return linha('forja escopo', 'ok', m.escopoFineGrained);
    const escopos = cabecalho.split(',').map((x) => x.trim()).filter(Boolean);
    const lista = escopos.join(', ') || m.nenhum;
    return escopos.includes('repo') ? linha('forja escopo', 'ok', m.escopo(lista)) : linha('forja escopo', 'warn', m.escopoSemRepo(lista), m.escopoSemRepoCorrecao);
  }
  return linha('forja escopo', 'ok', m.escopoNaoMedivel(f.tipo));
}

const PROJETO_DO_GITLAB = z.object({
  merge_method: z.string(), squash_option: z.string().optional(), merge_commit_template: z.string().nullable().optional(),
  merge_pipelines_enabled: z.boolean().optional(), merge_trains_enabled: z.boolean().optional(),
});
const REPOSITORIO_DO_GITHUB = z.object({
  allow_merge_commit: z.boolean().optional(), allow_squash_merge: z.boolean().optional(), allow_rebase_merge: z.boolean().optional(),
});

/** O metodo de merge e o que decide se a entrega chega a base com segundo pai. So avisa; o projeto nao lido reprova. */
function projetoDaForja(f: ForjaResolvida, api: ChamadorDaApi, linha: Linha): Check {
  const m = msg().forja.doctor;
  const caminho = f.tipo === 'gitlab' ? projetoNaApi(f.repo) : `repos/${f.repo}`;
  if (f.tipo !== 'gitlab' && f.tipo !== 'github') return linha('forja projeto', 'ok', m.naoMedivel);
  const r = api({ metodo: 'GET', caminho });
  if (!r.ok) return linha('forja projeto', 'fail', m.projetoFalhou(f.repo, msg().forja.motivo(r.erro, f.tipo)), m.projetoFalhouCorrecao);
  const invalido = (): Check => linha('forja projeto', 'warn',
    m.projetoFalhou(f.repo, msg().forja.motivo({ codigo: 'forja.resposta-invalida', detalhe: caminho }, f.tipo)), m.projetoFalhouCorrecao);
  if (f.tipo === 'gitlab') {
    const lido = PROJETO_DO_GITLAB.safeParse(r.valor.corpo);
    if (!lido.success) return invalido();
    const p = lido.data;
    const estado = (v: boolean | undefined): string => (v === undefined ? m.naoDisponivel : v ? m.ligado : m.desligado);
    const avisos: string[] = [];
    if (p.merge_method === 'ff') avisos.push(m.avisoFf);
    if (p.squash_option === 'always' || p.squash_option === 'default_on') avisos.push(m.avisoSquash(p.squash_option));
    const detalhe = [m.projetoGitlab(p.merge_method, p.squash_option ?? '?', estado(p.merge_pipelines_enabled), estado(p.merge_trains_enabled)),
      ...avisos].join('; ');
    return linha('forja projeto', avisos.length ? 'warn' : 'ok', detalhe, m.projetoGitlabCorrecao);
  }
  const lido = REPOSITORIO_DO_GITHUB.safeParse(r.valor.corpo);
  if (!lido.success) return invalido();
  const p = lido.data;
  const permite = (v: boolean | undefined): string => (v === undefined ? m.naoMedivel : v ? m.permitido : m.desligado);
  const avisos = p.allow_merge_commit === false ? [m.avisoSemMergeCommit] : [];
  const detalhe = [m.projetoGithub(permite(p.allow_merge_commit), permite(p.allow_squash_merge), permite(p.allow_rebase_merge)), ...avisos].join('; ');
  return linha('forja projeto', avisos.length ? 'warn' : 'ok', detalhe, m.projetoGithubCorrecao);
}

function capacidades(f: ForjaResolvida): Check {
  const m = msg().forja.doctor, a = adaptadorDaForja(f.tipo);
  // O `checksNoCommit` e o caminho antigo do executor do `gh`: a forja que le a CI pelo `estadoDeCi` nao precisa dele.
  const mostradas = CAPACIDADES.filter((c) => c !== 'checksNoCommit' || typeof a.checksNoCommit === 'function' || typeof a.estadoDeCi !== 'function');
  const ligadas = mostradas.filter((c) => typeof a[c] === 'function');
  const desligadas = mostradas.filter((c) => typeof a[c] !== 'function');
  return desligadas.length
    ? { nome: 'forja capacidades', nivel: 'warn', detalhe: m.capacidadesDesligadas(ligadas.join(', ') || m.nenhum, desligadas.join(', ')),
      correcao: m.capacidadesCorrecao }
    : { nome: 'forja capacidades', nivel: 'ok', detalhe: m.capacidades(ligadas.join(', ')) };
}

export function checarForja(carregado: ManifestoCarregado, s: SondasDoDoctor = sondasPadraoDoDoctor(carregado.raiz)): Check[] {
  const m = msg().forja.doctor;
  const declarada = carregado.manifesto.forja;
  const dependeDaForja = carregado.manifesto.ci.required_for_ship || declarada !== undefined;
  const linha: Linha = (nome, nivel, detalhe, correcao) => {
    const n = nivel === 'fail' && !dependeDaForja ? 'warn' : nivel;
    return { nome, nivel: n, detalhe, ...(n !== 'ok' && correcao ? { correcao } : {}) };
  };
  const url = s.urlDoRemoto(carregado.raiz, REMOTO_DA_FORJA);
  const endereco = url ? lerEnderecoDoRemoto(url) : null;
  if (!endereco) {
    return declarada ? [linha('forja identidade', 'warn', m.semHostComBloco(REMOTO_DA_FORJA), m.semHostCorrecao(REMOTO_DA_FORJA))] : [];
  }
  const resolvida = resolverForja({ endereco, manifesto: declarada, sondas: s.sondas, cache: s.cache, agoraMs: s.agoraMs() });
  if (!resolvida.ok) {
    return [linha('forja identidade', 'fail', msg().forja.motivo(resolvida.erro, null),
      resolvida.erro.codigo === 'forja.remoto-divergente' ? m.divergenteCorrecao : m.identidadeCorrecao)];
  }
  const f = resolvida.valor;
  // Remoto http sem porta declarada no manifesto: a web e a do remoto, sem TLS.
  const http = endereco.protocolo === 'http' && declarada?.porta === undefined;
  const portaWeb = f.porta ?? (http ? 80 : 443);
  const checks: Check[] = [linha('forja identidade', 'ok', identidade(f, portaWeb))];
  if (!alcanceETls(f, portaWeb, http, s, linha, checks)) return checks;
  if (!cliELogin(f, http, s, linha, checks)) return checks;
  // O login ja foi conferido: as chamadas da API nao repetem o `auth status`.
  const api = chamadorDaApi(f, { rodar: s.rodar, agoraMs: s.agoraMs, logins: new Map([[chaveDoLogin(f), true]]) });
  if (!servidor(f, s, api, linha, checks)) return checks;
  checks.push(escopo(f, api, linha, s.transporteDoShip?.(carregado.raiz) === 'forja-https'), projetoDaForja(f, api, linha), capacidades(f));
  return checks;
}
