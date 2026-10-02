/**
 * `ork audit run|list|show|ingest|verify|report`: o ciclo de vida de uma rodada de
 * auditoria periodica (bloco B5).
 *
 * O contrato de disparo da visao (secao 5.1) esta inteiro aqui, e nada dele e novo:
 *
 *   - o orquestrador (cron do Hermes, schedule do OpenClaw, hook do Claude Code) chama
 *     `ork audit run <pack> --profile <p> [--since Nd]`;
 *   - o `ork` monta o prompt do pack e despacha pelo RUNTIME ADAPTER QUE JA EXISTE
 *     (`adapters/claude-bg`), o mesmo do `ork phase run`. Nenhum mecanismo de runtime novo
 *     foi inventado para o auditor, e as policies do manifesto valem no despacho da rodada
 *     exatamente como valem no despacho de uma fase;
 *   - os achados voltam pelo `ork` (unico escritor) e ficam sujeitos a claims;
 *   - a saida termina no bloco obrigatorio de propostas para o roadmap do produto.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as adapter from './adapters/claude-bg';
import {
  DESCRICAO_DA_POSTURA,
  PACKS,
  escopoDaRodada,
  janelaDeCusto,
  montarPromptDeAuditoria,
  packAtivo,
  packsAtivos,
  posturaDoPack,
} from './auditoria';
import { hashDoPrompt } from './phase';
import { avaliarPolicies, bloqueantes } from './policies';
import { DIR_ESTADO, dirEstado, ManifestoCarregado } from './manifest';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import {
  acharDuplicado,
  achadosDaRodada,
  CAMPOS_DA_PROPOSTA,
  carimbarAchado,
  EntradaDeAchado,
  exigirAchado,
  lerBoard,
  parseSeveridade,
  pedidoDoAchado,
  registrarAchado,
  textoDoAchado,
} from './divida';
import { adicionarClaim } from './claims';
import {
  AchadoDeSuperficie,
  blocoDoFormato,
  entradaBrutaDaSuperficie,
  ResultadoDaVarredura,
  varrerSuperficie,
} from './superficie';
import { dirThread, novaThread } from './thread';
import {
  Achado,
  MotivoDeAuditoria,
  PackDeAuditoria,
  ResultadoDeClaim,
  ResumoDaSuperficie,
  RodadaDeAuditoria,
  VereditoDeAuditoria,
} from './types';
import { agora, gravar, gravarJson, lerJson, shaCurto, tabela } from './util';
import { commitReal, verificarClaim } from './verify';
import { formatarDataHora, formatarDataHoraRotulada, legendaDoFuso, localizarTexto } from './horario';

/** Versao do formato de `run.json`. */
export const VERSAO_DA_RODADA = 1;

/** Diretorio das rodadas de auditoria do projeto. */
export function dirAuditorias(raiz: string): string {
  return path.join(dirEstado(raiz), 'audits');
}

/** Diretorio de uma rodada. */
export function dirRodada(raiz: string, id: string): string {
  return path.join(dirAuditorias(raiz), id);
}

/** Caminho do `run.json` da rodada. */
export function caminhoRodada(raiz: string, id: string): string {
  return path.join(dirRodada(raiz, id), 'run.json');
}

/** Ids das rodadas existentes, em ordem alfabetica (que e cronologica pelo carimbo). */
export function listarRodadas(raiz: string): string[] {
  const dir = dirAuditorias(raiz);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(caminhoRodada(raiz, e.name)))
    .map((e) => e.name)
    .sort();
}

/** Le uma rodada do disco. */
export function lerRodada(raiz: string, id: string): RodadaDeAuditoria {
  const caminho = caminhoRodada(raiz, id);
  if (!fs.existsSync(caminho)) {
    throw new Error(`rodada de auditoria "${id}" nao encontrada em ${dirAuditorias(raiz)}`);
  }
  return lerJson<RodadaDeAuditoria>(caminho);
}

/** Grava a rodada. */
export function gravarRodada(raiz: string, rodada: RodadaDeAuditoria): void {
  gravarJson(caminhoRodada(raiz, rodada.id), rodada);
}

/**
 * `<abbrev>-<pack>-<AAAA-MM-DD>-<n>`: id da rodada, tambem usado como `--name` da sessao.
 *
 * A data vai com hifen de proposito. MEDIDO em 03/09/2026: com `AAAAMMDD` colado, o
 * `extrairSessionId` do adapter casa `20260903` como id curto de sessao (8 caracteres
 * hexadecimais) e a rodada grava um sessionId que nao existe. Com a data separada nao ha
 * token de 8 hex no nome, e o id que fica no `run.json` e o da sessao de verdade.
 */
export function novoIdDeRodada(
  raiz: string,
  abbrev: string,
  pack: PackDeAuditoria,
  quando: Date = new Date()
): string {
  const dia =
    String(quando.getFullYear()) +
    '-' +
    String(quando.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(quando.getDate()).padStart(2, '0');
  const base = `${abbrev}-${pack}-${dia}`;
  const existentes = listarRodadas(raiz).filter((id) => id.startsWith(base + '-'));
  return `${base}-${existentes.length + 1}`;
}

export interface OpcoesDeRodada {
  perfil?: string;
  since?: string;
  tudo?: boolean;
  effort?: string;
  model?: string;
  dryRun?: boolean;
  /** Autoriza rodar FORA da janela ociosa, com o nome de quem autorizou. */
  agora?: string;
  /** Roda um pack ainda inativo no estagio, com o motivo registrado no ledger. */
  forcar?: boolean;
  /** Injeta o relogio nos testes, para a janela ociosa ser testavel sem esperar a noite. */
  quando?: Date;
}

/**
 * O texto do `FORMATO.md` que a rodada deixa para o auditor saber o que produzir.
 *
 * Os campos obrigatorios vem de `CAMPOS_DA_PROPOSTA`, a MESMA lista que `faltasDaProposta`
 * usa para recusar achado incompleto: o documento nao pode prometer um formato diferente do
 * que o `ork` aceita.
 */
export function formatoDosAchados(
  rodada: RodadaDeAuditoria,
  varredura?: { resultado: ResultadoDaVarredura; registrados: boolean }
): string {
  const pack = PACKS[rodada.pack];
  const dir = path.join(DIR_ESTADO, 'audits', rodada.id);
  const exemplo: Record<string, unknown> = {
    regra: pack.regras[0].id,
    severidade: 'critico | maior | menor',
  };
  for (const c of CAMPOS_DA_PROPOSTA) {
    if (c.campo === 'arquivo') {
      exemplo.arquivo = c.descricao.replace('a evidencia principal, no formato ', '');
      exemplo.descricao = 'o contexto que a linha nao cabe';
      exemplo.alegacao = 'a alegacao verificavel do auditor sobre este achado';
      exemplo.verificar = ['comando que reexecuta a evidencia e sai 0 quando o achado procede'];
      continue;
    }
    exemplo[c.campo] = c.descricao;
  }
  return `# Formato dos achados da rodada ${rodada.id}

Escreva \`achados.json\` neste diretorio e registre com:

    ork audit ingest ${rodada.id} --arquivo ${dir}/achados.json

Estrutura (o \`ork\` recusa o achado que nao trouxer a proposta completa):

\`\`\`json
${JSON.stringify({ achados: [exemplo] }, null, 2)}
\`\`\`

Regras que o \`ork\` verifica sozinho:

- \`regra\` precisa ser uma das do pack ${pack.id}: ${pack.regras.map((r) => r.id).join(', ')}.
- Campos obrigatorios (motivo tipado \`achado.sem-proposta\` quando faltar algum):
${CAMPOS_DA_PROPOSTA.map((c) => `  - \`${c.campo}\`: ${c.descricao}`).join('\n')}
- \`verificar\` e o que torna o achado sustentavel: sem comando, uma alegacao negativa ou
  absoluta REPROVA em \`ork audit verify ${rodada.id}\`. O auditor nao tem self-report.
- A ingestao e idempotente: rodar \`ork audit ingest\` duas vezes nao duplica achado.
${varredura ? '\n' + blocoDoFormato(varredura.resultado, varredura.registrados) + '\n' : ''}`;
}

// ---------------------------------------------------------------------------
// A varredura deterministica de superficie de rede dentro da rodada (SP8..SP12)
// ---------------------------------------------------------------------------

/** O unico pack com varredura deterministica propria: a extensao de superficie do B5. */
export const PACK_DA_SUPERFICIE: PackDeAuditoria = 'security-privacy';

export interface ResultadoDaVarreduraDaRodada {
  rodada: string;
  resultado: ResultadoDaVarredura;
  registrados: Achado[];
  /** Achados que a rodada ja tinha: a varredura tambem e idempotente. */
  duplicados: Achado[];
  recusados: { achado: AchadoDeSuperficie; erro: string }[];
  resumo: ResumoDaSuperficie;
}

/**
 * Roda a varredura de superficie de rede no escopo da rodada e, quando pedido, registra os
 * achados no MESMO board de divida.
 *
 * Ela nao inventa um segundo caminho de achado: cada resultado da varredura vira
 * `AchadoBruto` e passa por `registrarAchadoDaRodada`, com a mesma validacao de proposta
 * completa, a mesma claim e a mesma guarda de duplicata da ingestao do auditor com LLM.
 *
 * `--dry-run` varre e NAO registra: a simulacao continua sem gravar achado, e o operador
 * registra depois com `ork audit surface --registrar <rodada>` se quiser.
 */
export function varrerSuperficieDaRodada(
  carregado: ManifestoCarregado,
  rodadaId: string,
  opcoes: { registrar?: boolean; limitePorRegra?: number } = {}
): ResultadoDaVarreduraDaRodada {
  const { raiz } = carregado;
  const rodada = lerRodada(raiz, rodadaId);
  const resultado = varrerSuperficie(raiz, {
    escopo: rodada.escopo,
    limitePorRegra: opcoes.limitePorRegra,
  });

  const registrados: Achado[] = [];
  const duplicados: Achado[] = [];
  const recusados: { achado: AchadoDeSuperficie; erro: string }[] = [];
  if (opcoes.registrar) {
    for (const a of resultado.achados) {
      const bruto = entradaBrutaDaSuperficie(a);
      const atual = lerRodada(raiz, rodadaId);
      const jaTinha = acharDuplicado(achadosDaRodada(raiz, rodadaId), entradaDoBruto(atual, bruto));
      if (jaTinha) {
        duplicados.push(jaTinha);
        continue;
      }
      try {
        registrados.push(registrarAchadoDaRodada(carregado, rodadaId, bruto));
      } catch (e) {
        recusados.push({ achado: a, erro: (e as Error).message });
      }
    }
  }

  const resumo: ResumoDaSuperficie = {
    arquivosLidos: resultado.arquivosLidos,
    arquivosComRota: resultado.arquivosComRota,
    rotas: resultado.rotas,
    frameworks: resultado.frameworks,
    encontrados: resultado.achados.length,
    registrados: registrados.length,
    aConfirmar: resultado.achados.filter((a) => a.confianca === 'baixa').length,
    detalhe: resultado.detalhe,
  };

  const dir = dirRodada(raiz, rodadaId);
  gravarJson(path.join(dir, 'superficie.json'), {
    versao: 1,
    rodada: rodadaId,
    varredura: resultado,
    registrados: registrados.map((a) => a.id),
  });
  const depois = lerRodada(raiz, rodadaId);
  depois.superficie = resumo;
  gravarRodada(raiz, depois);
  registrar(dir, rodadaId, TIPOS_DE_EVENTO.superficieVarrida, {
    pack: rodada.pack,
    arquivos: resumo.arquivosLidos,
    rotas: resumo.rotas,
    frameworks: resumo.frameworks,
    encontrados: resumo.encontrados,
    registrados: registrados.map((a) => a.id),
    duplicados: duplicados.map((a) => a.id),
    recusados: recusados.map((r) => `${r.achado.regra} ${r.achado.arquivo}:${r.achado.linha}: ${r.erro}`),
    aConfirmar: resumo.aConfirmar,
    truncados: resultado.truncados,
    detalhe: resumo.detalhe,
    determinista: true,
  });

  return { rodada: rodadaId, resultado, registrados, duplicados, recusados, resumo };
}

/**
 * `ork audit run <pack>`: monta o prompt do pack e despacha pelo runtime adapter existente.
 *
 * A ordem das reprovacoes e deliberada: estagio, depois custo, depois policy. Um pack que
 * nem devia estar ativo nao chega a gastar janela nenhuma da assinatura.
 */
export function rodarAuditoria(
  carregado: ManifestoCarregado,
  pack: PackDeAuditoria,
  opcoes: OpcoesDeRodada = {}
): RodadaDeAuditoria {
  const { raiz, manifesto } = carregado;
  const quando = opcoes.quando ?? new Date();
  const estagio = manifesto.project.stage;
  const postura = posturaDoPack(estagio);
  const perfil = opcoes.perfil ?? manifesto.board.default;
  const produto = manifesto.project.name;
  const id = novoIdDeRodada(raiz, manifesto.project.abbrev, pack, quando);
  const dir = dirRodada(raiz, id);
  const janela = janelaDeCusto(manifesto, quando);
  const escopo = escopoDaRodada(raiz, manifesto, { since: opcoes.since, tudo: opcoes.tudo, pack });
  const effort = opcoes.effort ?? manifesto.audit?.effort ?? 'eco';

  const base: RodadaDeAuditoria = {
    versao: VERSAO_DA_RODADA,
    id,
    pack,
    perfil,
    produto,
    estagio,
    postura,
    escopo,
    custo: { janela, effort, model: opcoes.model ?? manifesto.runtime.model, autorizadaPor: null },
    runtime: manifesto.runtime.adapter,
    sessionId: null,
    slug: id,
    promptPath: path.relative(raiz, path.join(dir, 'prompt.md')),
    promptSha256: '',
    verificada: false,
    memory: manifesto.memory.mode,
    criadaEm: agora(),
    status: 'bloqueada',
    motivo: null,
    detalhe: '',
    achados: [],
    veredito: null,
  };

  const bloquear = (motivo: MotivoDeAuditoria, detalhe: string, correcao: string): RodadaDeAuditoria => {
    const rodada: RodadaDeAuditoria = { ...base, status: 'bloqueada', motivo, detalhe };
    gravarRodada(raiz, rodada);
    registrar(dir, id, TIPOS_DE_EVENTO.auditoriaBloqueada, {
      pack,
      perfil,
      estagio,
      motivo,
      detalhe,
      correcao,
      reprovaEmTodoModo: true,
    });
    return rodada;
  };

  // 1. Hardening por estagio: o pack inativo nem monta prompt.
  if (!packAtivo(pack, estagio) && !opcoes.forcar) {
    return bloquear(
      'pack.inativo-no-estagio',
      `o pack ${pack} entra a partir do estagio ${PACKS[pack].estagioMinimo}, e o produto declara stage ${estagio}`,
      `promova project.stage no manifesto, ou rode com --forcar assumindo o custo (ativos agora: ${packsAtivos(estagio).join(', ')})`
    );
  }

  // 2. Governanca de custo: fora da janela ociosa a rodada so anda com autorizacao nomeada.
  if (janela.declarada && !janela.dentro && !opcoes.agora) {
    return bloquear(
      'custo.fora-da-janela',
      janela.detalhe,
      `espere a janela ${janela.inicio}-${janela.fim}, ou autorize agora: ork audit run ${pack} --agora "<quem autoriza>"`
    );
  }
  if (opcoes.agora) base.custo.autorizadaPor = opcoes.agora;

  // 3. O prompt exato, com o mesmo hash que vai para o run.json e para o ledger.
  const prompt = montarPromptDeAuditoria(
    {
      pack,
      produto,
      perfil,
      estagio,
      postura,
      rodada: id,
      dirDaRodada: path.join(DIR_ESTADO, 'audits', id),
      escopo,
      janela,
      effort,
    },
    raiz
  );
  const sha = hashDoPrompt(prompt);
  base.promptSha256 = sha;

  // 4. As MESMAS policies do despacho de fase valem aqui: o auditor nao tem regime proprio.
  const violacoes = avaliarPolicies(manifesto, { gate: 'phase.dispatch', prompt });
  const bloqueiam = bloqueantes(violacoes);
  if (bloqueiam.length > 0) {
    return bloquear(
      'policy.violation',
      bloqueiam.map((v) => `${v.policy}: ${v.detalhe}`).join('; '),
      bloqueiam.map((v) => v.correcao).join('; ')
    );
  }

  gravar(path.join(dir, 'prompt.md'), prompt);

  if (opcoes.dryRun) {
    const rodada: RodadaDeAuditoria = {
      ...base,
      status: 'ensaio',
      detalhe: 'simulacao (--dry-run): o prompt foi montado e nada foi despachado',
    };
    gravarRodada(raiz, rodada);
    // A varredura de superficie e local e nao gasta janela nenhuma, entao ela roda ate no
    // ensaio. O que o ensaio NAO faz e gravar achado no board.
    const varredura =
      pack === PACK_DA_SUPERFICIE ? varrerSuperficieDaRodada(carregado, id, { registrar: false }) : null;
    gravar(
      path.join(dir, 'FORMATO.md'),
      formatoDosAchados(rodada, varredura ? { resultado: varredura.resultado, registrados: false } : undefined)
    );
    return varredura ? lerRodada(raiz, id) : rodada;
  }

  const resultado = adapter.despachar({
    prompt,
    nome: id,
    cwd: raiz,
    model: base.custo.model,
    effort,
  });

  if (!resultado.ok || !resultado.sessionId) {
    const rodada: RodadaDeAuditoria = {
      ...base,
      status: 'bloqueada',
      motivo: 'runtime.unavailable',
      detalhe: resultado.erro ?? 'sem sessionId na saida do runtime',
    };
    gravarRodada(raiz, rodada);
    registrar(dir, id, TIPOS_DE_EVENTO.auditoriaBloqueada, {
      pack,
      motivo: 'runtime.unavailable',
      detalhe: rodada.detalhe,
      stderr: resultado.stderr.slice(0, 500),
      comando: resultado.comando.map((c, i) => (i === 2 ? `<prompt:${sha.slice(0, 8)}>` : c)),
    });
    return rodada;
  }

  const rodada: RodadaDeAuditoria = {
    ...base,
    status: 'despachada',
    sessionId: resultado.sessionId,
    verificada: resultado.verificada,
    detalhe: `rodada despachada pelo runtime adapter ${manifesto.runtime.adapter}`,
  };
  gravarRodada(raiz, rodada);
  const varredura =
    pack === PACK_DA_SUPERFICIE ? varrerSuperficieDaRodada(carregado, id, { registrar: true }) : null;
  gravar(
    path.join(dir, 'FORMATO.md'),
    formatoDosAchados(rodada, varredura ? { resultado: varredura.resultado, registrados: true } : undefined)
  );
  registrar(dir, id, TIPOS_DE_EVENTO.auditoriaDespachada, {
    pack,
    perfil,
    produto,
    estagio,
    postura,
    sessionId: resultado.sessionId,
    runtime: manifesto.runtime.adapter,
    effort,
    model: base.custo.model,
    janela: janela.detalhe,
    autorizadaPor: base.custo.autorizadaPor,
    escopo: escopo.detalhe,
    arquivosNoEscopo: escopo.total,
    graphify: escopo.graphify,
    promptPath: rodada.promptPath,
    promptSha256: sha,
    encontrada: resultado.verificada,
    comando: resultado.comando.map((c, i) => (i === 2 ? `<prompt:${sha.slice(0, 8)}>` : c)),
    superficie: varredura ? varredura.resumo.detalhe : null,
  });
  return varredura ? lerRodada(raiz, id) : rodada;
}

// ---------------------------------------------------------------------------
// Colheita dos achados
// ---------------------------------------------------------------------------

/** Um achado como o auditor o escreve no `achados.json`. */
export interface AchadoBruto {
  regra?: string;
  severidade?: string;
  titulo?: string;
  arquivo?: string;
  descricao?: string;
  alegacao?: string;
  verificar?: string[] | string;
  impacto?: string;
  fix?: string;
  irreversivel?: string;
  estimativa?: string;
}

/** Converte o achado bruto do auditor na entrada tipada do board. */
export function entradaDoBruto(
  rodada: RodadaDeAuditoria,
  bruto: AchadoBruto
): EntradaDeAchado {
  const severidade = parseSeveridade(bruto.severidade) ?? 'menor';
  const verificar = Array.isArray(bruto.verificar)
    ? bruto.verificar
    : typeof bruto.verificar === 'string' && bruto.verificar.trim() !== ''
      ? [bruto.verificar]
      : [];
  return {
    rodada: rodada.id,
    pack: rodada.pack,
    regra: (bruto.regra ?? '').trim().toUpperCase(),
    severidade,
    titulo: bruto.titulo ?? '',
    arquivo: bruto.arquivo ?? '',
    descricao: bruto.descricao ?? '',
    alegacao: bruto.alegacao,
    verificar,
    impacto: bruto.impacto ?? '',
    fix: bruto.fix ?? '',
    estimativa: bruto.estimativa ?? '',
    irreversivel: bruto.irreversivel ?? '',
    produto: rodada.produto,
    estagio: rodada.estagio,
    postura: rodada.postura,
    memory: rodada.memory,
  };
}

/** Registra um achado da rodada no board e no ledger da rodada. */
export function registrarAchadoDaRodada(
  carregado: ManifestoCarregado,
  rodadaId: string,
  bruto: AchadoBruto
): Achado {
  const { raiz } = carregado;
  const rodada = lerRodada(raiz, rodadaId);
  // Rodada reprovada no gate (estagio, custo ou policy) nao produz achado: aceitar achado
  // aqui seria o caminho obvio para contornar o hardening por estagio pela porta dos fundos.
  if (rodada.status === 'bloqueada') {
    throw new Error(
      `a rodada ${rodadaId} esta BLOQUEADA (motivo tipado: ${rodada.motivo}) e nao registra achado. ` +
        `Detalhe: ${rodada.detalhe}`
    );
  }
  const entrada = entradaDoBruto(rodada, bruto);
  // Idempotencia: o proprio prompt manda o auditor rodar `ork audit ingest`, entao a
  // ingestao roda de novo toda vez que alguem reprocessa o `achados.json`. Sem esta
  // guarda, a segunda passada duplicaria os achados e inflaria a recorrencia por regra,
  // que e exatamente o numero que propoe promover uma policy para bloqueante.
  const duplicado = acharDuplicado(achadosDaRodada(raiz, rodadaId), entrada);
  if (duplicado) {
    throw new Error(
      `achado.duplicado-na-rodada: a rodada ${rodadaId} ja registrou este achado como ` +
        `${duplicado.id} (${duplicado.regra} em ${duplicado.arquivo}${duplicado.linha !== null ? ':' + duplicado.linha : ''})`
    );
  }
  const achado = registrarAchado(raiz, entrada);
  rodada.achados = [...new Set([...rodada.achados, achado.id])];
  gravarRodada(raiz, rodada);
  const dir = dirRodada(raiz, rodadaId);
  registrar(dir, rodadaId, TIPOS_DE_EVENTO.achadoRegistrado, {
    achado: achado.id,
    pack: achado.pack,
    regra: achado.regra,
    severidade: achado.severidade,
    arquivo: `${achado.arquivo}${achado.linha !== null ? ':' + achado.linha : ''}`,
    claim: achado.claim.id,
    negativa: achado.claim.negativa,
    verificar: achado.claim.verificar,
    estado: achado.claim.estado,
  });
  registrar(dir, rodadaId, TIPOS_DE_EVENTO.propostaGravada, {
    achado: achado.id,
    destino: achado.proposta.destino,
    regime: achado.proposta.regime,
    impacto: achado.proposta.impacto,
    estimativa: achado.proposta.estimativa,
    passoIrreversivel: achado.proposta.passoIrreversivel,
  });
  return achado;
}

export interface ResultadoDaIngestao {
  rodada: string;
  registrados: Achado[];
  /** Achados que a rodada ja tinha: a ingestao e idempotente, nao acumula. */
  duplicados: Achado[];
  recusados: { indice: number; erro: string }[];
}

/** `ork audit ingest`: registra em lote os achados que o auditor escreveu. */
export function ingerirAchados(
  carregado: ManifestoCarregado,
  rodadaId: string,
  arquivo: string
): ResultadoDaIngestao {
  const { raiz } = carregado;
  lerRodada(raiz, rodadaId);
  const caminho = path.isAbsolute(arquivo) ? arquivo : path.resolve(raiz, arquivo);
  if (!fs.existsSync(caminho)) {
    throw new Error(`arquivo de achados nao encontrado: ${caminho}`);
  }
  const conteudo = lerJson<{ achados?: AchadoBruto[] } | AchadoBruto[]>(caminho);
  const brutos = Array.isArray(conteudo) ? conteudo : (conteudo.achados ?? []);
  const registrados: Achado[] = [];
  const duplicados: Achado[] = [];
  const recusados: { indice: number; erro: string }[] = [];
  brutos.forEach((bruto, i) => {
    const rodada = lerRodada(raiz, rodadaId);
    const jaTinha = acharDuplicado(achadosDaRodada(raiz, rodadaId), entradaDoBruto(rodada, bruto));
    if (jaTinha) {
      duplicados.push(jaTinha);
      return;
    }
    try {
      registrados.push(registrarAchadoDaRodada(carregado, rodadaId, bruto));
    } catch (e) {
      recusados.push({ indice: i, erro: (e as Error).message });
    }
  });
  return { rodada: rodadaId, registrados, duplicados, recusados };
}

// ---------------------------------------------------------------------------
// O auditor sujeito a claims
// ---------------------------------------------------------------------------

/**
 * `ork audit verify`: reexecuta no HEAD real a claim de cada achado da rodada.
 *
 * Chama a MESMA `verificarClaim` do `ork verify`. Nao existe julgamento de claim proprio da
 * auditoria: a alegacao negativa sem comando reprova aqui como reprova numa fase, e a claim
 * positiva sem comando avisa sem bloquear, como no gate do B1.
 */
export function verificarRodada(
  carregado: ManifestoCarregado,
  rodadaId: string
): VereditoDeAuditoria {
  const { raiz } = carregado;
  const rodada = lerRodada(raiz, rodadaId);
  const cwd = raiz;
  const commit = commitReal(cwd);
  // Achado descartado (nao procedia) e achado resolvido (divida paga) saem da reexecucao:
  // no primeiro caso nao ha o que provar, e no segundo a claim REPROVARIA justamente porque
  // o defeito foi corrigido, o que seria o veredito errado sobre o auditor.
  const achados = achadosDaRodada(raiz, rodadaId).filter(
    (a) => a.estado !== 'descartado' && a.estado !== 'resolvido'
  );
  const resultados: ResultadoDeClaim[] = achados.map((a) => verificarClaim(a.claim, cwd));

  for (let i = 0; i < achados.length; i++) {
    const r = resultados[i];
    const estado = r.verificado
      ? 'verificado'
      : r.motivo === 'claims.unverifiable'
        ? 'nao-verificavel'
        : 'reprovado';
    if (achados[i].claim.estado !== estado) {
      carimbarAchado(raiz, achados[i], { claim: { ...achados[i].claim, estado } });
    }
  }

  const motivos: MotivoDeAuditoria[] = [];
  if (resultados.some((r) => r.motivo === 'claims.failed')) motivos.push('claims.failed');
  if (resultados.some((r) => r.motivo === 'claims.unverifiable')) motivos.push('claims.unverifiable');
  // `claims.unverifiable` avisa e nao bloqueia, igual ao gate do B1.
  const ok = !motivos.includes('claims.failed');

  const veredito: VereditoDeAuditoria = {
    rodada: rodadaId,
    commit,
    cwd,
    resultados,
    motivos,
    ok,
    verificadoEm: agora(),
  };
  rodada.veredito = veredito;
  if (rodada.status !== 'relatada') rodada.status = 'verificada';
  gravarRodada(raiz, rodada);
  registrar(dirRodada(raiz, rodadaId), rodadaId, TIPOS_DE_EVENTO.auditoriaVerificada, {
    pack: rodada.pack,
    commit,
    achados: achados.length,
    claims: resultados.map((r) => ({
      id: r.claim.id,
      verificado: r.verificado,
      motivo: r.motivo,
      detalhe: r.detalhe,
    })),
    motivos,
    veredito: ok ? 'achados sustentados' : 'reprovado',
  });
  return veredito;
}

// ---------------------------------------------------------------------------
// O relatorio, com o bloco obrigatorio de propostas
// ---------------------------------------------------------------------------

export interface ResultadoDoRelatorio {
  rodada: RodadaDeAuditoria;
  texto: string;
  caminho: string;
  /** Copia publicada em `docs/audit/`, quando `--publicar`. */
  publicado: string | null;
  propostas: number;
}

/** Caminho do relatorio da rodada dentro do estado. */
export function caminhoRelatorio(raiz: string, id: string): string {
  return path.join(dirRodada(raiz, id), 'RELATORIO.md');
}

/**
 * O relatorio da rodada.
 *
 * O bloco "PROPOSTAS DE AJUSTE PARA O ROADMAP" e obrigatorio e sempre existe: com achados,
 * ele lista as propostas; sem achados, ele diz que a rodada nao produziu proposta nenhuma.
 * Lacuna publicada como lacuna, nunca omitida.
 */
export function relatorioDaRodada(
  carregado: ManifestoCarregado,
  rodadaId: string,
  opcoes: { publicar?: boolean } = {}
): ResultadoDoRelatorio {
  const { raiz } = carregado;
  const rodada = lerRodada(raiz, rodadaId);
  const achados = achadosDaRodada(raiz, rodadaId);
  const pack = PACKS[rodada.pack];
  const L: string[] = [];

  L.push(`# Auditoria ${rodada.pack} do produto ${rodada.produto} (rodada ${rodada.id})`);
  L.push('');
  L.push('## Contexto da rodada');
  L.push('');
  L.push(`- pack: ${pack.id} (${pack.titulo}), ${pack.regras.length} regras`);
  L.push(`- perfil: ${rodada.perfil}`);
  L.push(`- estagio do produto: ${rodada.estagio}`);
  L.push(`- postura: ${rodada.postura} (${DESCRICAO_DA_POSTURA[rodada.postura]})`);
  L.push(`- escopo: ${rodada.escopo.detalhe}`);
  L.push(`- Graphify: ${rodada.escopo.graphify}`);
  L.push(`- custo: effort ${rodada.custo.effort}, model ${rodada.custo.model}, ${rodada.custo.janela.detalhe}`);
  if (rodada.custo.autorizadaPor) {
    L.push(`- rodada fora da janela ociosa AUTORIZADA por: ${rodada.custo.autorizadaPor}`);
  }
  L.push(`- runtime: ${rodada.runtime}, sessao ${rodada.sessionId ?? '(nao despachada)'}`);
  if (rodada.superficie) {
    const sup = rodada.superficie;
    L.push(
      `- varredura deterministica de superficie de rede (SP8..SP12): ${sup.detalhe}` +
        `; frameworks: ${sup.frameworks.length > 0 ? sup.frameworks.join(', ') : '(nenhum reconhecido)'}` +
        `; registrados no board: ${sup.registrados}` +
        (sup.aConfirmar > 0 ? `; ${sup.aConfirmar} com confianca baixa (pedem confirmacao humana)` : '')
    );
  }
  L.push(`- prompt: ${rodada.promptPath} (sha256 ${rodada.promptSha256})`);
  L.push(`- status: ${rodada.status}${rodada.motivo ? ` (motivo tipado: ${rodada.motivo})` : ''}`);
  L.push('');

  L.push('## Achados');
  L.push('');
  if (achados.length === 0) {
    L.push('Nenhum achado registrado nesta rodada.');
  }
  for (const a of achados) {
    L.push(`### ${a.id} [${a.severidade}] ${a.regra}: ${a.titulo}`);
    L.push('');
    L.push(`- evidencia: \`${a.arquivo}${a.linha !== null ? ':' + a.linha : ''}\``);
    if (a.descricao) L.push(`- descricao: ${a.descricao}`);
    L.push(`- claim ${a.claim.id} (${a.claim.estado}${a.claim.negativa ? ', negativa' : ''}): ${a.claim.alegacao}`);
    L.push(
      `- reexecucao: ${a.claim.verificar.length > 0 ? '`' + a.claim.verificar.join(' && ') + '`' : 'NAO DECLARADA pelo auditor'}`
    );
    L.push(`- estado no board: ${a.estado}${a.thread ? ` (thread ${a.thread})` : ''}`);
    L.push('');
  }

  // O bloco obrigatorio. Ele existe em toda rodada, com ou sem achado.
  L.push(`## PROPOSTAS DE AJUSTE PARA O ROADMAP DE ${rodada.produto.toUpperCase()}`);
  L.push('');
  L.push(
    'Bloco obrigatorio da rodada (visao, secao 5.1). Nenhuma correcao foi aplicada: cada item ' +
      'abaixo e proposta enderecada ao roadmap do produto, para o humano decidir o que vira thread.'
  );
  L.push('');
  // Achado resolvido (divida paga) e descartado (nao procedia) saem do bloco de propostas:
  // o bloco e a fila do roadmap, e nao o historico da rodada, que fica em "Achados".
  const propostas = achados.filter((a) => a.estado !== 'resolvido' && a.estado !== 'descartado');
  const fechados = achados.filter((a) => a.estado === 'resolvido' || a.estado === 'descartado');
  if (propostas.length === 0) {
    L.push(
      achados.length === 0
        ? '**Nenhuma proposta nesta rodada.** A rodada nao produziu achado, entao nao ha ajuste a propor.'
        : '**Nenhuma proposta em aberto.** Todos os achados desta rodada ja foram resolvidos ou descartados.'
    );
  } else {
    L.push('| # | achado | evidencia | impacto | fix sugerido | passo irreversivel | estimativa | estado |');
    L.push('|---|---|---|---|---|---|---|---|');
    propostas.forEach((a, i) => {
      const evidencia = `${a.arquivo}${a.linha !== null ? ':' + a.linha : ''}`;
      L.push(
        `| ${i + 1} | ${a.id} ${a.titulo} | \`${evidencia}\` | ${a.proposta.impacto} | ` +
          `${a.proposta.fix} | ${a.proposta.passoIrreversivel} | ${a.proposta.estimativa} | ${a.estado} |`
      );
    });
    const abertos = propostas.filter((a) => a.estado === 'aberto');
    if (abertos.length > 0) {
      L.push('');
      L.push('Abrir a thread de qualquer uma delas, com a evidencia junto e sem retrabalho:');
      L.push('');
      L.push('```bash');
      for (const a of abertos) {
        L.push(`ork thread new "${a.titulo.slice(0, 40)}" --from-finding ${a.id}`);
      }
      L.push('```');
    }
  }
  if (fechados.length > 0) {
    L.push('');
    L.push(
      `Fora do bloco por ja estarem fechados: ` +
        fechados.map((a) => `${a.id} (${a.estado})`).join(', ') + '.'
    );
  }
  L.push('');

  L.push('## Destino das propostas');
  L.push('');
  L.push(`- regime de memoria declarado: \`${rodada.memory}\``);
  L.push(`- board de divida: \`.orkastery/divida/board.jsonl\` (consulta: \`ork audit divida\`)`);
  L.push(
    rodada.memory === 'orkmind'
      ? '- colecao `roadmap` do OrkMind: gravacao chega no bloco B6.'
      : '- colecao `roadmap` do OrkMind: NAO gravada, porque `memory: files`. Degradacao honesta, nao omissao.'
  );
  L.push('');

  L.push('## Veredito das claims do auditor');
  L.push('');
  if (!rodada.veredito) {
    L.push(`Ainda nao verificado. Rode: \`ork audit verify ${rodada.id}\``);
    L.push('');
    L.push('O auditor NAO tem direito a self-report: enquanto as claims dos achados nao forem');
    L.push('reexecutadas no HEAD real, nenhum achado desta rodada pode virar thread.');
  } else {
    const v = rodada.veredito;
    L.push(`- HEAD real: ${v.commit}`);
    L.push(`- verificado em: ${formatarDataHoraRotulada(v.verificadoEm)}`);
    L.push(`- veredito: ${v.ok ? 'ACHADOS SUSTENTADOS' : 'REPROVADO'}`);
    L.push(`- motivos tipados: ${v.motivos.length > 0 ? v.motivos.join(', ') : '(nenhum)'}`);
    L.push('');
    for (const r of v.resultados) {
      L.push(
        `  - ${r.claim.id}: ${r.verificado ? 'verificado' : 'NAO verificado'}` +
          `${r.motivo ? ` (${r.motivo})` : ''} - ${r.detalhe}`
      );
    }
  }
  L.push('');

  const texto = L.join('\n') + '\n';
  const caminho = caminhoRelatorio(raiz, rodadaId);
  gravar(caminho, texto);

  let publicado: string | null = null;
  if (opcoes.publicar) {
    publicado = path.join(raiz, 'docs', 'audit', `${rodada.id}.md`);
    gravar(publicado, texto);
  }

  rodada.status = 'relatada';
  gravarRodada(raiz, rodada);
  registrar(dirRodada(raiz, rodadaId), rodadaId, TIPOS_DE_EVENTO.relatorioGerado, {
    pack: rodada.pack,
    achados: achados.length,
    propostas: propostas.length,
    relatorio: path.relative(raiz, caminho),
    publicado: publicado ? path.relative(raiz, publicado) : null,
    regime: rodada.memory,
  });

  return { rodada, texto, caminho, publicado, propostas: propostas.length };
}

// ---------------------------------------------------------------------------
// Saidas do CLI
// ---------------------------------------------------------------------------

/** Tabela de `ork audit list`. */
export function tabelaDeRodadas(raiz: string): string {
  const ids = listarRodadas(raiz);
  if (ids.length === 0) {
    return 'Nenhuma rodada de auditoria em .orkastery/audits. Rode: ork audit run <pack>';
  }
  const linhas = ids.map((id) => {
    const r = lerRodada(raiz, id);
    return [
      r.id,
      r.pack,
      r.perfil,
      r.estagio,
      r.status,
      r.motivo ?? '-',
      String(r.achados.length),
      r.veredito ? (r.veredito.ok ? 'sustentado' : 'REPROVADO') : 'nao verificado',
      r.escopo.since ?? 'total',
    ];
  });
  return tabela(
    ['RODADA', 'PACK', 'PERFIL', 'ESTAGIO', 'STATUS', 'MOTIVO', 'ACHADOS', 'CLAIMS', 'ESCOPO'],
    linhas
  );
}

/** Texto de `ork audit show`. */
export function textoDaRodada(raiz: string, id: string): string {
  const r = lerRodada(raiz, id);
  const achados = achadosDaRodada(raiz, id);
  const L: string[] = [];
  L.push(`Rodada de auditoria ${r.id}`);
  L.push(`  pack        ${r.pack} (${PACKS[r.pack].titulo})`);
  L.push(`  produto     ${r.produto} (perfil ${r.perfil})`);
  L.push(`  estagio     ${r.estagio}, postura ${r.postura}`);
  L.push(`  escopo      ${r.escopo.detalhe}`);
  L.push(`  graphify    ${r.escopo.graphify}`);
  L.push(`  custo       effort ${r.custo.effort}, model ${r.custo.model}`);
  L.push(`  janela      ${r.custo.janela.detalhe}`);
  if (r.custo.autorizadaPor) L.push(`  autorizada  fora da janela por ${r.custo.autorizadaPor}`);
  L.push(`  runtime     ${r.runtime}, sessao ${r.sessionId ?? '(nao despachada)'}`);
  L.push(`  prompt      ${r.promptPath} (sha256 ${r.promptSha256 || '(nao montado)'})`);
  L.push(`  status      ${r.status}${r.motivo ? ` (motivo tipado: ${r.motivo})` : ''}`);
  if (r.superficie) {
    L.push(`  superficie  ${r.superficie.detalhe}`);
    L.push(
      `              registrados ${r.superficie.registrados}, a confirmar ${r.superficie.aConfirmar}, ` +
        `frameworks: ${r.superficie.frameworks.join(', ') || '(nenhum reconhecido)'}`
    );
  }
  if (r.detalhe) L.push(`  detalhe     ${r.detalhe}`);
  L.push('');
  L.push(`  Achados (${achados.length}):`);
  if (achados.length === 0) L.push('    (nenhum achado registrado nesta rodada ainda)');
  for (const a of achados) L.push(textoDoAchado(a));
  L.push('');
  if (r.veredito) {
    L.push(
      `  Claims do auditor: ${r.veredito.ok ? 'SUSTENTADAS' : 'REPROVADAS'} ` +
        `(motivos: ${r.veredito.motivos.join(', ') || 'nenhum'}) no HEAD ${shaCurto(r.veredito.commit)}`
    );
  } else {
    L.push(`  Claims do auditor: NAO verificadas. Rode: ork audit verify ${r.id}`);
  }
  L.push('');
  L.push(`  Relatorio com o bloco de propostas: ork audit report ${r.id}`);
  return L.join('\n');
}

/** Ledger de uma rodada, para `ork audit show --ledger`. */
export function tabelaDoLedgerDaRodada(raiz: string, id: string): string {
  lerRodada(raiz, id);
  const eventos = lerLedger(dirRodada(raiz, id));
  if (eventos.length === 0) return `Ledger vazio para a rodada ${id}.`;
  const linhas = eventos.map((e) => {
    const detalhe: string[] = [];
    if (e.pack) detalhe.push(String(e.pack));
    if (e.achado) detalhe.push(`achado ${String(e.achado)}`);
    if (e.motivo) detalhe.push(`motivo ${String(e.motivo)}`);
    if (e.sessionId) detalhe.push(`sessao ${String(e.sessionId).slice(0, 8)}`);
    if (e.veredito) detalhe.push(`veredito: ${String(e.veredito)}`);
    if (e.destino) detalhe.push(`destino ${String(e.destino)}`);
    // `e.thread` e o dono do evento, que aqui e a propria rodada: so vale imprimir quando
    // for OUTRO id, que e o caso do evento finding_to_thread.
    if (e.thread && e.thread !== id) detalhe.push(`thread ${String(e.thread)}`);
    if (e.detalhe) detalhe.push(localizarTexto(String(e.detalhe)).slice(0, 90));
    return [formatarDataHora(e.ts, { segundos: true }), e.tipo, detalhe.join(' | ')];
  });
  return `${tabela(['QUANDO', 'EVENTO', 'DETALHE'], linhas)}\n${legendaDoFuso()}`;
}

/** Quantos achados abertos existem por pack, para o resumo do CLI. */
export function resumoDoBoard(raiz: string): string {
  const board = lerBoard(raiz);
  if (board.length === 0) return 'board de divida vazio';
  const abertos = board.filter((a) => a.estado === 'aberto').length;
  return `${board.length} achado(s) no board de divida, ${abertos} aberto(s)`;
}

// ---------------------------------------------------------------------------
// `ork thread new --from-finding <id>`: o achado vira thread sem retrabalho
// ---------------------------------------------------------------------------

export interface ResultadoDoFromFinding {
  ok: boolean;
  achado: Achado;
  thread: import('./types').Thread | null;
  /** O texto de GOAL ja montado a partir do achado. */
  pedido: string;
  motivo: MotivoDeAuditoria | null;
  detalhe: string;
  correcao: string;
}

/**
 * Abre a thread que nasce de um achado de auditoria.
 *
 * Duas recusas tipadas, e as duas existem pela mesma razao: o auditor nao tem direito a
 * self-report. Um achado cuja claim ainda nao foi reexecutada no HEAD real, ou que foi
 * reexecutada e REPROVOU, nao pode virar trabalho, porque a evidencia que abriria a thread
 * nao existe. Claim `nao-verificavel` apenas AVISA e deixa passar, exatamente como o gate
 * do B1 trata `claims.unverifiable`.
 */
export function abrirThreadDoAchado(
  carregado: ManifestoCarregado,
  achadoId: string,
  opcoes: {
    nome?: string;
    modo?: import('./types').Modo;
    slug?: string;
    assunto?: string;
    criarWorktree?: boolean;
    worktree?: string | null;
    variante?: import('./types').VarianteDeCiclo | null;
    dryRun?: boolean;
  } = {}
): ResultadoDoFromFinding {
  const { raiz, manifesto } = carregado;
  const achado = exigirAchado(raiz, achadoId);
  const pedido = pedidoDoAchado(achado);

  if (achado.estado === 'virou-thread' && achado.thread) {
    return {
      ok: false,
      achado,
      thread: null,
      pedido,
      motivo: 'achado.ja-virou-thread',
      detalhe: `o achado ${achado.id} ja originou a thread ${achado.thread}`,
      correcao: `continue naquela thread: ork thread status ${achado.thread}`,
    };
  }
  if (achado.claim.estado === 'pendente') {
    return {
      ok: false,
      achado,
      thread: null,
      pedido,
      motivo: 'claims.failed',
      detalhe:
        `a claim ${achado.claim.id} do achado ainda nao foi reexecutada no HEAD real: ` +
        'o auditor nao tem direito a self-report',
      correcao: `prove o achado antes de abrir trabalho: ork audit verify ${achado.rodada}`,
    };
  }
  if (achado.claim.estado === 'reprovado') {
    return {
      ok: false,
      achado,
      thread: null,
      pedido,
      motivo: 'claims.failed',
      detalhe: `a claim ${achado.claim.id} do achado REPROVOU na reexecucao no HEAD real`,
      correcao:
        'o achado nao se sustenta: corrija a evidencia na rodada, ou descarte o achado, em vez de abrir thread sobre ele',
    };
  }

  const modo = opcoes.modo ?? manifesto.conduction.default_mode;
  const { thread, gravada } = novaThread(carregado, {
    nome: opcoes.nome ?? achado.titulo,
    modo,
    slug: opcoes.slug,
    assunto: opcoes.assunto,
    worktree: opcoes.worktree ?? null,
    criarWorktree: opcoes.criarWorktree,
    dryRun: opcoes.dryRun,
    variante: opcoes.variante ?? null,
  });

  if (!gravada) {
    return {
      ok: true,
      achado,
      thread,
      pedido,
      motivo: null,
      detalhe: 'simulacao (--dry-run): nenhuma thread e nenhum carimbo no board foram gravados',
      correcao: '',
    };
  }

  // A evidencia viaja junto e continua sob verificacao: a claim do achado vira claim da
  // thread pelo caminho normal (`ork claims add`), sem uma segunda regra de claim.
  const claimNaThread = adicionarClaim(raiz, thread.id, {
    arquivo: achado.claim.arquivo,
    alegacao: achado.claim.alegacao,
    verificar: achado.claim.verificar,
    fase: 'GOAL',
  });

  // O pedido pronto vai para arquivo, e nao so para a tela: o proximo comando do operador
  // e `--prompt "$(cat .../pedido-goal.md)"`, sem copiar e colar dez linhas de evidencia.
  gravar(path.join(dirThread(raiz, thread.id), 'pedido-goal.md'), pedido + '\n');
  gravarJson(path.join(dirThread(raiz, thread.id), 'achado.json'), {
    versao: 1,
    origem: {
      achado: achado.id,
      rodada: achado.rodada,
      pack: achado.pack,
      regra: achado.regra,
      severidade: achado.severidade,
      produto: achado.produto,
      estagio: achado.estagio,
      postura: achado.postura,
    },
    evidencia: `${achado.arquivo}${achado.linha !== null ? ':' + achado.linha : ''}`,
    proposta: achado.proposta,
    claimNoAchado: achado.claim,
    claimNaThread: claimNaThread.id,
    pedidoDeGoal: pedido,
  });

  registrar(dirThread(raiz, thread.id), thread.id, TIPOS_DE_EVENTO.achadoVirouThread, {
    achado: achado.id,
    rodada: achado.rodada,
    pack: achado.pack,
    regra: achado.regra,
    severidade: achado.severidade,
    evidencia: `${achado.arquivo}${achado.linha !== null ? ':' + achado.linha : ''}`,
    claimNoAchado: achado.claim.id,
    claimNaThread: claimNaThread.id,
    proposta: achado.proposta.fix,
    passoIrreversivel: achado.proposta.passoIrreversivel,
    estimativa: achado.proposta.estimativa,
  });
  registrar(dirRodada(raiz, achado.rodada), achado.rodada, TIPOS_DE_EVENTO.achadoVirouThread, {
    achado: achado.id,
    thread: thread.id,
    slug: thread.slug,
    modo,
  });

  carimbarAchado(raiz, achado, { estado: 'virou-thread', thread: thread.id });

  return {
    ok: true,
    achado,
    thread,
    pedido,
    motivo: achado.claim.estado === 'nao-verificavel' ? 'claims.unverifiable' : null,
    detalhe:
      achado.claim.estado === 'nao-verificavel'
        ? `AVISO: a claim ${achado.claim.id} do achado nao tem comando de verificacao (motivo tipado claims.unverifiable, que avisa e nao bloqueia)`
        : `achado ${achado.id} aberto como thread ${thread.id}, com a evidencia e a claim junto`,
    correcao: '',
  };
}
