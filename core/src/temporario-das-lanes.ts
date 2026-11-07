import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const ENV_TMPFS = 'ORK_CHECK_TMPFS';
/** Marca de transporte: o verify, e nao a lane, e o dono do ciclo de vida de TMPDIR. */
export const ENV_TMPDIR_DA_RODADA = 'ORK_CHECK_TMPDIR_DA_RODADA';
const TMPFS_MAGIC = 0x01021994;

interface SondaTmpfsOk { ok: true; livres: number }
interface SondaTmpfsFalhou { ok: false; motivo: string }
type SondaTmpfs = SondaTmpfsOk | SondaTmpfsFalhou;

export interface SelecaoDoTemporario {
  diretorio: string;
  estado: 'agile' | 'fallback';
  motivo: string;
}

interface OpcoesDoTemporario {
  chave?: string;
  disco?: string;
  candidatos?: string[];
  memoriaLivre?: number;
  memoriaTotal?: number;
  sondar?: (dir: string) => SondaTmpfs;
}

/** Confere filesystem em memoria, espaco e escrita sem depender do nome ou do tamanho de uma maquina. */
export function sondarTmpfs(dir: string): SondaTmpfs {
  try {
    if (!path.isAbsolute(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, motivo: 'candidato-ausente' };
    const s = fs.statfsSync(dir, { bigint: true });
    if (Number(s.type) !== TMPFS_MAGIC) return { ok: false, motivo: 'filesystem-nao-e-tmpfs' };
    const teste = fs.mkdtempSync(path.join(dir, 'ork-check-sonda-'));
    try { fs.writeFileSync(path.join(teste, 'gravavel'), 'ok', { mode: 0o600 }); }
    finally { fs.rmSync(teste, { recursive: true, force: true }); }
    return { ok: true, livres: Number(s.bavail * s.bsize) };
  } catch (e) {
    const erro = e as NodeJS.ErrnoException;
    return { ok: false, motivo: `sonda-falhou:${String(erro.code || erro.message)}` };
  }
}

/**
 * O tmpfs e opt-in ate a bancada provar ganho. `auto` exige folga proporcional de memoria e espaco; qualquer duvida
 * usa o temporario em disco. Verify e lanes chamam esta mesma funcao para nao criarem politicas diferentes.
 */
export function selecionarTemporario(opcoes: OpcoesDoTemporario = {}): SelecaoDoTemporario {
  const chave = opcoes.chave ?? process.env[ENV_TMPFS];
  const disco = opcoes.disco ?? os.tmpdir();
  const candidatos = opcoes.candidatos ?? [process.env.XDG_RUNTIME_DIR, '/dev/shm']
    .filter((x): x is string => !!x);
  const memoriaLivre = opcoes.memoriaLivre ?? os.freemem();
  const memoriaTotal = opcoes.memoriaTotal ?? os.totalmem();
  const sondar = opcoes.sondar ?? sondarTmpfs;
  if (chave !== 'auto') return { diretorio: disco, estado: 'fallback', motivo: chave ? `chave-${chave}` : 'desligado-por-padrao' };
  if (!(memoriaTotal > 0) || memoriaLivre / memoriaTotal < 0.25) {
    return { diretorio: disco, estado: 'fallback', motivo: 'memoria-livre-sem-folga' };
  }
  const necessario = Math.min(memoriaLivre / 4, memoriaTotal / 10);
  const motivos: string[] = [];
  for (const candidato of [...new Set(candidatos)]) {
    const r = sondar(candidato);
    if (r.ok && r.livres >= necessario) return { diretorio: candidato, estado: 'agile', motivo: 'tmpfs-gravavel-com-folga' };
    motivos.push(`${candidato}:${r.ok ? 'espaco-sem-folga' : r.motivo}`);
  }
  return { diretorio: disco, estado: 'fallback', motivo: motivos.length ? motivos.join(';') : 'sem-candidato-tmpfs' };
}
