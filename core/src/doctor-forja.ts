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
import type { RodarCli } from './forja/api';
import type { ForjaResolvida } from './forja/contrato';
import { lerEnderecoDoRemoto } from './forja/endereco';
import { rodarCli } from './forja/executor';
import { dirDoCacheDaForja } from './forja/cache';
import { resolverForja, SONDAS_PADRAO, SondasDaForja } from './forja/resolver';
import { msg } from './locale';
import { ManifestoCarregado } from './manifest';
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
  return checks;
}
