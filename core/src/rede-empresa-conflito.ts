/** RM-089 F6: projeção compacta e consultiva da fotografia F3 usada pela adoção. */
import type { ResultadoPreflightEmpresa } from './rede-empresa-preflight';

export interface FotografiaF3DaAdocao {
  estado: ResultadoPreflightEmpresa['estado'];
  consultivo: true;
  conflitos: number;
  ordemSugerida: string[];
  lacunas: string[];
  ponta: string | null;
  cobertura: ResultadoPreflightEmpresa['cobertura'];
}

export function fotografarConflitoDaAdocao(resultado: ResultadoPreflightEmpresa | null): FotografiaF3DaAdocao {
  if (!resultado) return { estado: 'nao-realizado', consultivo: true, conflitos: 0, ordemSugerida: [],
    lacunas: ['rede.nao-configurada'], ponta: null, cobertura: 'incompleta' };
  return { estado: resultado.estado, consultivo: true, conflitos: resultado.conflitos.length,
    ordemSugerida: resultado.ordemSugerida.map((item) => item.threadRef), lacunas: [...resultado.lacunas],
    ponta: resultado.fotografia.ponta, cobertura: resultado.cobertura };
}
