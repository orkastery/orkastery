/** O manifesto e as sondas falsas dos testes da secao forja do doctor. Nada aqui toca rede ou CLI de verdade. */
import type { SondasDoDoctor } from '../src/doctor-forja';
import type { SondasDaForja } from '../src/forja/resolver';
import type { ManifestoCarregado } from '../src/manifest';
import type { Check } from '../src/types';
import { projetoTemporario } from './apoio';
import { api, cliFalsa, gravado, http, login, ok, Regra, versao } from './forja-cli-falsa';

const BASE: ManifestoCarregado = (() => {
  const p = projetoTemporario('doctor-forja', false);
  try { return p.carregado; } finally { p.limpar(); }
})();

export function projeto(o: { forja?: NonNullable<ManifestoCarregado['manifesto']['forja']>; exigida?: boolean } = {}): ManifestoCarregado {
  return { ...BASE, manifesto: { ...BASE.manifesto, ci: { ...BASE.manifesto.ci, required_for_ship: o.exigida ?? false },
    ...(o.forja ? { forja: o.forja } : {}) } };
}

/** O glab 1.121.0 com login, servindo as respostas gravadas da versao pedida; `antes` tem prioridade. */
export function cliGitlab(versaoDoServidor = '19.2', antes: Regra[] = []): ReturnType<typeof cliFalsa> {
  return cliFalsa([...antes,
    { quando: versao, responde: ok('glab 1.121.0 (4d447cc6c)\n') },
    { quando: login, responde: ok('') },
    { quando: api('metadata'), responde: http(200, gravado(`gitlab/${versaoDoServidor}/metadata`)) },
    { quando: api('personal_access_tokens/self'), responde: http(200, gravado(`gitlab/${versaoDoServidor}/token`)) },
    { quando: api('projects/root%2Fmatriz'), responde: http(200, gravado(`gitlab/${versaoDoServidor}/projeto`)) },
  ]);
}

/** O gh 2.102.0 com login no github.com, com o repositorio gravado de 2026-10; `antes` tem prioridade. */
export function cliGithub(antes: Regra[] = []): ReturnType<typeof cliFalsa> {
  return cliFalsa([...antes,
    { quando: versao, responde: ok('gh version 2.102.0 (2026-09-30)\n') },
    { quando: login, responde: ok('') },
    { quando: api('meta'), responde: http(200, { verifiable_password_authentication: true }) },
    { quando: api('rate_limit'), responde: http(200, { resources: {} }, { 'X-Oauth-Scopes': 'gist, read:org, repo, workflow' }) },
    { quando: api('repos/orkastery/orkastery'), responde: http(200, gravado('github/2026-10/repositorio')) },
  ]);
}

export function sondas(o: { url?: string | null; tipos?: SondasDaForja; porta?: SondasDoDoctor['porta']; tls?: SondasDoDoctor['tls'];
  rodar?: SondasDoDoctor['rodar']; plataforma?: NodeJS.Platform } = {}): SondasDoDoctor {
  return {
    urlDoRemoto: () => (o.url === undefined ? 'https://gitlab.empresa.com/root/matriz.git' : o.url),
    sondas: o.tipos ?? { github: () => 'sem-login', gitlab: () => 'responde' },
    porta: o.porta ?? (() => 'aberta'),
    tls: o.tls ?? (() => ({ ok: true })),
    rodar: o.rodar ?? cliGitlab().rodar,
    agoraMs: () => Date.parse('2026-10-13T12:00:00Z'),
    cache: null,
    plataforma: o.plataforma ?? 'linux',
  };
}

export const linha = (checks: Check[], nome: string): Check | undefined => checks.find((c) => c.nome === nome);
