/**
 * RM-058, fatia N6 (D7 da ork-rm058n6): o registro da N6 ao lado do log do arco.
 *
 * O fechamento e o relatório da manhã guardam o que fizeram em logs de acréscimo próprios, um por domínio, na pasta do
 * arco (`.orkastery/noctum/arcos/<arco>/fechamento.jsonl` e `relatorio.jsonl`). Cada linha leva o sha256 da anterior e
 * o MAC de uma subchave da chave local do núcleo derivada pelo domínio: a do log do arco não vale aqui, e a de um domínio
 * não vale no outro. O log do arco ganha só o `encerrado` (D2): nada aqui autoriza, renova ou emenda o envelope.
 *
 * A trava de cada domínio é a do kernel num arquivo próprio (`<domínio>.lock`), nunca a do arco: o envio do relatório
 * espera o transporte do canal, e a revogação do dono não pode esperar por ele. A trava solta quando o processo morre.
 *
 * Limites, os mesmos do log do arco: a chave local é legível por qualquer processo do mesmo usuário do sistema, que pode
 * escrever uma linha nova ou truncar o log; o MAC acusa a linha trocada e a cadeia, a linha apagada do meio.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { exigirEstadoSemLink, raizDoEstado } from './estado-thread';
import { kernelDisponivel, tentarTravaExclusiva } from './fila-pesada';
import { chaveLocal } from './hitl-local-receipt';
import { ID_DO_ARCO } from './noctum-envelope';

export const DOMINIOS_DO_REGISTRO = ['fechamento', 'relatorio'] as const;
export type DominioDoRegistro = typeof DOMINIOS_DO_REGISTRO[number];

/** O contrato de cada domínio, que também separa a subchave do MAC. */
export const contratoDoRegistro = (dominio: DominioDoRegistro): string => `ork.noctum-${dominio}/v1`;

/** Tipo fechado próprio, como o da supervisão da N4: o registro não abre gate nem recusa efeito do arco. */
export const MOTIVOS_DO_REGISTRO = ['noctum.registro.adulterado', 'noctum.registro.ocupado', 'noctum.registro.sem-trava'] as const;
export type MotivoDoRegistro = typeof MOTIVOS_DO_REGISTRO[number];

export class RecusaDoRegistro extends Error {
  constructor(readonly motivo: MotivoDoRegistro, detalhe: string) {
    super(`${motivo}: ${detalhe}`);
    this.name = 'RecusaDoRegistro';
  }
}

export interface LinhaDoRegistro<E> {
  contrato: string;
  arco: string;
  seq: number;
  /** sha256 do texto da linha anterior; a primeira aponta para zeros. */
  anterior: string;
  em: string;
  evento: E;
}

interface Lido<E> {
  linhas: LinhaDoRegistro<E>[];
  ultima: string | null;
  bytesCompletos: number;
  bytesLidos: number;
}

const ZERO = '0'.repeat(64);
const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
const adulterado = (dominio: DominioDoRegistro, detalhe: string) =>
  new RecusaDoRegistro('noctum.registro.adulterado', `${dominio}: ${detalhe}; o registro do arco exige inspeção`);
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A pasta do arco na raiz do estado, sem link no caminho. */
export function pastaDoArco(raiz: string, arco: string): string {
  if (typeof arco !== 'string' || !ID_DO_ARCO.test(arco)) throw new RecusaDoRegistro('noctum.registro.adulterado', 'identificador de arco inválido');
  const principal = raizDoEstado(raiz);
  exigirEstadoSemLink(principal, ['.orkastery', 'noctum', 'arcos', arco]);
  return path.join(principal, '.orkastery', 'noctum', 'arcos', arco);
}

function subchave(raiz: string, dominio: DominioDoRegistro, criar: boolean): Buffer {
  return createHmac('sha256', chaveLocal(raiz, criar)).update(contratoDoRegistro(dominio)).digest();
}

/** Lê e confere o log inteiro. Linha sem quebra no fim está sendo gravada: fica de fora e não conta. */
function lerCompleto<E>(raiz: string, arco: string, dominio: DominioDoRegistro): Lido<E> {
  const file = path.join(pastaDoArco(raiz, arco), `${dominio}.jsonl`);
  let bruto: Buffer;
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0) {
        throw adulterado(dominio, 'o log não é arquivo privado do núcleo');
      }
      bruto = fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { linhas: [], ultima: null, bytesCompletos: 0, bytesLidos: 0 };
    if (e instanceof RecusaDoRegistro) throw e;
    throw adulterado(dominio, 'log ilegível');
  }
  // Em bytes: uma cauda que corta um caractere de vários bytes não desalinha os tamanhos.
  const fim = bruto.lastIndexOf(0x0a) + 1;
  const textos = bruto.subarray(0, fim).toString('utf8').split('\n').slice(0, -1);
  if (!textos.length) return { linhas: [], ultima: null, bytesCompletos: fim, bytesLidos: bruto.length };
  let chave: Buffer;
  try { chave = subchave(raiz, dominio, false); } catch { throw adulterado(dominio, 'chave do núcleo ausente para conferir o log'); }
  let anterior = ZERO;
  const contrato = contratoDoRegistro(dominio);
  const linhas = textos.map((texto, i) => {
    let l: unknown;
    try { l = JSON.parse(texto); } catch { throw adulterado(dominio, `linha ${i + 1} não é JSON`); }
    if (!objeto(l) || Object.keys(l).sort().join(',') !== 'dados,mac' || typeof l.mac !== 'string' || !/^[a-f0-9]{64}$/.test(l.mac)) {
      throw adulterado(dominio, `linha ${i + 1} fora do formato`);
    }
    const esperado = createHmac('sha256', chave).update(JSON.stringify(l.dados)).digest();
    if (!timingSafeEqual(Buffer.from(l.mac, 'hex'), esperado)) throw adulterado(dominio, `linha ${i + 1} com MAC que não confere`);
    const d = l.dados as LinhaDoRegistro<E>;
    if (!objeto(d) || d.contrato !== contrato || d.arco !== arco || d.seq !== i + 1 || d.anterior !== anterior) {
      throw adulterado(dominio, `linha ${i + 1} fora da cadeia`);
    }
    anterior = sha(texto);
    return d;
  });
  return { linhas, ultima: textos.at(-1)!, bytesCompletos: fim, bytesLidos: bruto.length };
}

/** As linhas conferidas do registro, sem trava (o log é lido inteiro e conferido). Vazio quando ele ainda não existe. */
export function lerRegistro<E>(raiz: string, arco: string, dominio: DominioDoRegistro): LinhaDoRegistro<E>[] {
  return lerCompleto<E>(raiz, arco, dominio).linhas;
}

const pausa = new Int32Array(new SharedArrayBuffer(4));

/**
 * Executa sob a trava do domínio, com as linhas lidas sob ela e um `anexar` que grava em cima delas. `esperarMs` é quanto
 * a trava ocupada por outro processo é esperada antes da recusa `noctum.registro.ocupado`; sem ele, a recusa é imediata.
 */
export function comRegistro<E, T>(raiz: string, arco: string, dominio: DominioDoRegistro,
  executar: (linhas: readonly LinhaDoRegistro<E>[], anexar: (evento: E, quando: string) => LinhaDoRegistro<E>) => T,
  opcoes: { esperarMs?: number } = {}): T {
  if (!kernelDisponivel()) throw new RecusaDoRegistro('noctum.registro.sem-trava', 'o registro do arco só grava com /usr/bin/flock');
  const pasta = pastaDoArco(raiz, arco);
  fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const prazo = Date.now() + Math.max(0, opcoes.esperarMs ?? 0);
  let fd: number | null;
  for (;;) {
    fd = tentarTravaExclusiva(path.join(pasta, `${dominio}.lock`));
    if (fd !== null || Date.now() >= prazo) break;
    Atomics.wait(pausa, 0, 0, Math.min(100, Math.max(1, prazo - Date.now())));
  }
  if (fd === null) throw new RecusaDoRegistro('noctum.registro.ocupado', `outro processo grava o ${dominio} do arco ${arco}`);
  try {
    let lido = lerCompleto<E>(raiz, arco, dominio);
    const anexar = (evento: E, quando: string): LinhaDoRegistro<E> => {
      const dados: LinhaDoRegistro<E> = { contrato: contratoDoRegistro(dominio), arco, seq: lido.linhas.length + 1,
        anterior: lido.ultima === null ? ZERO : sha(lido.ultima), em: quando, evento };
      const texto = JSON.stringify({ dados, mac: createHmac('sha256', subchave(raiz, dominio, true)).update(JSON.stringify(dados)).digest('hex') });
      const linha = Buffer.from(texto + '\n', 'utf8');
      const file = path.join(pasta, `${dominio}.jsonl`);
      const out = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
      try {
        const st = fs.fstatSync(out);
        if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0) {
          throw adulterado(dominio, 'o log não é arquivo privado do núcleo');
        }
        if (st.size !== lido.bytesLidos) throw adulterado(dominio, 'o log mudou entre a leitura e a escrita sob a trava');
        // A cauda sem quebra é escrita abortada (queda, disco cheio): nunca contou, e sai antes da linha nova.
        if (lido.bytesLidos !== lido.bytesCompletos) fs.ftruncateSync(out, lido.bytesCompletos);
        const escritos = fs.writeSync(out, linha);
        if (escritos !== linha.length) {
          fs.ftruncateSync(out, lido.bytesCompletos);
          fs.fsyncSync(out);
          throw adulterado(dominio, `escrita curta (${escritos} de ${linha.length} bytes); nada foi gravado`);
        }
        fs.fsyncSync(out);
      } finally { fs.closeSync(out); }
      const total = lido.bytesCompletos + linha.length;
      lido = { linhas: [...lido.linhas, dados], ultima: texto, bytesCompletos: total, bytesLidos: total };
      return dados;
    };
    return executar(lido.linhas, anexar);
  } finally { fs.closeSync(fd); }
}
