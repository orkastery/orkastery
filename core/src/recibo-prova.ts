/**
 * RM-078: identidade do que um verify e um CHECK provaram.
 *
 * O recibo nao depende do horario do despacho. Ele depende do HEAD exato da prova,
 * dos ids e comandos das claims ativas e dos bytes do plano. A equivalencia entre
 * esse HEAD e a fonte continua sendo responsabilidade da cadeia classificada em
 * `noctum-provas.ts`; este modulo nunca chama commits de produto de equivalentes.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirThread } from './thread';
import { Claim, DependenciaExternaDaClaim } from './types';
import { lerJsonl } from './util';

export const CONTRATO_DO_RECIBO_DE_PROVA = 'ork.recibo-prova/v1' as const;

export interface ChaveDoReciboDeProva {
  contrato: typeof CONTRATO_DO_RECIBO_DE_PROVA;
  head: string;
  claimsSha256: string;
  planoSha256: string | null;
  dependenciasExternas: DependenciaExternaDaClaim[];
  sha256: string;
}

const sha256 = (valor: string | Buffer): string => createHash('sha256').update(valor).digest('hex');

/** Forma canonica das claims: id ordenado e ordem declarada dos comandos preservada. */
export function materialDasClaims(claims: readonly Claim[]): {
  claims: Array<{ id: string; verificar: string[] }>;
  dependenciasExternas: DependenciaExternaDaClaim[];
} {
  const ativas = claims.filter((c) => c.estado !== 'retirada').sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const dependenciasExternas = [...new Set(ativas.flatMap((c) => c.dependenciasExternas ?? []))].sort();
  return {
    claims: ativas.map((c) => ({ id: c.id, verificar: [...c.verificar] })),
    dependenciasExternas,
  };
}

/** A chave atual. Plano ausente fica explicito e nunca compara como recibo valido. */
export function chaveDoReciboDeProva(raiz: string, threadId: string, head: string): ChaveDoReciboDeProva {
  const dir = dirThread(raiz, threadId);
  const claims = lerJsonl<Claim>(path.join(dir, 'claims.jsonl'));
  const material = materialDasClaims(claims);
  const plano = path.join(dir, 'docs', 'plan.md');
  const planoSha256 = fs.existsSync(plano) ? sha256(fs.readFileSync(plano)) : null;
  const base = {
    contrato: CONTRATO_DO_RECIBO_DE_PROVA,
    head,
    claimsSha256: sha256(JSON.stringify(material.claims)),
    planoSha256,
    dependenciasExternas: material.dependenciasExternas,
  };
  return { ...base, sha256: sha256(JSON.stringify(base)) };
}

/** Recibo completo e igual; forma legada, adulterada ou sem plano volta a executar. */
export function mesmaChaveDoRecibo(
  recibo: ChaveDoReciboDeProva | null | undefined,
  atual: ChaveDoReciboDeProva,
): boolean {
  return recibo?.contrato === CONTRATO_DO_RECIBO_DE_PROVA && recibo.planoSha256 !== null &&
    recibo.head === atual.head && recibo.claimsSha256 === atual.claimsSha256 &&
    recibo.planoSha256 === atual.planoSha256 &&
    JSON.stringify(recibo.dependenciasExternas) === JSON.stringify(atual.dependenciasExternas) &&
    recibo.sha256 === atual.sha256;
}
