/** RM-089 F7: gate GitHub por destino, sem aceitar commit status como autoridade positiva. */
import { publicacaoDoCheckDaFabricaGithub, type PublicacaoDoCheckDaFabricaGithub } from './forja/github/ci';
import type { PoliticaDeReciboCi } from './types';

export type CodigoDoGateGithub = 'ci.fabrica.prova-ausente' | 'ci.fabrica.regra-destino-invalida'
  | 'ci.fabrica.nome-colidente' | 'ci.fabrica.publicacao-recusada';

export interface CheckExigidoGithub { nome: string; appId: number | null; }
export interface ProtecaoClassicaGithub {
  padrao: string;
  strict: boolean;
  checks: CheckExigidoGithub[];
}
export interface RulesetGithub {
  ativo: boolean;
  inclusoes: string[];
  exclusoes: string[];
  strict: boolean;
  checks: CheckExigidoGithub[];
}
export interface EntradaDoGateGithub {
  nivel: PoliticaDeReciboCi;
  repositorio: string;
  destino: string;
  baseDoPedido: string;
  head: string;
  appIdEsperado: number;
  evento: 'pull_request' | 'pull_request.edited' | 'merge_group';
  fork: boolean;
  relacaoComDestino: 'ahead' | 'identical' | 'behind' | 'diverged';
  listaCompleta: boolean;
  protecaoClassica?: ProtecaoClassicaGithub;
  rulesets: RulesetGithub[];
  nomesExistentes?: string[];
  publicacaoAceita?: boolean;
}
export type ResultadoDoGateGithub = { ok: true; nome: string; publicacao: PublicacaoDoCheckDaFabricaGithub;
  decisorio: boolean } | { ok: false; codigo: CodigoDoGateGithub; nome: string };

export const sufixoDoDestinoGithub = (destino: string): string => Buffer.from(destino, 'utf8').toString('hex');
export const nomeDecisorioGithub = (destino: string): string => `ork-fabrica/utf8-${sufixoDoDestinoGithub(destino)}`;
export const nomeDiagnosticoGithub = (destino: string): string => `ork-fabrica-diagnostico/utf8-${sufixoDoDestinoGithub(destino)}`;

const metacaractere = /[*?\[\]{}!]/;
const classicaPropria = (p: ProtecaoClassicaGithub | undefined, destino: string): boolean =>
  !!p && p.padrao === destino && !metacaractere.test(p.padrao);
const rulesetProprio = (r: RulesetGithub, destino: string): boolean => r.ativo && r.exclusoes.length === 0
  && r.inclusoes.length === 1 && r.inclusoes[0] === `refs/heads/${destino}` && !metacaractere.test(r.inclusoes[0]);
const exige = (checks: readonly CheckExigidoGithub[], nome: string, app: number): boolean =>
  checks.some((c) => c.nome === nome && c.appId === app);
const exigeNome = (checks: readonly CheckExigidoGithub[], nome: string): boolean => checks.some((c) => c.nome === nome);

export function avaliarGateGithub(entrada: EntradaDoGateGithub): ResultadoDoGateGithub {
  const decisorio = entrada.nivel === 'exigir';
  const nome = decisorio ? nomeDecisorioGithub(entrada.destino) : nomeDiagnosticoGithub(entrada.destino);
  const falha = (codigo: CodigoDoGateGithub): ResultadoDoGateGithub => ({ ok: false, codigo, nome });
  if (!entrada.destino || entrada.evento === 'merge_group' || entrada.fork || entrada.baseDoPedido !== entrada.destino
      || !/^[a-f0-9]{40}$/.test(entrada.head) || !entrada.listaCompleta) return falha('ci.fabrica.prova-ausente');
  if (entrada.nomesExistentes?.some((existente) => existente.toLocaleLowerCase('en-US') === nome.toLocaleLowerCase('en-US')
      && existente !== nome)) return falha('ci.fabrica.nome-colidente');
  if (entrada.publicacaoAceita === false) return falha('ci.fabrica.publicacao-recusada');

  if (decisorio) {
    const diagnostico = nomeDiagnosticoGithub(entrada.destino);
    const classica = classicaPropria(entrada.protecaoClassica, entrada.destino);
    const rulesets = entrada.rulesets.filter((r) => rulesetProprio(r, entrada.destino));
    const regraPropria = classica || rulesets.length > 0;
    const exigeDiagnostico = (classica && exigeNome(entrada.protecaoClassica!.checks, diagnostico))
      || rulesets.some((r) => exigeNome(r.checks, diagnostico));
    const fonteEstrita = (classica && entrada.protecaoClassica!.strict
        && exige(entrada.protecaoClassica!.checks, nome, entrada.appIdEsperado))
      || rulesets.some((r) => r.strict && r.checks.length > 0 && exige(r.checks, nome, entrada.appIdEsperado));
    if (!regraPropria || exigeDiagnostico || !fonteEstrita
        || (entrada.relacaoComDestino !== 'ahead' && entrada.relacaoComDestino !== 'identical')) {
      return falha('ci.fabrica.regra-destino-invalida');
    }
  }
  return { ok: true, nome, decisorio,
    publicacao: publicacaoDoCheckDaFabricaGithub(entrada.repositorio, entrada.head, nome,
      decisorio ? 'success' : 'neutral') };
}
