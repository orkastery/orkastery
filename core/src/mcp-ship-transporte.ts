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
import { TIPOS_DE_FORJA, type TipoDeForja } from './forja/contrato';
import type { AlvoDaCli } from './forja/cli';
import { chaveDoLogin } from './forja/api';
import { lerEnderecoDoRemoto } from './forja/endereco';
import { gitPassivoMcp } from './mcp-git';
import { helperDeCredencialDaCli } from './rede-forja';
import { redigirCredenciaisUrl } from './redacao-url';
import { ErroDoCatalogo, msg } from './locale';
import type { TransporteFixado } from './mcp-transportes';

/** O unico remoto que o `github-ssh` aceita, como sempre. */
export const URL_GITHUB_SSH = /^git@github\.com:[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\.git$/;

/** Cada recusa dos transportes fixados; todas tem a frase no catalogo (`transporteShip.recusa`). */
export const RECUSAS_DO_TRANSPORTE = ['urls', 'modo', 'forja', 'ssh.divergente', 'ssh.sem-resposta', 'ssh.revogada',
  'ssh.nao-confirmada', 'ssh.impressao-divergente', 'ssh.caminho', 'ssh.known-hosts-alterado', 'https.sem-tls',
  'ssh.credencial-na-url', 'https.credencial-na-url', 'https.divergente', 'sem-cli', 'sem-helper', 'sem-login', 'binario', 'ca', 'ca-alterada',
  'fixacao-ausente', 'fixacao-insegura', 'fixacao-divergente'] as const;
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
 * O que o origin diz ao transporte, de um parse so (`lerEnderecoDoRemoto`). `forja-ssh`: `ssh://` ou a forma scp,
 * porta 22 quando nao vem. `forja-https`: so `https://`, sem usuario nem token na URL; `http://` levaria a
 * credencial em claro. Nos dois, senha ou token na URL recusa. O detalhe nunca leva a URL com credencial.
 */
/**
 * Senha ou token na parte de usuario (`user:segredo@`), antes do primeiro `/` do endereco: `ssh://u:s@h/…` ou
 * `u:s@h:caminho`. O usuario sozinho (`git@`) passa.
 */
function senhaNaUrl(bruta: string): boolean {
  const resto = bruta.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''), barra = resto.indexOf('/');
  const autoridade = barra < 0 ? resto : resto.slice(0, barra), arroba = autoridade.lastIndexOf('@');
  return arroba >= 0 && autoridade.slice(0, arroba).includes(':');
}

export function enderecoDoOrigin(transporte: TransporteFixado, url: string): EnderecoDoTransporte {
  const bruta = url.trim(), seguro = (): string => redigirCredenciaisUrl(bruta);
  if (transporte === 'forja-https') {
    if (/^http:\/\//i.test(bruta)) return recusar('https.sem-tls', seguro());
    if (/^https:\/\//i.test(bruta)) {
      let comCredencial = true;
      try { const u = new URL(bruta); comCredencial = u.username !== '' || u.password !== ''; } catch { /* sem parse: recusa */ }
      if (comCredencial || /^https:\/\/[^/]*@/i.test(bruta)) return recusar('https.credencial-na-url', 'origin');
    }
  }
  if (transporte === 'forja-ssh' && senhaNaUrl(bruta)) return recusar('ssh.credencial-na-url', 'origin');
  const e = lerEnderecoDoRemoto(bruta);
  if (!e) return recusar(path.isAbsolute(bruta) ? 'modo' : 'urls', path.isAbsolute(bruta) ? 'bare-local' : seguro());
  if (transporte === 'forja-ssh') {
    if (e.protocolo === 'https' || e.protocolo === 'http') return recusar('modo', 'forja-https');
    if (e.protocolo !== 'ssh' && e.protocolo !== 'scp') return recusar('urls', seguro());
    return { transporte, host: e.host, porta: e.porta ?? 22 };
  }
  if (e.protocolo === 'ssh' || e.protocolo === 'scp') return recusar('modo', 'forja-ssh');
  if (e.protocolo !== 'https') return recusar('urls', seguro());
  const porta = e.porta === 443 ? null : e.porta;
  return { transporte, host: e.host, porta, origem: `https://${porta === null ? e.host : `${e.host}:${porta}`}` };
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

/** O campo de hosts casa o nome: lista separada por virgula, ou o hash `|1|sal|hmac` do `HashKnownHosts`. Curinga nao. */
function casaNome(campo: string, nome: string): boolean {
  if (campo.startsWith('|1|')) {
    const [, , sal, hash] = campo.split('|');
    return !!sal && !!hash && createHmac('sha1', Buffer.from(sal, 'base64')).update(nome).digest('base64') === hash;
  }
  return campo.split(',').includes(nome);
}

/** As chaves que o known_hosts da pessoa aceita para o nome, e as que ele revoga (`@revoked`). `@cert-authority` cai. */
export function lerKnownHosts(conteudo: string, nome: string): { aceitas: ChaveDoServidor[]; revogadas: ChaveDoServidor[] } {
  const aceitas: ChaveDoServidor[] = [], revogadas: ChaveDoServidor[] = [];
  for (const bruta of conteudo.split('\n')) {
    const linha = bruta.trim();
    if (!linha || linha.startsWith('#')) continue;
    let c = linha.split(/\s+/), marca: string | null = null;
    if (c[0].startsWith('@')) { marca = c[0]; c = c.slice(1); }
    if (c.length < 3 || !casaNome(c[0], nome) || !TIPO_DE_CHAVE.test(c[1]) || !BASE64.test(c[2])) continue;
    if (marca === '@revoked') revogadas.push({ tipo: c[1], chave: c[2] });
    else if (marca === null) aceitas.push({ tipo: c[1], chave: c[2] });
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
  ca: { arquivo: string; sha256: string } | null;
}
export type FixacaoDoTransporte = FixacaoSsh | FixacaoHttps;
/** O que a sonda da instalacao devolve: a fixacao e, no SSH, o conteudo do known_hosts. */
export interface FixacaoPreparada { fixacao: FixacaoDoTransporte; knownHosts?: string }
export interface FixacaoLida { fixacao: FixacaoDoTransporte; dir: string }

/**
 * O `-c` que o push e o `ls-remote` do SHIP levam. Nada de token: so o comando do ssh, o helper e a CA.
 *
 * No HTTPS, o git escolhe cada `http.*` pela regra de URL mais especifica (host, depois o caminho mais longo), e o
 * `-c` vem por ultimo: so a URL exata do origin garante que nenhuma regra `http.<url>.*` do `~/.gitconfig` vence.
 * Nela, o TLS fica ligado, o proxy sai (vazio desliga, inclusive o do ambiente), a lista de cabecalhos extras e
 * zerada (vazio limpa o que veio antes) e a CA fixada entra. O certificado de cliente (`sslCert`, `sslKey`) fica com a
 * config da pessoa: nao afrouxa a verificacao do servidor. A credencial casa sem o caminho (`useHttpPath`), pela origem.
 */
export function configDeRede(fix: FixacaoDoTransporte, dir: string): string[] {
  if (fix.transporte === 'forja-ssh') return ['-c', `core.sshCommand=${comandoSsh(path.join(dir, 'known_hosts'))}`, '-c', 'ssh.variant=ssh'];
  const e = enderecoDoOrigin('forja-https', fix.url);
  if (e.transporte !== 'forja-https' || e.origem !== fix.origem) return recusar('https.divergente', fix.origem);
  const url = fix.url;
  return ['-c', 'credential.helper=', '-c', `credential.${fix.origem}.helper=${helperDeCredencialDaCli(fix.binario)}`,
    '-c', `credential.${fix.origem}.useHttpPath=${fix.caminho}`, '-c', 'http.sslVerify=true',
    '-c', `http.${url}.sslVerify=true`, '-c', `http.${url}.proxy=`, '-c', `http.${url}.extraHeader=`,
    ...(fix.ca ? ['-c', `http.${url}.sslCAInfo=${fix.ca.arquivo}`] : [])];
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

/**
 * A pasta da fixacao: diretorio de verdade (sem link), do usuario, sem acesso de grupo e de outros. As duas de
 * cima (`orkastery/mcp-ship`) tambem sem link, do usuario e sem escrita de grupo e de outros: ninguem troca a
 * pasta por baixo.
 */
function conferirPasta(dir: string): void {
  const st = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!st) return recusar('fixacao-ausente', dir);
  if (!st.isDirectory() || st.uid !== meuUid() || (st.mode & 0o077) !== 0) recusar('fixacao-insegura', dir);
  for (const acima of [path.dirname(dir), path.dirname(path.dirname(dir))]) {
    const s = fs.lstatSync(acima, { throwIfNoEntry: false });
    if (!s || !s.isDirectory() || s.uid !== meuUid() || (s.mode & 0o022) !== 0) recusar('fixacao-insegura', acima);
  }
}

/** Arquivo da fixacao: regular, do usuario, sem acesso de grupo e de outros, um vinculo so, sem seguir link. */
function lerDaFixacao(arquivo: string): Buffer {
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) { return recusar((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'fixacao-ausente' : 'fixacao-insegura', arquivo); }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== meuUid() || (st.mode & 0o077) !== 0 || st.nlink !== 1 || st.size > LIMITE_DA_FIXACAO) {
      recusar('fixacao-insegura', arquivo);
    }
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

/** A CA do manifesto: um PEM legivel, ate 1 MiB, do usuario ou do root, sem escrita de grupo ou de outros. */
function lerCa(arquivo: string): Buffer {
  let bytes: Buffer;
  try {
    const real = fs.realpathSync(arquivo), st = fs.statSync(real);
    if (!st.isFile() || st.size > LIMITE_DA_CA || (st.mode & 0o022) !== 0 || (st.uid !== meuUid() && st.uid !== 0)) recusar('ca', arquivo);
    bytes = fs.readFileSync(real);
  } catch (e) {
    if (e instanceof ErroDoCatalogo) throw e;
    return recusar('ca', arquivo);
  }
  if (!bytes.toString('latin1').includes('-----BEGIN CERTIFICATE-----')) recusar('ca', arquivo);
  return bytes;
}
export { lerCa as lerCaDoTransporte };

/** A CLI do helper: arquivo executavel do usuario ou do root, sem escrita de grupo ou de outros (depois dos links). */
function conferirBinario(binario: string): void {
  try {
    if (!path.isAbsolute(binario)) recusar('binario', binario);
    const st = fs.statSync(fs.realpathSync(binario));
    const dono = st.uid === meuUid() || st.uid === 0;
    if (!st.isFile() || !dono || (st.mode & 0o022) !== 0 || (st.mode & 0o111) === 0) recusar('binario', binario);
  } catch (e) {
    if (e instanceof ErroDoCatalogo) throw e;
    recusar('binario', binario);
  }
}
export { conferirBinario as conferirBinarioDoTransporte };

function gravarAtomico(arquivo: string, conteudo: string): void {
  const temp = `${arquivo}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, conteudo, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, arquivo);
  } finally { fs.rmSync(temp, { force: true }); }
}

/** Grava a fixacao (pasta 700, arquivos 600, troca atomica). O HTTPS apaga um known_hosts que sobrou do SSH. */
export function gravarFixacao(dir: string, p: FixacaoPreparada): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  conferirPasta(dir);
  if (p.knownHosts !== undefined) gravarAtomico(path.join(dir, 'known_hosts'), p.knownHosts);
  else fs.rmSync(path.join(dir, 'known_hosts'), { force: true });
  gravarAtomico(path.join(dir, 'transporte.json'), `${JSON.stringify(p.fixacao, null, 2)}\n`);
}

const texto = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096;
const hex64 = (v: unknown): boolean => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

function formatoValido(v: unknown): v is FixacaoDoTransporte {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || o.schema !== ESQUEMA_DA_FIXACAO || !texto(o.raiz) || !path.isAbsolute(o.raiz) || !texto(o.url)) return false;
  if (o.transporte === 'forja-ssh') {
    const chaves = o.chaves;
    return texto(o.host) && /^[a-z0-9.-]+$/.test(o.host) && Number.isInteger(o.porta) && (o.porta as number) >= 1 && (o.porta as number) <= 65535
      && Array.isArray(chaves) && chaves.length > 0 && hex64(o.knownHostsSha256)
      && chaves.every((k) => !!k && typeof k === 'object' && TIPO_DE_CHAVE.test(String((k as ChaveFixada).tipo))
        && IMPRESSAO.test(String((k as ChaveFixada).impressao)));
  }
  if (o.transporte !== 'forja-https') return false;
  const ca = o.ca as Record<string, unknown> | null;
  return (TIPOS_DE_FORJA as readonly unknown[]).includes(o.tipo) && typeof o.origem === 'string'
    && /^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(o.origem) && typeof o.caminho === 'boolean' && (o.cli === 'gh' || o.cli === 'glab')
    && texto(o.binario) && texto(o.versaoCli) && (ca === null || (typeof ca === 'object' && texto(ca.arquivo) && hex64(ca.sha256)));
}

/** Confere o que o push vai usar: o known_hosts pelo hash; a CLI pelo dono e pela escrita; a CA pelo hash. */
export function conferirFixacao(f: FixacaoDoTransporte, dir: string): void {
  conferirPasta(dir);
  if (f.transporte === 'forja-ssh') {
    const arquivo = path.join(dir, 'known_hosts');
    if (sha256(lerDaFixacao(arquivo)) !== f.knownHostsSha256) recusar('ssh.known-hosts-alterado', arquivo);
    return;
  }
  conferirBinario(f.binario);
  if (f.ca && sha256(lerCa(f.ca.arquivo)) !== f.ca.sha256) recusar('ca-alterada', f.ca.arquivo);
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

/** A linha que a instalacao mostra para a pessoa. */
export function textoDaFixacao(f: FixacaoDoTransporte, dir: string): string {
  const t = msg().forja.transporteShip;
  return f.transporte === 'forja-ssh'
    ? t.fixadoSsh(nomeNoKnownHosts(f.host, f.porta), f.chaves.map((k) => `${k.tipo} ${k.impressao}`).join(', '), path.join(dir, 'known_hosts'))
    : t.fixadoHttps(f.origem, `${f.cli} ${f.versaoCli}`, f.ca?.arquivo ?? null);
}
