/** RM-089 F3: análise pura de interseção, conflito e ordem sugerida. */
import type { CaminhoPublicado } from './rede-empresa-contrato';

export type EstadoDaIntersecao = 'intersecta' | 'disjunta' | 'inconclusiva';
export interface ResultadoDaIntersecao { estado: EstadoDaIntersecao; lacuna?: 'padrao.invalido' | 'padrao.nao-suportado' }

type Segmento = { duplo: true } | { duplo: false; valor: string };

function analisarPadrao(padrao: string): { ok: true; segmentos: Segmento[] } | { ok: false; lacuna: 'padrao.invalido' | 'padrao.nao-suportado' } {
  if (!padrao || padrao.length > 400 || padrao.startsWith('/') || padrao.includes('\\') || /[\x00-\x1f\x7f]/.test(padrao))
    return { ok: false, lacuna: 'padrao.invalido' };
  const partes = padrao.split('/');
  if (partes.some((p) => !p || p === '.' || p === '..')) return { ok: false, lacuna: 'padrao.invalido' };
  if (partes.some((p) => /[\[\]{}()!+@]/.test(p) || (p.includes('**') && p !== '**')))
    return { ok: false, lacuna: 'padrao.nao-suportado' };
  return { ok: true, segmentos: partes.map((valor) => valor === '**' ? { duplo: true } : { duplo: false, valor }) };
}

function fechoDoSegmento(padrao: string, iniciais: readonly number[]): number[] {
  const vistos = new Set(iniciais), fila = [...iniciais];
  while (fila.length) {
    const i = fila.shift()!;
    if (padrao[i] === '*' && !vistos.has(i + 1)) { vistos.add(i + 1); fila.push(i + 1); }
  }
  return [...vistos];
}

function transicoesDoSegmento(padrao: string, estado: number, alfabeto: readonly string[]): Array<[string, number]> {
  const token = padrao[estado];
  if (token === undefined) return [];
  if (token === '*') return alfabeto.map((c) => [c, estado]);
  if (token === '?') return alfabeto.map((c) => [c, estado + 1]);
  return [[token, estado + 1]];
}

function segmentosIntersectam(a: string, b: string): boolean {
  const literais = new Set([...a, ...b].filter((c) => c !== '*' && c !== '?'));
  let outro = '\u0001';
  while (literais.has(outro)) outro += '\u0001';
  const alfabeto = [...literais, outro];
  const fila: Array<[number, number, boolean]> = [[0, 0, false]], vistos = new Set<string>();
  while (fila.length) {
    const [ia, ib, consumiu] = fila.shift()!;
    for (const ea of fechoDoSegmento(a, [ia])) for (const eb of fechoDoSegmento(b, [ib])) {
      const chave = `${ea}:${eb}:${consumiu ? 1 : 0}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      if (consumiu && ea === a.length && eb === b.length) return true;
      const ta = transicoesDoSegmento(a, ea, alfabeto), tb = transicoesDoSegmento(b, eb, alfabeto);
      for (const [ca, na] of ta) for (const [cb, nb] of tb) if (ca === cb) fila.push([na, nb, true]);
    }
  }
  return false;
}

function fechoDeCaminho(segmentos: readonly Segmento[], iniciais: readonly number[]): number[] {
  const vistos = new Set(iniciais), fila = [...iniciais];
  while (fila.length) {
    const i = fila.shift()!;
    if (segmentos[i]?.duplo && !vistos.has(i + 1)) { vistos.add(i + 1); fila.push(i + 1); }
  }
  return [...vistos];
}

function rotulos(segmentos: readonly Segmento[], i: number): Array<{ qualquer: boolean; valor?: string; proximo: number }> {
  const s = segmentos[i];
  if (!s) return [];
  return s.duplo ? [{ qualquer: true, proximo: i }] : [{ qualquer: false, valor: s.valor, proximo: i + 1 }];
}

export function intersecaoDeGlobs(a: string, b: string): ResultadoDaIntersecao {
  const pa = analisarPadrao(a), pb = analisarPadrao(b);
  if (!pa.ok || !pb.ok) return { estado: 'inconclusiva', lacuna: !pa.ok ? pa.lacuna : !pb.ok ? pb.lacuna : 'padrao.invalido' };
  const fila: Array<[number, number]> = [[0, 0]], vistos = new Set<string>();
  while (fila.length) {
    const [ia, ib] = fila.shift()!;
    for (const ea of fechoDeCaminho(pa.segmentos, [ia])) for (const eb of fechoDeCaminho(pb.segmentos, [ib])) {
      const chave = `${ea}:${eb}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      if (ea === pa.segmentos.length && eb === pb.segmentos.length) return { estado: 'intersecta' };
      for (const ta of rotulos(pa.segmentos, ea)) for (const tb of rotulos(pb.segmentos, eb)) {
        if (ta.qualquer || tb.qualquer || segmentosIntersectam(ta.valor!, tb.valor!)) fila.push([ta.proximo, tb.proximo]);
      }
    }
  }
  return { estado: 'disjunta' };
}

export interface TrabalhoColetivo {
  inscricaoId: string;
  accountId: number;
  builder: string;
  threadRef: string;
  projectKey: string;
  itemId?: string;
  caminhos: CaminhoPublicado[];
  primeiraAparicao: { ordinal: number; commit: string } | null;
  instanteLocal: { valor: string; fonte: 'auto-relato-autenticado' };
}
export interface ConflitoColetivo {
  a: Pick<TrabalhoColetivo, 'inscricaoId' | 'builder' | 'threadRef'>;
  b: Pick<TrabalhoColetivo, 'inscricaoId' | 'builder' | 'threadRef'>;
  projectKey: string;
  itemId?: string;
  regioes: Array<{ a: string; b: string }>;
  fontes: Array<'item' | 'caminho'>;
}
export interface ResultadoDeConflitos {
  estado: 'conflito' | 'sem-conflito' | 'inconclusivo';
  consultivo: true;
  conflitos: ConflitoColetivo[];
  ordemSugerida: Array<Pick<TrabalhoColetivo, 'inscricaoId' | 'threadRef' | 'builder' | 'primeiraAparicao'>>;
  lacunas: string[];
  performance: { estado: 'unavailable' };
}

const identidade = (t: TrabalhoColetivo): string => `${t.inscricaoId}\0${t.accountId}\0${t.threadRef}`;
const resumo = (t: TrabalhoColetivo) => ({ inscricaoId: t.inscricaoId, builder: t.builder, threadRef: t.threadRef });

export function analisarConflitosColetivos(entrada: readonly TrabalhoColetivo[], lacunasIniciais: readonly string[] = []): ResultadoDeConflitos {
  const unicos = new Map<string, TrabalhoColetivo>();
  for (const trabalho of entrada) {
    const chave = identidade(trabalho), anterior = unicos.get(chave);
    if (!anterior || ((trabalho.primeiraAparicao?.ordinal ?? Number.MAX_SAFE_INTEGER)
      < (anterior.primeiraAparicao?.ordinal ?? Number.MAX_SAFE_INTEGER))) unicos.set(chave, trabalho);
  }
  const trabalhos = [...unicos.values()], conflitos: ConflitoColetivo[] = [], lacunas = [...lacunasIniciais];
  const grupos = new Map<string, TrabalhoColetivo[]>();
  for (const t of trabalhos) grupos.set(t.projectKey, [...(grupos.get(t.projectKey) ?? []), t]);
  for (const [projectKey, grupo] of grupos) for (let i = 0; i < grupo.length; i++) for (let j = i + 1; j < grupo.length; j++) {
    const a = grupo[i], b = grupo[j];
    if (a.inscricaoId === b.inscricaoId && a.accountId === b.accountId) continue;
    const fontes: Array<'item' | 'caminho'> = [], regioes: Array<{ a: string; b: string }> = [];
    if (a.itemId && a.itemId === b.itemId) fontes.push('item');
    for (const ca of a.caminhos) for (const cb of b.caminhos) {
      const intersecao = intersecaoDeGlobs(ca.padrao, cb.padrao);
      if (intersecao.estado === 'intersecta') regioes.push({ a: ca.padrao, b: cb.padrao });
      else if (intersecao.estado === 'inconclusiva') lacunas.push(`${intersecao.lacuna}:${a.threadRef}:${b.threadRef}`);
    }
    if (regioes.length) fontes.push('caminho');
    if (fontes.length) conflitos.push({ a: resumo(a), b: resumo(b), projectKey,
      ...(a.itemId && a.itemId === b.itemId ? { itemId: a.itemId } : {}), regioes, fontes });
  }
  if (trabalhos.some((t) => !t.primeiraAparicao)) lacunas.push('historia.primeira-aparicao-ausente');
  const ordemSugerida = [...trabalhos].sort((a, b) => (a.primeiraAparicao?.ordinal ?? Number.MAX_SAFE_INTEGER)
    - (b.primeiraAparicao?.ordinal ?? Number.MAX_SAFE_INTEGER) || a.inscricaoId.localeCompare(b.inscricaoId)
    || a.threadRef.localeCompare(b.threadRef)).map((t) => ({ inscricaoId: t.inscricaoId, threadRef: t.threadRef,
      builder: t.builder, primeiraAparicao: t.primeiraAparicao }));
  const lacunasUnicas = [...new Set(lacunas)].sort();
  return { estado: lacunasUnicas.length ? 'inconclusivo' : conflitos.length ? 'conflito' : 'sem-conflito', consultivo: true,
    conflitos, ordemSugerida, lacunas: lacunasUnicas, performance: { estado: 'unavailable' } };
}
