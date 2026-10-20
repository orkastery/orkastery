/**
 * RM-068: a DSN da memória fora do ambiente dos agentes. Domicílio único de onde a DSN vem (a variável de ambiente
 * nomeada em `memory.database_url_env`, ou o arquivo da pasta de segredos do `ork` nomeado em
 * `memory.database_url_file`), de como o arquivo é lido e de como o `ork doctor` procura DSN no ambiente sem imprimir
 * valor.
 *
 * As regras (G2 a G4 do GOAL da ork-dsnforadoamb):
 *  - uma fonte só: com `database_url_file`, só o arquivo vale, e o `ork` nunca cai para a variável;
 *  - o manifesto vem do repositório, então só nomeia arquivo da pasta de segredos (`~/.orkastery/segredos/<nome>`):
 *    ele não escolhe outro arquivo do dono para mandar ao `memory.cli` (P6 da fronteira de confiança);
 *  - o arquivo é comum, do usuário que roda o `ork`, sem link simbólico, sem bit fora de 0600, com até 4 KiB e uma
 *    linha, e é lido a cada uso;
 *  - nenhum detalhe repete o valor, e o caminho sai com `~` ou com o nome da variável da pasta do usuário.
 *
 * Só importa `node:*` e `maquina.ts`: o `orkmind.ts` carrega este módulo sem o parser do manifesto.
 */

import * as fs from 'node:fs';
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
export type CausaDaDsn = 'forma' | 'nao-existe' | 'nao-abre' | 'link' | 'nao-e-arquivo' | 'plataforma' | 'dono' |
  'permissao' | 'tamanho' | 'vazio' | 'linhas' | 'controle' | 'nome-valor' | 'leitura';

export const CAUSAS_DA_DSN: readonly CausaDaDsn[] = ['forma', 'nao-existe', 'nao-abre', 'link', 'nao-e-arquivo',
  'plataforma', 'dono', 'permissao', 'tamanho', 'vazio', 'linhas', 'controle', 'nome-valor', 'leitura'];

/** O texto pt-BR da causa, sem o valor; `permissao` só entra na causa `permissao`. */
export function textoDaCausa(causa: CausaDaDsn, permissao = ''): string {
  switch (causa) {
    case 'forma': return `memory.database_url_file fora da forma ${PREFIXO_DO_ARQUIVO_DA_DSN}<nome> (valor omitido)`;
    case 'nao-existe': return 'não existe';
    case 'nao-abre': return 'não foi possível abrir para leitura';
    case 'link': return 'link simbólico não é aceito';
    case 'nao-e-arquivo': return 'não é arquivo comum';
    case 'plataforma': return 'esta plataforma não confere dono nem permissão';
    case 'dono': return 'o dono não é o usuário que roda o ork';
    case 'permissao': return `permissão ${permissao} mais aberta que 0600`;
    case 'tamanho': return 'maior que 4 KiB';
    case 'vazio': return 'vazio';
    case 'linhas': return 'mais de uma linha';
    case 'controle': return 'caractere de controle';
    case 'nome-valor': return 'formato NOME=valor de arquivo de ambiente; grave só a DSN';
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

/**
 * O rótulo do arquivo (D2), na regra da pasta do usuário (`pastaDoUsuario`): `ORK_USUARIO_DIR` vence
 * `ORKASTERY_HOME`, que vence `~/.orkastery`. É o que vai a saída, ledger e bundle no lugar do caminho real.
 */
export function rotuloDoArquivoDaDsn(nome: string, env: NodeJS.ProcessEnv = process.env): string {
  const pasta = (env.ORK_USUARIO_DIR ?? '').trim() ? 'ORK_USUARIO_DIR'
    : (env.ORKASTERY_HOME ?? '').trim() ? 'ORKASTERY_HOME' : '~/.orkastery';
  return `${pasta}/${PASTA_DE_SEGREDOS}/${nome}`;
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

/** G4: abre o arquivo sem seguir link, confere o descritor aberto (tipo, dono, modo, tamanho) e lê uma linha. */
function lerArquivoDaDsn(declarado: string, env: NodeJS.ProcessEnv, uid: number | null): DsnDaMemoria {
  if (!arquivoDaDsnValido(declarado)) {
    return { fonte: 'arquivo', rotulo: `${PREFIXO_DO_ARQUIVO_DA_DSN}<nome>`, dsn: '', falha: 'dsn.arquivo-invalido',
      detalhe: textoDaCausa('forma'), causa: 'forma' };
  }
  const nome = declarado.slice(PREFIXO_DO_ARQUIVO_DA_DSN.length);
  const rotulo = rotuloDoArquivoDaDsn(nome, env);
  const caminho = path.join(pastaDoUsuario(env), PASTA_DE_SEGREDOS, nome);
  const falhou = (falha: FalhaDaDsn, causa: CausaDaDsn, permissao?: string): DsnDaMemoria =>
    ({ fonte: 'arquivo', rotulo, dsn: '', falha, detalhe: `${rotulo}: ${textoDaCausa(causa, permissao)}`, causa,
      ...(permissao ? { permissao } : {}) });
  let antes: fs.Stats;
  try {
    antes = fs.lstatSync(caminho);
  } catch (e) {
    return falhou('dsn.arquivo-ausente', ['ENOENT', 'ENOTDIR'].includes(codigoDoErro(e)) ? 'nao-existe' : 'nao-abre');
  }
  if (antes.isSymbolicLink()) return falhou('dsn.arquivo-invalido', 'link');
  if (!antes.isFile()) return falhou('dsn.arquivo-invalido', 'nao-e-arquivo');
  let fd: number | null = null;
  try {
    try {
      fd = fs.openSync(caminho, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    } catch (e) {
      const codigo = codigoDoErro(e);
      return codigo === 'ELOOP' ? falhou('dsn.arquivo-invalido', 'link')
        : falhou('dsn.arquivo-ausente', codigo === 'ENOENT' ? 'nao-existe' : 'nao-abre');
    }
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return falhou('dsn.arquivo-invalido', 'nao-e-arquivo');
    const permissao = (st.mode & 0o777).toString(8).padStart(4, '0');
    if (uid === null) return falhou('dsn.arquivo-inseguro', 'plataforma', permissao);
    if (st.uid !== uid) return falhou('dsn.arquivo-inseguro', 'dono', permissao);
    if ((st.mode & 0o177) !== 0) return falhou('dsn.arquivo-inseguro', 'permissao', permissao);
    if (st.size > LIMITE_DO_ARQUIVO_DA_DSN) return falhou('dsn.arquivo-invalido', 'tamanho', permissao);
    const bruto = fs.readFileSync(fd);
    if (bruto.length > LIMITE_DO_ARQUIVO_DA_DSN) return falhou('dsn.arquivo-invalido', 'tamanho', permissao);
    const dsn = bruto.toString('utf8').trim();
    if (!dsn) return falhou('dsn.arquivo-invalido', 'vazio', permissao);
    if (/[\r\n]/.test(dsn)) return falhou('dsn.arquivo-invalido', 'linhas', permissao);
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(dsn)) return falhou('dsn.arquivo-invalido', 'controle', permissao);
    if (/^[A-Z_][A-Z0-9_]*=/.test(dsn)) return falhou('dsn.arquivo-invalido', 'nome-valor', permissao);
    return { fonte: 'arquivo', rotulo, dsn, falha: null, detalhe: '', permissao };
  } catch {
    return falhou('dsn.arquivo-ausente', 'leitura');
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * D6: o que da DSN nunca pode sair do `ork`: ela inteira e a senha com 12 caracteres ou mais, crua e decodificada.
 * DSN opaca (`chave=valor`) fica só inteira.
 */
export function fragmentosDaDsn(dsn: string): string[] {
  const fragmentos = dsn ? [dsn] : [];
  try {
    const senha = new URL(dsn).password;
    if (senha.length >= 12) fragmentos.push(senha, decodeURIComponent(senha));
  } catch { /* DSN opaca: só a DSN inteira */ }
  return [...new Set(fragmentos)];
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
