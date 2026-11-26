/** RM-089 F7: decisão da fábrica baseada somente em registros do núcleo e fatos relidos da forja. */
import type { ConfiguracaoDaFabricaCi } from './types';

export type ForjaDaFabrica = 'github' | 'gitlab';
export type CodigoDeProvaDaFabrica = 'ci.fabrica.prova-ausente' | 'ci.fabrica.regra-destino-invalida';

export interface VerifyDaFabrica {
  commit: string;
  verde: boolean;
  comandos: string[];
  rodadaId: string;
  chaveDeProva: string;
  posicao: number;
}

export interface CommitDaFabrica {
  sha: string;
  pais: string[];
  arquivos: string[];
}

export interface ComparacaoDaFabrica {
  relacao: 'ahead' | 'identical' | 'behind' | 'diverged';
  completa: boolean;
  arquivosDesdeVerify: string[];
  commits: CommitDaFabrica[];
}

export interface RegistroDeCommitDaFabrica {
  tipo: 'mcp_git_committed' | 'commit';
  commit: string;
  sessionId: string;
  posicao: number;
}

export interface CheckDaFabrica {
  fase: 'CHECK';
  origem: 'sessions.watch';
  sessionId: string;
  despachoEm: string;
  despachoRegistrado: boolean;
  despachoVerificado: boolean;
  promptConferido: boolean;
  sensorResultId: string;
  favoravel: boolean;
  parecerSha256: string;
  shaRevisado: string;
  conducaoId: string;
  posicao: number;
}

export interface TagDaConducaoDaFabrica {
  conducaoId: string;
  head: string;
  posicao: number;
}

export interface RegistrosParaDecisaoDaFabrica {
  forja: ForjaDaFabrica;
  projeto: string;
  origem: string;
  destino: string;
  head: string;
  comandosDoManifesto: string[];
  configuracaoDoDestino: ConfiguracaoDaFabricaCi | null;
  verifies: VerifyDaFabrica[];
  comparacao: ComparacaoDaFabrica;
  registrosDeCommit: RegistroDeCommitDaFabrica[];
  checks: CheckDaFabrica[];
  tags: TagDaConducaoDaFabrica[];
}

export interface ProvaDosRegistrosDaFabrica {
  forja: ForjaDaFabrica;
  projeto: string;
  origem: string;
  destino: string;
  head: string;
  verify: VerifyDaFabrica;
  check: CheckDaFabrica;
  tag: TagDaConducaoDaFabrica;
  construtores: string[];
  commitsDeProduto: string[];
  configuracaoDoDestino: ConfiguracaoDaFabricaCi;
}

export type ResultadoDosRegistrosDaFabrica = { ok: true; prova: ProvaDosRegistrosDaFabrica } |
  { ok: false; codigo: CodigoDeProvaDaFabrica; detalhe: string };

const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const mesmos = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((valor, indice) => valor === b[indice]);
const soBundle = (arquivos: readonly string[]): boolean =>
  arquivos.length > 0 && arquivos.every((arquivo) => arquivo === '.ork-ci' || arquivo.startsWith('.ork-ci/'));
const commitDeProduto = (commit: CommitDaFabrica): boolean =>
  commit.pais.length < 2 && commit.arquivos.some((arquivo) => arquivo !== '.ork-ci' && !arquivo.startsWith('.ork-ci/'));
const falha = (detalhe: string): ResultadoDosRegistrosDaFabrica =>
  ({ ok: false, codigo: 'ci.fabrica.prova-ausente', detalhe });

/**
 * A ordem relevante é a posição no ledger. Hora de arquivo, data do commit e entrada do evento não substituem o rastro.
 */
export function conferirRegistrosDaFabrica(entrada: RegistrosParaDecisaoDaFabrica): ResultadoDosRegistrosDaFabrica {
  if (!SHA.test(entrada.head) || !entrada.configuracaoDoDestino) return falha('configuração pública ausente no destino');
  const identidade = entrada.forja === 'github'
    ? entrada.configuracaoDoDestino.github_app_id : entrada.configuracaoDoDestino.gitlab_user_id;
  if (!Number.isSafeInteger(identidade) || Number(identidade) <= 0) return falha('identidade da fábrica ausente para a forja');

  const ultimoVerify = [...entrada.verifies].sort((a, b) => a.posicao - b.posicao).at(-1);
  if (!ultimoVerify || !ultimoVerify.verde || !SHA.test(ultimoVerify.commit) || !HASH.test(ultimoVerify.chaveDeProva)
      || !ultimoVerify.rodadaId || !mesmos(ultimoVerify.comandos, entrada.comandosDoManifesto)) {
    return falha('último verify não é verde ou não executou o manifesto');
  }
  if (!entrada.comparacao.completa || !entrada.comparacao.commits.every((c) => SHA.test(c.sha))) {
    return falha('lista de commits ou arquivos incompleta');
  }
  if (entrada.comparacao.relacao !== 'ahead' && entrada.comparacao.relacao !== 'identical') {
    return falha('commit do verify não pertence à cadeia do HEAD');
  }
  if (ultimoVerify.commit !== entrada.head && !soBundle(entrada.comparacao.arquivosDesdeVerify)) {
    return falha('mudança de produto depois do verify');
  }

  const produtos = entrada.comparacao.commits.filter(commitDeProduto);
  const registros = new Map<string, RegistroDeCommitDaFabrica>();
  for (const registro of [...entrada.registrosDeCommit].sort((a, b) => a.posicao - b.posicao)) {
    if (SHA.test(registro.commit) && registro.sessionId) registros.set(registro.commit, registro);
  }
  const semRegistro = produtos.find((commit) => !registros.has(commit.sha));
  if (semRegistro) return falha(`commit de produto sem registro: ${semRegistro.sha}`);
  const dosProdutos = produtos.map((commit) => registros.get(commit.sha)!);
  const construtores = [...new Set(dosProdutos.map((registro) => registro.sessionId))];
  const posicaoDoUltimoProduto = dosProdutos.reduce((maior, registro) => Math.max(maior, registro.posicao), -1);

  const check = [...entrada.checks].sort((a, b) => a.posicao - b.posicao).reverse().find((c) =>
    c.fase === 'CHECK' && c.origem === 'sessions.watch' && c.despachoRegistrado && c.despachoVerificado
    && c.promptConferido && !!c.sensorResultId && c.favoravel && HASH.test(c.parecerSha256)
    && c.shaRevisado === entrada.head && c.posicao > posicaoDoUltimoProduto && !construtores.includes(c.sessionId));
  if (!check) return falha('CHECK independente e ligado ao HEAD ausente');
  const tag = [...entrada.tags].sort((a, b) => a.posicao - b.posicao).reverse().find((t) =>
    t.conducaoId === check.conducaoId && t.head === entrada.head && t.posicao >= check.posicao);
  if (!tag) return falha('tag da mesma condução ausente');
  return { ok: true, prova: { forja: entrada.forja, projeto: entrada.projeto, origem: entrada.origem,
    destino: entrada.destino, head: entrada.head, verify: ultimoVerify, check, tag, construtores,
    commitsDeProduto: produtos.map((commit) => commit.sha), configuracaoDoDestino: entrada.configuracaoDoDestino } };
}
