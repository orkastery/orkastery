// core/src/forja/resolver.ts
/**
 * A identidade da forja do projeto: o tipo, o endereco da web e da API, o SSH, a CA e o caminho do projeto. Nesta
 * ordem: o bloco `forja:` do manifesto; o host conhecido (`github.com`, `gitlab.com` e os apelidos de SSH deles); e a
 * sondagem, so pela CLI que ja tem login no host (`gh api meta`, `glab api metadata`). Nenhuma requisicao anonima vai
 * a host desconhecido, e o nome do host nunca decide o tipo sozinho: um GitLab pode se chamar `github.empresa.com`.
 * Sem resposta, `forja.desconhecida`; com duas, `forja.ambigua`; as duas pedem `forja.tipo` no manifesto. O host e o
 * caminho vem de UM parse do remoto (`lerEnderecoDoRemoto`), que quem chama faz.
 */
import type { Manifesto } from '../types';
import { chamarApi, RodarCli, temLogin } from './api';
import { gravarNoCache, lerDoCache } from './cache';
import { hostDaApi } from './cli';
import { ErroDaForja, ForjaResolvida, OrigemDoValor, Resultado, TipoDeForja, TIPOS_DE_FORJA } from './contrato';
import type { EnderecoDoRemoto } from './endereco';
import { rodarCli } from './executor';

export type RespostaDaSondagem = 'responde' | 'sem-login' | 'nao-responde';
export interface AlvoDaSondagem { host: string; porta: number | null; caminhoBase: string; ca: string | null }
/** Uma sonda por tipo de forja; uma forja nova acrescenta a dela. */
export type SondasDaForja = Partial<Record<TipoDeForja, (alvo: AlvoDaSondagem) => RespostaDaSondagem>>;

const HOSTS_CONHECIDOS: Readonly<Record<string, { tipo: TipoDeForja; host: string }>> = {
  'github.com': { tipo: 'github', host: 'github.com' },
  'ssh.github.com': { tipo: 'github', host: 'github.com' },
  'gitlab.com': { tipo: 'gitlab', host: 'gitlab.com' },
  'altssh.gitlab.com': { tipo: 'gitlab', host: 'gitlab.com' },
};

/** O tipo e o host da web de um host conhecido (o SSH pela 443 tambem), ou `null`. */
export const hostConhecido = (host: string): { tipo: TipoDeForja; host: string } | null => HOSTS_CONHECIDOS[host] ?? null;

const PRAZO_DA_SONDA_MS = 15_000;
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** As sondas pela CLI com login: o login e conferido antes; sem ele, a API nao e chamada. */
export function sondasPadrao(rodar: RodarCli = rodarCli, logins?: Map<string, boolean>): SondasDaForja {
  return {
    github: (alvo) => {
      // O GitHub nao e servido em subcaminho.
      if (alvo.caminhoBase) return 'nao-responde';
      const f = { tipo: 'github' as const, ...alvo };
      if (!temLogin(f, rodar)) return 'sem-login';
      const r = chamarApi(f, { metodo: 'GET', caminho: 'meta', prazoMs: PRAZO_DA_SONDA_MS }, { rodar, logins });
      return r.ok && objeto(r.valor.corpo) && typeof r.valor.corpo.verifiable_password_authentication === 'boolean' ? 'responde' : 'nao-responde';
    },
    // O `chamarApi` confere o login do glab antes do pedido.
    gitlab: (alvo) => {
      const r = chamarApi({ tipo: 'gitlab', ...alvo }, { metodo: 'GET', caminho: 'metadata', prazoMs: PRAZO_DA_SONDA_MS }, { rodar, logins });
      if (!r.ok) return r.erro.codigo === 'forja.sem-login' ? 'sem-login' : 'nao-responde';
      return objeto(r.valor.corpo) && typeof r.valor.corpo.version === 'string' ? 'responde' : 'nao-responde';
    },
  };
}

export const SONDAS_PADRAO: SondasDaForja = sondasPadrao();

export interface EntradaDoResolver {
  /** O remoto, lido pelo parser unico. */
  endereco: EnderecoDoRemoto;
  manifesto?: Manifesto['forja'];
  sondas?: SondasDaForja;
  /** O diretorio do cache de 24 h (`dirDoCacheDaForja`); sem ele, toda resolucao sem tipo sonda. */
  cache?: string | null;
  agoraMs?: number;
}

const erro = (codigo: ErroDaForja['codigo'], detalhe: string): Resultado<never> => ({ ok: false, erro: { codigo, detalhe } });

export function resolverForja(e: EntradaDoResolver): Resultado<ForjaResolvida> {
  const m = e.manifesto ?? {};
  const r = e.endereco;
  const web = r.protocolo === 'https' || r.protocolo === 'http';
  const hostDoRemoto = hostConhecido(r.host)?.host ?? r.host;
  const declarado = m.host ? (hostConhecido(m.host)?.host ?? m.host) : null;
  const host = declarado ?? hostDoRemoto;
  // Com o host declarado, o remoto aponta para ele ou para o SSH declarado; outro host nunca e consultado.
  if (declarado) {
    const aceitos = [declarado, ...(m.ssh_host ? [m.ssh_host] : [])];
    if (!aceitos.includes(r.host) && !aceitos.includes(hostDoRemoto)) return erro('forja.remoto-divergente', `${r.host} != ${declarado}`);
  }
  const caminhoBase = m.caminho_base ?? '';
  let repo = r.caminho;
  if (caminhoBase && web) {
    const prefixo = `${caminhoBase.slice(1)}/`;
    if (!repo.startsWith(prefixo) || repo.slice(prefixo.length).split('/').length < 2) {
      return erro('forja.remoto-divergente', `${r.caminho} !~ ${caminhoBase}`);
    }
    repo = repo.slice(prefixo.length);
  }
  const portaPadrao = r.protocolo === 'http' ? 80 : 443;
  const portaDoRemoto = web && hostDoRemoto === host && r.porta !== null && r.porta !== portaPadrao ? r.porta : null;
  const porta = m.porta ?? portaDoRemoto;
  const ssh = r.protocolo === 'ssh' || r.protocolo === 'scp';
  const valor = {
    host, porta, caminhoBase,
    sshHost: m.ssh_host ?? (ssh && r.host !== host ? r.host : null),
    sshPorta: m.ssh_porta ?? (r.protocolo === 'ssh' ? r.porta : null),
    ca: m.ca ?? null, repo,
  };
  const origem = {
    host: (m.host ? 'manifesto' : 'remoto') as OrigemDoValor,
    porta: (m.porta !== undefined ? 'manifesto' : portaDoRemoto !== null ? 'remoto' : 'padrao') as OrigemDoValor,
    caminhoBase: (m.caminho_base !== undefined ? 'manifesto' : 'padrao') as OrigemDoValor,
  };
  const conhecido = hostConhecido(host);
  if (m.tipo) {
    if (conhecido && conhecido.tipo !== m.tipo) return erro('forja.remoto-divergente', `${host}: ${conhecido.tipo} != ${m.tipo}`);
    return { ok: true, valor: { tipo: m.tipo, ...valor, origem: { tipo: 'manifesto', ...origem } } };
  }
  if (conhecido) return { ok: true, valor: { tipo: conhecido.tipo, ...valor, origem: { tipo: 'remoto', ...origem } } };
  const sondas = e.sondas ?? SONDAS_PADRAO;
  const alvo: AlvoDaSondagem = { host, porta, caminhoBase, ca: valor.ca };
  // O tipo sondado vale 24 h: so a resposta unica e guardada; a duvida volta a sondar.
  const agora = e.agoraMs ?? Date.now();
  const chaveDoCache = `sondagem ${hostDaApi(alvo)}${caminhoBase}`;
  const guardado = lerDoCache(e.cache ?? null, chaveDoCache, agora)?.tipo;
  if ((TIPOS_DE_FORJA as readonly unknown[]).includes(guardado)) {
    return { ok: true, valor: { tipo: guardado as TipoDeForja, ...valor, origem: { tipo: 'sondagem', ...origem } } };
  }
  const respostas = TIPOS_DE_FORJA.flatMap((tipo) => {
    const sonda = sondas[tipo];
    return sonda ? [{ tipo, resposta: sonda(alvo) }] : [];
  });
  const responderam = respostas.filter((x) => x.resposta === 'responde');
  if (responderam.length === 1) {
    gravarNoCache(e.cache ?? null, chaveDoCache, { tipo: responderam[0].tipo }, agora);
    return { ok: true, valor: { tipo: responderam[0].tipo, ...valor, origem: { tipo: 'sondagem', ...origem } } };
  }
  const resumo = respostas.map((x) => `${x.tipo} ${x.resposta}`).join(', ');
  return erro(responderam.length > 1 ? 'forja.ambigua' : 'forja.desconhecida', `${hostDaApi(alvo)}${caminhoBase} (${resumo})`);
}
