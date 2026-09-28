/**
 * Slug de sessao em 3 partes (conceitos: docs/conceitos/visao-geral.md).
 *
 *   <produto ate 3 letras>-<assunto ate 12 chars>-<fases>[-<rotacao>]
 *
 * A parte 1 vem de `project.abbrev` no manifesto. A parte 2 nao tem hifen interno,
 * o que preserva o parse deterministico. A parte 3 diz que fases a sessao conduz.
 */

/** Regex canonica do slug, aplicada em toda geracao e todo override `--slug`. */
export const REGEX_SLUG =
  /^[a-z0-9]{1,3}-[a-z0-9]{1,12}-(goal|plan|go|check|ship|master|f[1-6]{2,6}|full)(-[0-9]+)?$/;

export interface PartesDoSlug {
  produto: string;
  assunto: string;
  fases: string;
  /** Sufixo numerico de rotacao de sessao (gate de tokens), null quando ausente. */
  rotacao: number | null;
}

/** Remove acentos e reduz a `[a-z0-9]`, o alfabeto aceito nas partes 1 e 2. */
function apenasAlfanumerico(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Normaliza a abreviacao do produto para a parte 1 (ate 3 caracteres). */
export function normalizarAbbrev(bruto: string): string {
  return apenasAlfanumerico(bruto).slice(0, 3);
}

/** Normaliza o nome dado pelo builder para a parte 2 (ate 12 caracteres). */
export function normalizarAssunto(bruto: string): string {
  return apenasAlfanumerico(bruto).slice(0, 12);
}

/** Valida a abreviacao do projeto, com mensagem de erro acionavel. */
export function validarAbbrev(abbrev: string): { ok: boolean; erro?: string } {
  if (!abbrev) {
    return { ok: false, erro: 'project.abbrev ausente no manifesto (parte 1 do slug)' };
  }
  if (!/^[a-z0-9]{1,3}$/.test(abbrev)) {
    return {
      ok: false,
      erro: `project.abbrev invalido: "${abbrev}" (esperado ate 3 caracteres [a-z0-9])`,
    };
  }
  return { ok: true };
}

/** Monta o slug de 3 partes. Lanca erro se o resultado nao casar com a regex canonica. */
export function montarSlug(
  abbrev: string,
  assunto: string,
  fases: string,
  rotacao?: number | null
): string {
  const partes = [normalizarAbbrev(abbrev), normalizarAssunto(assunto), fases.toLowerCase()];
  let slug = partes.join('-');
  if (rotacao && rotacao > 1) slug += `-${rotacao}`;
  if (!REGEX_SLUG.test(slug)) {
    throw new Error(`slug gerado invalido: "${slug}" (regex canonica: ${REGEX_SLUG.source})`);
  }
  return slug;
}

/** Faz o parse do slug nas 3 partes. Retorna null quando o slug e invalido. */
export function parseSlug(slug: string): PartesDoSlug | null {
  if (!REGEX_SLUG.test(slug)) return null;
  const partes = slug.split('-');
  const rotacao = partes.length === 4 ? Number(partes[3]) : null;
  return {
    produto: partes[0],
    assunto: partes[1],
    fases: partes[2],
    rotacao,
  };
}

/** O slug e valido pela regex canonica? */
export function slugValido(slug: string): boolean {
  return REGEX_SLUG.test(slug);
}

/** Id da thread a partir do slug: as duas primeiras partes (`<produto>-<assunto>`). */
export function idDaThreadPeloSlug(slug: string): string | null {
  const p = parseSlug(slug);
  return p ? `${p.produto}-${p.assunto}` : null;
}

/** Proximo slug de rotacao de sessao dentro do mesmo bloco (gate de tokens, B1). */
export function proximaRotacao(slug: string, jaExistentes: string[]): string {
  const p = parseSlug(slug);
  if (!p) throw new Error(`slug invalido para rotacao: ${slug}`);
  const base = `${p.produto}-${p.assunto}-${p.fases}`;
  let n = 1;
  for (const existente of jaExistentes) {
    const q = parseSlug(existente);
    if (!q) continue;
    if (`${q.produto}-${q.assunto}-${q.fases}` !== base) continue;
    n = Math.max(n, q.rotacao ?? 1);
  }
  return montarSlug(p.produto, p.assunto, p.fases, n + 1);
}
