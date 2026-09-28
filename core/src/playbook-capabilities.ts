/** Matriz I09 sem transporte, spawn, persistencia ou ativacao. */
import {
  ContratoPlaybookInvalido, PLAYBOOK_VERSION, hashJsonPlaybook, listaPlaybook,
  objetoFechado, textoPlaybook, validarContratoPlaybook,
} from './playbook-contracts';

export type NivelCapacidade = 'help' | 'transporte' | 'teste' | 'homologacao';
const niveis: NivelCapacidade[] = ['help', 'transporte', 'teste', 'homologacao'];
export interface ContextoCapacidade {
  runtime: 'codex' | 'claude';
  versaoRuntime: string;
  binarioSha256: string;
  transporte: string;
  configSha256: string;
  schemaSha256: string;
  codigoSha256: string;
  escopo: {
    projeto: string; thread: string; fase: string; dispatchId: string; sessionId: string;
    base: string; head: string; prova: string;
  };
}
export interface CapacidadeCandidata {
  id: string;
  evidencias: Partial<Record<NivelCapacidade, string>>;
}
export interface MatrizCapacidadesCandidata {
  schemaVersion: typeof PLAYBOOK_VERSION;
  contexto: ContextoCapacidade;
  capacidades: CapacidadeCandidata[];
}
export interface ReciboCapacidade {
  schemaVersion: typeof PLAYBOOK_VERSION;
  id: string;
  fingerprint: string;
  capacidade: string;
  nivel: NivelCapacidade;
  origem: 'help' | 'transporte' | 'deterministica' | 'nativa';
  fonte: { id: string; sha256: string };
  comando: string[];
  saida: string;
  inicio: string;
  fim: string;
  resultado: {
    estado: 'aprovado' | 'reprovado' | 'unavailable';
    exitCode: number;
    esperados: string[];
    executados: string[];
    aprovados: string[];
    skipped: number;
    todo: number;
  };
}

const versao = { type: 'integer', const: PLAYBOOK_VERSION };
const schemaContexto = objetoFechado({
  runtime: { type: 'string', enum: ['codex', 'claude'] },
  versaoRuntime: textoPlaybook, binarioSha256: textoPlaybook, transporte: textoPlaybook,
  configSha256: textoPlaybook, schemaSha256: textoPlaybook, codigoSha256: textoPlaybook,
  escopo: objetoFechado({
    projeto: textoPlaybook, thread: textoPlaybook,
    fase: { type: 'string', enum: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'] },
    dispatchId: textoPlaybook, sessionId: textoPlaybook, base: textoPlaybook, head: textoPlaybook, prova: textoPlaybook,
  }),
});
const schemaMatriz = objetoFechado({
  schemaVersion: versao, contexto: schemaContexto,
  capacidades: listaPlaybook(objetoFechado({
    id: textoPlaybook,
    evidencias: objetoFechado(Object.fromEntries(niveis.map(n => [n, textoPlaybook])), []),
  })),
});
const schemaRecibo = objetoFechado({
  schemaVersion: versao, id: textoPlaybook, fingerprint: textoPlaybook, capacidade: textoPlaybook,
  nivel: { type: 'string', enum: niveis },
  origem: { type: 'string', enum: ['help', 'transporte', 'deterministica', 'nativa'] },
  fonte: objetoFechado({ id: textoPlaybook, sha256: textoPlaybook }),
  comando: listaPlaybook(textoPlaybook, 1), saida: { type: 'string', maxLength: 131072 },
  inicio: textoPlaybook, fim: textoPlaybook,
  resultado: objetoFechado({
    estado: { type: 'string', enum: ['aprovado', 'reprovado', 'unavailable'] },
    exitCode: { type: 'integer' }, esperados: listaPlaybook(textoPlaybook),
    executados: listaPlaybook(textoPlaybook), aprovados: listaPlaybook(textoPlaybook),
    skipped: { type: 'integer' }, todo: { type: 'integer' },
  }),
});

function exigir(condicao: unknown, campo: string, detalhe: string): asserts condicao {
  if (!condicao) throw new ContratoPlaybookInvalido(campo, detalhe);
}
function sha256(valor: string, campo: string): void {
  exigir(/^[a-f0-9]{64}$/.test(valor), campo, 'SHA-256 invalido');
}
function nomesUnicos(valores: string[], campo: string): void {
  exigir(valores.every(v => v.trim().length > 0), campo, 'nome vazio');
  exigir(new Set(valores).size === valores.length, campo, 'nome repetido');
}

export function fingerprintCapacidade(contexto: ContextoCapacidade): string {
  validarContratoPlaybook(contexto, schemaContexto);
  for (const k of ['binarioSha256', 'configSha256', 'schemaSha256', 'codigoSha256'] as const) sha256(contexto[k], k);
  for (const k of ['base', 'head'] as const) exigir(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(contexto.escopo[k]), k, 'commit invalido');
  exigir(Object.values(contexto.escopo).every(v => v.trim().length > 0) &&
    contexto.versaoRuntime.trim().length > 0 && contexto.transporte.trim().length > 0, 'contexto', 'identidade vazia');
  return hashJsonPlaybook({ schemaVersion: PLAYBOOK_VERSION, contexto });
}

export function validarReciboCapacidade(valor: unknown): ReciboCapacidade {
  validarContratoPlaybook(valor, schemaRecibo);
  const r = valor as ReciboCapacidade;
  sha256(r.fingerprint, 'fingerprint');
  sha256(r.fonte.sha256, 'fonte.sha256');
  for (const campo of ['inicio', 'fim'] as const) {
    const instante = Date.parse(r[campo]);
    exigir(Number.isFinite(instante) && new Date(instante).toISOString() === r[campo], campo, 'instante UTC invalido');
  }
  exigir(Date.parse(r.fim) >= Date.parse(r.inicio), 'fim', 'recibo termina antes de iniciar');
  nomesUnicos([r.id], 'id');
  nomesUnicos([r.capacidade], 'capacidade');
  nomesUnicos([r.fonte.id], 'fonte.id');
  const resultado = r.resultado;
  for (const k of ['esperados', 'executados', 'aprovados'] as const) nomesUnicos(resultado[k], `resultado.${k}`);
  exigir(resultado.exitCode >= 0 && resultado.skipped >= 0 && resultado.todo >= 0, 'resultado', 'contagem negativa');
  exigir(resultado.aprovados.every(c => resultado.executados.includes(c)) &&
    resultado.executados.every(c => resultado.esperados.includes(c)), 'resultado', 'casos sem correspondencia');
  const origens: Record<NivelCapacidade, string[]> = {
    help: ['help'], transporte: ['transporte'], teste: ['deterministica', 'nativa'], homologacao: ['nativa'],
  };
  exigir(origens[r.nivel].includes(r.origem), 'origem', 'origem incompativel com nivel');
  return r;
}

export interface CapacidadeAvaliada {
  id: string;
  observadaNoHelp: boolean;
  disponivelNoTransporte: boolean;
  testada: boolean;
  homologada: boolean;
  estado: 'pendente' | 'reprovada' | 'unavailable' | 'homologada';
  motivos: string[];
}
export interface MatrizCapacidadesAvaliada {
  schemaVersion: typeof PLAYBOOK_VERSION;
  fingerprint: string;
  capacidades: CapacidadeAvaliada[];
  requeridasAtendidas: boolean;
  requeridasSemDemonstracao: string[];
}

/**
 * O consumidor Ork fornece contexto ATUAL e resolve fontes externas exatas, verificadas
 * independentemente. Nunca construir resolverRecibo a partir do JSON do candidato.
 * Ausencia de resolver ou de fonte nao concede selo. T07/T20 implementarao essa fronteira.
 */
export function avaliarCapacidades(
  candidato: unknown,
  contextoAtual: ContextoCapacidade,
  requeridas: string[],
  resolverRecibo?: (id: string) => unknown,
): MatrizCapacidadesAvaliada {
  validarContratoPlaybook(candidato, schemaMatriz);
  const matriz = candidato as MatrizCapacidadesCandidata;
  const fingerprint = fingerprintCapacidade(contextoAtual);
  exigir(fingerprintCapacidade(matriz.contexto) === fingerprint, 'contexto', 'fingerprint atual divergente');
  validarContratoPlaybook(requeridas, listaPlaybook(textoPlaybook));
  nomesUnicos(requeridas, 'requeridas');
  nomesUnicos(matriz.capacidades.map(c => c.id), 'capacidades');
  const capacidades = matriz.capacidades.map(c => {
    const provas: Partial<Record<NivelCapacidade, boolean>> = {};
    const motivos: string[] = [];
    let reprovada = false;
    let unavailable = false;
    for (const nivel of niveis) {
      const id = c.evidencias[nivel];
      if (id === undefined) continue;
      const fonte = resolverRecibo?.(id);
      if (fonte === undefined || fonte === null) {
        motivos.push(`${nivel}: fonte externa ausente`);
        unavailable = true;
        continue;
      }
      const recibo = validarReciboCapacidade(fonte);
      exigir(recibo.id === id && recibo.capacidade === c.id && recibo.nivel === nivel, nivel, 'recibo de outra capacidade ou nivel');
      exigir(recibo.fingerprint === fingerprint, nivel, 'recibo de outro fingerprint');
      const r = recibo.resultado;
      const casosCompletos = r.esperados.length > 0 && r.esperados.length === r.executados.length &&
        r.executados.length === r.aprovados.length && r.skipped === 0 && r.todo === 0;
      provas[nivel] = r.estado === 'aprovado' && r.exitCode === 0 && casosCompletos;
      if (!provas[nivel]) {
        motivos.push(`${nivel}: ${r.estado}, casos completos=${casosCompletos}, exitCode=${r.exitCode}`);
        if (r.estado === 'unavailable') unavailable = true;
        else reprovada = true;
      }
    }
    const homologada = provas.transporte === true && provas.teste === true && provas.homologacao === true &&
      !reprovada && !unavailable;
    return {
      id: c.id, observadaNoHelp: provas.help === true, disponivelNoTransporte: provas.transporte === true,
      testada: provas.teste === true, homologada,
      estado: reprovada ? 'reprovada' as const : unavailable ? 'unavailable' as const :
        homologada ? 'homologada' as const : 'pendente' as const,
      motivos,
    };
  });
  const requeridasSemDemonstracao = requeridas.filter(id => !capacidades.some(c => c.id === id && c.homologada));
  return { schemaVersion: PLAYBOOK_VERSION, fingerprint, capacidades,
    requeridasAtendidas: requeridas.length > 0 && requeridasSemDemonstracao.length === 0,
    requeridasSemDemonstracao };
}

export function exigirCapacidadesRequeridas(...parametros: Parameters<typeof avaliarCapacidades>): MatrizCapacidadesAvaliada {
  const matriz = avaliarCapacidades(...parametros);
  exigir(matriz.requeridasAtendidas, 'requeridas', `sem demonstracao: ${matriz.requeridasSemDemonstracao.join(', ') || 'coorte vazia'}`);
  return matriz;
}
