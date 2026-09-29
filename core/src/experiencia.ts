/** Preferências públicas da experiência. Consulta não grava respostas nem autoria. */
import { fusoDoSistema, normalizarFuso } from './horario';
import type { Manifesto } from './types';

export type PreferenciasExperiencia = NonNullable<Manifesto['owner']>;
export type OrigemPreferencia = 'manifesto' | 'sistema' | 'padrao';

export function normalizarIdioma(valor: unknown): string | undefined {
  if (typeof valor !== 'string' || !valor.trim()) return undefined;
  try { return Intl.getCanonicalLocales(valor.trim())[0]; } catch { return undefined; }
}

export function validarPreferencias(valor: unknown): PreferenciasExperiencia {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw Error('experiencia.config.invalid: owner deve ser um objeto');
  const v = valor as Record<string, unknown>, resultado: PreferenciasExperiencia = {};
  if (v.language !== undefined) {
    const idioma = normalizarIdioma(v.language);
    if (!idioma) throw Error('experiencia.config.invalid: owner.language exige locale BCP-47');
    resultado.language = idioma;
  }
  if (v.timezone !== undefined) {
    const fuso = normalizarFuso(v.timezone);
    if (!fuso) throw Error('experiencia.config.invalid: owner.timezone exige fuso IANA');
    resultado.timezone = fuso;
  }
  if (v.depth !== undefined) {
    if (v.depth !== 'curta' && v.depth !== 'detalhada') throw Error('experiencia.config.invalid: owner.depth exige curta ou detalhada');
    resultado.depth = v.depth;
  }
  if (v.experience !== undefined) {
    if (typeof v.experience !== 'boolean') throw Error('experiencia.config.invalid: owner.experience exige booleano');
    resultado.experience = v.experience;
  }
  return resultado;
}

export function idiomaDoSistema(env: NodeJS.ProcessEnv = process.env): string {
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG;
  const normalizado = normalizarIdioma(locale?.split(/[.@]/)[0].replace(/_/g, '-'));
  return normalizado ?? normalizarIdioma(Intl.DateTimeFormat().resolvedOptions().locale) ?? 'en-US';
}

export function resolverExperiencia(owner: PreferenciasExperiencia = {},
  sistema = { language: idiomaDoSistema(), timezone: fusoDoSistema() }) {
  const p = validarPreferencias(owner);
  const language = p.language ?? normalizarIdioma(sistema.language) ?? 'en-US';
  return {
    language, timezone: p.timezone ?? normalizarFuso(sistema.timezone) ?? 'UTC',
    depth: p.depth ?? 'curta', experience: p.experience ?? true,
    skill: language.toLowerCase().startsWith('pt-') || language === 'pt'
      ? 'orchestration-experience-pt-br' : 'orchestration-experience',
    origem: {
      language: p.language === undefined ? 'sistema' : 'manifesto',
      timezone: p.timezone === undefined ? 'sistema' : 'manifesto',
      depth: p.depth === undefined ? 'padrao' : 'manifesto',
      experience: p.experience === undefined ? 'padrao' : 'manifesto',
    } as Record<keyof PreferenciasExperiencia, OrigemPreferencia>,
  };
}
