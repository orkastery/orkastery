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
  versaoPublicacao?: 1 | 2 | 3;
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

function mesclarDuplicata(anterior: TrabalhoColetivo, atual: TrabalhoColetivo): TrabalhoColetivo {
  const versaoAnterior = anterior.versaoPublicacao ?? 3, versaoAtual = atual.versaoPublicacao ?? 3;
  const ordinalAnterior = anterior.primeiraAparicao?.ordinal ?? Number.MAX_SAFE_INTEGER;
  const ordinalAtual = atual.primeiraAparicao?.ordinal ?? Number.MAX_SAFE_INTEGER;
  const atualTemPrecedencia = versaoAtual > versaoAnterior
    || (versaoAtual === versaoAnterior && ordinalAtual < ordinalAnterior);
  const principal = atualTemPrecedencia ? atual : anterior;
  const complemento = atualTemPrecedencia ? anterior : atual;
  return { ...complemento, ...principal };
}

/** Primeiro segmento literal: regiões distintas por essa chave não podem se intersectar. */
function regiaoDoPadrao(padrao: string): string | null {
  if (padrao.startsWith('/') || padrao.includes('\\') || /[\x00-\x1f\x7f]/.test(padrao)) return null;
  const primeiro = padrao.split('/')[0];
  return primeiro && primeiro !== '.' && primeiro !== '..' && /^[A-Za-z0-9._-]+$/.test(primeiro) ? primeiro : null;
}

interface ParCandidato {
  a: number;
  b: number;
  porItem: boolean;
  caminhos: Map<string, { a: CaminhoPublicado; b: CaminhoPublicado }>;
}

export interface DiagnosticoDaAnaliseColetiva {
  aoCompararCaminhos?: (a: string, b: string, caminhoA: string, caminhoB: string) => void;
}

export function analisarConflitosColetivos(entrada: readonly TrabalhoColetivo[], lacunasIniciais: readonly string[] = [],
  diagnostico: DiagnosticoDaAnaliseColetiva = {}): ResultadoDeConflitos {
  const unicos = new Map<string, TrabalhoColetivo>();
  for (const trabalho of entrada) {
    const chave = identidade(trabalho), anterior = unicos.get(chave);
    unicos.set(chave, anterior ? mesclarDuplicata(anterior, trabalho) : trabalho);
  }
  const trabalhos = [...unicos.values()].sort((a, b) => identidade(a).localeCompare(identidade(b)));
  const conflitos: ConflitoColetivo[] = [], lacunas = [...lacunasIniciais];
  const caminhosValidos = new Set<CaminhoPublicado>();
  for (const trabalho of trabalhos) for (const caminho of trabalho.caminhos) {
    const padrao = analisarPadrao(caminho.padrao);
    if (padrao.ok) caminhosValidos.add(caminho);
    else lacunas.push(`${padrao.lacuna}:${trabalho.threadRef}`);
  }
  const grupos = new Map<string, TrabalhoColetivo[]>();
  for (const t of trabalhos) grupos.set(t.projectKey, [...(grupos.get(t.projectKey) ?? []), t]);
  for (const [projectKey, grupo] of grupos) {
    const pares = new Map<string, ParCandidato>();
    const par = (ia: number, ib: number): ParCandidato => {
      const [a, b] = ia < ib ? [ia, ib] : [ib, ia], chave = `${a}:${b}`;
      let atual = pares.get(chave);
      if (!atual) { atual = { a, b, porItem: false, caminhos: new Map() }; pares.set(chave, atual); }
      return atual;
    };
    const porItem = new Map<string, number[]>();
    grupo.forEach((t, i) => { if (t.itemId) porItem.set(t.itemId, [...(porItem.get(t.itemId) ?? []), i]); });
    for (const indices of porItem.values()) for (let i = 0; i < indices.length; i++) for (let j = i + 1; j < indices.length; j++)
      par(indices[i], indices[j]).porItem = true;

    const regioes = new Map<string, Array<{ trabalho: number; caminho: CaminhoPublicado }>>();
    const globais: Array<{ trabalho: number; caminho: CaminhoPublicado }> = [];
    grupo.forEach((t, trabalho) => t.caminhos.filter((caminho) => caminhosValidos.has(caminho)).forEach((caminho) => {
      const regiao = regiaoDoPadrao(caminho.padrao);
      if (regiao === null) globais.push({ trabalho, caminho });
      else regioes.set(regiao, [...(regioes.get(regiao) ?? []), { trabalho, caminho }]);
    }));
    const registrarCaminho = (x: { trabalho: number; caminho: CaminhoPublicado },
      y: { trabalho: number; caminho: CaminhoPublicado }): void => {
      if (x.trabalho === y.trabalho) return;
      const candidato = par(x.trabalho, y.trabalho);
      const [a, b] = x.trabalho < y.trabalho ? [x.caminho, y.caminho] : [y.caminho, x.caminho];
      candidato.caminhos.set(`${a.padrao}\0${b.padrao}`, { a, b });
    };
    for (const entradas of regioes.values()) {
      for (let i = 0; i < entradas.length; i++) for (let j = i + 1; j < entradas.length; j++)
        registrarCaminho(entradas[i], entradas[j]);
      for (const entrada of entradas) for (const global of globais) registrarCaminho(entrada, global);
    }
    for (let i = 0; i < globais.length; i++) for (let j = i + 1; j < globais.length; j++)
      registrarCaminho(globais[i], globais[j]);

    for (const candidato of [...pares.values()].sort((a, b) => a.a - b.a || a.b - b.b)) {
      const a = grupo[candidato.a], b = grupo[candidato.b];
      if (a.inscricaoId === b.inscricaoId && a.accountId === b.accountId) continue;
      const fontes: Array<'item' | 'caminho'> = [], regioesDoConflito: Array<{ a: string; b: string }> = [];
      if (candidato.porItem) fontes.push('item');
      for (const caminhos of candidato.caminhos.values()) {
        diagnostico.aoCompararCaminhos?.(a.threadRef, b.threadRef, caminhos.a.padrao, caminhos.b.padrao);
        const intersecao = intersecaoDeGlobs(caminhos.a.padrao, caminhos.b.padrao);
        if (intersecao.estado === 'intersecta') regioesDoConflito.push({ a: caminhos.a.padrao, b: caminhos.b.padrao });
        else if (intersecao.estado === 'inconclusiva') lacunas.push(`${intersecao.lacuna}:${a.threadRef}:${b.threadRef}`);
      }
      if (regioesDoConflito.length) fontes.push('caminho');
      if (fontes.length) conflitos.push({ a: resumo(a), b: resumo(b), projectKey,
        ...(candidato.porItem && a.itemId ? { itemId: a.itemId } : {}), regioes: regioesDoConflito, fontes });
    }
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
