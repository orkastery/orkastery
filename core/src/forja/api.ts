/**
 * A chamada a API REST da forja pela CLI ja logada (`gh api`, `glab api`). O host vai sempre explicito (`CLI_DA_FORJA`),
 * o corpo vai pelo stdin, a resposta vem com o status e os cabecalhos (`-i`), o ambiente e reduzido e o diretorio e
 * neutro. O erro sai tipado pelo status HTTP. Um 429 em leitura espera o `tentarEm` uma vez, ate 60 s, e repete;
 * escrita nunca se repete sozinha (quem chamou rele o estado antes de agir). No `glab`, que faz o pedido anonimo quando
 * nao tem login no host, o login e conferido antes da primeira chamada de cada host do processo. A paginacao segue o
 * `Link` (ou o `x-next-page` do GitLab) ate 10 paginas de 100; passou disso, `forja.incompleto`.
 */
import * as os from 'node:os';
import { detalheSeguro } from '../forja';
import { AlvoDaCli, CLI_DA_FORJA, hostDaApi } from './cli';
import type { CodigoDeErroDaForja, ErroDaForja, Resultado } from './contrato';
import { ChamadaDaCli, rodarCli, SaidaDaCli } from './executor';

export type MetodoHttp = 'GET' | 'POST' | 'PUT';
/** `caminho` e relativo a raiz da API (`projects/1/merge_requests`), sem barra inicial. */
export interface PedidoDaApi { metodo: MetodoHttp; caminho: string; corpo?: unknown; prazoMs?: number }
export interface LimiteDaApi { restante: number | null; total: number | null; reiniciaEm: string | null }
/** `cabecalhos` com o nome em minusculas. */
export interface RespostaDaApi { status: number; corpo: unknown; cabecalhos: Readonly<Record<string, string>>; limite: LimiteDaApi }
export type RodarCli = (c: ChamadaDaCli) => SaidaDaCli;
export interface OpcoesDaApi {
  rodar?: RodarCli;
  agoraMs?: () => number;
  esperar?: (ms: number) => void;
  /** Os hosts com o login ja conferido; sem ele, o mapa do processo. */
  logins?: Map<string, boolean>;
}
export type ChamadorDaApi = (pedido: PedidoDaApi) => Resultado<RespostaDaApi>;

export const PRAZO_DA_API_MS = 30_000;
export const ESPERA_MAXIMA_DO_LIMITE_MS = 60_000;
export const POR_PAGINA = 100;
export const MAX_PAGINAS = 10;
const TETO_DA_SAIDA = 32 * 1024 * 1024;
const PRAZO_DO_LOGIN_MS = 15_000;

const LOGINS = new Map<string, boolean>();
const falha = (codigo: CodigoDeErroDaForja, detalhe: string): { ok: false; erro: ErroDaForja } => ({ ok: false, erro: { codigo, detalhe } });
const dormir = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/** A chave do login: o host como a CLI o guarda, `host` ou `host:porta`, nunca com o caminho base. */
export const chaveDoLogin = (f: AlvoDaCli): string => hostDaApi(f);

/**
 * A CLI do tipo tem login no host exato? O codigo de saida, e a saida quando a CLI nao filtra o host sozinha.
 * `binario`: o caminho absoluto da CLI a rodar, sem busca no PATH.
 */
export function temLogin(f: AlvoDaCli, rodar: RodarCli = rodarCli, binario?: string): boolean {
  const cli = CLI_DA_FORJA[f.tipo];
  const s = rodar({ cmd: cli.cmd, args: cli.login(f), prazoMs: PRAZO_DO_LOGIN_MS, maxBuffer: 1024 * 1024, ...cli.ambiente(f),
    cwd: os.tmpdir(), reduzido: true, ...(binario !== undefined ? { binario } : {}) });
  return s.status === 0 && (cli.confirmaLogin?.(f, `${s.stdout}\n${s.stderr}`) ?? true);
}

/** A saida de `-i`: `HTTP/x NNN texto`, os cabecalhos ate a linha vazia (CRLF ou LF) e o corpo. */
export function lerSaidaHttp(stdout: string): { status: number; cabecalhos: Record<string, string>; corpo: string } | null {
  const linha = /^HTTP\/\d(?:\.\d)? (\d{3})\b[^\n]*\n/.exec(stdout);
  if (!linha) return null;
  const resto = stdout.slice(linha[0].length);
  const cabecalhos: Record<string, string> = {};
  let pos = 0;
  for (;;) {
    const fim = resto.indexOf('\n', pos);
    if (fim < 0) return null;
    const l = resto.slice(pos, fim).replace(/\r$/, '');
    pos = fim + 1;
    if (l === '') break;
    const dois = l.indexOf(':');
    if (dois > 0) cabecalhos[l.slice(0, dois).trim().toLowerCase()] = l.slice(dois + 1).trim();
  }
  return { status: Number(linha[1]), cabecalhos, corpo: resto.slice(pos) };
}

const inteiro = (v: string | undefined): number | null => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);

function limiteDe(c: Readonly<Record<string, string>>): LimiteDaApi {
  const reset = inteiro(c['ratelimit-reset'] ?? c['x-ratelimit-reset']);
  return { restante: inteiro(c['ratelimit-remaining'] ?? c['x-ratelimit-remaining']), total: inteiro(c['ratelimit-limit'] ?? c['x-ratelimit-limit']),
    reiniciaEm: reset === null ? null : new Date(reset * 1000).toISOString() };
}

/** A cota abaixo de 10 %: os consumidores de fundo (pulse, espera de CI) espacam as chamadas. */
export const limiteBaixo = (l: LimiteDaApi): boolean => l.restante !== null && l.total !== null && l.total > 0 && l.restante < l.total * 0.1;

/** Quando tentar de novo: o `Retry-After` (segundos ou data) ou o reset da cota (epoch em segundos). */
function tentarEmDe(c: Readonly<Record<string, string>>, agora: number): string | null {
  const espera = c['retry-after'];
  if (espera && /^\d+$/.test(espera)) return new Date(agora + Number(espera) * 1000).toISOString();
  if (espera && Number.isFinite(Date.parse(espera))) return new Date(Date.parse(espera)).toISOString();
  const reset = inteiro(c['ratelimit-reset'] ?? c['x-ratelimit-reset']);
  return reset === null ? null : new Date(reset * 1000).toISOString();
}

/** A mensagem do corpo de erro (`message` no GitHub e no GitLab, que as vezes a da como objeto). */
function mensagemDoCorpo(texto: string): string {
  try {
    const j = JSON.parse(texto) as Record<string, unknown> | null;
    const m = j && typeof j === 'object' ? j.message ?? j.error ?? j.error_description : undefined;
    return typeof m === 'string' ? m : m === undefined ? '' : JSON.stringify(m);
  } catch { return texto.trim().slice(0, 200); }
}

function erroDoStatus(h: { status: number; cabecalhos: Record<string, string>; corpo: string }, pedido: PedidoDaApi, agora: number): ErroDaForja {
  const texto = mensagemDoCorpo(h.corpo);
  const detalhe = detalheSeguro(`HTTP ${h.status} ${pedido.metodo} ${pedido.caminho}${texto ? `: ${texto}` : ''}`);
  // O GitHub responde 403, e nao 429, quando a cota primaria acaba (`x-ratelimit-remaining: 0`) e na secundaria.
  // O limite secundario pode vir com a cota primaria sobrando e sem `Retry-After`: so a mensagem o diz, e a espera
  // minima recomendada e de 60 s (o reset da cota primaria nao vale para ele).
  const secundario = h.status === 403 && !('retry-after' in h.cabecalhos) && h.cabecalhos['x-ratelimit-remaining'] !== '0'
    && /rate limit/i.test(texto);
  const cota = h.status === 429 || (h.status === 403 && (h.cabecalhos['x-ratelimit-remaining'] === '0' || 'retry-after' in h.cabecalhos)) || secundario;
  if (cota) {
    const tentarEm = secundario ? new Date(agora + 60_000).toISOString() : tentarEmDe(h.cabecalhos, agora);
    return { codigo: 'forja.limite', detalhe, ...(tentarEm ? { tentarEm } : {}) };
  }
  const codigo: CodigoDeErroDaForja = h.status === 401 ? 'forja.sem-login' : h.status === 403 ? 'forja.sem-permissao'
    : h.status === 404 ? 'forja.nao-achei' : h.status === 409 ? 'forja.conflito' : h.status >= 500 ? 'forja.indisponivel' : 'forja.pedido-recusado';
  return { codigo, detalhe };
}

function umaChamada(f: AlvoDaCli, pedido: PedidoDaApi, rodar: RodarCli, agora: number): Resultado<RespostaDaApi> {
  const cli = CLI_DA_FORJA[f.tipo];
  const prazoMs = pedido.prazoMs ?? PRAZO_DA_API_MS;
  const comCorpo = pedido.corpo !== undefined;
  const s = rodar({ cmd: cli.cmd, args: cli.api(f, pedido.metodo, pedido.caminho, comCorpo), entrada: comCorpo ? JSON.stringify(pedido.corpo) : undefined,
    prazoMs, maxBuffer: TETO_DA_SAIDA, ...cli.ambiente(f), cwd: os.tmpdir(), reduzido: true });
  if (s.erro === 'ENOENT') return falha('forja.ausente', `${cli.cmd}: ENOENT`);
  // O estouro do teto tambem mata o processo com SIGTERM: vem antes do prazo.
  if (s.erro === 'ENOBUFS') return falha('forja.resposta-invalida', detalheSeguro(`${pedido.metodo} ${pedido.caminho}: saida > ${TETO_DA_SAIDA} B`));
  if (s.erro === 'ETIMEDOUT' || s.sinal === 'SIGTERM') return falha('forja.indisponivel', `${cli.cmd}: ${Math.round(prazoMs / 1000)} s`);
  const h = lerSaidaHttp(s.stdout);
  if (!h) {
    const texto = `${s.stderr}\n${s.stdout}`;
    const semLogin = /auth login|not logged|not been authenticated|no token|GH_TOKEN|GITLAB_TOKEN/i.test(texto);
    return falha(semLogin ? 'forja.sem-login' : 'forja.indisponivel', detalheSeguro(s.stderr || s.stdout || `${cli.cmd}: ${s.status}`));
  }
  if (h.status < 200 || h.status >= 300) return { ok: false, erro: erroDoStatus(h, pedido, agora) };
  let corpo: unknown = null;
  if (h.corpo.trim()) {
    try { corpo = JSON.parse(h.corpo); } catch { return falha('forja.resposta-invalida', detalheSeguro(`HTTP ${h.status} ${pedido.metodo} ${pedido.caminho}`)); }
  }
  return { ok: true, valor: { status: h.status, corpo, cabecalhos: h.cabecalhos, limite: limiteDe(h.cabecalhos) } };
}

export function chamarApi(f: AlvoDaCli, pedido: PedidoDaApi, opcoes: OpcoesDaApi = {}): Resultado<RespostaDaApi> {
  const rodar = opcoes.rodar ?? rodarCli, agoraMs = opcoes.agoraMs ?? Date.now, esperar = opcoes.esperar ?? dormir;
  const cli = CLI_DA_FORJA[f.tipo];
  // Um caminho com `-` na frente seria lido pela CLI como opcao.
  if (pedido.caminho.startsWith('-')) return falha('forja.pedido-recusado', detalheSeguro(`${pedido.metodo} ${pedido.caminho}: caminho com - na frente`));
  if (cli.loginAntes) {
    const logins = opcoes.logins ?? LOGINS, chave = chaveDoLogin(f);
    let comLogin = logins.get(chave);
    // So o login confirmado fica guardado: uma falha passageira nao marca o host como sem login pelo resto do processo.
    if (comLogin === undefined) { comLogin = temLogin(f, rodar); if (comLogin) logins.set(chave, true); }
    if (!comLogin) return falha('forja.sem-login', `${cli.cmd} ${chave}`);
  }
  const r = umaChamada(f, pedido, rodar, agoraMs());
  if (r.ok || r.erro.codigo !== 'forja.limite' || pedido.metodo !== 'GET' || !r.erro.tentarEm) return r;
  const espera = Date.parse(r.erro.tentarEm) - agoraMs();
  if (espera > ESPERA_MAXIMA_DO_LIMITE_MS) return r;
  esperar(Math.max(0, espera));
  return umaChamada(f, pedido, rodar, agoraMs());
}

export const chamadorDaApi = (f: AlvoDaCli, opcoes: OpcoesDaApi = {}): ChamadorDaApi => (p) => chamarApi(f, p, opcoes);

/** O numero da proxima pagina: do `Link` `rel="next"` ou do `x-next-page`. `sem-numero`: ha proxima sem `page=`. */
export function proximaPagina(cabecalhos: Readonly<Record<string, string>>): number | null | 'sem-numero' {
  const link = cabecalhos.link;
  // O header inteiro, sem cortar na virgula: a URL do next pode ter virgula (`labels=a,b`). Com `rel=next` e sem o
  // numero lido, `sem-numero`, nunca o fim da lista.
  if (link && /\brel="?next\b/.test(link)) {
    const m = /<([^>]*)>\s*;\s*rel="?next\b/.exec(link);
    const pagina = m ? /[?&]page=(\d+)/.exec(m[1]) : null;
    return pagina ? Number(pagina[1]) : 'sem-numero';
  }
  return inteiro(cabecalhos['x-next-page'] || undefined);
}

function comPagina(caminho: string, pagina: number): string {
  const corte = caminho.indexOf('?');
  const base = corte < 0 ? caminho : caminho.slice(0, corte);
  const consulta = new URLSearchParams(corte < 0 ? '' : caminho.slice(corte + 1));
  consulta.set('per_page', String(POR_PAGINA));
  consulta.set('page', String(pagina));
  return `${base}?${consulta.toString()}`;
}

/**
 * Le as paginas de uma lista (GET) por um chamador ja ligado a forja, pelo numero que a forja manda. `itens` extrai a
 * lista do corpo (`null`: fora do formato); sem ele, o corpo tem de ser a lista. Mais de 10 paginas: `forja.incompleto`,
 * nunca a lista curta.
 */
export function paginarPelaApi(api: ChamadorDaApi, p: { caminho: string; itens?: (corpo: unknown) => unknown[] | null; prazoMs?: number }):
  Resultado<{ itens: unknown[]; paginas: number }> {
  const extrair = p.itens ?? ((corpo: unknown) => (Array.isArray(corpo) ? corpo : null));
  const itens: unknown[] = [];
  let pagina = 1;
  for (let lidas = 1; lidas <= MAX_PAGINAS; lidas++) {
    const r = api({ metodo: 'GET', caminho: comPagina(p.caminho, pagina), prazoMs: p.prazoMs });
    if (!r.ok) return r;
    const lista = extrair(r.valor.corpo);
    if (!lista) return falha('forja.resposta-invalida', detalheSeguro(p.caminho));
    itens.push(...lista);
    const proxima = proximaPagina(r.valor.cabecalhos);
    if (proxima === null) return { ok: true, valor: { itens, paginas: lidas } };
    if (proxima === 'sem-numero' || proxima <= pagina) return falha('forja.resposta-invalida', detalheSeguro(`${p.caminho}: next`));
    pagina = proxima;
  }
  return falha('forja.incompleto', detalheSeguro(`${p.caminho} > ${MAX_PAGINAS}x${POR_PAGINA}`));
}

/** `paginarPelaApi` com o chamador da forja `f`. */
export function paginarApi(f: AlvoDaCli, p: { caminho: string; itens?: (corpo: unknown) => unknown[] | null; prazoMs?: number },
  opcoes: OpcoesDaApi = {}): Resultado<{ itens: unknown[]; paginas: number }> {
  return paginarPelaApi(chamadorDaApi(f, opcoes), p);
}
