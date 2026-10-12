/**
 * RM-047 (fronteira de confiança, P1): a postura de sandbox que afrouxa vale só com a confirmação
 * desta máquina.
 *
 * O `runtime.sandbox` mora no `orkastery.yaml`, que vem com o repositório. Um valor que afrouxa o
 * sandbox do agente (hoje, `danger-full-access`, que no Codex vai junto com aprovação `never`) não
 * pode valer só porque o manifesto clonado o declara: o despacho recusa com
 * `runtime.sandbox-nao-confirmado` até a máquina confirmar a mesma postura no setup local, com
 * `ork setup sandbox confirmar <postura>`.
 *
 * A confirmação fica em `.orkastery/private/postura-local.json`, na raiz de estado: pasta 0700 e
 * arquivo 0600 do próprio usuário, nunca link e nunca rastreado pelo git. Ela guarda a postura e o
 * caminho real da raiz, então não vale para outra postura nem para outro checkout.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SANDBOX_PADRAO, SANDBOXES_DO_CODEX } from './adapters/codex';
import { raizDoEstado } from './estado-thread';
import { rastreadoPeloGit } from './procedencia';
import { Manifesto } from './types';
import { agora } from './util';

export const CONTRATO_POSTURA_LOCAL = 'ork.postura-local/v1';
export const ARQUIVO_POSTURA_LOCAL = 'postura-local.json';
const LIMITE_BYTES = 4096;

/**
 * As posturas de sandbox que afrouxam o padrão (`workspace-write`). `read-only` aperta e vale sem
 * confirmação. Uma postura nova do runtime entra aqui antes de poder ser declarada.
 */
export const POSTURAS_QUE_AFROUXAM: readonly string[] = ['danger-full-access'];

export interface PosturaLocal {
  contrato: typeof CONTRATO_POSTURA_LOCAL;
  /** A postura de sandbox que esta máquina aceita para este checkout. */
  sandbox: string;
  /** Caminho real da raiz de estado no momento da confirmação. */
  raiz: string;
  confirmadoEm: string;
  por: string;
}

function uid(): number | null {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

export function pastaPrivadaDaPostura(raiz: string): string {
  return path.join(raizDoEstado(raiz), '.orkastery', 'private');
}

export function caminhoDaPosturaLocal(raiz: string): string {
  return path.join(pastaPrivadaDaPostura(raiz), ARQUIVO_POSTURA_LOCAL);
}

/** O manifesto pede uma postura que afrouxa o sandbox? */
export function posturaAfrouxada(manifesto: Pick<Manifesto, 'runtime'>): string | null {
  const sandbox = manifesto.runtime.sandbox ?? SANDBOX_PADRAO;
  return POSTURAS_QUE_AFROUXAM.includes(sandbox) ? sandbox : null;
}

/** Comando que confirma a postura nesta máquina; vai em toda recusa. */
export function comandoDeConfirmacao(postura: string): string {
  return `ork setup sandbox confirmar ${postura}`;
}

/**
 * RM-047 (P3): lê um arquivo de `.orkastery/private/` com as regras da confirmação local: pasta 0700 e
 * arquivo 0600 do próprio usuário, nunca link, nunca rastreado pelo git, até 4 KiB e JSON válido.
 * Devolve o objeto cru, ou `null` com o motivo.
 */
export function lerArquivoPrivado(raiz: string, nome: string): { bruto: Record<string, unknown> | null; motivo: string | null } {
  const pasta = pastaPrivadaDaPostura(raiz), arquivo = path.join(pasta, nome);
  const stPasta = fs.lstatSync(pasta, { throwIfNoEntry: false });
  if (!stPasta) return { bruto: null, motivo: 'sem confirmação local' };
  const dono = uid();
  if (!stPasta.isDirectory() || stPasta.isSymbolicLink() || (dono !== null && stPasta.uid !== dono) ||
      (stPasta.mode & 0o077) !== 0) return { bruto: null, motivo: '.orkastery/private precisa ser pasta 0700 do próprio usuário' };
  const st = fs.lstatSync(arquivo, { throwIfNoEntry: false });
  if (!st) return { bruto: null, motivo: 'sem confirmação local' };
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || (dono !== null && st.uid !== dono) ||
      (st.mode & 0o077) !== 0 || st.size > LIMITE_BYTES) {
    return { bruto: null, motivo: `${nome} precisa ser arquivo 0600 do próprio usuário` };
  }
  if (rastreadoPeloGit(raiz, arquivo)) {
    return { bruto: null, motivo: `${nome} está versionado no git e não vale como confirmação local` };
  }
  let bruto: unknown;
  try { bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return { bruto: null, motivo: `${nome} com JSON inválido` }; }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return { bruto: null, motivo: `${nome} com JSON inválido` };
  return { bruto: bruto as Record<string, unknown>, motivo: null };
}

/** Caminho real da raiz de estado: a confirmação local vale só para o checkout que a gravou. */
export function raizRealDoEstado(raiz: string): string {
  try { return fs.realpathSync(raizDoEstado(raiz)); } catch { return path.resolve(raiz); }
}

/**
 * Lê a confirmação local. `null` quando ela não existe ou não vale (pasta ou arquivo com dono ou modo
 * errado, link, rastreado pelo git, JSON inválido, outra raiz); o motivo vai em `motivo`.
 */
export function lerPosturaLocal(raiz: string): { postura: PosturaLocal | null; motivo: string | null } {
  const { bruto: o, motivo } = lerArquivoPrivado(raiz, ARQUIVO_POSTURA_LOCAL);
  if (!o) return { postura: null, motivo };
  if (o.contrato !== CONTRATO_POSTURA_LOCAL || typeof o.sandbox !== 'string' ||
      typeof o.raiz !== 'string' || typeof o.confirmadoEm !== 'string' || typeof o.por !== 'string') {
    return { postura: null, motivo: `${ARQUIVO_POSTURA_LOCAL} fora do contrato ${CONTRATO_POSTURA_LOCAL}` };
  }
  if (o.raiz !== raizRealDoEstado(raiz)) return { postura: null, motivo: 'a confirmação local é de outro checkout' };
  return { postura: o as unknown as PosturaLocal, motivo: null };
}

/**
 * A recusa do despacho: `null` quando a postura do manifesto vale nesta máquina (não afrouxa, ou
 * foi confirmada localmente com o mesmo valor); senão o erro tipado com o comando que confirma.
 * Só o Codex recebe a postura de sandbox do manifesto.
 */
export function recusaDePostura(raiz: string, manifesto: Pick<Manifesto, 'runtime'>, runtime: string): string | null {
  if (runtime !== 'codex') return null;
  const postura = posturaAfrouxada(manifesto);
  if (!postura) return null;
  const { postura: local, motivo } = lerPosturaLocal(raiz);
  if (local && local.sandbox === postura) return null;
  const porque = local ? `a máquina confirmou ${local.sandbox}, não ${postura}` : motivo ?? 'sem confirmação local';
  return `runtime.sandbox-nao-confirmado: o orkastery.yaml pede runtime.sandbox: ${postura}, que desliga o sandbox ` +
    `do agente, e esta máquina não confirmou essa postura (${porque}). Nada foi despachado. O manifesto vem com o ` +
    `repositório; quem decide afrouxar o sandbox é a máquina. Para aceitar nesta máquina: ${comandoDeConfirmacao(postura)}` +
    ` (ou volte o manifesto para ${SANDBOX_PADRAO}).`;
}

/**
 * RM-047 (P3): grava um objeto em `.orkastery/private/<nome>` com as regras da confirmação local
 * (pasta 0700, arquivo 0600 por temporário exclusivo e `rename`, nunca seguindo link).
 */
export function gravarArquivoPrivado(raiz: string, nome: string, objeto: object): void {
  const pasta = pastaPrivadaDaPostura(raiz), arquivo = path.join(pasta, nome);
  const estado = path.dirname(pasta);
  const stEstado = fs.lstatSync(estado, { throwIfNoEntry: false });
  if (stEstado && (!stEstado.isDirectory() || stEstado.isSymbolicLink())) throw new Error('estado.link: .orkastery precisa ser pasta de verdade');
  fs.mkdirSync(estado, { recursive: true });
  try { fs.mkdirSync(pasta, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const stPasta = fs.lstatSync(pasta);
  if (!stPasta.isDirectory() || stPasta.isSymbolicLink()) throw new Error('estado.link: .orkastery/private precisa ser pasta de verdade');
  fs.chmodSync(pasta, 0o700);
  if (rastreadoPeloGit(raiz, arquivo)) {
    throw new Error(`estado.rastreado: ${nome} está versionado no git; tire-o do índice (git rm --cached) antes de confirmar`);
  }
  const temp = path.join(pasta, `.${nome}.${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, JSON.stringify(objeto, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, arquivo);
}

/** Apaga um arquivo de `.orkastery/private/`; devolve se havia um. */
export function revogarArquivoPrivado(raiz: string, nome: string): boolean {
  const arquivo = path.join(pastaPrivadaDaPostura(raiz), nome);
  const st = fs.lstatSync(arquivo, { throwIfNoEntry: false });
  if (!st) return false;
  fs.rmSync(arquivo, { force: true });
  return true;
}

/** Grava a confirmação local de uma postura de sandbox para este checkout. */
export function confirmarPosturaLocal(raiz: string, sandbox: string, por: string): PosturaLocal {
  if (!(SANDBOXES_DO_CODEX as readonly string[]).includes(sandbox)) {
    throw new Error(`runtime.sandbox-invalido: "${sandbox}" (aceitos: ${SANDBOXES_DO_CODEX.join(', ')})`);
  }
  const postura: PosturaLocal = { contrato: CONTRATO_POSTURA_LOCAL, sandbox, raiz: raizRealDoEstado(raiz), confirmadoEm: agora(), por };
  gravarArquivoPrivado(raiz, ARQUIVO_POSTURA_LOCAL, postura);
  return postura;
}

/** Apaga a confirmação local; devolve se havia uma. */
export function revogarPosturaLocal(raiz: string): boolean {
  return revogarArquivoPrivado(raiz, ARQUIVO_POSTURA_LOCAL);
}
