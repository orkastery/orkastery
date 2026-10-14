/**
 * Os transportes do `ork_ship` que a instalacao fixa. `forja-ssh`: a chave do servidor confirmada pela pessoa vai
 * para um known_hosts proprio, e o ssh roda sem config do usuario nem do sistema, com `StrictHostKeyChecking=yes`.
 * `forja-https`: o git zera os helpers de credencial da config e recebe um so, o da CLI da forja com login no host,
 * fixado pela origem; a CA do manifesto entra conferida pelo hash. A fixacao mora fora do projeto, numa pasta 700
 * do usuario por raiz; o servidor MCP a le no startup e o worker do SHIP a confere antes de cada passo. O token
 * nunca passa por aqui: o git o pede ao helper pelo pipe.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { TIPOS_DE_FORJA, type ForjaResolvida, type TipoDeForja } from './forja/contrato';
import { CLI_DA_FORJA, versaoAbaixo, type AlvoDaCli } from './forja/cli';
import { chaveDoLogin, temLogin, type RodarCli } from './forja/api';
import { HOST_DO_REMOTO, lerEnderecoDoRemoto, type EnderecoDoRemoto } from './forja/endereco';
import { resolverForja, type SondasDaForja } from './forja/resolver';
import { gitPassivoMcp } from './mcp-git';
import { acharBinario, helperDeCredencialDaCli } from './rede-forja';
import { ErroDoCatalogo, msg } from './locale';
import type { Manifesto } from './types';
import type { TransporteFixado, TransporteShipMcp } from './mcp-transportes';

/** O unico remoto que o `github-ssh` aceita, como sempre. */
export const URL_GITHUB_SSH = /^git@github\.com:[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\.git$/;

/** Cada recusa dos transportes fixados; todas tem a frase no catalogo (`transporteShip.recusa`). */
export const RECUSAS_DO_TRANSPORTE = ['urls', 'modo', 'forja', 'ssh.divergente', 'ssh.sem-resposta', 'ssh.revogada',
  'ssh.nao-confirmada', 'ssh.impressao-divergente', 'ssh.known-hosts-ilegivel', 'ssh.caminho', 'ssh.known-hosts-alterado', 'https.sem-tls',
  'ssh.credencial-na-url', 'https.credencial-na-url', 'https.divergente', 'sem-cli', 'sem-helper', 'sem-login', 'binario', 'ca', 'ca-alterada',
  'fixacao-ausente', 'fixacao-insegura', 'fixacao-divergente', 'mudou-no-push'] as const;
export type RecusaDoTransporte = (typeof RECUSAS_DO_TRANSPORTE)[number];

/** A recusa sai com o codigo `mcp.ship.transport.*` na frente: o servidor e o worker do SHIP so repassam `mcp.*`. */
export function recusar(codigo: RecusaDoTransporte, detalhe: string): never {
  throw new ErroDoCatalogo((m) => m.forja.transporteShip.recusa(`mcp.ship.transport.${codigo}`, detalhe));
}

/** A URL efetiva do origin, a mesma no fetch e no push. O push usa todas as URLs configuradas, nunca so a primeira. */
export function originUnicoMcp(raiz: string): string {
  const ler = (push: boolean): string => {
    const raw = gitPassivoMcp(raiz, ['remote', 'get-url', ...(push ? ['--push'] : []), '--all', 'origin']);
    const urls = raw.split('\n');
    if (urls[urls.length - 1] === '') urls.pop();
    if (urls.length !== 1 || !urls[0] || /[\x00-\x1f\x7f]/.test(urls[0])) throw Error('mcp.ship.transport.urls: origin exige uma URL efetiva');
    return urls[0];
  };
  const fetch = ler(false), push = ler(true);
  if (fetch !== push) throw Error('mcp.ship.transport.pushurl');
  return fetch;
}

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const CAMINHO_SEGURO = /^[A-Za-z0-9_./+-]+$/;
const LIMITE_DA_FIXACAO = 65536, LIMITE_DA_CA = 1048576;
const meuUid = (): number | undefined => process.getuid?.();

// ---------------------------------------------------------------------------
// O origin de cada transporte fixado.
// ---------------------------------------------------------------------------

export type EnderecoDoTransporte = { transporte: 'forja-ssh'; host: string; porta: number }
  | { transporte: 'forja-https'; host: string; porta: number | null; origem: string };

/**
 * Senha ou token na parte de usuario (`user:segredo@`), antes do primeiro `/` do endereco: `ssh://u:s@h/…` ou
 * `u:s@h:caminho`. O usuario sozinho (`git@`) passa.
 */
function senhaNaUrl(bruta: string): boolean {
  const resto = bruta.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''), barra = resto.indexOf('/');
  const autoridade = barra < 0 ? resto : resto.slice(0, barra), arroba = autoridade.lastIndexOf('@');
  return arroba >= 0 && autoridade.slice(0, arroba).includes(':');
}

/** O usuario do SSH, quando vem: `ssh://user@h/…` ou `user@h:caminho`. */
function usuarioDoSsh(bruta: string): string | null {
  const esquema = /^[a-z][a-z0-9+.-]*:\/\/([^/]*)/i.exec(bruta);
  if (esquema) { const i = esquema[1].lastIndexOf('@'); return i < 0 ? null : esquema[1].slice(0, i); }
  const scp = /^([^@:/]*)@/.exec(bruta);
  return scp ? scp[1] : null;
}
const USUARIO_SSH = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

/**
 * O que o origin diz ao transporte, de um parse so (`lerEnderecoDoRemoto`). `forja-ssh`: `ssh://` ou a forma scp,
 * porta 22 quando nao vem, usuario e host que nao parecem opcao. `forja-https`: so `https://`, sem usuario nem token
 * na URL; `http://` levaria a credencial em claro. Nos dois, senha ou token na URL recusa. O detalhe de uma recusa
 * nunca leva o origin cru (pode ter token na query, no fragmento ou num userinfo malformado): no maximo o esquema e o
 * host do parse, ou a palavra `origin` quando nao houve parse.
 */
export function enderecoDoOrigin(transporte: TransporteFixado, url: string): EnderecoDoTransporte {
  return lerOrigin(transporte, url).endereco;
}

/** O parse do origin e o que ele diz ao transporte; a sonda da instalacao leva os dois, de uma leitura so. */
function lerOrigin(transporte: TransporteFixado, url: string): { endereco: EnderecoDoTransporte; remoto: EnderecoDoRemoto } {
  const bruta = url.trim(), e = lerEnderecoDoRemoto(bruta);
  const resumo = (): string => (e ? `${e.protocolo}://${e.host}${e.porta ? `:${e.porta}` : ''}` : 'origin');
  if (transporte === 'forja-https') {
    if (/^http:/i.test(bruta)) return recusar('https.sem-tls', resumo());
    if (/^https:\/\//i.test(bruta)) {
      let comCredencial = true;
      try { const u = new URL(bruta); comCredencial = u.username !== '' || u.password !== ''; } catch { /* sem parse: recusa */ }
      if (comCredencial || /^https:\/\/[^/]*@/i.test(bruta)) return recusar('https.credencial-na-url', 'origin');
    }
  }
  if (transporte === 'forja-ssh' && senhaNaUrl(bruta)) return recusar('ssh.credencial-na-url', 'origin');
  if (!e) return recusar(path.isAbsolute(bruta) ? 'modo' : 'urls', path.isAbsolute(bruta) ? 'bare-local' : 'origin');
  if (transporte === 'forja-ssh') {
    if (e.protocolo === 'https' || e.protocolo === 'http') return recusar('modo', 'forja-https');
    if (e.protocolo !== 'ssh' && e.protocolo !== 'scp') return recusar('urls', resumo());
    const usuario = usuarioDoSsh(bruta);
    if (usuario !== null && !USUARIO_SSH.test(usuario)) return recusar('urls', resumo());
    return { endereco: { transporte, host: e.host, porta: e.porta ?? 22 }, remoto: e };
  }
  if (e.protocolo === 'ssh' || e.protocolo === 'scp') return recusar('modo', 'forja-ssh');
  if (e.protocolo !== 'https') return recusar('urls', resumo());
  const porta = e.porta === 443 ? null : e.porta;
  return { endereco: { transporte, host: e.host, porta, origem: `https://${porta === null ? e.host : `${e.host}:${porta}`}` }, remoto: e };
}

// ---------------------------------------------------------------------------
// SSH: a chave do servidor e o known_hosts.
// ---------------------------------------------------------------------------

export interface ChaveDoServidor { tipo: string; chave: string }
const TIPO_DE_CHAVE = /^(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521))$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const IMPRESSAO = /^SHA256:[A-Za-z0-9+/]{43}$/;
const mesma = (a: ChaveDoServidor, b: ChaveDoServidor): boolean => a.tipo === b.tipo && a.chave === b.chave;

/** A impressao que o OpenSSH mostra (`ssh-keygen -lf -E sha256`): o sha256 do blob em base64, sem o `=` final. */
export const impressaoDaChave = (chave: string): string =>
  `SHA256:${createHash('sha256').update(Buffer.from(chave, 'base64')).digest('base64').replace(/=+$/, '')}`;

/** O nome do host no known_hosts: `host` na porta 22, `[host]:porta` nas outras. */
export const nomeNoKnownHosts = (host: string, porta: number): string => (porta === 22 ? host : `[${host}]:${porta}`);

/** As chaves que o `ssh-keyscan` imprimiu para o nome exato, sem repeticao; comentario e tipo fora da lista caem. */
export function lerKeyscan(saida: string, nome: string): ChaveDoServidor[] {
  const chaves: ChaveDoServidor[] = [];
  for (const bruta of saida.split('\n')) {
    const linha = bruta.trim();
    if (!linha || linha.startsWith('#')) continue;
    const c = linha.split(/\s+/);
    if (c.length < 3 || c[0] !== nome || !TIPO_DE_CHAVE.test(c[1]) || !BASE64.test(c[2])) continue;
    const k = { tipo: c[1], chave: c[2] };
    if (!chaves.some((x) => mesma(x, k))) chaves.push(k);
  }
  return chaves;
}

/** Um padrao do known_hosts (`*` e `?`) casa o nome inteiro. */
const casaPadrao = (padrao: string, nome: string): boolean =>
  new RegExp(`^${padrao.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(nome);

/**
 * O campo de hosts aceita o nome: o hash `|1|sal|hmac` do `HashKnownHosts`, ou a lista separada por virgula com o nome
 * exato. Como no OpenSSH, um `!padrao` que casa o nome tira a linha, mesmo com um positivo que case; curinga positivo
 * nunca confirma.
 */
function casaNome(campo: string, nome: string): boolean {
  if (campo.startsWith('|1|')) {
    const [, , sal, hash] = campo.split('|');
    return !!sal && !!hash && createHmac('sha1', Buffer.from(sal, 'base64')).update(nome).digest('base64') === hash;
  }
  const padroes = campo.split(',');
  if (padroes.some((p) => p.startsWith('!') && casaPadrao(p.slice(1), nome))) return false;
  return padroes.includes(nome);
}

/**
 * As chaves que o known_hosts da pessoa aceita para o nome, e as que ele revoga. Toda linha `@revoked` conta, qualquer
 * que seja o campo de hosts (`*`, curinga, hash, outro nome): a chave revogada nao entra por nenhum nome.
 * `@cert-authority` cai.
 */
export function lerKnownHosts(conteudo: string, nome: string): { aceitas: ChaveDoServidor[]; revogadas: ChaveDoServidor[] } {
  const aceitas: ChaveDoServidor[] = [], revogadas: ChaveDoServidor[] = [];
  for (const bruta of conteudo.split('\n')) {
    const linha = bruta.trim();
    if (!linha || linha.startsWith('#')) continue;
    let c = linha.split(/\s+/), marca: string | null = null;
    if (c[0].startsWith('@')) { marca = c[0]; c = c.slice(1); }
    if (c.length < 3 || !TIPO_DE_CHAVE.test(c[1]) || !BASE64.test(c[2])) continue;
    if (marca === '@revoked') revogadas.push({ tipo: c[1], chave: c[2] });
    else if (marca === null && casaNome(c[0], nome)) aceitas.push({ tipo: c[1], chave: c[2] });
  }
  return { aceitas, revogadas };
}

export const linhasDoKnownHosts = (chaves: readonly ChaveDoServidor[], nome: string): string =>
  chaves.map((k) => `${nome} ${k.tipo} ${k.chave}\n`).join('');

/**
 * O ssh do push: `-F /dev/null` tira a config do usuario e a do sistema (nada de ProxyCommand nem HostName trocado);
 * so o known_hosts fixado vale, sem pergunta e sem regravar chave. O caminho vai sem aspas porque o ssh separa
 * `UserKnownHostsFile` por espaco: caminho com espaco ou caractere especial recusa.
 */
export function comandoSsh(knownHosts: string): string {
  if (!path.isAbsolute(knownHosts) || !CAMINHO_SEGURO.test(knownHosts)) recusar('ssh.caminho', knownHosts);
  return ['ssh', '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${knownHosts}`,
    '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UpdateHostKeys=no', '-o', 'CheckHostIP=no', '-o', 'ConnectTimeout=30'].join(' ');
}

// ---------------------------------------------------------------------------
// HTTPS: a credencial pela CLI logada.
// ---------------------------------------------------------------------------

/** Se o git manda o caminho do repositorio ao helper (`useHttpPath`). Falso ate a medicao do login com subcaminho. */
export const CAMINHO_NA_CREDENCIAL = false;

/**
 * A origem da credencial sai da chave do login da CLI (`host[:porta]`, nunca com o caminho base): o helper responde
 * pelo mesmo host em que a CLI tem login. O git casa `credential.<url>` pelo esquema, host e porta; o caminho base
 * vai a parte, para o `useHttpPath`.
 */
export function alvoDaCredencial(f: AlvoDaCli): { origem: string; caminhoBase: string } {
  const chave = chaveDoLogin(f);
  if (!/^[a-z0-9.-]+(?::\d+)?$/.test(chave)) recusar('https.divergente', chave);
  return { origem: `https://${chave}`, caminhoBase: f.caminhoBase };
}

// ---------------------------------------------------------------------------
// A fixacao gravada na instalacao.
// ---------------------------------------------------------------------------

export const ESQUEMA_DA_FIXACAO = 'ork.mcp-ship-transport/v1' as const;
export interface ChaveFixada { tipo: string; impressao: string }
interface BaseDaFixacao { schema: typeof ESQUEMA_DA_FIXACAO; raiz: string; url: string }
export interface FixacaoSsh extends BaseDaFixacao {
  transporte: 'forja-ssh'; host: string; porta: number; chaves: ChaveFixada[]; knownHostsSha256: string;
}
export interface FixacaoHttps extends BaseDaFixacao {
  transporte: 'forja-https'; tipo: TipoDeForja; origem: string; caminho: boolean; cli: 'gh' | 'glab'; binario: string; versaoCli: string;
  /** A CA do manifesto: `arquivo` e de onde veio (so para mostrar); o git le a copia `ca.pem` da pasta da fixacao. */
  ca: { arquivo: string; sha256: string } | null;
}
export type FixacaoDoTransporte = FixacaoSsh | FixacaoHttps;
/** O que a sonda da instalacao devolve: a fixacao; no SSH, o conteudo do known_hosts; no HTTPS com CA, os bytes dela. */
export interface FixacaoPreparada { fixacao: FixacaoDoTransporte; knownHosts?: string; ca?: Buffer }
export interface FixacaoLida { fixacao: FixacaoDoTransporte; dir: string }

/**
 * O `-c` que o push e o `ls-remote` do SHIP levam. Nada de token: so o comando do ssh, o helper e a CA.
 *
 * No HTTPS, o git escolhe cada `http.*` pela regra de URL mais especifica (host, depois o caminho mais longo), e o
 * `-c` vem por ultimo: so a URL exata do origin garante que nenhuma regra `http.<url>.*` do `~/.gitconfig` vence.
 * Nela, o TLS fica ligado, o proxy sai (vazio desliga, inclusive o do ambiente), a lista de cabecalhos extras e
 * zerada (vazio limpa o que veio antes), nenhum redirecionamento e seguido e a CA entra pela copia fixada. O certificado de cliente (`sslCert`, `sslKey`) fica com a
 * config da pessoa: nao afrouxa a verificacao do servidor. A credencial casa sem o caminho (`useHttpPath`), pela origem.
 */
export function configDeRede(fix: FixacaoDoTransporte, dir: string): string[] {
  if (fix.transporte === 'forja-ssh') {
    return ['-c', `core.sshCommand=${comandoSsh(path.join(dir, 'known_hosts'))}`, '-c', 'ssh.variant=ssh', ...travasDoRemoto('ssh')];
  }
  const e = enderecoDoOrigin('forja-https', fix.url);
  if (e.transporte !== 'forja-https' || e.origem !== fix.origem) return recusar('https.divergente', fix.origem);
  const url = fix.url;
  return ['-c', 'credential.helper=', '-c', `credential.${fix.origem}.helper=${helperDeCredencialDaCli(fix.binario)}`,
    '-c', `credential.${fix.origem}.useHttpPath=${fix.caminho}`, '-c', 'http.sslVerify=true',
    '-c', `http.${url}.sslVerify=true`, '-c', `http.${url}.proxy=`, '-c', `http.${url}.extraHeader=`,
    '-c', `http.${url}.followRedirects=false`,
    ...(fix.ca ? ['-c', `http.${url}.sslCAInfo=${path.join(dir, ARQUIVO_DA_CA)}`] : []), ...travasDoRemoto('https')];
}

/**
 * O que o git le da `.git/config` e da `.git/hooks` a cada comando, inclusive entre a ultima conferencia e o push:
 * nenhum hook roda (`core.hooksPath=/dev/null` vence o da config do projeto e a pasta `hooks`) e so o protocolo do
 * modo vale (`protocol.allow=never`). Um origin trocado para caminho local ou `file://`, com `receivepack` ou
 * `uploadpack` proprios, recusa no protocolo sem rodar nada. O `-c remote.origin.url=` nao serviria: a chave tem
 * varios valores, e o `-c` acrescenta um em vez de trocar.
 */
function travasDoRemoto(protocolo: 'ssh' | 'https'): string[] {
  return ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-c', `protocol.${protocolo}.allow=always`];
}

/** O protocolo de uma lista de `configDeRede` ja validada: ssh com o ssh fixado, https sem ele; vazia, nenhum. */
export function protocoloDaConfigDeRede(config: readonly string[]): 'ssh' | 'https' | null {
  if (!config.length) return null;
  return config.some((c) => c.startsWith('core.sshCommand=')) ? 'ssh' : 'https';
}

/** A URL exata das regras `http.<url>.*` de uma lista https validada (todas tem a mesma). */
export function urlDaConfigDeRede(config: readonly string[]): string | null {
  for (const c of config) { const m = /^http\.(https:\/\/[^=\s]+)\.sslVerify=/.exec(c); if (m) return m[1]; }
  return null;
}

/**
 * O gitdir de onde saem o push e os `ls-remote` do transporte fixado: um bare novo, 700, numa pasta do usuario, sem
 * modelo (nenhum hook copiado), que le os objetos do projeto pelo `objects/info/alternates`. Nada da config, dos hooks,
 * dos `insteadOf` nem das regras de protocolo do projeto entra no git que vai a rede: so o objeto que o ship decidiu.
 */
export function criarGitdirDoPush(raiz: string, env: NodeJS.ProcessEnv = process.env): string {
  const comum = gitPassivoMcp(raiz, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  if (!path.isAbsolute(comum) || CONTROLE.test(comum)) recusar('urls', 'gitdir');
  const objetos = fs.realpathSync(path.join(comum, 'objects'));
  if (!fs.statSync(objetos).isDirectory() || CONTROLE.test(objetos)) recusar('urls', 'gitdir');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-ship-push-'));
  try {
    fs.chmodSync(dir, 0o700);
    conferirAncestrais(path.join(dir, 'x'), 'fixacao-insegura');
    const r = spawnSync('git', ['init', '--bare', '--quiet', '--template=', '--', dir], { encoding: 'utf8', timeout: 30000,
      env: { ...env, GIT_ALLOW_PROTOCOL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) recusar('urls', 'gitdir');
    fs.mkdirSync(path.join(dir, 'objects', 'info'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'objects', 'info', 'alternates'), `${objetos}\n`, { mode: 0o600, flag: 'wx' });
    return dir;
  } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
}

const ESCAPE_DE_REGEX = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARCA_DO_KNOWN_HOSTS = '/__known_hosts__';
const FORMA_DO_SSH = new RegExp(`^${ESCAPE_DE_REGEX(comandoSsh(MARCA_DO_KNOWN_HOSTS)).replace(ESCAPE_DE_REGEX(MARCA_DO_KNOWN_HOSTS), '(/[A-Za-z0-9_./+-]+/known_hosts)')}$`);
const SUFIXO_DO_HELPER = ' auth git-credential';
const CHAVE_DO_HTTP = /^http\.(https:\/\/[^=\s]+)\.(sslVerify|proxy|extraHeader|followRedirects|sslCAInfo)$/;
const CHAVE_DA_CREDENCIAL = /^credential\.(https:\/\/[^=\s]+)\.(helper|useHttpPath)$/;

/** O binario de um helper `!<caminho> auth git-credential` na forma exata de `helperDeCredencialDaCli`; senao, null. */
function binarioDoHelper(valor: string): string | null {
  if (!valor.startsWith('!') || !valor.endsWith(SUFIXO_DO_HELPER)) return null;
  const resto = valor.slice(1, -SUFIXO_DO_HELPER.length);
  let binario: string;
  if (CAMINHO_SEGURO.test(resto)) binario = resto;
  else if (resto.length >= 2 && resto.startsWith("'") && resto.endsWith("'") && !resto.slice(1, -1).replace(/'\\''/g, '').includes("'")) {
    binario = resto.slice(1, -1).replace(/'\\''/g, "'");
  } else return null;
  return path.isAbsolute(binario) && helperDeCredencialDaCli(binario) === valor ? binario : null;
}

/**
 * Confere uma lista `-c chave=valor` contra o que `configDeRede` emite: cada chave tem so o valor da sua forma
 * (TLS ligado, proxy e cabecalho vazios, sem redirecionamento, ssh sem config do usuario, helper da CLI, CA `ca.pem`),
 * e toda URL da lista e a mesma. Devolve a chave recusada (nunca o valor) ou null quando a lista toda e valida.
 */
export function chaveRecusadaDaConfigDeRede(config: readonly string[]): string | null {
  const origens = new Set<string>();
  const urls = new Set<string>();
  const vistas = new Set<string>();
  if (config.length % 2 !== 0) return '';
  for (let i = 0; i < config.length; i += 2) {
    const par = config[i + 1];
    const igual = typeof par === 'string' ? par.indexOf('=') : -1;
    const chave = igual > 0 ? par.slice(0, igual) : '';
    const valor = igual > 0 ? par.slice(igual + 1) : '';
    if (config[i] !== '-c' || chave === '' || /[\0\n\r]/.test(valor)) return chave;
    let ok = false;
    let m: RegExpExecArray | null;
    vistas.add(chave);
    if (chave === 'core.sshCommand') ok = FORMA_DO_SSH.test(valor);
    else if (chave === 'core.hooksPath') ok = valor === '/dev/null';
    else if (chave === 'protocol.allow') ok = valor === 'never';
    else if (chave === 'protocol.ssh.allow' || chave === 'protocol.https.allow') ok = valor === 'always';
    else if (chave === 'ssh.variant') ok = valor === 'ssh';
    else if (chave === 'credential.helper') ok = valor === '';
    else if (chave === 'http.sslVerify') ok = valor === 'true';
    else if ((m = CHAVE_DA_CREDENCIAL.exec(chave))) {
      origens.add(m[1]);
      ok = m[2] === 'helper' ? binarioDoHelper(valor) !== null : valor === 'true' || valor === 'false';
    } else if ((m = CHAVE_DO_HTTP.exec(chave))) {
      urls.add(m[1]);
      const v = m[2];
      ok = v === 'sslVerify' ? valor === 'true'
        : v === 'followRedirects' ? valor === 'false'
        : v === 'sslCAInfo' ? path.isAbsolute(valor) && CAMINHO_SEGURO.test(valor) && path.basename(valor) === ARQUIVO_DA_CA
        : valor === '';
    }
    if (!ok) return chave;
  }
  // Lista nao vazia leva as travas, e o protocolo liberado e o do modo: ssh com o ssh fixado, https sem ele.
  if (config.length) {
    const ssh = vistas.has('core.sshCommand') || vistas.has('ssh.variant');
    const http = urls.size > 0 || origens.size > 0 || vistas.has('credential.helper') || vistas.has('http.sslVerify');
    if (!vistas.has('core.hooksPath')) return 'core.hooksPath';
    if (!vistas.has('protocol.allow')) return 'protocol.allow';
    if (ssh === http) return 'core.sshCommand/http';
    if (vistas.has(ssh ? 'protocol.https.allow' : 'protocol.ssh.allow')) return ssh ? 'protocol.https.allow' : 'protocol.ssh.allow';
    if (!vistas.has(ssh ? 'protocol.ssh.allow' : 'protocol.https.allow')) return ssh ? 'protocol.ssh.allow' : 'protocol.https.allow';
  }
  // Uma URL so, e a origem das credenciais e a do endereco dela.
  if (urls.size > 1 || origens.size > 1) return 'http/credential';
  const [u] = [...urls];
  const [o] = [...origens];
  if (u !== undefined) {
    try {
      const e = enderecoDoOrigin('forja-https', u);
      if (e.transporte !== 'forja-https' || (o !== undefined && e.origem !== o)) return 'http/credential';
    } catch { return 'http/credential'; }
  } else if (o !== undefined) return 'http/credential';
  return null;
}

/**
 * O que o transporte fixado acrescenta ao ambiente do worker: nenhuma pergunta (`GIT_ASKPASS` vazio desliga tambem o
 * `core.askPass` e o `SSH_ASKPASS` no git). No HTTPS, o barramento da sessao, para a CLI ler o token do keyring do
 * sistema. Nada de token do ambiente de quem chama.
 */
export function ambienteDoTransporte(t: TransporteFixado, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const extra: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never' };
  if (t === 'forja-https') for (const nome of ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR']) {
    const v = env[nome];
    if (v) extra[nome] = v;
  }
  return extra;
}

/** Uma pasta por raiz, na config do usuario: fora do projeto, longe do que o agente escreve. */
export function dirDaFixacao(raiz: string, env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(env.HOME || os.homedir(), '.config');
  return path.join(base, 'orkastery', 'mcp-ship', sha256(raiz).slice(0, 32));
}

const ARQUIVO_DA_CA = 'ca.pem';
const CONTROLE = /[\x00-\x1f\x7f]/;

/**
 * Cada pasta acima de `alvo`, ate a raiz, como o `secure_path` do OpenSSH: pasta de verdade (sem link), do usuario
 * ou do root, sem escrita de grupo e de outros; a do root com sticky (`/tmp`) passa, porque ali ninguem troca o que
 * e de outro dono.
 */
function conferirAncestrais(alvo: string, codigo: RecusaDoTransporte): void {
  for (let atual = path.dirname(alvo); ; atual = path.dirname(atual)) {
    const s = fs.lstatSync(atual, { throwIfNoEntry: false });
    const dono = !!s && (s.uid === meuUid() || s.uid === 0);
    const escrita = !!s && (s.mode & 0o022) !== 0 && !(s.uid === 0 && (s.mode & 0o1000) !== 0);
    if (!s || !s.isDirectory() || !dono || escrita) recusar(codigo, atual);
    if (atual === path.dirname(atual)) return;
  }
}

/** A pasta da fixacao: diretorio de verdade (sem link), do usuario, sem acesso de grupo e de outros; e toda pasta acima. */
function conferirPasta(dir: string): void {
  const st = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!st) return recusar('fixacao-ausente', dir);
  if (!st.isDirectory() || st.uid !== meuUid() || (st.mode & 0o077) !== 0) recusar('fixacao-insegura', dir);
  conferirAncestrais(dir, 'fixacao-insegura');
}

/** Arquivo da fixacao: regular, do usuario, sem acesso de grupo e de outros, um vinculo so, sem seguir link. */
function lerDaFixacao(arquivo: string, limite = LIMITE_DA_FIXACAO): Buffer {
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) { return recusar((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'fixacao-ausente' : 'fixacao-insegura', arquivo); }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== meuUid() || (st.mode & 0o077) !== 0 || st.nlink !== 1 || st.size > limite) {
      recusar('fixacao-insegura', arquivo);
    }
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

const ehPem = (bytes: Buffer): boolean => bytes.toString('latin1').includes('-----BEGIN CERTIFICATE-----');

/** Le ate `limite + 1` bytes do descritor: o que passa do teto nunca entra inteiro na memoria. */
function lerComTeto(fd: number, limite: number): Buffer {
  const partes: Buffer[] = [];
  let total = 0;
  for (;;) {
    const b = Buffer.alloc(Math.min(65536, limite + 1 - total));
    const n = fs.readSync(fd, b, 0, b.length, null);
    if (n === 0) break;
    partes.push(b.subarray(0, n));
    total += n;
    if (total > limite) break;
  }
  return Buffer.concat(partes, total);
}

/**
 * A CA do manifesto, lida uma vez na instalacao: caminho absoluto, um PEM, ate 1 MiB, arquivo regular do usuario ou
 * do root sem escrita de grupo ou de outros, e toda pasta do caminho real com a mesma regra. O caminho real e aberto
 * sem seguir link e conferido pelo descritor aberto, o mesmo que se le. Os bytes vao para a copia da fixacao; o
 * arquivo de origem nunca mais e lido.
 */
function lerCa(arquivo: string): Buffer {
  if (!path.isAbsolute(arquivo) || CONTROLE.test(arquivo)) return recusar('ca', arquivo);
  let bytes: Buffer;
  try {
    const real = fs.realpathSync(arquivo);
    conferirAncestrais(real, 'ca');
    const fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > LIMITE_DA_CA || (st.mode & 0o022) !== 0 || (st.uid !== meuUid() && st.uid !== 0)) recusar('ca', arquivo);
      bytes = lerComTeto(fd, LIMITE_DA_CA);
    } finally { fs.closeSync(fd); }
  } catch (e) {
    if (e instanceof ErroDoCatalogo) throw e;
    return recusar('ca', arquivo);
  }
  if (bytes.length > LIMITE_DA_CA || !ehPem(bytes)) recusar('ca', arquivo);
  return bytes;
}
export { lerCa as lerCaDoTransporte };

/**
 * A CLI do helper, pelo caminho real: arquivo executavel do usuario ou do root, sem escrita de grupo ou de outros,
 * e toda pasta do caminho real com a mesma regra. Devolve o caminho real, que e o que se fixa e o que o git roda.
 */
function binarioReal(binario: string): string {
  try {
    if (!path.isAbsolute(binario) || CONTROLE.test(binario)) recusar('binario', binario);
    const real = fs.realpathSync(binario), st = fs.lstatSync(real);
    const dono = st.uid === meuUid() || st.uid === 0;
    if (!st.isFile() || !dono || (st.mode & 0o022) !== 0 || (st.mode & 0o111) === 0 || CONTROLE.test(real)) recusar('binario', binario);
    conferirAncestrais(real, 'binario');
    return real;
  } catch (e) {
    if (e instanceof ErroDoCatalogo) throw e;
    return recusar('binario', binario);
  }
}
export { binarioReal as binarioRealDoTransporte };

function gravarAtomico(arquivo: string, conteudo: string | Buffer): void {
  const temp = `${arquivo}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, conteudo, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, arquivo);
  } finally { fs.rmSync(temp, { force: true }); }
}

/**
 * Grava a fixacao (pasta 700, arquivos 600, troca atomica). O known_hosts e a copia da CA so ficam quando a fixacao
 * os pede; o que sobrou de outra instalacao sai. Os bytes da CA tem de ter o hash fixado.
 */
export function gravarFixacao(dir: string, p: FixacaoPreparada): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  conferirPasta(dir);
  if (p.knownHosts !== undefined) gravarAtomico(path.join(dir, 'known_hosts'), p.knownHosts);
  else fs.rmSync(path.join(dir, 'known_hosts'), { force: true });
  const ca = p.fixacao.transporte === 'forja-https' ? p.fixacao.ca : null;
  if (ca) {
    if (!p.ca || sha256(p.ca) !== ca.sha256 || !ehPem(p.ca) || p.ca.length > LIMITE_DA_CA) recusar('ca', ca.arquivo);
    gravarAtomico(path.join(dir, ARQUIVO_DA_CA), p.ca);
  } else fs.rmSync(path.join(dir, ARQUIVO_DA_CA), { force: true });
  gravarAtomico(path.join(dir, 'transporte.json'), `${JSON.stringify(p.fixacao, null, 2)}\n`);
}

const texto = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !CONTROLE.test(v);
const absoluto = (v: unknown): v is string => texto(v) && path.isAbsolute(v);
const hex64 = (v: unknown): boolean => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

function formatoValido(v: unknown): v is FixacaoDoTransporte {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || o.schema !== ESQUEMA_DA_FIXACAO || !texto(o.raiz) || !path.isAbsolute(o.raiz) || !texto(o.url)) return false;
  if (o.transporte === 'forja-ssh') {
    const chaves = o.chaves;
    return texto(o.host) && HOST_DO_REMOTO.test(o.host) && Number.isInteger(o.porta) && (o.porta as number) >= 1 && (o.porta as number) <= 65535
      && Array.isArray(chaves) && chaves.length > 0 && hex64(o.knownHostsSha256)
      && chaves.every((k) => !!k && typeof k === 'object' && TIPO_DE_CHAVE.test(String((k as ChaveFixada).tipo))
        && IMPRESSAO.test(String((k as ChaveFixada).impressao)));
  }
  if (o.transporte !== 'forja-https') return false;
  const ca = o.ca as Record<string, unknown> | null;
  return (TIPOS_DE_FORJA as readonly unknown[]).includes(o.tipo) && typeof o.origem === 'string'
    && /^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(o.origem) && typeof o.caminho === 'boolean' && (o.cli === 'gh' || o.cli === 'glab')
    && absoluto(o.binario) && texto(o.versaoCli) && (ca === null || (typeof ca === 'object' && absoluto(ca.arquivo) && hex64(ca.sha256)));
}

/**
 * Confere o que o push vai usar: o known_hosts pelo hash; a CLI pelo caminho real, pelo dono e pela escrita dela e de
 * cada pasta acima; a copia da CA pelo hash, lida como os outros arquivos da fixacao (sem seguir link).
 */
export function conferirFixacao(f: FixacaoDoTransporte, dir: string): void {
  conferirPasta(dir);
  if (f.transporte === 'forja-ssh') {
    const arquivo = path.join(dir, 'known_hosts');
    if (sha256(lerDaFixacao(arquivo)) !== f.knownHostsSha256) recusar('ssh.known-hosts-alterado', arquivo);
    return;
  }
  if (binarioReal(f.binario) !== f.binario) recusar('binario', f.binario);
  const copia = path.join(dir, ARQUIVO_DA_CA);
  if (f.ca && sha256(lerDaFixacao(copia, LIMITE_DA_CA)) !== f.ca.sha256) recusar('ca-alterada', copia);
}

/** A fixacao desta raiz, deste transporte e deste origin, conferida; outra coisa recusa antes de qualquer rede. */
export function lerFixacao(raiz: string, transporte: TransporteFixado, url: string, env: NodeJS.ProcessEnv = process.env): FixacaoLida {
  const dir = dirDaFixacao(raiz, env);
  if (!fs.lstatSync(dir, { throwIfNoEntry: false })) recusar('fixacao-ausente', `ork mcp install --project ${raiz} --ship-transport ${transporte}`);
  conferirPasta(dir);
  const arquivo = path.join(dir, 'transporte.json');
  let fixacao: unknown;
  try { fixacao = JSON.parse(lerDaFixacao(arquivo).toString('utf8')); } catch (e) {
    if (e instanceof ErroDoCatalogo) throw e;
    return recusar('fixacao-insegura', arquivo);
  }
  if (!formatoValido(fixacao)) return recusar('fixacao-insegura', arquivo);
  if (fixacao.raiz !== raiz || fixacao.transporte !== transporte) recusar('fixacao-divergente', `${fixacao.transporte} != ${transporte}`);
  if (fixacao.url !== url) recusar('fixacao-divergente', 'origin');
  // O origin fixado tem de levar ao mesmo host e porta (SSH) ou a mesma origem (HTTPS) da chave e do helper fixados.
  const e = enderecoDoOrigin(transporte, url);
  if (fixacao.transporte === 'forja-ssh' && e.transporte === 'forja-ssh' && (e.host !== fixacao.host || e.porta !== fixacao.porta)) {
    recusar('ssh.divergente', `${nomeNoKnownHosts(e.host, e.porta)} != ${nomeNoKnownHosts(fixacao.host, fixacao.porta)}`);
  }
  if (fixacao.transporte === 'forja-https' && e.transporte === 'forja-https' && e.origem !== fixacao.origem) {
    recusar('https.divergente', `${e.origem} != ${fixacao.origem}`);
  }
  conferirFixacao(fixacao, dir);
  return { fixacao, dir };
}

/** A linha que a instalacao mostra para a pessoa; na simulacao, o que seria fixado. */
export function textoDaFixacao(f: FixacaoDoTransporte, dir: string, simulacao = false): string {
  const t = msg().forja.transporteShip;
  const ssh = simulacao ? t.fixariaSsh : t.fixadoSsh, https = simulacao ? t.fixariaHttps : t.fixadoHttps;
  return f.transporte === 'forja-ssh'
    ? ssh(nomeNoKnownHosts(f.host, f.porta), f.chaves.map((k) => `${k.tipo} ${k.impressao}`).join(', '), path.join(dir, 'known_hosts'))
    : https(f.origem, `${f.cli} ${f.versaoCli}`, f.ca?.arquivo ?? null);
}

/**
 * A fixacao que esta raiz ja tem, para uma instalacao nao trocar a de outro host do projeto. `null` sem fixacao, ou
 * com uma que nenhum servidor aceitaria (JSON quebrado, formato desconhecido, outra raiz): essa a instalacao refaz.
 * Pasta ou arquivo inseguro (link, dono, modo, segundo vinculo) recusa: sobrescrever apagaria o sinal de que alguem
 * mexeu ali, e a gravacao recusaria a pasta do mesmo jeito.
 */
export function fixacaoInstalada(raiz: string, env: NodeJS.ProcessEnv = process.env): FixacaoDoTransporte | null {
  const dir = dirDaFixacao(raiz, env);
  if (!fs.lstatSync(dir, { throwIfNoEntry: false })) return null;
  conferirPasta(dir);
  const arquivo = path.join(dir, 'transporte.json');
  if (!fs.lstatSync(arquivo, { throwIfNoEntry: false })) return null;
  const bytes = lerDaFixacao(arquivo);
  let v: unknown;
  try { v = JSON.parse(bytes.toString('utf8')); } catch { return null; }
  return formatoValido(v) && v.raiz === raiz ? v : null;
}

// ---------------------------------------------------------------------------
// A sonda da instalacao.
// ---------------------------------------------------------------------------

/** O transporte que o origin pede, sem rede: bare local, o SSH do GitHub de sempre, SSH de outra forja ou HTTPS. */
export function proporTransporte(url: string): TransporteShipMcp | null {
  const t = url.trim();
  if (path.isAbsolute(t)) return 'bare-local';
  if (URL_GITHUB_SSH.test(t)) return 'github-ssh';
  const e = lerEnderecoDoRemoto(t);
  if (!e) return null;
  return e.protocolo === 'ssh' || e.protocolo === 'scp' ? 'forja-ssh' : e.protocolo === 'https' ? 'forja-https' : null;
}

/** O que a sonda roda. Os testes trocam tudo; nenhuma sonda pede credencial (`git-credential get` nunca roda aqui). */
export interface SondasDoTransporte {
  /** Sem shell e com prazo: o `ssh-keyscan`, o `--version` e a ajuda do `auth git-credential` da CLI. */
  rodar(binario: string, args: readonly string[], prazoMs: number): { status: number | null; stdout: string; stderr: string };
  /** O executor do `temLogin`; sem valor, a CLI de verdade. */
  rodarCli?: RodarCli;
  acharBinario(cmd: 'gh' | 'glab'): string | null;
  /** As sondas do `resolverForja`, para host sem `forja.tipo`; sem valor, as padrao. */
  sondas?: SondasDaForja;
  /** O known_hosts da pessoa, que confirma a chave do servidor sem `--ssh-fingerprint`. */
  knownHostsDoUsuario: string | null;
  /** Os known_hosts do sistema, lidos so pelas revogacoes; sem valor, nenhum. */
  knownHostsDoSistema?: readonly string[];
}

/** O `ssh-keyscan` desiste de cada host em 10 s; o processo inteiro, em 30 s. A CLI responde a versao e a ajuda em 10 s. */
const PRAZO_DO_KEYSCAN_MS = 30_000, PRAZO_DA_CLI_MS = 10_000;
const LIMITE_DO_KNOWN_HOSTS = 4 * 1048576;

export function sondasPadraoDoTransporte(env: NodeJS.ProcessEnv = process.env): SondasDoTransporte {
  const home = env.HOME || os.homedir();
  return {
    rodar: (binario, args, prazoMs) => {
      const r = spawnSync(binario, [...args], { encoding: 'utf8', timeout: prazoMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin', HOME: home, LANG: 'C', LC_ALL: 'C', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1',
          GH_PROMPT_DISABLED: '1', GLAB_CHECK_UPDATE: 'false', GLAB_SEND_TELEMETRY: 'false' } });
      return { status: r.status, stdout: (r.stdout ?? '').toString(), stderr: (r.stderr ?? '').toString() };
    },
    acharBinario: (cmd) => acharBinario(cmd, { env }),
    knownHostsDoUsuario: path.join(home, '.ssh', 'known_hosts'),
    knownHostsDoSistema: ['/etc/ssh/ssh_known_hosts', '/etc/ssh/ssh_known_hosts2'],
  };
}

export interface EntradaDaFixacao {
  raiz: string; transporte: TransporteFixado; url: string; manifesto?: Manifesto['forja'];
  /** `SHA256:...` conferida pela pessoa fora do ork (`--ssh-fingerprint`). */
  impressao?: string;
  sondas: SondasDoTransporte;
}

/**
 * Sonda o origin no modo pedido e devolve a fixacao, sem gravar nada; o que nao fecha recusa com o motivo. Nesta
 * ordem: o modo serve ao origin (um parse so dele), a forja resolve, e o SSH ou o HTTPS confere o resto.
 */
export function prepararFixacao(e: EntradaDaFixacao): FixacaoPreparada {
  const { endereco, remoto } = lerOrigin(e.transporte, e.url);
  const r = resolverForja({ endereco: remoto, manifesto: e.manifesto, sondas: e.sondas.sondas });
  // O detalhe do resolver pode citar o caminho do projeto: sai so o host, como em toda recusa do origin.
  if (!r.ok) return recusar('forja', msg().forja.motivo({ codigo: r.erro.codigo, detalhe: r.erro.detalhe.split(remoto.caminho).join('<caminho>') }, null));
  return endereco.transporte === 'forja-ssh' ? fixarSsh(e, endereco, r.valor) : fixarHttps(e, endereco, r.valor);
}

/** O conteudo de um known_hosts: `null` quando nao existe; `undefined` quando existe e nao se le (nao regular, grande demais). */
function lerArquivoDeKnownHosts(arquivo: string): string | null | undefined {
  try {
    const fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    try {
      if (!fs.fstatSync(fd).isFile()) return undefined;
      const conteudo = lerComTeto(fd, LIMITE_DO_KNOWN_HOSTS);
      return conteudo.length > LIMITE_DO_KNOWN_HOSTS ? undefined : conteudo.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined;
  }
}

/**
 * O known_hosts da pessoa para o nome: o que ele aceita e o que ele revoga. Sem arquivo, nada confirma (so a
 * impressao dita); arquivo que existe e nao se le recusa, porque esconderia uma revogacao. Os known_hosts do sistema
 * so acrescentam revogacoes, nunca confirmam: ausente ou ilegivel, nao e a confirmacao da pessoa e fica de fora.
 */
function conhecidasDoUsuario(arquivo: string | null, globais: readonly string[], nome: string): ReturnType<typeof lerKnownHosts> {
  let conhecidas: ReturnType<typeof lerKnownHosts> = { aceitas: [], revogadas: [] };
  if (arquivo) {
    const conteudo = lerArquivoDeKnownHosts(arquivo);
    if (conteudo === undefined) recusar('ssh.known-hosts-ilegivel', arquivo);
    if (conteudo) conhecidas = lerKnownHosts(conteudo, nome);
  }
  for (const global of globais) {
    const conteudo = lerArquivoDeKnownHosts(global);
    if (conteudo) conhecidas.revogadas.push(...lerKnownHosts(conteudo, nome).revogadas);
  }
  return conhecidas;
}

const impressoes = (ks: readonly ChaveDoServidor[]): string => ks.map((k) => `${k.tipo} ${impressaoDaChave(k.chave)}`).join(', ');

/**
 * A chave do servidor so entra confirmada: o known_hosts da pessoa a aceita, ou a impressao dita (`--ssh-fingerprint`)
 * e a dela. Nunca a primeira que aparece. Revogada no known_hosts, trocada (o known_hosts guarda outra do mesmo tipo)
 * ou impressao que o servidor nao apresentou recusam.
 */
function fixarSsh(e: EntradaDaFixacao, origin: { host: string; porta: number }, f: ForjaResolvida): FixacaoPreparada {
  const { host, porta } = origin;
  const alvo = { host: f.sshHost ?? f.host, porta: f.sshPorta ?? 22 };
  if (host !== alvo.host || porta !== alvo.porta) recusar('ssh.divergente', `${host}:${porta} != ${alvo.host}:${alvo.porta}`);
  // O host vem do parse e nunca comeca por `-`; mesmo assim vai depois do `--`, para nunca virar opcao.
  if (!HOST_DO_REMOTO.test(host) || !Number.isInteger(porta) || porta < 1 || porta > 65535) recusar('urls', 'origin');
  const nome = nomeNoKnownHosts(host, porta);
  const scan = e.sondas.rodar('ssh-keyscan', ['-T', '10', '-p', String(porta), '-t', 'ed25519,ecdsa,rsa', '--', host], PRAZO_DO_KEYSCAN_MS);
  const doServidor = lerKeyscan(scan.stdout, nome);
  if (!doServidor.length) recusar('ssh.sem-resposta', nome);
  const conhecidas = conhecidasDoUsuario(e.sondas.knownHostsDoUsuario, e.sondas.knownHostsDoSistema ?? [], nome);
  if (doServidor.some((k) => conhecidas.revogadas.some((r) => mesma(k, r)))) recusar('ssh.revogada', nome);
  const trocadas = doServidor.filter((k) => conhecidas.aceitas.some((u) => u.tipo === k.tipo) && !conhecidas.aceitas.some((u) => mesma(k, u)));
  if (trocadas.length) {
    const guardadas = conhecidas.aceitas.filter((u) => trocadas.some((t) => t.tipo === u.tipo));
    recusar('ssh.impressao-divergente', `known_hosts ${nome}: ${impressoes(guardadas)} != ${impressoes(trocadas)}`);
  }
  const lista = impressoes(doServidor);
  let dita: string | null = null;
  if (e.impressao !== undefined) {
    dita = e.impressao.trim().replace(/=+$/, '');
    const valida = IMPRESSAO.test(dita);
    if (!valida || !doServidor.some((k) => impressaoDaChave(k.chave) === dita)) {
      recusar('ssh.impressao-divergente', `${valida ? dita : '--ssh-fingerprint'}; ${nome}: ${lista}`);
    }
  }
  const confirmadas = doServidor.filter((k) => conhecidas.aceitas.some((u) => mesma(k, u)) || impressaoDaChave(k.chave) === dita);
  if (!confirmadas.length) recusar('ssh.nao-confirmada', `${nome}: ${lista}`);
  const knownHosts = linhasDoKnownHosts(confirmadas, nome);
  return {
    knownHosts,
    fixacao: { schema: ESQUEMA_DA_FIXACAO, raiz: e.raiz, url: e.url, transporte: 'forja-ssh', host, porta,
      chaves: confirmadas.map((k) => ({ tipo: k.tipo, impressao: impressaoDaChave(k.chave) })), knownHostsSha256: sha256(knownHosts) },
  };
}

/**
 * O helper e o da CLI do tipo, pelo caminho real, na versao minima, com `auth git-credential` e login no host exato
 * (`host[:porta]`, nunca o caminho base). A CA do manifesto e lida uma vez aqui e segue em bytes para a copia fixada.
 * A saida da CLI nunca e repetida: so o codigo de saida e a versao lida.
 */
function fixarHttps(e: EntradaDaFixacao, origin: { origem: string }, f: ForjaResolvida): FixacaoPreparada {
  const alvo: AlvoDaCli = { tipo: f.tipo, host: f.host, porta: f.porta, caminhoBase: f.caminhoBase, ca: f.ca };
  const { origem, caminhoBase } = alvoDaCredencial(alvo);
  if (origin.origem !== origem) recusar('https.divergente', `${origin.origem} != ${origem}`);
  const ca = f.ca === null ? null : lerCa(f.ca);
  const cli = CLI_DA_FORJA[f.tipo];
  const achado = e.sondas.acharBinario(cli.cmd);
  if (!achado) return recusar('sem-cli', `${cli.cmd} ${cli.minima}`);
  const binario = binarioReal(achado);
  const versao = cli.lerVersao(e.sondas.rodar(binario, ['--version'], PRAZO_DA_CLI_MS).stdout);
  if (versao === null || versaoAbaixo(versao, cli.minima)) return recusar('sem-helper', `${cli.cmd} ${versao ?? '?'} < ${cli.minima}`);
  const ajuda = e.sondas.rodar(binario, ['auth', 'git-credential', '--help'], PRAZO_DA_CLI_MS);
  if (ajuda.status !== 0 || !/git-credential/.test(`${ajuda.stdout}\n${ajuda.stderr}`)) recusar('sem-helper', `${cli.cmd} ${versao}, >= ${cli.minima}`);
  // O login confere a mesma CLI que vai ser fixada, pelo caminho real, sem nova busca no PATH.
  if (!temLogin(alvo, e.sondas.rodarCli, binario)) recusar('sem-login', `${cli.cmd} ${chaveDoLogin(alvo)}`);
  return {
    fixacao: { schema: ESQUEMA_DA_FIXACAO, raiz: e.raiz, url: e.url, transporte: 'forja-https', tipo: f.tipo, origem,
      caminho: CAMINHO_NA_CREDENCIAL && caminhoBase !== '', cli: cli.cmd, binario, versaoCli: versao,
      ca: ca && f.ca ? { arquivo: f.ca, sha256: sha256(ca) } : null },
    ...(ca ? { ca } : {}),
  };
}
