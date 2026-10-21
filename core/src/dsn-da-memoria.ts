/**
 * RM-069: a DSN da memória fora do ambiente dos agentes. Domicílio único de onde a DSN vem (a variável de ambiente
 * nomeada em `memory.database_url_env`, ou o arquivo da pasta de segredos do `ork` nomeado em
 * `memory.database_url_file`), de como o arquivo é lido e de como o `ork doctor` procura DSN no ambiente sem imprimir
 * valor.
 *
 * As regras (G2 a G4 do GOAL da ork-dsnforadoamb, D18 a D21 do GO-FIX 1, D24 do GO-FIX 2):
 *  - uma fonte só: com `database_url_file`, só o arquivo vale, e o `ork` nunca cai para a variável;
 *  - o manifesto vem do repositório, então só nomeia arquivo da pasta de segredos (`~/.orkastery/segredos/<nome>`):
 *    ele não escolhe outro arquivo do dono para mandar ao `memory.cli` (P6 da fronteira de confiança);
 *  - a raiz da pasta do usuário do `ork` sai do caminho real da casa do usuário (`HOME`): vinda de `ORK_USUARIO_DIR`
 *    ou `ORKASTERY_HOME`, é um caminho absoluto sem `..`, dentro da casa, e uma pasta do próprio usuário; fora disso,
 *    a recusa vem antes de abrir qualquer coisa;
 *  - o caminho é conferido antes de abrir: cada pasta da casa até a de segredos é pasta comum, sem link simbólico, e o
 *    caminho real do arquivo é o próprio caminho;
 *  - o arquivo é comum, do usuário que roda o `ork`, sem link simbólico, com permissão 0600 ou 0400 exata (os bits
 *    especiais contam), até 4 KiB e uma linha só com a DSN (`esquema://...`), e é lido a cada uso;
 *  - nenhum detalhe repete o valor, e o caminho sai com `~` ou com o nome da variável da pasta do usuário;
 *  - a DSN e a senha dela, de qualquer tamanho, nunca saem do `ork`: a resposta do processo filho que as repete é
 *    recusada inteira na fronteira (`contemFragmentoDaDsn`).
 *
 * Só importa `node:*` e `maquina.ts`: o `orkmind.ts` carrega este módulo sem o parser do manifesto.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pastaDoUsuario } from './maquina';
import type { FonteDaDsn } from './types';

/** A pasta de segredos, dentro da pasta do usuário do `ork`. */
export const PASTA_DE_SEGREDOS = 'segredos';
/** A única forma aceita de `memory.database_url_file`: este prefixo e um nome de arquivo. */
export const PREFIXO_DO_ARQUIVO_DA_DSN = '~/.orkastery/segredos/';
const NOME_DO_ARQUIVO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Maior arquivo de DSN aceito, em bytes. */
export const LIMITE_DO_ARQUIVO_DA_DSN = 4096;
/** D18: as permissões aceitas, comparadas com os bits especiais (setuid, setgid, sticky); nenhuma outra passa. */
const PERMISSOES_ACEITAS: readonly number[] = [0o600, 0o400];
/** D19: o esquema de URL (RFC 3986), `://` e algo depois; DSN de vários hosts da libpq não é URL para o `new URL`. */
const DSN_COM_ESQUEMA = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/\S/;

/** Por que a fonte declarada não deu DSN; os mesmos nomes dos motivos de degradação da memória. */
export type FalhaDaDsn =
  | 'dsn.nao-declarado'
  | 'dsn.env-ausente'
  | 'dsn.arquivo-ausente'
  | 'dsn.arquivo-inseguro'
  | 'dsn.arquivo-invalido';

/**
 * Por que o arquivo da DSN foi recusado. O texto pt-BR de cada causa mora em `textoDaCausa`; o catálogo do `ork doctor`
 * o repete nas duas línguas, e um teste confere que o pt-BR dos dois é o mesmo.
 */
export type CausaDaDsn = 'forma' | 'raiz' | 'nao-existe' | 'nao-abre' | 'pasta' | 'dono-da-pasta' | 'link' |
  'nao-e-arquivo' | 'plataforma' | 'dono' | 'permissao' | 'tamanho' | 'vazio' | 'codificacao' | 'linhas' | 'controle' |
  'nome-valor' | 'esquema' | 'espaco' | 'leitura';

export const CAUSAS_DA_DSN: readonly CausaDaDsn[] = ['forma', 'raiz', 'nao-existe', 'nao-abre', 'pasta', 'dono-da-pasta',
  'link', 'nao-e-arquivo', 'plataforma', 'dono', 'permissao', 'tamanho', 'vazio', 'codificacao', 'linhas', 'controle',
  'nome-valor', 'esquema', 'espaco', 'leitura'];

/** O texto pt-BR da causa, sem o valor; `permissao` só entra na causa `permissao`. */
export function textoDaCausa(causa: CausaDaDsn, permissao = ''): string {
  switch (causa) {
    case 'forma': return `memory.database_url_file fora da forma ${PREFIXO_DO_ARQUIVO_DA_DSN}<nome> (valor omitido)`;
    case 'raiz': return 'a pasta do usuário do ork precisa ser caminho absoluto sem .., dentro da casa do usuário (HOME)';
    case 'nao-existe': return 'não existe';
    case 'nao-abre': return 'não foi possível abrir para leitura';
    case 'pasta': return 'o caminho da pasta de segredos tem link simbólico ou algo que não é pasta';
    case 'dono-da-pasta': return 'a pasta do usuário do ork não é do usuário que roda o ork';
    case 'link': return 'link simbólico não é aceito';
    case 'nao-e-arquivo': return 'não é arquivo comum';
    case 'plataforma': return 'esta plataforma não confere dono nem permissão';
    case 'dono': return 'o dono não é o usuário que roda o ork';
    case 'permissao': return `permissão ${permissao}, diferente de 0600 e de 0400`;
    case 'tamanho': return 'maior que 4 KiB';
    case 'vazio': return 'vazio';
    case 'codificacao': return 'não é texto UTF-8';
    case 'linhas': return 'mais de uma linha';
    case 'controle': return 'caractere de controle';
    case 'nome-valor': return 'formato NOME=valor de arquivo de ambiente; grave só a DSN';
    case 'esquema': return 'não é DSN com esquema (como postgresql://)';
    case 'espaco': return 'espaço dentro da DSN';
    case 'leitura': return 'não foi possível ler';
  }
}

/** A DSN da memória e de onde ela veio. */
export interface DsnDaMemoria {
  fonte: FonteDaDsn;
  /** O NOME da variável, ou o arquivo pelo rótulo com `~`; vazio sem fonte. Nunca o valor, nunca caminho de máquina. */
  rotulo: string;
  /** O valor; vazio quando a fonte falha. Só vai ao ambiente do processo filho do `orkmind`. */
  dsn: string;
  falha: FalhaDaDsn | null;
  /** Por que a fonte falhou, sem o valor; vazio quando ela vale. */
  detalhe: string;
  /** A causa da recusa do arquivo, quando o arquivo é a fonte e falhou. */
  causa?: CausaDaDsn;
  /** A permissão do arquivo aberto (`0600`, `0400`), quando o arquivo é a fonte. */
  permissao?: string;
}

export interface OpcoesDaDsn {
  env?: NodeJS.ProcessEnv;
  /** O uid que conta como dono do arquivo; o padrão é o do processo (sem `process.getuid`, nenhum). */
  uid?: number | null;
}

/** A forma aceita de `memory.database_url_file` (G3): `~/.orkastery/segredos/<nome>`, sem subpasta. */
export function arquivoDaDsnValido(valor: string): boolean {
  return valor.startsWith(PREFIXO_DO_ARQUIVO_DA_DSN) && NOME_DO_ARQUIVO.test(valor.slice(PREFIXO_DO_ARQUIVO_DA_DSN.length));
}

/** A variável que dá a pasta do usuário do `ork`, na regra de `pastaDoUsuario`; sem nenhuma, a pasta é `~/.orkastery`. */
function variavelDaPastaDoUsuario(env: NodeJS.ProcessEnv): 'ORK_USUARIO_DIR' | 'ORKASTERY_HOME' | null {
  return (env.ORK_USUARIO_DIR ?? '').trim() ? 'ORK_USUARIO_DIR' : (env.ORKASTERY_HOME ?? '').trim() ? 'ORKASTERY_HOME' : null;
}

/**
 * O rótulo do arquivo (D2), na regra da pasta do usuário (`pastaDoUsuario`): `ORK_USUARIO_DIR` vence
 * `ORKASTERY_HOME`, que vence `~/.orkastery`. É o que vai a saída, ledger e bundle no lugar do caminho real.
 */
export function rotuloDoArquivoDaDsn(nome: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${variavelDaPastaDoUsuario(env) ?? '~/.orkastery'}/${PASTA_DE_SEGREDOS}/${nome}`;
}

function uidDoProcesso(): number | null {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function codigoDoErro(e: unknown): string {
  return String((e as NodeJS.ErrnoException)?.code ?? '');
}

/**
 * A DSN da memória pela fonte que o bloco `memory` declara. Com `database_url_file`, só o arquivo; com
 * `database_url_env`, o ambiente, como sempre foi; sem nenhuma, `dsn.nao-declarado`. Nunca há segunda candidata.
 */
export function resolverDsn(memory: { database_url_env?: string; database_url_file?: string },
  opcoes: OpcoesDaDsn = {}): DsnDaMemoria {
  const env = opcoes.env ?? process.env;
  const arquivo = (memory.database_url_file ?? '').trim();
  if (arquivo) return lerArquivoDaDsn(arquivo, env, opcoes.uid === undefined ? uidDoProcesso() : opcoes.uid);
  const variavel = (memory.database_url_env ?? '').trim();
  if (variavel) {
    const dsn = env[variavel] ?? '';
    return dsn.trim()
      ? { fonte: 'ambiente', rotulo: variavel, dsn, falha: null, detalhe: '' }
      : { fonte: 'ambiente', rotulo: variavel, dsn: '', falha: 'dsn.env-ausente', detalhe: `${variavel} não está no ambiente` };
  }
  return { fonte: 'nenhuma', rotulo: '', dsn: '', falha: 'dsn.nao-declarado',
    detalhe: 'nenhuma fonte declarada (memory.database_url_file ou memory.database_url_env)' };
}

/** Por que o caminho do arquivo foi recusado antes de abrir. */
interface RecusaDoCaminho { falha: FalhaDaDsn; causa: CausaDaDsn }

/** A raiz da pasta do usuário do `ork` pelo caminho real (D24). */
interface RaizDaPastaDoUsuario {
  /** O caminho real da casa do usuário, onde a conferência começa. */
  casa: string;
  /** As pastas da raiz abaixo da casa, em ordem. */
  partes: string[];
  /** A raiz: a casa real e as partes. */
  pasta: string;
  /** A raiz veio de `ORK_USUARIO_DIR` ou de `ORKASTERY_HOME`, e não é a `.orkastery` da casa. */
  daVariavel: boolean;
}

function ausente(e: unknown): RecusaDoCaminho {
  return { falha: 'dsn.arquivo-ausente', causa: ['ENOENT', 'ENOTDIR'].includes(codigoDoErro(e)) ? 'nao-existe' : 'nao-abre' };
}

/** Um componente `..`, nos dois separadores: o `path.resolve` o tira pelo texto, sem seguir o link que venha antes. */
function temPontoPonto(caminho: string): boolean {
  return caminho.split(/[\\/]/).includes('..');
}

/** As pastas de `caminho` abaixo de `pasta`, quando ele fica dentro dela sem ser ela; senão, `null`. */
function partesAbaixo(pasta: string, caminho: string): string[] | null {
  const relativo = path.relative(pasta, caminho);
  return relativo && relativo !== '..' && !relativo.startsWith(`..${path.sep}`) && !path.isAbsolute(relativo)
    ? relativo.split(path.sep) : null;
}

/**
 * D24: a raiz da pasta do usuário do `ork`, canonizada pelo caminho real antes de qualquer leitura. A casa do usuário
 * (`HOME`) vale pelo caminho real: o que fica acima dela é do sistema de quem roda o `ork` e não é conferido. Sem
 * variável, a raiz é a `.orkastery` da casa, como em `pastaDoUsuario`. Vinda de `ORK_USUARIO_DIR` ou de
 * `ORKASTERY_HOME`, é um caminho absoluto, sem `..`, abaixo da casa (escrita como o ambiente a escreve, ou pelo caminho
 * real) e sem ser ela. Fora disso, a causa `raiz`, sem abrir nada; as pastas abaixo da casa, `conferirCaminho` confere.
 */
function raizDaPastaDoUsuario(env: NodeJS.ProcessEnv): RaizDaPastaDoUsuario | RecusaDoCaminho {
  const casa = (env.HOME ?? '').trim() || os.homedir();
  const daVariavel = variavelDaPastaDoUsuario(env) !== null;
  const declarada = daVariavel ? pastaDoUsuario(env) : '';
  if (!path.isAbsolute(casa) || (daVariavel && (!path.isAbsolute(declarada) || temPontoPonto(declarada)))) {
    return { falha: 'dsn.arquivo-invalido', causa: 'raiz' };
  }
  let real: string;
  try { real = fs.realpathSync(casa); } catch (e) { return ausente(e); }
  if (!daVariavel) return { casa: real, partes: ['.orkastery'], pasta: path.join(real, '.orkastery'), daVariavel };
  const alvo = path.resolve(declarada);
  // A casa como o ambiente a escreve só vale sem `..`, que o `path.resolve` tiraria pelo texto; a real vale sempre.
  const partes = (temPontoPonto(casa) ? null : partesAbaixo(path.resolve(casa), alvo)) ?? partesAbaixo(real, alvo);
  if (!partes) return { falha: 'dsn.arquivo-invalido', causa: 'raiz' };
  return { casa: real, partes, pasta: path.join(real, ...partes), daVariavel };
}

/**
 * D24: o caminho do arquivo conferido componente a componente pelo `lstat`, da casa real ao arquivo, sem seguir link e
 * antes de abrir qualquer coisa: cada pasta da raiz e a de segredos são pastas comuns, a raiz vinda do ambiente é do
 * usuário que roda o `ork`, o arquivo é arquivo comum, e o caminho real do arquivo é o próprio caminho (a segunda prova,
 * contra troca no meio). Devolve o caminho e o `lstat` do arquivo, ou a falha.
 */
function conferirCaminho(raiz: RaizDaPastaDoUsuario, nome: string, uid: number | null)
  : { caminho: string; arquivo: fs.Stats } | RecusaDoCaminho {
  let pasta = raiz.casa;
  for (const parte of [...raiz.partes, PASTA_DE_SEGREDOS]) {
    pasta = path.join(pasta, parte);
    let st: fs.Stats;
    try { st = fs.lstatSync(pasta); } catch (e) { return ausente(e); }
    if (st.isSymbolicLink() || !st.isDirectory()) return { falha: 'dsn.arquivo-invalido', causa: 'pasta' };
    if (raiz.daVariavel && pasta === raiz.pasta && uid !== null && st.uid !== uid) {
      return { falha: 'dsn.arquivo-inseguro', causa: 'dono-da-pasta' };
    }
  }
  const caminho = path.join(pasta, nome);
  let arquivo: fs.Stats;
  try { arquivo = fs.lstatSync(caminho); } catch (e) { return ausente(e); }
  if (arquivo.isSymbolicLink()) return { falha: 'dsn.arquivo-invalido', causa: 'link' };
  if (!arquivo.isFile()) return { falha: 'dsn.arquivo-invalido', causa: 'nao-e-arquivo' };
  try {
    if (fs.realpathSync(caminho) !== caminho) return { falha: 'dsn.arquivo-invalido', causa: 'pasta' };
  } catch (e) { return ausente(e); }
  return { caminho, arquivo };
}

/**
 * D19: o conteúdo pelo contrato inteiro, sem repetir o valor. Texto UTF-8 de até 4 KiB; um único fim de linha no fim
 * (`\n` ou `\r\n`) é o único aparo antes das guardas de linha e de controle; depois delas, só o espaço comum em volta
 * sai, e o que fica é uma DSN `esquema://...` sem espaço.
 */
function dsnDoConteudo(bruto: Buffer): { dsn: string } | { causa: CausaDaDsn } {
  if (bruto.length > LIMITE_DO_ARQUIVO_DA_DSN) return { causa: 'tamanho' };
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bruto);
  } catch {
    return { causa: 'codificacao' };
  }
  const linha = texto.endsWith('\r\n') ? texto.slice(0, -2) : texto.endsWith('\n') ? texto.slice(0, -1) : texto;
  if (!linha.trim()) return { causa: 'vazio' };
  if (/[\r\n\u0085\u2028\u2029]/.test(linha)) return { causa: 'linhas' };
  if (/[\p{Cc}\p{Cf}]/u.test(linha)) return { causa: 'controle' };
  const dsn = linha.replace(/^ +| +$/g, '');
  if (/^[A-Z_][A-Z0-9_]*=/.test(dsn)) return { causa: 'nome-valor' };
  if (!DSN_COM_ESQUEMA.test(dsn)) return { causa: 'esquema' };
  if (/\s/.test(dsn)) return { causa: 'espaco' };
  return { dsn };
}

/**
 * G4 (D18, D19, D24): confere a raiz e o caminho, abre o arquivo sem seguir link, confere o descritor aberto (o mesmo
 * arquivo do `lstat`, comum, do usuário, permissão exata, tamanho) e só então lê, até o limite, pelo contrato inteiro.
 */
function lerArquivoDaDsn(declarado: string, env: NodeJS.ProcessEnv, uid: number | null): DsnDaMemoria {
  if (!arquivoDaDsnValido(declarado)) {
    return { fonte: 'arquivo', rotulo: `${PREFIXO_DO_ARQUIVO_DA_DSN}<nome>`, dsn: '', falha: 'dsn.arquivo-invalido',
      detalhe: textoDaCausa('forma'), causa: 'forma' };
  }
  const nome = declarado.slice(PREFIXO_DO_ARQUIVO_DA_DSN.length);
  const rotulo = rotuloDoArquivoDaDsn(nome, env);
  const falhou = (falha: FalhaDaDsn, causa: CausaDaDsn, permissao?: string): DsnDaMemoria =>
    ({ fonte: 'arquivo', rotulo, dsn: '', falha, detalhe: `${rotulo}: ${textoDaCausa(causa, permissao)}`, causa,
      ...(permissao ? { permissao } : {}) });
  const raiz = raizDaPastaDoUsuario(env);
  if ('falha' in raiz) return falhou(raiz.falha, raiz.causa);
  const antes = conferirCaminho(raiz, nome, uid);
  if ('falha' in antes) return falhou(antes.falha, antes.causa);
  let fd: number | null = null;
  try {
    try {
      fd = fs.openSync(antes.caminho, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    } catch (e) {
      const codigo = codigoDoErro(e);
      return codigo === 'ELOOP' ? falhou('dsn.arquivo-invalido', 'link')
        : falhou('dsn.arquivo-ausente', codigo === 'ENOENT' ? 'nao-existe' : 'nao-abre');
    }
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return falhou('dsn.arquivo-invalido', 'nao-e-arquivo');
    // O descritor aberto é o arquivo que o `lstat` conferiu: nada foi trocado entre a conferência e a abertura.
    if (st.dev !== antes.arquivo.dev || st.ino !== antes.arquivo.ino) return falhou('dsn.arquivo-ausente', 'nao-abre');
    const modo = st.mode & 0o7777;
    const permissao = modo.toString(8).padStart(4, '0');
    if (uid === null) return falhou('dsn.arquivo-inseguro', 'plataforma', permissao);
    if (st.uid !== uid) return falhou('dsn.arquivo-inseguro', 'dono', permissao);
    if (!PERMISSOES_ACEITAS.includes(modo)) return falhou('dsn.arquivo-inseguro', 'permissao', permissao);
    if (st.size > LIMITE_DO_ARQUIVO_DA_DSN) return falhou('dsn.arquivo-invalido', 'tamanho', permissao);
    // Lê até um byte além do limite: o arquivo que cresceu depois do `fstat` cai no tamanho, sem ser lido inteiro.
    const bruto = Buffer.alloc(LIMITE_DO_ARQUIVO_DA_DSN + 1);
    let lidos = 0, n = -1;
    while (n !== 0 && lidos < bruto.length) {
      n = fs.readSync(fd, bruto, lidos, bruto.length - lidos, null);
      lidos += n;
    }
    const conteudo = dsnDoConteudo(bruto.subarray(0, lidos));
    if ('causa' in conteudo) return falhou('dsn.arquivo-invalido', conteudo.causa, permissao);
    return { fonte: 'arquivo', rotulo, dsn: conteudo.dsn, falha: null, detalhe: '', permissao };
  } catch {
    return falhou('dsn.arquivo-ausente', 'leitura');
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function decodificada(texto: string): string {
  try { return decodeURIComponent(texto); } catch { return texto; }
}

/**
 * As senhas que a DSN carrega, cruas como estão no texto: a do usuário (`esquema://usuario:senha@`, inclusive com vários
 * hosts), a que o `new URL` lê, a do parâmetro `password` da consulta e a de `password=` na forma `chave=valor` da libpq.
 */
function senhasDaDsn(dsn: string): string[] {
  const senhas: string[] = [];
  const usuario = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)@/.exec(dsn)?.[1] ?? '';
  if (usuario.includes(':')) senhas.push(usuario.slice(usuario.indexOf(':') + 1));
  try { senhas.push(new URL(dsn).password); } catch { /* não é URL para o `new URL`: as outras leituras valem */ }
  const consulta = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^?#]*\?([^#]*)/.exec(dsn)?.[1] ?? '';
  for (const par of consulta.split('&')) {
    const igual = par.indexOf('=');
    if (igual > 0 && decodificada(par.slice(0, igual)) === 'password') senhas.push(par.slice(igual + 1));
  }
  for (const m of dsn.matchAll(/(?:^|\s)password\s*=\s*('(?:[^'\\]|\\.)*'|(?:[^\s'\\]|\\.)+)/g)) {
    senhas.push((m[1].startsWith("'") ? m[1].slice(1, -1) : m[1]).replace(/\\(.)/g, '$1'));
  }
  return senhas.filter(Boolean);
}

/**
 * D6 e D20: o que da DSN nunca pode sair do `ork`: ela inteira (como veio e aparada) e cada senha dela, de qualquer
 * tamanho, crua e decodificada. Senha curta ou comum também recusa a resposta legítima que tiver o mesmo trecho: a
 * barreira prefere a recusa ao vazamento.
 */
export function fragmentosDaDsn(dsn: string): string[] {
  const texto = dsn.trim();
  if (!texto) return [];
  const fragmentos = [dsn, texto];
  for (const senha of senhasDaDsn(texto)) fragmentos.push(senha, decodificada(senha));
  return [...new Set(fragmentos.filter(Boolean))];
}

/**
 * D21: verdadeiro quando algum texto do valor traz um dos fragmentos, em qualquer nível: as strings, as chaves de objeto
 * e os números como saem no JSON. É a barreira da fronteira com o processo filho: a resposta que repete a DSN ou a senha
 * é recusada inteira, com um código sem o valor, e nunca chega a saída, erro, ledger ou bundle.
 */
export function contemFragmento(valor: unknown, fragmentos: readonly string[]): boolean {
  const proibidos = fragmentos.filter(Boolean);
  const examinar = (x: unknown): boolean => {
    if (typeof x === 'string') return proibidos.some((p) => x.includes(p));
    if (typeof x === 'number') return examinar(String(x));
    if (!x || typeof x !== 'object') return false;
    if (Array.isArray(x)) return x.some(examinar);
    return Object.entries(x).some(([k, v]) => examinar(k) || examinar(v));
  };
  return proibidos.length > 0 && examinar(valor);
}

/** D21: a DSN ou a senha dela em algum texto do valor (`contemFragmento` com `fragmentosDaDsn`). */
export function contemFragmentoDaDsn(valor: unknown, dsn: string): boolean {
  return contemFragmento(valor, fragmentosDaDsn(dsn));
}

/** D7: `esquema://usuario:senha@`, com usuário vazio aceito e senha obrigatória, em qualquer ponto do valor. */
const URL_COM_SENHA = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/?#@:]*:[^\s/?#@]+@/;

/** Os NOMES, em ordem, das variáveis com URL com senha. Nunca o valor. */
export function variaveisComUrlComSenha(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter((nome) => URL_COM_SENHA.test(env[nome] ?? '')).sort();
}

/** Os NOMES, em ordem, das variáveis cujo valor traz a DSN dada ou a senha dela (D6). Nunca o valor. */
export function variaveisComDsn(env: NodeJS.ProcessEnv, dsn: string): string[] {
  const fragmentos = fragmentosDaDsn(dsn);
  if (!fragmentos.length) return [];
  return Object.keys(env).filter((nome) => fragmentos.some((f) => (env[nome] ?? '').includes(f))).sort();
}
