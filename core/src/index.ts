#!/usr/bin/env node
import { runBrain } from './company-brain-cli';
import { ID_DE_DOCUMENTO, NOME_DE_COLECAO } from './conhecimento';
import { CONSULTAS_DO_CONHECIMENTO, consultaRespondeu, consultarConhecimento, PedidoDoConhecimento, textoDoConhecimento } from './conhecimento-consulta';
import { raizDoEstado } from './estado-thread';
import { checarAnalisadoresDoGrafo, executarGrafo } from './intelligence-graph-cli';
import { executarSecurityScan } from './security-scan/cli';
import { lerModo } from './check-modo';
import { lerEntradaDaThread } from './mcp-grafo';
import { runMaestroCli } from './maestro-cli';
import { publicHitlVerifiers } from './hitl-public-receipt';
import { apresentarDecisao, ofertaDoPedido, prazoLocalDoPedido } from './hitl-presentation';
import { desdeDoPedido, entradaDoPedido, montarPedidoCurto, textoDoPedidoCurto } from './hitl-curto';
import { montarStatusDoRoadmap, textoDoStatusDoRoadmap } from './roadmap-status';
import { exigirNotaSemHost, marcaDeHost, pedirNota, textoDoPedidoDeNota } from './master-nota';
import { readNativeOfferStdin } from './hitl-native-offer';
import { prepararRecibosParaDespacho } from './hitl-ingress-receipt';
import { isAbsolute } from 'node:path';
import { memoryState } from './project-state';
import { abrirPedidoSessao, reconciliarEnvioDeSessao, responderSessao, superarSessao } from './hitl-sessions';
import { comandoAtivacao, exigirAtivacao, PerfilPublicacao } from './write-activation';
import { validarDiretorioDeThread } from './escopo-escrita';
import { userInfo } from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CreationActor, compensateCreation, resumeCreation, startCreation } from './creation-operation';
import { listCreationOperations, readCreationOperation } from './creation-operation-store';
import { inspectPortfolio } from './portfolio-context';
/**
 * `ork`: nucleo CLI deterministico do Orkastery (bloco B0).
 *
 * Sem LLM embutido: o `ork` monta prompt, despacha pelo runtime adapter, verifica no
 * mundo real e registra no ledger. Quem escreve codigo e a orquestra (Camada 3);
 * quem decide e o humano; o meio e conduzido por software.
 */

import { fecharAdministrativamente, registrarArtefato } from './thread-close';
import { ingerirEvento, lerPayloadSensor } from './session-events';
import { iniciarWatcher, observarSessao } from './session-watcher';
import { migrarMaster } from './master-migracao';
import { listarBatch, ratificarBatch, SelecaoMaster } from './master-batch';
import { enviarDigest, montarDigest, responderLoteDigest } from './master-digest';
import { auditarMaster } from './master-audit';
import { auditarProcesso } from './process-audit';
import { proporMaster } from './master';
import {
  DESCRICAO_DO_MOTIVO_DE_AUDITORIA,
  ORDEM_DOS_PACKS,
  PACKS,
  carregarTemplatesDeAuditoria,
  escopoDaRodada,
  janelaDeCusto,
  lintTemplateDeAuditoria,
  montarPromptDeAuditoria,
  packsAtivos,
  parseEstagio,
  parsePack,
  posturaDoPack,
  tabelaDePacks,
  templateDoPack,
  textoDoPack,
} from './auditoria';
import {
  abrirThreadDoAchado,
  ingerirAchados,
  registrarAchadoDaRodada,
  relatorioDaRodada,
  resumoDoBoard,
  rodarAuditoria,
  tabelaDeRodadas,
  tabelaDoLedgerDaRodada,
  textoDaRodada,
  varrerSuperficieDaRodada,
  verificarRodada,
} from './auditrun';
import {
  REGRAS_DE_SUPERFICIE,
  RegraDeSuperficie,
  textoDaVarredura,
  varrerSuperficie,
} from './superficie';
import { devolverVagas, textoDoBoard, textoDoPlano, textoDoReap, planejar, threadsDeTodosOsPerfis } from './board';
import { textoDoRadar, varrerSessoes } from './hitl';
import { filaDoDono, montarPulse, textoDoPulse } from './pulse';
import { codigosEmUso, interpretarRespostaDoPulse, responderPeloPulse } from './pulse-resposta';
import { referenciaDoReplyValida } from './pulse-consentimento';
import { CADENCIAS, gravarCadencia, inicioDaProximaJanela, lerCadencia, textoDaCadencia } from './pulse-cadencia';
import { LIMIAR_DE_DECISOES_POR_FASE, placarDaThread, registrarDecisao, taxaDeReversao } from './decisao-autonoma';
import { PedidoHitlQualquer, TipoDeCriterio, CAMPOS_DA_DECISAO_NO_CLI, recusaNaSuperficie } from './hitl-contract';
import { montarMonitor, textoDoMonitor } from './orquestracao';
import {
  carimbarAchado,
  exigirAchado,
  parseEstadoDeAchado,
  tabelaDaDivida,
  textoDoAchado,
} from './divida';
import { definicaoDaVariante, parseVariante, tabelaDeVariantes, VARIANTES } from './ciclos';
import { adicionarClaim, anexarComando, retirarClaim, tabelaDeClaims } from './claims';
import { conferirClaims, ErroDeConferencia, FORMATO_DA_CONFERENCIA, idsDeClaims, textoDaConferencia } from './claims-conferir';
import { exigirCatalogoDoPacote } from './catalogo';
import { doctor, doctorJson } from './doctor';
import { checarForja } from './doctor-forja';
import { endurecerUmask, preflight, textoPreflight } from './preflight';
import { rodarEval, textoDoEval } from './evalrunner';
import { aprovarGateHumano } from './gates';
import { abrirPedidoGate, contextoDoPedidoNativo, lerRespostaStdin, responderGate } from './hitl-gates';
import { exportarHandoff, recall, textoDoHandoff } from './handoff';
import {
  destinoPadraoDe,
  instalarAdaptador,
  ORDEM_DOS_HOSTS,
  parseHost,
  tabelaDeHosts,
  textoDaInstalacao,
  textoDosPitfalls,
} from './hosts';
import { exigirRepositorioParaInit, init } from './init';
import { createInitiative, createProduct, createProject, findEntity, listEntities, PortfolioKind, PortfolioStatus, readPortfolio } from './portfolio';
import { atualizarAgentsMd } from './agents-md';
import { adquirirRegiao, liberar, tabelaDeLeases } from './leases';
import { inventariarSessoes } from './sessoes-inventario';
import { coletarEstatisticas, registrarEstimativaPlano, textoDasEstatisticas } from './ledger-stats';
import { relatorioDeEsgotamentos, textoDosEsgotamentos } from './esgotamentos';
import { adotarSessao } from './sessoes-adopt';
import { textoDoInventario } from './sessoes';
import { ENV_THREAD_DO_DESPACHO, ENVS_DE_PROVIDER_PAGO, nomesDeProviderAtivos } from './runtime-ambiente';
import { avaliarPolicies, linhasDeAviso, severidadeDeclarada } from './policies';
import {
  aceitarPendentesPorOmissao,
  aceitosPorOmissao,
  entregasParaOmissao,
  indiceDaThread,
  motivoForaDaOmissao,
  ORDEM_DAS_CLASSES,
  parseClasse,
  registrarMaster,
  tabelaDeClasses,
  tabelaDeEntregas,
  textoDoMaster,
} from './master';
import { carregarManifesto, configDeEmbedding, DIR_ESTADO, diretorioDoProjeto, exigirManifesto, ManifestoCarregado } from './manifest';
import { formatarDataHora, formatarDataHoraRotulada, fusoDoManifesto, legendaDoFuso, localizarTextoRotulado,
  registrarFonteDoFuso } from './horario';
import { gravarEtapa, lerOnboarding, resetarOnboarding, textoDaPauta, validarPedidoDeEtapa } from './onboarding';
import { resolverExperiencia } from './experiencia';
import { desinstalarExperiencia } from './hosts';
import { ativarLocale, cobreLocale, comLocale, ErroDoCatalogo, ligarRemontagem, linguaDeclaradaDoDono, Locale, localeAtivo, mensagemDoErro, msg, remontar, resolverLocale, textoDoCatalogo } from './locale';
import { DadosDaAjuda } from './locale-ajuda';
import {
  abrirMemoria,
  sondarEmbeddings,
  publicar,
  publicarPropostas,
  ResultadoDoSync,
  sincronizarMemoria,
  sincronizarOnboarding,
  textoDoEstado,
  textoDoSync,
} from './memoria';
import { chaveDeEmbeddingAceita, COLECOES_DO_ORK, configDoManifesto, criarEscopoDeLeitura, DriverCliOrkMind, textoDeBuscaValido, validarConsultaDelimitada, LIMITE_CONSULTA_PADRAO } from './orkmind';
import { AlvoDeEmbedding, codigoDaFalha, indexar, ResultadoDoIndice, textoDoIndice, universoDaBusca } from './indice-vetorial';
import { buscarPorSignificado, textoDaBuscaPorSignificado, LIMITE_MAXIMO_DA_BUSCA, LIMITE_PADRAO_DA_BUSCA, ModoDeBusca, MODOS_DE_BUSCA, ResultadoDaBuscaSemantica } from './busca-semantica';
import { recallDaThread, textoDoRecall } from './recall';
import { inventariarHandoffs, migrarHandoffs } from './memory-migration';
import {
  abrirRodada,
  correcoesDaRodada,
  reverificar,
  textoDaRodada as textoDaRodadaDeFix,
  textoDoReverify,
  ultimaRodada,
} from './fix';
import { faltaPara, lerFilaDeRetomada, parseRateLimit, tabelaDaFila } from './ratelimit';
import {
  cancelarPedido,
  executarRetry,
  POLITICA_DE_RETRY,
  planejarRetry,
  retomarFila,
  retomarPorId,
  tabelaDaPolitica,
  textoDaRetomada,
  textoDoPlano as textoDoPlanoDeRetry,
  textoDoRetry,
} from './retry';
import { registrarProvaAusente } from './prova-minima';
import { VERSAO_DO_ORK } from './versao';
import { comandoNoctum } from './noctum-cli';
import { RecusaDoArco } from './noctum-envelope';
import { aceitarModoNoctum, ehModoNoctum, recusaDoModoNaThread, tagNoctumNoPedido } from './noctum-modo';
import { exigirModoVivo, extrairTagAposentadaDoPedido, extrairTagDoPedido, MODOS, ORDEM_DOS_MODOS,
  parseModo, pausasDoModo, recusaDeModoAposentado, tabelaDeModos } from './modos';
import { migrarModosAposentados, textoDaMigracaoModos } from './modos-migracao';
import { editarBloco, lerSetup, resetarSetup, textoDaEntrevista, textoDoSetup, versionarSetup } from './setup';
import {
  adicionarPerfil, desativarPerfil, expirarPerfisVencidos, lerPerfis, lerPerfisComContas, linhasDePerfis,
  marcarFalhaDePerfil, perfilDeDespacho, PerfilDeDespacho, perfisComHorario, prepararDiretorioDoPerfil, reativarPerfil,
  registrarConferenciaInconclusiva, tipoDeLimiteDoPerfil, VARIAVEL_DO_PERFIL,
} from './runtime-profiles';
import { ambienteDoPerfil as ambienteDoPerfilClaude, conferirAuth as conferirAuthClaude } from './adapters/claude-bg';
import { ambienteDoDespacho as ambienteDoDespachoCodex, conferirAuth as conferirAuthCodex } from './adapters/codex';
import { ambienteDoFilho as ambienteDoFilhoGrok, comandoDeLogin as comandoDeLoginGrok, conferirAuth as conferirAuthGrok } from './adapters/grok';
import {
  assumirConducao, canalDoProcesso, conducaoDaThread, ErroDeConducao, ESPERA_PADRAO_MS, esperarConducaoLivre, liberarSeOrfa,
  textoDoPedidoRepetido, textoDoStatusDaConducao,
} from './conducao';
import { baterSentinela, desligarSentinela, statusDaSentinela, textoDoStatusDaSentinela } from './conducao-sentinela';
import { gravarAutorizacao, lerAutorizacao, linhaDaAutorizacao, textoDaAutorizacao } from './autorizacao-duravel';
import { atualizarBranchDaThread, textoDaAtualizacao } from './atualizar-branch';
import { baterConducao, textoDaBatida } from './conducao-batida';
import { entregarPeloTransporte } from './pulse-delivery';
import { descreverSlug, hashDoPrompt, montarPrompt, rodarFase, tabelaDoLedger, valoresDoPrompt } from './phase';
import {
  avisosDeLingua,
  carregarTemplates,
  exigirTemplate,
  idiomaDoTemplate,
  lintTemplate,
  ProblemaDeTemplate,
  renderizar,
  tabelaDeTemplates,
  templateDaFase,
  textoDoLint,
  threadDeExemplo,
} from './prompts';
import { comandoDeAttach, limparFantasmas, logsDaSessao, pararSessao, textoDaLimpeza } from './sessoes';
import { exec, shaCurto, tabela } from './util';
import { ship, textoDoShip } from './ship';
import { consultarCi, executarBundleCi, executarCi, executarCiDaBranch, prepararBundleCi } from './ci';
import { contextoDaVarredura, mergeBase, relatorioDoDadoPrivado, varrerArvore, varrerDiff } from './dado-privado';
import { avisoDaWorktree, avisoDeThreadSemBase, avisoDeWorktreeQueFalharia, caminhoThread, canalDaSessao, dirThread, exigirFase, lerThread,
  linhaDaWorktree, listarIds, novaThread, pedidoDaThread, pedidoDeWorktree, PedidoDeWorktree, prepararPedido, resumoDaThread, tabelaDeThreads,
  threadsDaListagem,
} from './thread';
import { escopoPadraoDoSync, iniciarDocs, sincronizarDocs, textoDaSincronizacao, textoDaVerificacao, verificarDocs } from './docs';
import { BRANCH_DE_RESERVAS, leituraDasReservas, listarReservas, PainelDeReservas, pegarItem, REMOTO_PADRAO, reservarFeat, reservasOrfas,
  soltarItem, soltarReservasOrfas, textoDasReservas } from './roadmap-reservas';
import { lerFabrica, publicarMaquina, registrarPublicacao, removerMaquina, textoDaFabrica, textoDasOutrasMaquinas } from './fabrica-estado';
import { exigirRemoto } from './branch-de-estado';
import { ErroDoPedidoDeProjeto, montarPanoramaDaRede, SAIDA_DO_PEDIDO, textoDoPanoramaDaRede } from './network-roadmap';
import { publicarEmSegundoPlano } from './fabrica-publicar';
import { estadoDaBatida, instalarBatida, removerBatida, textoDoEstadoDaBatida, textoDoResultadoDaBatida } from './fabrica-batida';
import { avisoDaFabricaPedida, fabricaCompartilhada, gravarConfigDaMaquina, lerConfigDaMaquina, nomeDaMaquina } from './maquina';
import { entrarNaRede, publicarRede, refDaCasa, sairDaRede } from './rede';
import { registrarNaRede } from './rede-adesao';
import { jsonSemInvisivel } from './saida-segura';
import { ehNomeDeForja } from './rede-forja';
import { jsonDaRede, lerRede, textoDaRede } from './rede-status';
import { lerLedger } from './ledger';
import { gateDeTokens, textoDoGateDeTokens } from './tokens';
import { ClasseDeFalha, ColecaoDoOrk, Fase, FASES, FonteDeMedida, Modo, MotivoGate, UniversoDaBusca } from './types';
import { PreparoDasDependencias, ultimaLinhaDoPreparo } from './dependencias-da-worktree';
import { ESPERA_DA_FILA_PESADA_MS, gravarBaseline, linhasDaBaseline, textoDoVerify, verificar } from './verify';
import { ErroDaFilaPesada, OcupanteDaFila } from './fila-pesada';
import {
  auditarWorktree,
  garantirWorktree,
  liberarWorktree,
  sincronizarWorktree,
  textoDoAudit,
} from './worktree';
import { linhaDoLintDeClaim } from './claim-lint';
import { propostasDePolicy, registrarPropostasNovas, resumoDasLicoes, textoDeLicoes } from './licoes';
import { executarDemo } from './demo';
import { registrarEntregaExternaPorPr, registrarEntregaPorPr, registrarEntregasPorPr } from './entrega-pr';
import { linhasDaPublicacao, pistaDeEntrega, publicarEntrega } from './ship-publicar';
import {
  caminhoDoRegistro, consultaDoProjeto, CONTRATO_PROJETOS, declaracaoQueFaltou, ENV_PROJETO_EXPLICITO, ErroDeProjeto, esquecerProjeto,
  fixarProjetoAlvo, FORA_DA_CONSULTA, iniciarDeclaracaoDoProjeto,
  linhasDaConsulta, listarProjetos, pedirDeclaracaoDoProjeto, ProjetoAlvo, raizParaExibir, registrarProjeto, registrarProjetoEmSilencio,
  remotoDoProjeto, resolverProjetoAlvo, SAIDA_DE_PROJETO, semRemoto,
} from './projeto-alvo';
import { ARQUIVO_WORKTREE_LOCAL, COMANDO_CONFIRMAR_WORKTREE, confirmarWorktreeLocal, lerWorktreeLocal, pastaDasWorktreesPedida,
  recusaDePastaDasWorktrees, revogarWorktreeLocal } from './worktree-local';
import { ehTransporteShipMcp, type TransporteShipMcp } from './mcp-transportes';
import { caminhoDaPosturaLocal, comandoDeConfirmacao, confirmarPosturaLocal, lerPosturaLocal, posturaAfrouxada, recusaDePostura, revogarPosturaLocal } from './postura-local';

/** A versao publicada em `@orkastery/cli`, lida do package.json (`versao.ts`). */
// Antes de qualquer arquivo ou despacho: sem escrita de grupo nem de outros, que o sensor recusaria.
endurecerUmask();

const VERSAO = VERSAO_DO_ORK;

interface Args {
  posicionais: string[];
  opcoes: Record<string, string | boolean>;
}

/** Parse simples de argumentos: `--chave valor`, `--chave=valor` e flags booleanas. */
export function parseArgs(argv: string[]): Args {
  const posicionais: string[] = [];
  const opcoes: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const igual = a.indexOf('=');
      if (igual > 0) {
        opcoes[a.slice(2, igual)] = a.slice(igual + 1);
      } else {
        const proximo = argv[i + 1];
        if (proximo !== undefined && !proximo.startsWith('--')) {
          opcoes[a.slice(2)] = proximo;
          i++;
        } else {
          opcoes[a.slice(2)] = true;
        }
      }
    } else {
      posicionais.push(a);
    }
  }
  return { posicionais, opcoes };
}

function texto(v: string | boolean | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * RM-058 N2 (A1 da rodada 2 do CHECK): a fila de recursos pesados de um comando que verifica por dentro, pelo `--esperar`
 * dele, com o aviso no stderr e o comando que a recusa sugere. Sem `--esperar`, vale o padrão curto do verify.
 */
function filaPesadaDoCli(args: Args, operacao: 'verify' | 'baseline', comandoDeEsperar: string):
  { esperarMs: number | undefined; aoEsperar: (ocupantes: OcupanteDaFila[]) => void; comandoDeEsperar: string } {
  const m = msg().verify;
  return { esperarMs: conducaoDoCli(args).esperarMs, comandoDeEsperar,
    aoEsperar: (ocupantes) => console.error(m.filaPesadaEsperando(operacao,
      ocupantes.map((o) => m.filaPesadaOcupante(o.operacao, o.thread, formatarDataHora(o.desde))).join('; '))) };
}

/**
 * I-36 (D2, D6): o que o CLI declara sobre a conducao. `--canal` (sem ele, o que a borda exporta),
 * `--correlacao` (conversa ou mensagem de origem) e `--esperar [minutos]` (sem valor, 30).
 */
function conducaoDoCli(args: Args): { canal: ReturnType<typeof canalDoProcesso>; correlacao: string | null; esperarMs: number | undefined } {
  if (args.opcoes.canal === true) throw new Error(msg().phase.canalUso);
  const bruto = args.opcoes.esperar;
  let esperarMs: number | undefined;
  if (bruto === true) esperarMs = ESPERA_PADRAO_MS;
  else if (typeof bruto === 'string') {
    const minutos = Number(bruto);
    if (!Number.isFinite(minutos) || minutos <= 0 || minutos > 24 * 60) throw new Error(msg().phase.esperarUso);
    esperarMs = Math.round(minutos * 60_000);
  }
  return { canal: canalDoProcesso(texto(args.opcoes.canal)), correlacao: texto(args.opcoes.correlacao) ?? null, esperarMs };
}

/** RM-061 (F2a): o que a ajuda interpola; a redacao mora no catalogo (`msg().ajuda`, D10). */
function dadosDaAjuda(locale: Locale = localeAtivo()): DadosDaAjuda {
  return { versao: VERSAO, modos: ORDEM_DOS_MODOS.length, segredos: msg(locale).onboarding.segredos,
    tags: ORDEM_DOS_MODOS.map((m) => MODOS[m].tag).join(' ') };
}

/** A ajuda em pt-BR, o texto de sempre: o `docs verificar` a compara com a referencia do CLI. */
const AJUDA = msg('pt-BR').ajuda.texto(dadosDaAjuda('pt-BR'));

/**
 * RM-061 (F2a): a ajuda segue o locale como os comandos cobertos: `owner.language` do projeto de
 * `--projeto` ou do diretorio, senao `LC_ALL`, `LC_MESSAGES` e `LANG`. Manifesto ilegivel nao derruba a ajuda.
 */
function localeDaAjuda(projeto?: string): Locale {
  // A ajuda sai antes de o projeto-alvo ser fixado: com `--projeto`, vale o manifesto dele (D14).
  let raiz: string | undefined;
  if (projeto !== undefined) {
    try { raiz = resolverProjetoAlvo({ opcao: projeto })?.raiz; } catch { /* nome ambiguo ou desconhecido: o cwd */ }
  }
  let ownerLanguage: unknown;
  try { ownerLanguage = carregarManifesto(raiz)?.manifesto.owner?.language; } catch { /* vale o ambiente */ }
  return resolverLocale(ownerLanguage).locale;
}


function comandoThread(args: Args): number {
  if (args.posicionais[1] === 'close' || args.posicionais[1] === 'entrega') {
    const raiz = exigirManifesto().raiz, id = args.posicionais[2];
    if (!id) throw new ErroDoCatalogo((m) => m.thread.informeOId);
    const por = texto(args.opcoes.por) ?? '';
    // RM-061 (F3b, D3): o fechamento e a entrega gravam (ledger, thread.json, a soltura do que a thread segurava) no
    // escopo pt-BR; a recusa vem do catalogo e a entrada do CLI a remonta no locale do comando. O resultado e JSON.
    const r = comLocale('pt-BR', () => args.posicionais[1] === 'close'
      ? fecharAdministrativamente(raiz, id, { motivo: texto(args.opcoes.motivo) ?? '', por, justificativa: texto(args.opcoes.justificativa) ?? '' })
      : registrarArtefato(raiz, id, texto(args.opcoes.arquivo) ?? '', texto(args.opcoes.sha256) ?? '', por));
    console.log(JSON.stringify(r, null, 2));
    return 0;
  }
  const sub = args.posicionais[1];
  if (sub === 'new') {
    const carregado = exigirManifesto();

    // `--from-finding <id>`: o achado de auditoria vira thread sem retrabalho (bloco B5).
    // O nome posicional passa a ser opcional, porque o titulo do achado ja serve de nome.
    const doAchado = texto(args.opcoes['from-finding']) ?? texto(args.opcoes['do-achado']);
    if (doAchado) {
      const mf = msg().thread.fromFinding;
      const brutoModoAchado = texto(args.opcoes.modo) ?? texto(args.opcoes.mode);
      let modoAchado: Modo | undefined;
      // RM-058 N6 (D1): thread em modo #Noctum não existe; a recusa diz se falta o envelope ou se a lista do arco é fechada.
      if (brutoModoAchado !== undefined && ehModoNoctum(brutoModoAchado)) { console.error(recusaDoModoNaThread(carregado.raiz).message); return 2; }
      if (brutoModoAchado !== undefined) {
        try { modoAchado = exigirModoVivo(brutoModoAchado); }
        catch (e) { console.error((e as Error).message); return 2; }
      }
      // P4 do ensaio da 0.5.0 (D2): a thread do achado segue a mesma regra de worktree do `thread new`.
      let pedidoAchado: PedidoDeWorktree;
      try {
        pedidoAchado = pedidoDeWorktree({ worktree: args.opcoes.worktree, semWorktree: args.opcoes['sem-worktree'] },
          carregado.manifesto.worktree.por_thread);
      } catch (e) { console.error((e as Error).message); return 2; }
      const r = abrirThreadDoAchado(carregado, doAchado, {
        nome: args.posicionais[2],
        modo: modoAchado ?? undefined,
        slug: texto(args.opcoes.slug),
        assunto: texto(args.opcoes.assunto),
        criarWorktree: pedidoAchado.criar,
        worktree: pedidoAchado.dir,
        origemDaWorktree: pedidoAchado.origem,
        dryRun: args.opcoes['dry-run'] === true,
      });
      if (!r.ok) {
        const motivo = r.motivo ?? 'claims.failed';
        console.error(mf.recusada(r.achado.id));
        console.error(`  ${mf.descricaoDoMotivo(motivo, DESCRICAO_DO_MOTIVO_DE_AUDITORIA[motivo])}`);
        console.error(mf.motivoTipado(r.motivo));
        console.error(mf.detalhe(r.detalhe));
        console.error(mf.correcao(r.correcao));
        return 1;
      }
      const gravadaDoAchado = args.opcoes['dry-run'] !== true;
      // RM-052 (D7): thread nova, projeto conhecido; o aviso nunca derruba a criacao.
      const avisoDoRegistroDoAchado = gravadaDoAchado && r.thread ? registrarProjetoEmSilencio(carregado.raiz, 'thread new') : null;
      if (avisoDoRegistroDoAchado) console.error(avisoDoRegistroDoAchado);
      console.log(
        gravadaDoAchado
          ? mf.criada(r.achado.id)
          : mf.simulacao
      );
      console.log(textoDoAchado(r.achado));
      console.log('');
      if (r.thread) {
        console.log(resumoDaThread(r.thread));
        console.log('');
        console.log(`  slug em 3 partes: ${descreverSlug(r.thread.slug)}`);
        const linhaDaWorktreeDoAchado = linhaDaWorktree(r.worktreePor, gravadaDoAchado);
        if (linhaDaWorktreeDoAchado) console.log(linhaDaWorktreeDoAchado);
        const avisoDaWorktreeDoAchado = r.worktreeFalharia ? avisoDeWorktreeQueFalharia(r.worktreeFalharia)
          : avisoDaWorktree(pedidoAchado.origem, { thread: r.thread, gravada: gravadaDoAchado, worktreePor: r.worktreePor },
            carregado.manifesto);
        if (avisoDaWorktreeDoAchado) console.error(avisoDaWorktreeDoAchado);
      }
      if (r.motivo === 'claims.unverifiable') {
        console.log('');
        console.log(`  ${r.detalhe}`);
      }
      // Bloco B6: a origem da thread vai para a colecao `roadmap` (achado -> proposta ->
      // thread -> entrega e rastreavel sem abrir o board).
      if (r.thread && gravadaDoAchado) {
        relatarPublicacao(
          publicar(carregado, r.thread.id, {
            tipo: 'achado',
            referencia: r.achado.id,
            detalhe:
              `Achado ${r.achado.id} (${r.achado.pack}/${r.achado.regra}): ${r.achado.titulo}. ` +
              `Fix proposto: ${r.achado.proposta.fix}`,
          })
        );
      }
      if (gravadaDoAchado && r.thread) {
        console.log(mf.origemDoGoal(r.thread.id));
        console.log('');
        console.log(mf.pedidoMontado);
        console.log('');
        console.log(r.pedido);
        console.log('');
        console.log(mf.proximoPasso);
        console.log(mf.comandoDoProximoPasso(r.thread.id));
      }
      return 0;
    }

    const nome = args.posicionais[2];
    const mt = msg().thread;
    if (!nome) {
      console.error(mt.usoNew);
      return 2;
    }
    const avisoRoadmap = avisoRoadmapSemAssociacao(nome, texto(args.opcoes.roadmap));
    if (avisoRoadmap) console.error(avisoRoadmap);
    const brutoModo = texto(args.opcoes.modo) ?? texto(args.opcoes.mode);
    // RM-058 N6 (D1): thread em modo #Noctum não existe; a recusa diz se falta o envelope ou se a lista do arco é fechada.
    if (brutoModo !== undefined && ehModoNoctum(brutoModo)) { console.error(recusaDoModoNaThread(carregado.raiz).message); return 2; }
    let modo: Modo;
    try {
      modo = brutoModo !== undefined
        ? exigirModoVivo(brutoModo)
        : carregado.manifesto.conduction.default_mode;
    } catch (e) { console.error((e as Error).message); return 2; }
    // I-43 (D4, viga a): a exigencia de validacao cruzada e declarada na criacao e
    // fica gravada na thread, em vez de morar num envelope a parte.
    const exigeRuntimeDiferente = args.opcoes['exige-runtime-diferente'] === true;
    // I-43 (D4, viga b): `--done "criterio :: comando"`, com `;;` separando varios.
    // O separador `::` e obrigatorio: criterio sem comando e a prosa que o envelope
    // tinha, e o produto nao aceita de volta um criterio de pronto que ninguem executa.
    const doneWhen = (texto(args.opcoes.done) ?? '').split(';;').map((p) => p.trim()).filter(Boolean)
      .map((entrada) => {
        const corte = entrada.indexOf('::');
        if (corte < 0) throw new Error(mt.doneSemComando(entrada));
        const criterio = entrada.slice(0, corte).trim();
        const comando = entrada.slice(corte + 2).trim();
        if (!criterio || !comando) throw new Error(mt.doneIncompleto(entrada));
        return { criterio, comando };
      });
    const dryRun = args.opcoes['dry-run'] === true;
    // RM-059 (T6.0): o pedido do builder, guardado para o render da fase quando falta `--pedido`.
    if (args.opcoes.pedido === true) {
      console.error(mt.usoPedido);
      return 2;
    }
    const pedidoDoBuilder = texto(args.opcoes.pedido);
    // A4 do CHECK: pedido invalido e erro de uso, e sai antes da reserva do roadmap, que vai ao remoto.
    if (pedidoDoBuilder !== undefined) {
      try { prepararPedido(pedidoDoBuilder); }
      catch (e) { console.error(mt.usoComMotivo(mensagemDoErro(e))); return 2; }
    }
    // `--worktree auto` (ou `--worktree` sozinho) cria a worktree isolada da thread; um caminho reusa um
    // diretorio que ja existe. P4 do ensaio da 0.5.0: sem flag, `worktree.por_thread: true` cria como o
    // `--worktree auto`, e `--sem-worktree` cria sem ela. Uso invalido sai antes da reserva do roadmap.
    let pedido: PedidoDeWorktree;
    try {
      pedido = pedidoDeWorktree({ worktree: args.opcoes.worktree, semWorktree: args.opcoes['sem-worktree'] },
        carregado.manifesto.worktree.por_thread);
    } catch (e) { console.error((e as Error).message); return 2; }
    const brutoCiclo = texto(args.opcoes.ciclo) ?? texto(args.opcoes.variante);
    const variante = brutoCiclo ? parseVariante(brutoCiclo) : null;
    if (brutoCiclo && !variante) {
      console.error(mt.varianteInvalida(brutoCiclo, Object.keys(VARIANTES).join(', ')));
      return 2;
    }
    // P4 do ensaio da 0.5.0 (D4, CHECK): a recusa do ciclo sai antes da reserva do roadmap, como os outros erros de
    // uso; a do `novaThread` fica como defesa de quem o chama direto.
    if (variante && definicaoDaVariante(variante).exigeWorktree && pedido.origem === 'sem-worktree') {
      console.error(mt.cicloExigeWorktree(variante));
      return 2;
    }
    const brutoFatias = texto(args.opcoes.fatias);
    // I-47: `--roadmap RM-NNN` reserva o item ANTES de criar a thread. A reserva e o passo
    // atomico entre maquinas (o primeiro push vence); a thread e local. Se a criacao falhar,
    // a reserva e devolvida; se der certo, ela passa a apontar para a thread.
    const itemDoRoadmap = dryRun ? undefined : texto(args.opcoes.roadmap);
    // RM-061 (F2a, D6): o que grava estado (reserva, thread, ledger, worktree, registro, publicacoes) roda em pt-BR.
    const itemReservado = itemDoRoadmap ? comLocale('pt-BR', () => pegarItem(carregado.raiz, itemDoRoadmap).item) : undefined;
    let criada: ReturnType<typeof novaThread>;
    try {
      criada = comLocale('pt-BR', () => novaThread(carregado, {
        nome,
        modo,
        slug: texto(args.opcoes.slug),
        assunto: texto(args.opcoes.assunto),
        worktree: pedido.dir,
        criarWorktree: pedido.criar,
        origemDaWorktree: pedido.origem,
        dryRun,
        variante,
        branch: texto(args.opcoes.branch),
        fatias: brutoFatias !== undefined ? Number(brutoFatias) : undefined,
        exigeRuntimeDiferente,
        doneWhen,
        roadmap: itemReservado,
        ...(pedidoDoBuilder !== undefined ? { pedido: pedidoDoBuilder } : {}),
      }));
    } catch (e) {
      if (itemDoRoadmap) {
        try { comLocale('pt-BR', () => soltarItem(carregado.raiz, itemDoRoadmap)); } catch { /* fica reservado; `ork roadmap soltar` resolve */ }
      }
      throw e;
    }
    const { thread, gravada } = criada;
    const reservaDoItem = itemDoRoadmap && gravada
      ? comLocale('pt-BR', () => pegarItem(carregado.raiz, itemDoRoadmap, { thread: thread.id })) : null;
    // I-51 (RM-047): com a fabrica compartilhada, as outras maquinas veem a thread nova.
    if (gravada) comLocale('pt-BR', () => publicarEmSegundoPlano(carregado.raiz));
    // RM-052 (D7): quem abre thread aqui conhece este projeto; o aviso nunca derruba a criacao.
    const avisoDoRegistro = gravada ? comLocale('pt-BR', () => registrarProjetoEmSilencio(carregado.raiz, 'thread new')) : null;
    if (avisoDoRegistro) console.error(avisoDoRegistro);
    console.log(gravada ? mt.criada : mt.simulacao);
    if (reservaDoItem) console.log(mt.roadmapReservado(reservaDoItem.item, reservaDoItem.reserva?.maquina));
    console.log(resumoDaThread(thread));
    console.log('');
    console.log(mt.slugEm3Partes(descreverSlug(thread.slug)));
    const linhaDaWorktreeNova = linhaDaWorktree(criada.worktreePor, gravada, variante);
    if (linhaDaWorktreeNova) console.log(linhaDaWorktreeNova);
    relatarDependencias(criada.dependencias, thread.worktree ?? '');
    const avisoDaWorktreeNova = criada.worktreeFalharia ? avisoDeWorktreeQueFalharia(criada.worktreeFalharia)
      : avisoDaWorktree(pedido.origem, criada, carregado.manifesto);
    const avisoSemBase = avisoDeThreadSemBase(thread, gravada);
    if (thread.pedido) {
      console.log(mt.pedidoGuardado(gravada, `.orkastery/threads/${thread.id}/${thread.pedido.arquivo}`, shaCurto(thread.pedido.sha256),
        thread.pedido.bytes));
    }
    if (gravada) {
      console.log(mt.estado(thread.id));
      // Bloco B6: a origem da thread e as policies do projeto vao para a memoria
      // semantica quando ela esta ligada. Em regime files nada muda nesta saida.
      relatarPublicacao(comLocale('pt-BR', () => publicar(carregado, thread.id)));
      // Thread sem base nao tem fase para rodar: o proximo passo e o do aviso.
      if (!avisoSemBase) {
        console.log('');
        console.log(mt.proximoPasso(thread.id, thread.faseAtual));
      }
    }
    if (avisoDaWorktreeNova) console.error(avisoDaWorktreeNova);
    if (avisoSemBase) console.error(avisoSemBase);
    return 0;
  }
  if (sub === 'list' || sub === undefined) {
    const carregado = exigirManifesto();
    // I-43 (D8): `--todas` abre o que o default esconde, e `--json` passa a devolver
    // JSON de verdade. Acrescentar uma flag numa tela onde `--json` era aceito e
    // IGNORADO em silencio (saindo 0) seria deixar dois pesos na mesma linha.
    const todas = args.opcoes.todas === true;
    if (args.opcoes.json === true) {
      const linhas = threadsDaListagem(carregado.raiz, { todas });
      console.log(JSON.stringify({ todas, total: linhas.length, threads: linhas }, null, 2));
      return 0;
    }
    console.log(tabelaDeThreads(carregado.raiz, { todas }));
    return 0;
  }
  if (sub === 'status') {
    const carregado = exigirManifesto();
    const id = args.posicionais[2];
    const mt = msg().thread;
    if (!id) {
      console.error(mt.usoStatus);
      return 2;
    }
    const thread = lerThread(carregado.raiz, id);
    if (args.opcoes.json === true) {
      // Idem: `ork thread status <id> --json` imprimia o TEXTO e saia 0.
      console.log(JSON.stringify(thread, null, 2));
      return 0;
    }
    console.log(`Thread ${thread.id}`);
    // I-36 (T17): a linha de conducao vem da leitura unica do nucleo.
    console.log(resumoDaThread(thread, conducaoDaThread(carregado.raiz, thread.id)));
    console.log('');
    if (thread.sessoes.length === 0) {
      console.log(mt.nenhumaSessao);
    } else {
      console.log(mt.sessoesDespachadas);
      for (const s of thread.sessoes) {
        console.log(`    ${s.slug.padEnd(24)} ${s.fase.padEnd(6)} ${s.sessionId.slice(0, 8)}  ` + mt.sessao(s.verificada, canalDaSessao(s)));
      }
    }
    console.log('');
    console.log(mt.pausasDoModo(pausasDoModo(thread.modo)));
    return 0;
  }
  console.error(msg().cli.subcomandoDesconhecido('thread', sub));
  return 2;
}

/**
 * `ork setup [modo]`: a feature #setup no nucleo.
 *
 * Sem argumento, imprime a pauta da entrevista (a lista topificada dos modos vivos com a
 * config atual de cada bloco): e o texto que o orquestrador entrega ao owner quando a
 * tag #setup chega no pedido. Com um modo, mostra/edita/reseta a config daquele modo.
 * Toda edicao vira evento `setup_configured` no ledger do projeto.
 */
function comandoOnboarding(args: Args): number {
  const invalido = () => { throw new Error(msg().onboarding.usoInvalido); };
  if (Object.keys(args.opcoes).some(k => !['conteudo', 'por', 'json', 'reset'].includes(k))) invalido();
  if ('json' in args.opcoes && args.opcoes.json !== true) invalido();
  if ('por' in args.opcoes && typeof args.opcoes.por !== 'string') invalido();
  const alias = 'reset' in args.opcoes;
  const sub = alias ? 'reset' : args.posicionais[1] ?? 'show';
  const etapa = alias ? texto(args.opcoes.reset) : args.posicionais[2];
  if (alias && args.posicionais.length !== 1) invalido();
  if (!['show', 'set', 'reset', 'sync'].includes(sub)) invalido();
  if (['show', 'sync'].includes(sub) && (args.posicionais.length > 2 || 'conteudo' in args.opcoes)) invalido();
  if (sub === 'set' && (!etapa || args.posicionais.length !== 3 || typeof args.opcoes.conteudo !== 'string')) invalido();
  if (sub === 'reset' && (args.posicionais.length > 3 || 'conteudo' in args.opcoes)) invalido();
  if (sub === 'sync' && 'por' in args.opcoes) throw new Error(msg().onboarding.syncPor);
  const carregado = exigirManifesto(), raiz = carregado.raiz, por = texto(args.opcoes.por) ?? 'owner';
  if (sub === 'sync') {
    const r = comLocale('pt-BR', () => sincronizarOnboarding(carregado));
    console.log(args.opcoes.json === true ? JSON.stringify(r, null, 2)
      : msg().onboarding.syncResultado(r.regime, r.motivo, r.respondidas, r.gravadas, r.duplicadas, r.falhas));
    return 0;
  }
  let estado;
  // RM-061 (F2a, D6): a recusa de uso sai no locale do comando; a gravacao roda em pt-BR (o dado nao muda).
  if (sub === 'set') {
    let conteudo: unknown;
    try { conteudo = JSON.parse(args.opcoes.conteudo as string); } catch { return invalido(); }
    validarPedidoDeEtapa(etapa, conteudo, por);
    estado = comLocale('pt-BR', () => gravarEtapa(raiz, etapa!, conteudo, por));
  } else if (sub === 'reset') {
    validarPedidoDeEtapa(etapa, undefined, por);
    estado = comLocale('pt-BR', () => resetarOnboarding(raiz, etapa, por));
  } else estado = lerOnboarding(raiz);
  console.log(args.opcoes.json === true ? JSON.stringify(estado, null, 2) : textoDaPauta(estado, exigirManifesto(raiz).manifesto.owner));
  return 0;
}

/**
 * I-33 (D8): `ork accounts list|add|remove|check`. O login e sempre do proprio CLI com o env do
 * perfil (`claude auth login`, `codex login`, `grok login [--device-auth]`); o `ork` so guarda identidade,
 * diretorio e estado, nunca le, copia ou migra o que o CLI grava (o `auth.json` do grok inclusive). A lista
 * nao tem segredo porque o store nao tem.
 */
/** A8: valor citado para colar no shell: aspas simples, e a aspa simples do proprio valor fechada e reaberta. */
function aspasDeShell(valor: string): string {
  return `'${valor.split("'").join(`'"'"'`)}'`;
}

/**
 * I-33 (N2): o aviso da chave de troca entre perfis sai no proprio comando que a usa (`phase run`,
 * `retry`, `accounts`), nao so no `ork doctor`: valor invalido nunca liga a troca em silencio.
 */
function avisarChavesDePerfis(carregado: ReturnType<typeof exigirManifesto>): void {
  for (const a of carregado.avisos) if (a.startsWith('runtime_profiles.')) console.error(msg().phase.aviso(a));
}

function comandoAccounts(args: Args): number {
  const carregado = exigirManifesto();
  avisarChavesDePerfis(carregado);
  const raiz = carregado.raiz;
  const sub = args.posicionais[1] ?? 'list';
  // RM-061 (F3b, GO-FIX 1): a conferencia roda no escopo pt-BR (o detalhe vai ao store), e a impressao o traduz.
  const conferir = (p: PerfilDeDespacho) => comLocale('pt-BR', () => p.runtime === 'claude-bg' ? conferirAuthClaude(p)
    : p.runtime === 'grok' ? conferirAuthGrok(p) : conferirAuthCodex(p));
  const detalhe = (auth: { detalhe: string }) => ma.detalheDoLogin(remontar(auth.detalhe));
  // RM-061 (F3b, D3): o texto pelo catalogo; o que se grava (store de perfis, registro de contas) roda no escopo pt-BR,
  // e o id, o runtime, o diretorio, o motivo tipado e o detalhe que o CLI do runtime devolve saem como vieram.
  const ma = msg().accounts;
  const imprimir = () => {
    const store = lerPerfis(raiz);
    if (args.opcoes.json === true) { console.log(JSON.stringify(store, null, 2)); return; }
    // I-49: a tabela mostra o que o despacho enxerga, com o que outra fabrica viu na mesma conta.
    const visto = lerPerfisComContas(raiz);
    console.log(visto.perfis.length === 0 ? ma.semPerfis : tabela([...ma.colunas], linhasDePerfis(visto)));
    // I-35: a tabela mostra horario do dono; o fuso sai uma vez, no fim da mensagem.
    if (perfisComHorario(store)) console.log(legendaDoFuso());
  };
  if (sub === 'list') { imprimir(); return 0; }
  if (sub === 'add') {
    const id = args.posicionais[2], runtime = texto(args.opcoes.runtime), dirBruto = texto(args.opcoes.dir);
    // RM-067 (F3): o codigo de dispositivo e do login do grok; nos outros runtimes, a opcao e recusada.
    const dispositivo = args.opcoes['device-auth'] === true;
    if (!id || !runtime || !dirBruto || (dispositivo && runtime !== 'grok')) {
      console.error(ma.usoAdd);
      return 2;
    }
    const dir = path.resolve(dirBruto);
    let perfil;
    try {
      // A7: diretorio inacessivel ou de outro usuario e recusado antes de qualquer gravacao no store.
      prepararDiretorioDoPerfil(dir);
      const desativado = lerPerfis(raiz).perfis.some(p => p.id === id && p.estado === 'desativado');
      perfil = comLocale('pt-BR', () => adicionarPerfil(raiz, { id, runtime, dir }));
      if (desativado) console.log(ma.reativado(id));
    } catch (e) { console.error(ma.recusado(mensagemDoErro(e))); return 1; }
    const despacho = perfilDeDespacho(perfil);
    const variavel = VARIAVEL_DO_PERFIL[perfil.runtime];
    // D13: o login do claude e fixado na assinatura (`--claudeai`), nunca no Console de API.
    // RM-067 (F3, D1 b): o grok entra pela assinatura, no login do proprio CLI (navegador ou codigo de dispositivo).
    const comando = perfil.runtime === 'claude-bg' ? ['claude', 'auth', 'login', '--claudeai']
      : perfil.runtime === 'grok' ? comandoDeLoginGrok(dispositivo) : ['codex', 'login'];
    if (args.opcoes['sem-login'] !== true && process.stdin.isTTY && process.stdout.isTTY) {
      // Login interativo do proprio CLI, com o env do perfil sobre a assinatura higienizada.
      const env = perfil.runtime === 'claude-bg' ? ambienteDoPerfilClaude(despacho)
        : perfil.runtime === 'grok' ? ambienteDoFilhoGrok({ perfil: despacho }) : ambienteDoDespachoCodex(process.env, despacho);
      spawnSync(comando[0], comando.slice(1), { stdio: 'inherit', env });
    } else {
      console.log(ma.loginPendente(variavel, aspasDeShell(dir), comando.join(' '), id));
    }
    const auth = conferir(despacho);
    // A14: conferencia inconclusiva nao marca sem-auth; o preflight do proximo despacho confere de novo.
    if (!auth.ok && !auth.transitorio) comLocale('pt-BR', () => marcarFalhaDePerfil(raiz, id, auth.pago
      ? { estado: 'provider-pago', esgotadoAte: null, motivo: 'cost.violation', detalhe: auth.detalhe }
      : { estado: 'sem-auth', esgotadoAte: null, motivo: 'runtime.auth-missing', detalhe: auth.detalhe }));
    console.log(ma.resultadoAdd(id, perfil.runtime, dir, auth.semConferencia ? ma.semConferenciaAdd(detalhe(auth)) : auth.ok ? ma.conferido
      : auth.transitorio ? ma.inconclusivaAdd(detalhe(auth))
      : auth.pago ? ma.pagoAdd(detalhe(auth)) : ma.semLoginAdd(detalhe(auth))));
    return 0;
  }
  if (sub === 'remove') {
    const id = args.posicionais[2];
    if (!id) { console.error(ma.usoRemove); return 2; }
    try { comLocale('pt-BR', () => desativarPerfil(raiz, id)); } catch (e) { console.error(mensagemDoErro(e)); return 1; }
    console.log(ma.desativado(id));
    return 0;
  }
  if (sub === 'check') {
    const alvo = args.posicionais[2];
    const expirados = new Set(comLocale('pt-BR', () => expirarPerfisVencidos(raiz)).map(p => p.id));
    const perfis = lerPerfis(raiz).perfis.filter(p => p.estado !== 'desativado' && (alvo === undefined || p.id === alvo));
    if (alvo !== undefined && perfis.length === 0) { console.error(ma.perfilAtivoNaoExiste(alvo)); return 1; }
    const inventario = inventariarSessoes(raiz, { global: true });
    let falhas = 0;
    for (const p of perfis) {
      const auth = conferir(perfilDeDespacho(p));
      comLocale('pt-BR', () => {
        // RM-067 (F3): sem conferencia (grok), o estado fica: so o login que o proprio CLI confere devolve o perfil.
        if (auth.ok && !auth.semConferencia && (p.estado === 'sem-auth' || p.estado === 'provider-pago')) reativarPerfil(raiz, p.id);
        if (!auth.ok && auth.transitorio) registrarConferenciaInconclusiva(raiz, p.id, auth.detalhe);
        else if (!auth.ok) {
          marcarFalhaDePerfil(raiz, p.id, auth.pago
            ? { estado: 'provider-pago', esgotadoAte: null, motivo: 'cost.violation', detalhe: auth.detalhe }
            : { estado: 'sem-auth', esgotadoAte: null, motivo: 'runtime.auth-missing', detalhe: auth.detalhe });
        }
      });
      if (!auth.ok) falhas++;
      const atual = lerPerfis(raiz).perfis.find(x => x.id === p.id) ?? p;
      const sessoes = inventario.sessoes.filter(s => s.viva && s.runtime === p.runtime && s.perfil === p.id);
      const cargas = [...new Set(sessoes.flatMap(s => s.vinculos.length
        ? s.vinculos.map(v => `${v.thread}:${v.fase}`) : [ma.sessaoSemVinculo(s.sessionId.slice(0, 8))]))];
      const carga = !inventario.ok ? ma.cargaInconclusiva : cargas.length ? ma.cargaDaConta(cargas.join(', ')) : ma.cargaVazia;
      const volta = atual.esgotadoAte ?? auth.cota?.resetEm ?? null;
      const operacional = [
        ma.limiteDaConta(ma.tipoDeLimite(tipoDeLimiteDoPerfil(atual))),
        ma.cotaDaConta(auth.cota ? ma.cotaMedida(auth.cota.usada, auth.cota.limite, auth.cota.unidade) : ma.cotaIndisponivel),
        carga,
        volta ? ma.voltaEm(formatarDataHoraRotulada(volta)) : ma.voltaSemMedida,
        ...(expirados.has(p.id) ? [ma.marcaExpirada] : []),
      ].join('; ');
      console.log(`${ma.resultadoCheck(p.id, p.runtime, auth.semConferencia ? ma.semConferenciaCheck(detalhe(auth)) : auth.ok ? ma.conferido
        : auth.transitorio ? ma.inconclusivaCheck(detalhe(auth))
        : auth.pago ? ma.pagoCheck(detalhe(auth)) : ma.semLoginCheck(detalhe(auth)))}; ${operacional}`);
    }
    console.log('');
    imprimir();
    return falhas > 0 ? 1 : 0;
  }
  if (sub === 'esgotamentos') {
    // RM-040 (B7): so leitura do registro de contas e dos ledgers dos projetos registrados.
    let relatorio;
    try { relatorio = relatorioDeEsgotamentos({ desde: texto(args.opcoes.desde) ?? '7d' }); }
    catch (e) { console.error(ma.periodoInvalido((e as Error).message)); return 2; }
    console.log(args.opcoes.json === true ? JSON.stringify(relatorio, null, 2) : textoDosEsgotamentos(relatorio));
    return 0;
  }
  console.error(ma.desconhecido(sub));
  return 2;
}

function comandoSetup(args: Args): number {
  const carregado = exigirManifesto();
  const raiz = carregado.raiz;
  const modoBruto = args.posicionais[1];
  const por = texto(args.opcoes.por) ?? 'owner';
  const ms = msg().setup.cli;

  if (modoBruto === 'versionar') {
    // I-52 (RM-047): o setup que vale agora vai para orkastery.setup.json, para entrar por PR.
    const r = versionarSetup(raiz, por);
    if (args.opcoes.json === true) { console.log(JSON.stringify({ caminho: r.caminho, setup: r.setup }, null, 2)); return 0; }
    console.log(ms.versionado(r.caminho));
    console.log(ms.levePorPr);
    return 0;
  }
  if (modoBruto === 'worktree') {
    // RM-047 (P3): worktree.dir fora da raiz so cria checkout com a confirmacao desta maquina, fora do git.
    const acao = args.posicionais[2];
    const json = args.opcoes.json === true;
    if (acao === 'confirmar') {
      const local = confirmarWorktreeLocal(raiz, carregado.manifesto, por, args.posicionais[3]);
      if (json) { console.log(JSON.stringify(local, null, 2)); return 0; }
      console.log(ms.worktreeConfirmada(local.dir, local.raiz));
      console.log(ms.worktreeGravada(ARQUIVO_WORKTREE_LOCAL));
      return 0;
    }
    if (acao === 'revogar') {
      const havia = revogarWorktreeLocal(raiz);
      if (json) { console.log(JSON.stringify({ revogada: havia }, null, 2)); return 0; }
      console.log(havia ? ms.worktreeRevogada : ms.worktreeNaoHavia);
      return 0;
    }
    if (acao !== undefined) { console.error(ms.worktreeSubcomando(acao)); return 2; }
    const pedida = pastaDasWorktreesPedida(raiz, carregado.manifesto);
    const local = lerWorktreeLocal(raiz);
    const recusa = recusaDePastaDasWorktrees(raiz, carregado.manifesto);
    if (json) {
      console.log(JSON.stringify({ manifesto: carregado.manifesto.worktree.dir, dir: pedida.dir, dentroDaRaiz: pedida.dentro,
        confirmadaNestaMaquina: local.local?.dir ?? null, criacao: recusa === null ? 'permitida' : 'recusada' }, null, 2));
      return 0;
    }
    console.log(ms.worktreeManifesto(carregado.manifesto.worktree.dir, pedida.dir, pedida.dentro));
    console.log(ms.confirmacaoLocal(local.local ? local.local.dir : ms.nenhumaConfirmacao(String(local.motivo))));
    console.log(recusa === null ? ms.criacaoPermitida : ms.criacaoRecusada(COMANDO_CONFIRMAR_WORKTREE));
    return 0;
  }
  if (modoBruto === 'sandbox') {
    // RM-047 (P1): a postura de sandbox que afrouxa so vale com a confirmacao desta maquina, fora do git.
    const acao = args.posicionais[2];
    const json = args.opcoes.json === true;
    if (acao === 'confirmar') {
      const postura = args.posicionais[3];
      if (!postura) { console.error(ms.sandboxUso); return 2; }
      const p = confirmarPosturaLocal(raiz, postura, por);
      if (json) { console.log(JSON.stringify(p, null, 2)); return 0; }
      console.log(ms.sandboxConfirmada(p.sandbox, p.raiz));
      console.log(ms.sandboxGravada(caminhoDaPosturaLocal(raiz)));
      return 0;
    }
    if (acao === 'revogar') {
      const havia = revogarPosturaLocal(raiz);
      if (json) { console.log(JSON.stringify({ revogada: havia }, null, 2)); return 0; }
      console.log(havia ? ms.sandboxRevogada : ms.sandboxNaoHavia);
      return 0;
    }
    if (acao !== undefined) { console.error(ms.sandboxSubcomando(acao)); return 2; }
    const pedida = carregado.manifesto.runtime.sandbox;
    const local = lerPosturaLocal(raiz);
    const recusa = recusaDePostura(raiz, carregado.manifesto, 'codex');
    if (json) {
      console.log(JSON.stringify({ manifesto: pedida, afrouxa: posturaAfrouxada(carregado.manifesto) !== null,
        confirmadaNestaMaquina: local.postura?.sandbox ?? null, despachoCodex: recusa === null ? 'permitido' : 'recusado' }, null, 2));
      return 0;
    }
    console.log(ms.sandboxManifesto(pedida));
    console.log(ms.confirmacaoLocal(local.postura ? local.postura.sandbox : ms.nenhumaConfirmacao(String(local.motivo))));
    console.log(recusa === null ? ms.despachoPermitido : ms.despachoRecusado(comandoDeConfirmacao(pedida)));
    return 0;
  }
  if (!modoBruto) {
    if (args.opcoes.reset === true) {
      resetarSetup(raiz, undefined, por);
      if (args.opcoes.json === true) { console.log(JSON.stringify(lerSetup(raiz), null, 2)); return 0; }
      console.log(ms.resetado);
      console.log(textoDaEntrevista(raiz));
      return 0;
    }
    console.log(args.opcoes.json === true ? JSON.stringify(lerSetup(raiz), null, 2) : textoDaEntrevista(raiz));
    return 0;
  }

  const modo = parseModo(modoBruto);
  if (!modo) {
    console.error(ms.modoDesconhecido(modoBruto, ORDEM_DOS_MODOS.join(', ')));
    return 2;
  }

  if (args.opcoes.reset === true) {
    resetarSetup(raiz, modo, por);
    if (args.opcoes.json === true) { console.log(JSON.stringify(lerSetup(raiz).modos[modo], null, 2)); return 0; }
    console.log(ms.modoResetado(MODOS[modo].tag));
    console.log('');
    console.log(textoDoSetup(raiz, modo));
    return 0;
  }

  const bloco = texto(args.opcoes.bloco);
  const runtime = texto(args.opcoes.runtime);
  const model = texto(args.opcoes.model);
  const effort = texto(args.opcoes.effort);
  // I-33 (D6): `--fallback runtime:modelo[:esforco],...`; `--fallback ""` remove a ordem.
  const fallbackBruto = args.opcoes.fallback === true ? '' : texto(args.opcoes.fallback);
  const fallback = fallbackBruto === undefined ? undefined : fallbackBruto.split(',').map(s => s.trim()).filter(s => s !== '');
  if (bloco === undefined && (runtime !== undefined || model !== undefined || effort !== undefined || fallback !== undefined)) {
    console.error(ms.informeBloco);
    return 2;
  }
  if (bloco !== undefined) {
    if (runtime === undefined && model === undefined && effort === undefined && fallback === undefined) {
      console.error(ms.nadaParaEditar);
      return 2;
    }
    const r = editarBloco(raiz, modo, Number(bloco), { runtime, model, effort, ...(fallback !== undefined ? { fallback } : {}) }, por);
    if (!r.ok) {
      console.error(ms.edicaoRecusada(r.erro ?? ''));
      return 1;
    }
    if (args.opcoes.json === true) { console.log(JSON.stringify(r.setup.modos[modo], null, 2)); return 0; }
    console.log(ms.blocoAlterado(r.bloco, MODOS[modo].tag,
      `${r.de?.runtime}/${r.de?.model}/${r.de?.effort}`, `${r.para?.runtime}/${r.para?.model}/${r.para?.effort}`));
    console.log(ms.gravado(r.caminho));
    console.log('');
    console.log(textoDoSetup(raiz, modo));
    return 0;
  }

  console.log(args.opcoes.json === true ? JSON.stringify(lerSetup(raiz).modos[modo], null, 2) : textoDoSetup(raiz, modo));
  return 0;
}

function comandoPhase(args: Args): number {
  const sub = args.posicionais[1];
  const carregado = exigirManifesto();
  const m = msg().phase;
  if (sub === 'run') {
    avisarChavesDePerfis(carregado);
    const id = args.posicionais[2];
    const faseBruta = args.posicionais[3];
    const prompt = texto(args.opcoes.prompt);
    if (!id || !faseBruta || !prompt) {
      console.error(m.usoRun);
      return 2;
    }
    const thread = lerThread(carregado.raiz, id);
    const fase: Fase = exigirFase(thread, faseBruta);
    const conducao = conducaoDoCli(args);
    // RM-061 (F2a, D6): o despacho grava prompt, ledger, lease e pedidos em pt-BR; so a impressao segue o locale.
    const r = comLocale('pt-BR', () => rodarFase(carregado, id, {
      fase,
      prompt,
      runtime: texto(args.opcoes.runtime),
      model: texto(args.opcoes.model),
      effort: texto(args.opcoes.effort),
      perfil: texto(args.opcoes.perfil),
      dryRun: args.opcoes['dry-run'] === true,
      canal: conducao.canal,
      ...(conducao.correlacao ? { correlacao: conducao.correlacao } : {}),
      ...(conducao.esperarMs ? { esperarMs: conducao.esperarMs } : {}),
      // A baseline que o despacho grava espera a fila pesada com aviso; a recusa sugere gravá-la antes, com mais espera.
      filaPesada: filaPesadaDoCli(args, 'baseline', `ork verify ${id} --baseline --esperar 120`),
    }));
    // I-36 (T12, T14): pedido repetido e segundo pedido tem resposta propria, antes dos outros gates.
    if (r.idempotente && r.conducao) {
      console.log(textoDoPedidoRepetido(id, r.conducao));
      return 0;
    }
    if (r.motivo === 'conducao.em-andamento') {
      console.log(args.opcoes.json === true && r.recusa ? JSON.stringify(r.recusa, null, 2) : r.recusa?.texto ?? r.erro);
      return 3;
    }
    // RM-037 (defeito 3): a recusa por vaga e espera, como a da conducao (codigo 3), e diz quem ocupa.
    if (r.motivo === 'concurrency.limite' && r.vaga) {
      if (args.opcoes.json === true) { console.log(JSON.stringify({ motivo: r.motivo, ...r.vaga }, null, 2)); return 3; }
      console.log(m.vagaRecusada(r.vaga.ocupam.length, r.vaga.limite));
      for (const o of r.vaga.ocupam) {
        console.log(`  ${o.thread.padEnd(20)} ${(o.fase ?? '-').padEnd(6)} ` +
          `${o.sessao ? `${o.runtime} ${o.sessao.slice(0, 8)}` : m.despachoEmCurso}, ${m.desde(localizarTextoRotulado(o.desde))}`);
      }
      console.log(m.correcao(r.vaga.correcao));
      console.log(r.dryRun ? m.vagaEnsaio : m.vagaLedger(id));
      return 3;
    }
    // RM-037 (S-4 do CHECK 3): a baseline que o despacho nao conseguiu gravar nao e gate reprovado.
    if (r.motivo === 'baseline.pendente') {
      if (args.opcoes.json === true) { console.log(JSON.stringify({ motivo: r.motivo, detalhe: r.erro }, null, 2)); return 1; }
      console.error(m.recusado(`${r.erro}`));
      console.error(m.baselinePendente);
      return 1;
    }
    // RM-061 (F2a): o resumo do despacho sai pelo catalogo; o rotulo tem largura 14, como antes.
    const campo = (rotulo: string, valor: string) => `  ${rotulo.padEnd(14)} : ${valor}`, rt = m.rotulos;
    if (r.dryRun && !r.bloqueado) {
      console.log(m.simulacao);
      console.log(campo(rt.slug, r.slug));
      console.log(campo(rt.prompt, `${r.promptPath}`));
      console.log(campo(rt.sha256, `${r.promptSha256}`));
      console.log(campo(rt.pausaAoFim, m.simNao(!!r.pausaAoFim)));
      console.log(campo(rt.runtime, `${r.runtime}`));
      console.log(campo(rt.modelo, `${r.model}/${r.effort}`));
      // O prompt inteiro nao cabe na tela: o argumento longo aparece mascarado.
      console.log(campo(rt.comando, r.comando.map((c) => (c.length > 80 ? '"<prompt>"' : c)).join(' ')));
      for (const l of linhasDeAviso(r.violacoes ?? [])) console.log(l);
      return 0;
    }
    if (r.bloqueado) {
      console.error(m.bloqueado(`${r.motivo}`));
      for (const v of r.violacoes) {
        console.error(`  [${v.severidade}] policy ${v.policy}: ${v.detalhe}`);
        console.error(m.violacaoCorrecao(v.correcao));
      }
      console.error(m.promptNaoGravado(id));
      return 1;
    }
    if (!r.sessionId) {
      // I-35: o erro vai ao ledger com o ISO; o dono le no fuso dele, com o fuso dito uma vez.
      console.error(m.falhou(`${r.erro ? localizarTextoRotulado(r.erro) : r.erro}`));
      console.error(m.falhouLedger(id));
      return 1;
    }
    console.log(m.despachada(fase));
    for (const l of linhasDeAviso(r.violacoes ?? [])) console.log(l);
    console.log(campo(rt.sessionId, r.sessionId));
    console.log(campo(rt.slug, `${r.slug} (${descreverSlug(r.slug)})`));
    console.log(campo(rt.prompt, `${r.promptPath}`));
    console.log(campo(rt.sha256, `${r.promptSha256}`));
    console.log(campo(rt.runtime, `${r.runtime}`));
    console.log(campo(rt.modelo, m.modeloGravado(`${r.model}`, `${r.effort}`)));
    console.log(m.verificada(!!r.verificada));
    console.log(m.pausaNoFim(!!r.pausaAoFim));
    console.log('');
    if (r.runtime === 'claude-bg') {
      console.log(m.acompanheClaude(r.sessionId, id));
    } else {
      console.log(m.acompanhe(id));
    }
    return r.verificada ? 0 : 1;
  }
  if (sub === 'list') {
    const id = args.posicionais[2];
    if (!id) {
      console.error(m.usoList);
      return 2;
    }
    console.log(tabelaDoLedger(carregado.raiz, id));
    return 0;
  }
  console.error(msg().cli.subcomandoDesconhecido('phase', sub));
  return 2;
}

function comandoLedger(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  const m = msg().operacao.ledger;
  if (sub === 'stats') {
    const desde = texto(args.opcoes.desde);
    if (!desde) throw Error(m.usoStats);
    const r = coletarEstatisticas(carregado.raiz, { desde, ate: texto(args.opcoes.ate), thread: texto(args.opcoes.thread), modo: texto(args.opcoes.modo), runtime: texto(args.opcoes.runtime) });
    console.log(args.opcoes.json === true ? JSON.stringify(r, null, 2) : textoDasEstatisticas(r));
    return 0;
  }
  if (sub === 'estimate') {
    const thread = args.posicionais[2], semIa = Number(texto(args.opcoes['sem-ia'])), iaSemOrk = Number(texto(args.opcoes['ia-sem-ork']));
    const por = texto(args.opcoes.por), metodo = texto(args.opcoes.metodo), premissas = texto(args.opcoes.premissas);
    if (!thread || !por || !metodo || !premissas) throw Error(m.usoEstimate);
    const e = registrarEstimativaPlano(carregado.raiz, thread, { semIaHoras: semIa, iaSemOrkHoras: iaSemOrk, por, metodo, premissas, incerteza: texto(args.opcoes.incerteza) });
    console.log(args.opcoes.json === true ? JSON.stringify(e, null, 2) : m.estimativa(thread, semIa, iaSemOrk));
    return 0;
  }
  throw Error(m.uso);
}

/**
 * `ork sessions hitl`: quem, entre as sessoes do runtime, espera o humano AGORA.
 *
 * Complementa o `ork monitor`, que e thread-centrico: aqui a varredura parte das SESSOES,
 * entao ela enxerga a sessao `claude --bg` que travou em HITL sem ter thread nenhuma --
 * o buraco exato do incidente de 05/09/2026 (codigo 2FA do `npm publish`).
 *
 * O `--exigir-limpo` transforma o radar em watchdog: sai != 0 enquanto houver sessao
 * esperando humano, entao um cron ou o proprio orquestrador trata "tem gente esperando"
 * como falha acionavel, sem precisar interpretar texto.
 */
function comandoSessionsHitl(args: Args, raiz: string): number {
  const ms = msg().operacao.restante.sessions;
  const bruto = texto(args.opcoes.atencao);
  const atencaoMin = bruto === undefined ? undefined : Number(bruto);
  if (atencaoMin !== undefined && (!Number.isFinite(atencaoMin) || atencaoMin < 0)) {
    console.error(ms.atencao(bruto ?? ''));
    return 2;
  }
  const radar = varrerSessoes({
    raiz,
    registrar: args.opcoes.registrar === true,
    escopo: texto(args.opcoes.escopo)?.split(',').map(s => s.trim()),
    registrarMaquina: args.opcoes['registrar-maquina'] === true,
    linhasLogs: texto(args.opcoes.linhas) === undefined ? undefined : Number(texto(args.opcoes.linhas)),
    soDaRaiz: args.opcoes['so-da-raiz'] === true,
    soParadas: args.opcoes['so-paradas'] === true,
    semLogs: args.opcoes['sem-logs'] === true,
    atencaoMin,
  });
  console.log(args.opcoes.json === true ? JSON.stringify(radar, null, 2) : textoDoRadar(radar));
  if (!radar.runtimeConsultado) return 1;
  if (args.opcoes['exigir-limpo'] === true) return radar.resumo.precisamDeHumano > 0 ? 1 : 0;
  return 0;
}

function comandoSessions(args: Args): number {
  const ms = msg().operacao.restante.sessions;
  const sub = args.posicionais[1];
  const carregado = carregarManifesto();
  const raiz = carregado?.raiz ?? diretorioDoProjeto();
  if (sub === 'watch') {
    const id = texto(args.opcoes.thread);
    if (!carregado || !id) { console.error(ms.usoWatch); return 2; }
    const thread = lerThread(raiz, id);
    const sessionId = texto(args.opcoes.sessao) ?? thread.sessoes.at(-1)?.sessionId;
    if (!sessionId || !thread.sessoes.some(s => s.sessionId === sessionId)) throw new Error(ms.sessaoDaThread);
    console.log(JSON.stringify(args.opcoes.once === true ? observarSessao(carregado, sessionId) : { pid: iniciarWatcher(raiz, sessionId) }));
    return 0;
  }
  if (sub === 'event') {
    const tipo = texto(args.opcoes.tipo), sessao = texto(args.opcoes.sessao);
    if (!carregado || !tipo || !sessao) {
      console.error(ms.usoEvent);
      return 2;
    }
    try { console.log(JSON.stringify(ingerirEvento(raiz, sessao, tipo, lerPayloadSensor()))); return 0; }
    catch (e) { console.error(ms.eventoRecusado((e as Error).message)); return 1; }
  }
  if (sub === undefined || sub === 'list') {
    const r = inventariarSessoes(raiz, { todas: args.opcoes.all === true, global: args.opcoes.global === true });
    console.log(args.opcoes.json === true ? JSON.stringify(r, null, 2) : textoDoInventario(r));
    return !r.ok || (args.opcoes['exigir-limpo'] === true && r.semThread > 0) ? 1 : 0;
  }
  if (sub === 'limpar-fantasmas') {
    if (!carregado) { console.error(ms.exigeProjeto); return 2; }
    const r = limparFantasmas(raiz, { dryRun: args.opcoes['dry-run'] === true });
    console.log(args.opcoes.json === true ? JSON.stringify(r, null, 2) : textoDaLimpeza(r));
    return r.ok ? 0 : 1;
  }
  if (sub === 'hitl') {
    return comandoSessionsHitl(args, carregado ? raiz : '');
  }
  if (sub === 'request') {
    const id = args.posicionais[2], sessionId = args.posicionais[3];
    const fase = texto(args.opcoes.fase), runtime = texto(args.opcoes.runtime), pergunta = texto(args.opcoes.pergunta);
    if (!id || !sessionId || !fase || !FASES.includes(fase as Fase) || !runtime) throw new Error(ms.request);
    console.log(JSON.stringify(abrirPedidoSessao(raiz, id, sessionId, { fase: fase as Fase, runtime, pergunta, prazo: texto(args.opcoes.prazo) })));
    return 0;
  }
  if (sub === 'answer') {
    const id = args.posicionais[2], pedido = args.posicionais[3];
    if (!id || !pedido || args.opcoes.stdin !== true) throw new Error(ms.answer);
    const r = lerRespostaStdin({ origem: texto(args.opcoes.origem), por: texto(args.opcoes.por),
      mensagem: texto(args.opcoes.mensagem), canal: texto(args.opcoes.canal), conta: texto(args.opcoes.conta) });
    console.log(JSON.stringify(responderSessao(raiz, id, pedido, r)));
    return 0;
  }
  if (sub === 'reconcile') {
    // FX3: fecha um envio pendente so com (thread, pedido). Nao reenvia e nao re-elicita:
    // pergunta ao receptor, pelo recibo correlacionado, se ele recebeu aquele envioId.
    const id = args.posicionais[2], pedido = args.posicionais[3];
    if (!id || !pedido) throw new Error(ms.reconcile);
    const r = reconciliarEnvioDeSessao(raiz, id, pedido);
    console.log(JSON.stringify(r));
    return r.estado === 'entregue' ? 0 : 1;
  }
  if (sub === 'supersede') {
    const id = args.posicionais[2], sessionId = args.posicionais[3];
    const fase = texto(args.opcoes.fase), runtime = texto(args.opcoes.runtime);
    if (!id || !sessionId || !fase || !FASES.includes(fase as Fase) || !runtime) throw new Error(ms.supersede);
    console.log(JSON.stringify(superarSessao(raiz, id, sessionId, fase as Fase, runtime)));
    return 0;
  }
  const chave = args.posicionais[2];
  if (!chave) {
    console.error(ms.usoSub(sub));
    return 2;
  }
  if (sub === 'adopt') {
    const r = adotarSessao(exigirManifesto(), chave);
    console.log(args.opcoes.json === true ? JSON.stringify(r, null, 2) :
      `${r.detalhe}${r.vinculo ? `: ${r.sessionId} -> ${r.vinculo.thread} (${r.vinculo.raiz})` : ''}`);
    return r.ok ? 0 : 1;
  }
  if (sub === 'logs') {
    const n = Number(texto(args.opcoes.linhas) ?? '60');
    const r = logsDaSessao(chave, Number.isFinite(n) ? n : 60, carregado ? raiz : null);
    console.log(r.texto);
    return r.codigo;
  }
  if (sub === 'stop') {
    const r = pararSessao(chave, carregado ? raiz : null);
    console.log(r.texto);
    return r.codigo;
  }
  if (sub === 'attach') {
    const r = comandoDeAttach(chave, carregado ? raiz : null);
    console.log(r.texto);
    return r.codigo;
  }
  console.error(ms.desconhecido(sub));
  return 2;
}


/**
 * I-41 (GO-FIX 1, B4): a decisao que a sessao toma sem perguntar ao dono vai ao ledger por aqui,
 * com o que foi decidido, o porque, como mudar, o custo de reverter, o criterio escrito, quem
 * decidiu e a evidencia. E assim que ela chega ao dono no resumo, em vez de sumir na conversa.
 */
function comandoDecisao(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1], id = args.posicionais[2];
  if (sub === 'registrar') {
    const campo = (nome: string): string => {
      const v = texto(args.opcoes[nome]);
      if (!v) throw new ErroDoCatalogo((m) => m.decisao.exigeFlag(nome));
      return v;
    };
    if (!id) throw new ErroDoCatalogo((m) => m.decisao.usoRegistrar);
    const bruto = campo('criterio'), separador = bruto.indexOf(':');
    const tipo = bruto.slice(0, separador) as TipoDeCriterio, referencia = bruto.slice(separador + 1);
    if (separador < 1 || !['manifesto', 'ledger', 'medicao'].includes(tipo) || !referencia.trim()) {
      throw new ErroDoCatalogo((m) => m.decisao.criterioUso);
    }
    const entrada = {
      decidido: campo('decidido'), porque: campo('porque'), comoMudar: campo('como-mudar'),
      custoDeReverter: { agora: campo('custo-agora'), depois: campo('custo-depois') },
      criterio: { tipo, referencia }, quemDecidiu: campo('quem'), evidencia: campo('evidencia'),
      razao: texto(args.opcoes.razao), reverte: texto(args.opcoes.reverte),
    };
    let registro: ReturnType<typeof registrarDecisao>;
    // RM-037 (defeito 4): a recusa cita a flag que o dono digitou, com o tamanho e o teto reais.
    try { registro = registrarDecisao(carregado.raiz, id, entrada); }
    catch (e) { throw new Error(recusaNaSuperficie((e as Error).message, CAMPOS_DA_DECISAO_NO_CLI)); }
    const { pedido, evento } = registro;
    const placar = placarDaThread(lerLedger(dirThread(carregado.raiz, id))).find(f => f.fase === pedido.fase);
    console.log(JSON.stringify({ ok: true, pedidoId: pedido.id, eventId: evento.eventId, fase: pedido.fase, placar }));
    return 0;
  }
  if (sub === 'placar') {
    // RM-061 (F3b): o placar pelo catalogo; o `--json` e a fase de cada linha sao dado e nao mudam.
    const md = msg().decisao;
    if (!id) throw new ErroDoCatalogo((m) => m.decisao.usoPlacar);
    lerThread(carregado.raiz, id);
    const placar = placarDaThread(lerLedger(dirThread(carregado.raiz, id)));
    const taxa = taxaDeReversao(placar);
    if (args.opcoes.json === true) {
      console.log(JSON.stringify({ thread: id, limiar: LIMIAR_DE_DECISOES_POR_FASE, taxaDeReversao: taxa, fases: placar }, null, 2));
      return 0;
    }
    console.log(tabela([...md.colunasDoPlacar],
      placar.map(f => [f.fase, String(f.decididas), String(f.informadas), String(f.perguntas), String(f.revertidas),
        String(f.semRastro), f.acimaDoLimiar ? md.acimaDoLimiar(LIMIAR_DE_DECISOES_POR_FASE) : md.dentroDoLimiar])));
    console.log(md.taxaDeReversao(taxa));
    return 0;
  }
  throw new ErroDoCatalogo((m) => m.decisao.uso);
}

/**
 * I-50 (RM-039): a tag que o dono manda no Telegram, pelo terminal. Sem tag, mostra a cadencia em
 * vigor. O `#` e opcional porque o shell trata `#` no inicio da palavra como comentario.
 */
function comandoCadenciaDoPulse(args: Args): number {
  const carregado = exigirManifesto();
  const m = msg().operacao.pulseCadencia;
  if (args.posicionais.length > 3) throw new Error(m.umaTag);
  const bruta = args.posicionais[2];
  const agora = new Date().toISOString();
  if (bruta !== undefined) {
    const lido = interpretarRespostaDoPulse(bruta.trim().startsWith('#') ? bruta : `#${bruta.trim()}`);
    if (lido.forma !== 'cadencia') {
      throw new Error(m.desconhecida(bruta, Object.keys(CADENCIAS).join(', ')));
    }
    gravarCadencia(carregado.raiz, lido.tag, { por: texto(args.opcoes.por) ?? userInfo().username,
      canal: texto(args.opcoes.canal) ?? 'terminal', em: agora });
  }
  const vigente = lerCadencia(carregado.raiz);
  if (args.opcoes.json === true) {
    console.log(JSON.stringify({ tag: vigente.tag, janelaMin: vigente.janelaMin, ancoraMin: vigente.ancoraMin,
      descricao: vigente.descricao, gravada: vigente.gravada, proximaJanela: inicioDaProximaJanela(vigente, agora) }, null, 2));
    return 0;
  }
  console.log(textoDaCadencia(vigente, agora));
  console.log(vigente.gravada
    ? m.trocada(vigente.gravada.por, vigente.gravada.canal, formatarDataHoraRotulada(vigente.gravada.em))
    : m.padrao);
  return 0;
}

function comandoClaims(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  // RM-061 (F3b, D3): o texto pelo catalogo; o que se grava (claims.jsonl, ledger) roda no escopo pt-BR, e a alegacao,
  // o arquivo, o comando e o motivo digitado saem como vieram. O estado da claim so se traduz na impressao.
  const mc = msg().claims;
  if (sub === 'add') {
    const id = args.posicionais[2];
    const arquivo = args.posicionais[3];
    const alegacao = texto(args.opcoes.claim) ?? texto(args.opcoes.alegacao);
    if (!id || !arquivo || !alegacao) {
      console.error(mc.usoAdd);
      return 2;
    }
    const comando = texto(args.opcoes.verificar) ?? texto(args.opcoes.verify);
    const faseBruta = texto(args.opcoes.fase);
    const thread = lerThread(carregado.raiz, id);
    const claim = comLocale('pt-BR', () => adicionarClaim(carregado.raiz, id, {
      arquivo,
      alegacao,
      verificar: comando ? [comando] : [],
      fase: faseBruta ? exigirFase(thread, faseBruta) : undefined,
    }));
    console.log(mc.registrada(claim.id, id));
    console.log(mc.campoArquivo(claim.arquivo));
    console.log(mc.campoAlegacao(claim.alegacao));
    console.log(mc.campoNegativa(claim.negativa));
    console.log(mc.campoVerificar(claim.verificar.join(' && ')));
    console.log(mc.campoEstado(mc.estado(claim.estado)));
    if (claim.negativa && claim.verificar.length === 0) {
      console.log('');
      console.log(mc.avisoNegativa);
    }
    // RM-008 (B8): a conferencia local da policy claim_sem_prova_local avisa e segue.
    const linhasDePolicy = linhasDeAviso(claim.avisosDePolicy ?? []);
    if (linhasDePolicy.length) { console.log(''); for (const l of linhasDePolicy) console.log(l); }
    // I-53 (RM-037, P6): o lint avisa aqui; a suite inteira e recusada no `ci prepare`.
    for (const a of claim.lint ?? []) {
      console.log('');
      console.log(mc.avisoDoLint(linhaDoLintDeClaim(claim.id, a), a.regra === 'suite-inteira'));
    }
    return 0;
  }
  if (sub === 'conferir') {
    // RM-059 (T0.10): so o que foi pedido, no sandbox do verify, sob a conducao da thread, sem recibo.
    const id = args.posicionais[2];
    const json = args.opcoes.json === true;
    const claims = texto(args.opcoes.claims);
    const tarefa = texto(args.opcoes.tarefa);
    const prazo = texto(args.opcoes.prazo);
    const semValor = ['claims', 'tarefa', 'prazo'].some((o) => args.opcoes[o] === true);
    if (!id || semValor || (claims === undefined) === (tarefa === undefined)) {
      console.error(mc.usoConferir);
      return 2;
    }
    const conducao = conducaoDoCli(args);
    try {
      // O resultado e as recusas nascem em pt-BR, como o --json os leva; o texto os remonta no locale do comando.
      const r = comLocale('pt-BR', () => conferirClaims(carregado, id, {
        claims: claims !== undefined ? idsDeClaims(claims) : undefined,
        tarefa,
        prazoMs: prazo !== undefined ? Number(prazo) * 1000 : undefined,
        canal: conducao.canal,
        correlacao: conducao.correlacao,
      }));
      console.log(json ? JSON.stringify(r, null, 2) : textoDaConferencia(r));
      return r.ok ? 0 : 1;
    } catch (e) {
      if (!(e instanceof ErroDeConferencia)) throw e;
      if (json) console.log(JSON.stringify({ formato: FORMATO_DA_CONFERENCIA, thread: id, ok: false, erro: e.message }, null, 2));
      else console.error(mensagemDoErro(e));
      return 2;
    }
  }
  if (sub === 'verificar') {
    const id = args.posicionais[2];
    const claimId = args.posicionais[3];
    const comando = texto(args.opcoes.comando) ?? texto(args.opcoes.verificar);
    if (!id || !claimId || !comando) {
      console.error(mc.usoVerificar);
      return 2;
    }
    const claim = comLocale('pt-BR', () => anexarComando(carregado.raiz, id, claimId, comando));
    console.log(mc.comandoAnexado(claim.id));
    console.log(mc.campoVerificar(claim.verificar.join(' && ')));
    console.log(mc.campoEstado(mc.estado(claim.estado)));
    console.log('');
    console.log(mc.proveAgora(id));
    return 0;
  }
  if (sub === 'retirar') {
    const id = args.posicionais[2];
    const claimId = args.posicionais[3];
    const motivo = texto(args.opcoes.motivo);
    if (!id || !claimId || !motivo) {
      console.error(mc.usoRetirar);
      return 2;
    }
    const claim = comLocale('pt-BR', () => retirarClaim(carregado.raiz, id, claimId, motivo));
    console.log(mc.retirada(claim.id, id));
    console.log(mc.campoAlegacao(claim.alegacao));
    console.log(mc.campoMotivo(motivo));
    console.log(mc.historicoContinua);
    return 0;
  }
  if (sub === 'ausente') {
    const id = args.posicionais[2];
    const paths = (texto(args.opcoes.paths) ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    const motivo = texto(args.opcoes.motivo);
    if (!id || paths.length === 0 || !motivo) {
      console.error(mc.usoAusente);
      return 2;
    }
    comLocale('pt-BR', () => registrarProvaAusente(carregado.raiz, id, { paths, motivo, commit: texto(args.opcoes.commit) }));
    console.log(mc.ausenciaRegistrada(id, paths.join(', ')));
    console.log(mc.campoMotivo(motivo));
    return 0;
  }
  if (sub === 'list' || sub === undefined) {
    const id = args.posicionais[2];
    if (!id) {
      console.error(mc.usoList);
      return 2;
    }
    console.log(tabelaDeClaims(carregado.raiz, id));
    return 0;
  }
  console.error(msg().cli.subcomandoDesconhecido('claims', sub));
  return 2;
}

function comandoVerify(args: Args): number {
  const carregado = exigirManifesto();
  const id = args.posicionais[1];
  const m = msg().verify;
  if (!id) {
    console.error(m.uso);
    return 2;
  }
  // RM-072 (D1): `--check classic|agile` vence o `check.mode` do manifesto; outro valor sai com 2 e os dois aceitos.
  const brutoDoCheck = args.opcoes.check;
  const check = brutoDoCheck === undefined ? undefined : lerModo(brutoDoCheck);
  if (check === null) {
    console.error(m.checkInvalido(typeof brutoDoCheck === 'string' ? brutoDoCheck : null));
    return 2;
  }
  // RM-058 N2 (D10): enquanto a fila de recursos pesados nao da a vez, o CLI diz uma vez por quem espera.
  const aoEsperar = (ocupantes: OcupanteDaFila[]) => console.error(m.filaPesadaEsperando(args.opcoes.baseline === true ? 'baseline' : 'verify',
    ocupantes.map((o) => m.filaPesadaOcupante(o.operacao, o.thread, formatarDataHora(o.desde))).join('; ')));
  const doCli = conducaoDoCli(args);
  // O `ork verify` do CLI espera a fila em primeiro plano ate `--esperar` ou 60 min; a recusa sugere o dobro.
  const conducao = { ...doCli, filaPesada: { aoEsperar, esperarMs: doCli.esperarMs ?? ESPERA_DA_FILA_PESADA_MS,
    comandoDeEsperar: `ork verify ${id}${args.opcoes.baseline === true ? ' --baseline' : ''} --esperar 120` } };
  if (args.opcoes.baseline === true) {
    // RM-061 (F2b, G2): a baseline e o ledger sao gravados em pt-BR; so a impressao segue o locale.
    const b = comLocale('pt-BR', () => gravarBaseline(carregado, id, undefined, conducao, 'cli', undefined, check));
    console.log(m.baselineGravada(id));
    console.log(m.baselineCommit(b.commit));
    // RM-037 (defeito 1 de 19 e 20/10/2026): o comando sem veredito nao sai como "ja falhava".
    for (const linha of linhasDaBaseline(b, id)) console.log(linha);
    if (b.comandos.some((c) => !c.ok)) {
      // Ensaio de 03/10 (R7): "ja falhava" sem dizer onde ver a saida do comando.
      console.log(m.baselineSaida(caminhoThread(carregado.raiz, id), id));
    }
    if (b.comandos.length === 0) {
      // Fatia 2 do ensaio da 0.5.0 (R5): a baseline foi gravada; o que falta e comando, nao baseline.
      console.log(m.baselineSemComandos);
    }
    return 0;
  }
  const r = comLocale('pt-BR', () => verificar(carregado, id, { soClaims: args.opcoes['so-claims'] === true, conducao, check }));
  console.log(textoDoVerify(r));
  return r.ok ? 0 : 1;
}

/**
 * `ork conducao status|assumir` (I-36, T15): quem conduz a thread agora, e o handoff explicito. O
 * status tambem libera, com prova no ledger, a conducao que ficou sem dono (T16).
 */
/**
 * RM-059 (F6, T6.4; DD5 do plano dos mods): `ork conducao sentinela status|bater|desligar`. A presenca da
 * Sentinela do Condutor nesta maquina e o passo do condutor em cada thread aberta; o condutor externo le o
 * `status --json` para ceder o despacho enquanto a presenca vale. Nada aqui despacha.
 */
function comandoSentinela(carregado: ManifestoCarregado, args: Args): number {
  const m = msg().conducao.cli;
  const acao = args.posicionais[2] ?? 'status';
  const json = args.opcoes.json === true;
  if (acao === 'status') {
    const s = statusDaSentinela(carregado);
    console.log(json ? JSON.stringify(s, null, 2) : textoDoStatusDaSentinela(s));
    return 0;
  }
  if (acao !== 'bater' && acao !== 'desligar') throw new Error(m.sentinelaUso);
  const sessao = texto(args.opcoes.sessao);
  if (!sessao) throw new Error(m.sentinelaSessao(acao));
  if (acao === 'bater') {
    const r = baterSentinela(carregado.raiz, { sessao });
    const curta = r.presenca.sessao.slice(0, 8);
    console.log(json ? JSON.stringify(r, null, 2) : r.ok
      ? m.sentinelaLigada(r.ligou, r.presenca.maquina, curta)
      : m.sentinelaOutra(curta, r.presenca.maquina));
    return r.ok ? 0 : 3;
  }
  const motivo = texto(args.opcoes.motivo);
  const r = desligarSentinela(carregado.raiz, { sessao, ...(motivo ? { motivo } : {}) });
  console.log(json ? JSON.stringify(r, null, 2) : r.desligada ? m.sentinelaOff : m.sentinelaNada);
  return 0;
}

/**
 * RM-063 (F7): `ork conducao autorizar|autorizacao`. A autorizacao duravel do dono nesta maquina
 * (`ork.autorizacao-duravel/v1`, fora do git): o que a batida da conducao pode fazer sozinha e ate quando.
 */
function comandoAutorizacao(carregado: ManifestoCarregado, args: Args, sub: 'autorizar' | 'autorizacao'): number {
  const m = msg().conducao.cli;
  const json = args.opcoes.json === true;
  const projeto = carregado.manifesto.project.name;
  if (sub === 'autorizacao') {
    if (args.posicionais.length > 2) throw new Error(m.autorizacaoUso);
    const leitura = lerAutorizacao(carregado.raiz, { projeto });
    console.log(json ? JSON.stringify(leitura, null, 2) : textoDaAutorizacao(leitura));
    return 0;
  }
  const ate = texto(args.opcoes.ate), pode = texto(args.opcoes.pode);
  if (!ate || !pode || args.posicionais.length > 2) {
    throw new Error(m.autorizarUso);
  }
  const r = gravarAutorizacao(carregado.raiz, { ate, pode, por: texto(args.opcoes.por), nota: texto(args.opcoes.nota), projeto,
    fuso: fusoDoManifesto(carregado).fuso, canal: conducaoDoCli(args).canal });
  if (!r.ok) {
    console.log(json ? JSON.stringify(r, null, 2) : m.autorizacaoRecusada(r.motivo, r.detalhe));
    return 1;
  }
  const a = r.anterior;
  console.log(json ? JSON.stringify({ ok: true, leitura: r.leitura, anterior: a }, null, 2) : [
    m.autorizacaoGravada(linhaDaAutorizacao(r.leitura)),
    ...(a ? [m.substitui(a.por, formatarDataHoraRotulada(a.ate), a.pode.join(', '))] : []),
    m.arquivo(r.leitura.arquivo)].join('\n'));
  return 0;
}

function comandoConducao(args: Args): number {
  const carregado = exigirManifesto();
  const m = msg().conducao.cli;
  const sub = args.posicionais[1];
  const id = args.posicionais[2];
  if (sub === 'sentinela') return comandoSentinela(carregado, args);
  if (sub === 'autorizar' || sub === 'autorizacao') return comandoAutorizacao(carregado, args, sub);
  if (sub === 'batida') {
    // RM-063 (F7): o passo deterministico da conducao, o mesmo que a varredura do cron roda depois do resumo.
    if (args.posicionais.length > 2) throw new Error(m.batidaUso);
    const r = baterConducao(carregado, { canal: conducaoDoCli(args).canal });
    const textoDaRodada = textoDaBatida(r);
    console.log(args.opcoes.json === true ? JSON.stringify(r, null, 2) : textoDaRodada);
    // RM-063 (H2): o `#OrkRetomar` do canal roda esta batida em segundo plano; o que voltou a andar volta ao dono pelo
    // transporte do pulse (com o outro host configurado, se o primeiro falhar).
    if (args.opcoes.entregar === true) {
      const mensagem = `🔁 Orkastery, retomada em ${nomeDaMaquina()}:\n${textoDaRodada}`.slice(0, 3900);
      try {
        const e = entregarPeloTransporte(carregado.raiz, mensagem, { oQue: 'a retomada' });
        if (!e.ok) console.error(m.pulseAviso);
      } catch (e) { console.error(m.pulseFalha((e as Error).message)); }
    }
    return r.ocupada ? 3 : 0;
  }
  if (sub === 'atualizar') {
    // RM-063 (F7): o merge da base remota na branch da thread, com a reconciliacao do CHANGELOG; conflito em codigo aborta.
    if (!id || args.posicionais.length > 3) throw new Error(m.atualizarUso);
    lerThread(carregado.raiz, id);
    const doCli = conducaoDoCli(args);
    const r = atualizarBranchDaThread(carregado, id, { enviar: args.opcoes.enviar === true, canal: doCli.canal, correlacao: doCli.correlacao,
      ...(doCli.esperarMs ? { esperarMs: doCli.esperarMs } : {}) });
    console.log(args.opcoes.json === true ? JSON.stringify(r, null, 2) : textoDaAtualizacao(r));
    return r.acao === 'mesclada' || r.acao === 'ja-atualizada' ? 0 : r.acao === 'recusada' && r.motivo === 'conduzida' ? 3 : 1;
  }
  if (sub === 'status') {
    if (!id) throw new Error(m.statusUso);
    lerThread(carregado.raiz, id);
    liberarSeOrfa(carregado.raiz, id);
    const atual = conducaoDaThread(carregado.raiz, id);
    console.log(args.opcoes.json === true ? JSON.stringify({ thread: id, conducao: atual }, null, 2) : textoDoStatusDaConducao(id, atual));
    return 0;
  }
  if (sub === 'assumir') {
    const por = texto(args.opcoes.por), motivo = texto(args.opcoes.motivo);
    if (!id || !por || !motivo) throw new Error(m.assumirUso);
    const r = assumirConducao(carregado.raiz, id, { por, motivo, canal: conducaoDoCli(args).canal });
    console.log(args.opcoes.json === true ? JSON.stringify(r, null, 2) : m.assumida(r.ok, r.detalhe));
    return r.ok ? 0 : 3;
  }
  throw new Error(m.uso);
}

/** RM-048 (D1): o gate aberto no contrato curto, com o codigo estavel e o "desde" do ledger. */
function textoDoGateCurto(raiz: string, pedido: PedidoHitlQualquer, canal: 'telegram' | 'terminal'): string {
  const quando = new Date().toISOString();
  const eventos = lerLedger(dirThread(raiz, pedido.thread));
  const codigo = (pedido as { codigo?: unknown }).codigo;
  const curto = montarPedidoCurto(entradaDoPedido(pedido, desdeDoPedido(eventos, pedido)),
    { quando, responder: typeof codigo === 'string' ? { tipo: 'codigo', codigo } : { tipo: 'dialogo' } });
  return textoDoPedidoCurto(curto, canal);
}

function comandoGate(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  const mg = msg().operacao.restante.gate;
  if (sub === 'context') {
    const id = args.posicionais[2], pedido = args.posicionais[3];
    if (!id || !pedido || args.posicionais.length !== 4 ||
        Object.entries(args.opcoes).some(([k, v]) => k !== 'native-offer-stdin' || v !== true))
      throw Error(mg.usoContext);
    const view = contextoDoPedidoNativo(carregado.raiz, id, pedido);
    const callback = args.opcoes['native-offer-stdin'] ? readNativeOfferStdin() : undefined;
    console.log(JSON.stringify({ ...view, canais: ofertaDoPedido(view.pedido, [],
      callback === undefined ? undefined : { callback, raiz: carregado.raiz }),
      apresentacao: apresentarDecisao(view.pedido), prazoLocal: prazoLocalDoPedido(view.pedido) }));
    return 0;
  }
  if (sub === 'request') {
    const id = args.posicionais[2];
    if (!id) throw new Error(mg.requestThread);
    const formato = texto(args.opcoes.formato);
    if (formato !== undefined && formato !== 'telegram' && formato !== 'terminal') throw new Error(mg.formato);
    const pedido = abrirPedidoGate(carregado.raiz, id, texto(args.opcoes.motivo));
    // RM-048 (D1): com --formato, o que sai e o pedido no contrato curto, pronto para o canal, com
    // o codigo estavel na ultima linha. Sem ele, o JSON de sempre, para quem integra.
    console.log(formato ? textoDoGateCurto(carregado.raiz, pedido, formato) : JSON.stringify(pedido));
    return 0;
  }
  if (sub === 'answer') {
    const id = args.posicionais[2], pedido = args.posicionais[3];
    if (!id || !pedido || args.opcoes['resposta-stdin'] !== true || args.opcoes.resposta !== undefined) throw new Error(mg.answer);
    const r = lerRespostaStdin({ por: texto(args.opcoes.por), mensagem: texto(args.opcoes.mensagem),
      origem: texto(args.opcoes.origem), canal: texto(args.opcoes.canal), conta: texto(args.opcoes.conta) });
    console.log(JSON.stringify(responderGate(carregado.raiz, id, pedido, r)));
    return 0;
  }
  if (sub === 'next') {
    const id = args.posicionais[2];
    if (!id) {
      console.error(mg.usoNext);
      return 2;
    }
    const thread = lerThread(carregado.raiz, id);
    const proximoBruto = texto(args.opcoes.proximo) ?? texto(args.opcoes['proxima-fase']);
    const ocupacaoBruta = texto(args.opcoes.ocupacao);
    const janelaBruta = texto(args.opcoes.janela);
    const v = gateDeTokens(carregado, id, {
      proximo: proximoBruto ? exigirFase(thread, proximoBruto) : undefined,
      ocupacao: ocupacaoBruta !== undefined ? Number(ocupacaoBruta) : undefined,
      fonte: texto(args.opcoes.fonte) as FonteDeMedida | undefined,
      transcript: texto(args.opcoes.transcript),
      janela: janelaBruta !== undefined ? Number(janelaBruta) : undefined,
      refazer: args.opcoes.refazer === true,
      sessao: texto(args.opcoes.sessao),
    });
    console.log(textoDoGateDeTokens(v));
    return 0;
  }
  if (sub === 'approve') {
    const id = args.posicionais[2];
    const sobre = args.posicionais[3];
    const por = texto(args.opcoes.por) ?? texto(args.opcoes.quem);
    if (!id || !sobre || !por) {
      console.error(mg.approveAposentado);
      return 2;
    }
    lerThread(carregado.raiz, id);
    const e = aprovarGateHumano(carregado.raiz, id, sobre, por, texto(args.opcoes.obs));
    console.log(mg.registrado(id));
    console.log(mg.sobre(sobre));
    console.log(mg.autorizado(por));
    console.log(mg.quando(formatarDataHoraRotulada(e.ts)));
    return 0;
  }
  console.error(mg.desconhecido(sub));
  return 2;
}

/**
 * `ork retry`: a politica de retry tipada e a fila duravel de rate limit (bloco B3).
 *
 * O comando existe separado do `ork gate` porque ele nao decide VERDADE: ele decide o
 * que fazer com uma verdade que o gate ja estabeleceu. `plan` calcula sem executar, e
 * por isso nao gasta tentativa nem toca no repositorio.
 */
function comandoRetry(args: Args): number {
  const sub = args.posicionais[1];
  const mr = msg().retry, mc = mr.complementar;

  if (sub === 'policy') {
    const alvo = texto(args.opcoes.motivo);
    if (alvo) {
      const politica = POLITICA_DE_RETRY[alvo as keyof typeof POLITICA_DE_RETRY];
      if (!politica) {
        console.error(mc.motivoDesconhecido(alvo));
        console.error(mc.conhecidos(Object.keys(POLITICA_DE_RETRY).join(', ')));
        return 2;
      }
      if (args.opcoes.json === true) {
        console.log(JSON.stringify(politica, null, 2));
        return 0;
      }
      console.log(mc.motivo(politica.motivo));
      console.log(mc.significado(localeAtivo() === 'en' ? mr.politica[politica.motivo].porque : DESCRICAO_DO_MOTIVO_DE_AUDITORIA[politica.motivo]));
      console.log(mc.acao(politica.acao));
      console.log(mc.automatica(politica.automatica ? mc.sim : mc.nao));
      console.log(mc.porque(mr.politica[politica.motivo].porque));
      console.log(mc.correcao(mr.politica[politica.motivo].correcao));
      return 0;
    }
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(Object.values(POLITICA_DE_RETRY), null, 2));
      return 0;
    }
    console.log(mc.politicaTitulo);
    console.log('');
    console.log(tabelaDaPolitica());
    console.log('');
    for (const linha of mc.politicaFecho) console.log(linha);
    return 0;
  }

  if (sub === 'parse') {
    const bruto = texto(args.opcoes.stderr) ?? args.posicionais.slice(2).join(' ');
    if (!bruto) {
      console.error(mc.usoParse);
      return 2;
    }
    const sinal = parseRateLimit(bruto);
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(sinal, null, 2));
      return sinal ? 0 : 1;
    }
    if (!sinal) {
      console.log(mc.semSinal);
      return 1;
    }
    console.log(mc.sinal);
    console.log(mc.fonte(sinal.fonte));
    console.log(mc.reset(sinal.resetEm ? formatarDataHoraRotulada(sinal.resetEm) : mc.semHora));
    console.log(mc.trecho(sinal.trecho));
    if (sinal.resetEm === null) {
      console.log('');
      for (const linha of mc.estimada) console.log(linha);
    }
    return 0;
  }

  const carregado = exigirManifesto();
  avisarChavesDePerfis(carregado);

  if (sub === 'plan' || sub === 'run') {
    const id = args.posicionais[2];
    if (!id) {
      console.error(msg().retry.usoPlanRun(sub));
      return 2;
    }
    const thread = lerThread(carregado.raiz, id);
    const faseBruta = texto(args.opcoes.fase);
    const opcoes = {
      motivo: texto(args.opcoes.motivo) as MotivoGate | undefined,
      fase: faseBruta ? exigirFase(thread, faseBruta) : undefined,
      autorizadoPor: texto(args.opcoes.por) ?? texto(args.opcoes.quem),
    };
    if (sub === 'plan') {
      // RM-061 (F2b, G2): a razao nasce em pt-BR, como o --json e o ledger a guardam; so a impressao segue o locale.
      const plano = comLocale('pt-BR', () => planejarRetry(carregado, id, opcoes));
      if (args.opcoes.json === true) {
        console.log(JSON.stringify(plano, null, 2));
        return 0;
      }
      console.log(textoDoPlanoDeRetry(plano));
      return 0;
    }
    // I-36 (D2): `--esperar` espera a conducao em andamento terminar antes de executar a retomada.
    const conducao = conducaoDoCli(args);
    if (conducao.esperarMs && args.opcoes['dry-run'] !== true) esperarConducaoLivre(carregado.raiz, id, conducao.esperarMs);
    const r = comLocale('pt-BR', () => executarRetry(carregado, id, {
      ...opcoes,
      dryRun: args.opcoes['dry-run'] === true,
      reverify: args.opcoes.reverify === true,
    }));
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      console.log(textoDoRetry(r));
    }
    // Codigo de saida != 0 quando nada pode ser feito sozinho: e o sinal para o
    // orquestrador parar e chamar o humano, em vez de seguir achando que retomou.
    return r.executada ? 0 : 1;
  }

  if (sub === 'list') {
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(lerFilaDeRetomada(carregado.raiz), null, 2));
      return 0;
    }
    console.log(tabelaDaFila(carregado.raiz));
    const espera = lerFilaDeRetomada(carregado.raiz).filter((p) => p.estado === 'aguardando');
    if (espera.length > 0) {
      console.log('');
      console.log(mc.proxima(formatarDataHora(espera[0].liberaEm), faltaPara(espera[0])));
      console.log(mc.retome);
    }
    return 0;
  }

  if (sub === 'resume') {
    const ocupacaoBruta = texto(args.opcoes.ocupacao);
    const opcoes = {
      quando: texto(args.opcoes.agora),
      dryRun: args.opcoes['dry-run'] === true,
      forcar: args.opcoes.forcar === true,
      ocupacao: ocupacaoBruta !== undefined ? Number(ocupacaoBruta) : undefined,
      fonte: texto(args.opcoes.fonte) as 'runtime_reported' | 'estimated' | 'informada' | undefined,
    };
    const idPedido = texto(args.opcoes.id);
    const rs = idPedido
      ? [retomarPorId(carregado, idPedido, opcoes)]
      : retomarFila(carregado, opcoes);
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(rs, null, 2));
    } else {
      console.log(textoDaRetomada(rs));
    }
    // Escalada nao e sucesso: ela e o pedido de socorro que pausa qualquer modo.
    return rs.some((r) => r.playbook === 'escalada') ? 1 : 0;
  }

  if (sub === 'cancel') {
    const idPedido = args.posicionais[2];
    const motivo = texto(args.opcoes.motivo);
    if (!idPedido || !motivo) {
      console.error(mc.usoCancel);
      return 2;
    }
    const p = cancelarPedido(carregado, idPedido, motivo);
    console.log(mc.cancelado(p.id));
    console.log(mc.thread(p.thread));
    console.log(mc.fase(p.fase));
    console.log(mc.motivoLinha(motivo));
    return 0;
  }

  console.error(mc.desconhecido(sub ?? ''));
  return 2;
}

/**
 * `ork fix`: o sub-loop GO-FIX / CHECK-REVERIFY (bloco B3).
 *
 * `open` deriva a spec do resultado REAL do `ork verify`; `reverify` da veredito POR
 * correcao. O `--parcial` e recusado quando a rodada tem correcao tipo B, porque
 * parcial depois de tipo B nao e CHECK (DoD 10).
 */
function comandoFix(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  const id = args.posicionais[2];
  const mf = msg().operacao.restante.fix;

  if (sub === 'open') {
    if (!id) {
      console.error(mf.usoOpen);
      return 2;
    }
    const conducao = { ...conducaoDoCli(args), filaPesada: filaPesadaDoCli(args, 'verify', `ork fix open ${id} --esperar 30`) };
    const rodada = comLocale('pt-BR', () => abrirRodada(carregado, id, { soClaims: args.opcoes['so-claims'] === true, conducao }));
    const reverify =
      args.opcoes.reverify === true && rodada.correcoes.length > 0
        ? comLocale('pt-BR', () => reverificar(carregado, id, { rodada: rodada.rodada, conducao }))
        : null;
    if (args.opcoes.json === true) {
      console.log(JSON.stringify({ rodada, reverify }, null, 2));
    } else {
      console.log(textoDaRodadaDeFix(rodada));
      if (reverify) {
        console.log('');
        console.log(textoDoReverify(reverify));
      }
    }
    if (rodada.correcoes.length === 0) return 0;
    return reverify && reverify.veredito === 'PASSOU' ? 0 : 1;
  }

  if (sub === 'list') {
    if (!id) {
      console.error(mf.usoList);
      return 2;
    }
    lerThread(carregado.raiz, id);
    const rodadaBruta = texto(args.opcoes.rodada);
    const rodada = rodadaBruta ? Number(rodadaBruta) : ultimaRodada(carregado.raiz, id);
    if (rodada === 0) {
      console.log(mf.semRodada(id));
      return 0;
    }
    const correcoes = correcoesDaRodada(carregado.raiz, id, rodada);
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(correcoes, null, 2));
      return 0;
    }
    console.log(mf.lista(rodada, id));
    console.log('');
    console.log(
      tabela(
        [...mf.colunasLista],
        correcoes.map((c) => [
          c.id,
          c.tipo,
          c.origem,
          c.alvo,
          c.estado,
          c.verificar.join(' && ') || mf.verifyCompleto,
        ])
      )
    );
    return 0;
  }

  if (sub === 'reverify') {
    if (!id) {
      console.error(mf.usoReverify);
      return 2;
    }
    const rodadaBruta = texto(args.opcoes.rodada);
    const r = comLocale('pt-BR', () => reverificar(carregado, id, {
      conducao: { ...conducaoDoCli(args), filaPesada: filaPesadaDoCli(args, 'verify', `ork fix reverify ${id} --esperar 30`) },
      rodada: rodadaBruta ? Number(rodadaBruta) : undefined,
      parcial: args.opcoes.parcial === true,
    }));
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      console.log(textoDoReverify(r));
    }
    return r.veredito === 'PASSOU' ? 0 : 1;
  }

  console.error(mf.desconhecido(sub ?? ''));
  return 2;
}

function comandoHandoff(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  const id = args.posicionais[2];
  const mh = msg().operacao.restante.handoff;
  if (sub === 'export') {
    if (!id) {
      console.error(mh.usoExport);
      return 2;
    }
    const thread = lerThread(carregado.raiz, id);
    const faseBruta = texto(args.opcoes['proxima-fase']) ?? texto(args.opcoes.fase);
    const r = comLocale('pt-BR', () => exportarHandoff(carregado, id, {
      proximaFase: faseBruta ? exigirFase(thread, faseBruta) : undefined,
      slugDestino: texto(args.opcoes.slug),
    }));
    console.log(textoDoHandoff(r.handoff, r.caminho));
    console.log('');
    console.log(mh.historico(r.caminhoHistorico));
    return 0;
  }
  if (sub === 'recall') {
    const ponteiro = args.posicionais[3];
    if (!id || !ponteiro) {
      console.error(mh.usoRecall);
      return 2;
    }
    const r = comLocale('pt-BR', () => recall(carregado, id, ponteiro));
    console.log(mh.resolvido(r.location));
    console.log(mh.metodo(r.metodo));
    console.log(mh.sha(r.sha256));
    console.log(mh.linhas(r.intervalo ? `${r.intervalo.inicio}-${r.intervalo.fim}` : mh.naoAplicavel));
    console.log('');
    console.log(r.conteudo);
    return 0;
  }
  console.error(mh.desconhecido(sub));
  return 2;
}

/**
 * RM-059 (F7, T7.1; DD4 do plano dos mods): `ork ship publicar <thread>`. So publica no modo que ja autoriza push
 * (#Auto e #Maestro); a autorizacao humana na linha nao vale aqui (D1 da ork-rm059pista), e o push do modo que pausa
 * e do dono, no terminal dele.
 */
function comandoShipPublicar(carregado: ManifestoCarregado, args: Args): number {
  const m = msg().ship;
  const p = m.publicar;
  if (args.opcoes['autorizar-push'] !== undefined) {
    console.error(p.semAutorizarPush);
    return 2;
  }
  const alvo = args.posicionais[2];
  if (!alvo || args.posicionais.length > 3) {
    console.error(p.uso);
    return 2;
  }
  if (args.opcoes.remoto !== undefined) exigirRemoto(args.opcoes.remoto, 'ship');
  // Como o ship: o que o publicar grava (ledger, detalhe e correcao do --json) nasce em pt-BR.
  const r = comLocale('pt-BR', () => publicarEntrega(carregado, alvo, {
    remoto: texto(args.opcoes.remoto), dryRun: args.opcoes['dry-run'] === true,
  }));
  if (args.opcoes.json === true) {
    console.log(JSON.stringify(r, null, 2));
    return r.acao === 'recusada' ? 1 : 0;
  }
  for (const linha of linhasDaPublicacao(r)) console.log(linha);
  return r.acao === 'recusada' ? 1 : 0;
}

/** RM-059 (F7, T7.1): `ork ship pista [<thread>]`, as etapas da entrega e o proximo passo que o nucleo declara. */
function comandoShipPista(carregado: ManifestoCarregado, args: Args): number {
  const p = msg().ship.publicar;
  if (args.posicionais.length > 3) {
    console.error(p.usoPista);
    return 2;
  }
  if (args.opcoes.remoto !== undefined) exigirRemoto(args.opcoes.remoto, 'ship');
  const r = comLocale('pt-BR', () => pistaDeEntrega(carregado, { remoto: texto(args.opcoes.remoto), thread: args.posicionais[2] }));
  if (args.opcoes.json === true) {
    console.log(JSON.stringify(r, null, 2));
    return 0;
  }
  console.log(p.cabecalhoPista(formatarDataHora(r.lidoEm), r.remoto, r.base));
  if (!r.remotoLido) console.log(p.remotoNaoRespondeu(r.remoto));
  if (!r.prsLidos) console.log(p.prsNaoResponderam(remontar(r.prsNaoLidos ?? '-')));
  if (!r.pistas.length) console.log(p.semPistas);
  for (const pista of r.pistas) {
    console.log('');
    console.log(p.linhaDaThread(pista.thread, pista.tag, pista.branch));
    console.log(`    ${pista.etapas.map((e) => `${p.nomeDaEtapa(e.id)} ${p.marcaDaEtapa(e.estado)}`).join(' | ')}`);
    for (const e of pista.etapas.filter((x) => x.estado !== 'feita' && x.estado !== 'nao-se-aplica')) {
      console.log(`      ${p.nomeDaEtapa(e.id)}: ${remontar(e.texto)}`);
    }
    console.log(p.linhaDoProximo(remontar(pista.proximo.texto), pista.proximo.comando));
  }
  return 0;
}

function comandoShip(args: Args): number {
  const carregado = exigirManifesto();
  const m = msg().ship;
  if (args.posicionais[1] === 'publicar') return comandoShipPublicar(carregado, args);
  if (args.posicionais[1] === 'pista') return comandoShipPista(carregado, args);
  if (args.posicionais[1] === 'registrar-pr') {
    // I-57 (RM-008): a entrega feita por PR vira ship_done, provada no remoto e no CI.
    const alvo = args.posicionais[2];
    const remoto = texto(args.opcoes.remoto);
    // RM-037 (defeito 5): PR mesclado em repositorio externo declarado em ci.external_repositories.
    const repo = texto(args.opcoes.repo), numeroDoPr = texto(args.opcoes.pr);
    if ((!alvo && args.opcoes.todas !== true) || (!!repo !== !!numeroDoPr) || (repo && !alvo)) {
      console.error(m.usoRegistrarPr);
      return 2;
    }
    // RM-047: o `--remoto` da linha de comando so chega ao git como nome de remoto (ship.remoto-invalido).
    if (args.opcoes.remoto !== undefined) exigirRemoto(args.opcoes.remoto, 'ship');
    // RM-037 (fatia 3, defeito 6): o `--dry-run` era ignorado, e o ensaio gravava o ship_done de verdade.
    const dryRun = args.opcoes['dry-run'] === true;
    // RM-061 (F2b, G2): o ship_done e o motivo nascem em pt-BR; so a impressao segue o locale.
    const r = comLocale('pt-BR', () => alvo && repo
      ? [registrarEntregaExternaPorPr(carregado, alvo, { repositorio: repo, pr: Number(numeroDoPr), dryRun, remoto })]
      : alvo ? [registrarEntregaPorPr(carregado, alvo, { remoto, dryRun })] : registrarEntregasPorPr(carregado, { remoto, dryRun }));
    if (args.opcoes.json === true) { console.log(JSON.stringify(r, null, 2)); return r.some((x) => x.acao === 'recusada') ? 1 : 0; }
    if (dryRun) console.log(m.ensaio);
    if (r.length === 0) console.log(m.nenhumaComMerge);
    for (const x of r) console.log(m.linhaDoRegistro(x.thread, m.acoes[x.acao] ?? x.acao, remontar(x.motivo)));
    // RM-044 (A3): a pagina que o push da base vai reprovar em docs.paridade.merge, com o comando que corrige.
    // So aviso: nada e gravado e o codigo de saida nao muda.
    const pendentes = r.flatMap((x) => x.docsPendentes.map((d) => ({ thread: x.thread, ...d })));
    if (pendentes.length) {
      console.log('');
      console.log(m.avisoDeDocs(pendentes.length));
      for (const d of pendentes) {
        console.log(m.docPendente(d.id, d.arquivo, d.merge.slice(0, 7), d.thread, d.codigo));
        console.log(m.docPendenteComando(d.comando));
      }
    }
    const registradas = r.filter((x) => x.acao === 'registrou').length;
    const registrariam = r.filter((x) => x.acao === 'registraria').length;
    if (registradas) {
      console.log('');
      // RM-008 (03/10): o texto ensina a forma COM a thread. A forma sem thread fechava tambem as
      // entregues de outras frentes paralelas, e era ela que os condutores copiavam daqui.
      console.log(m.registradas(registradas));
      for (const x of r.filter((y) => y.acao === 'registrou')) console.log(`  ork master ${x.thread} --aceitar-omissao`);
    }
    if (registrariam) {
      console.log('');
      console.log(m.registrariam(registrariam));
    }
    return r.some((x) => x.acao === 'recusada') ? 1 : 0;
  }
  const id = args.posicionais[1];
  const para = texto(args.opcoes.para) ?? texto(args.opcoes.to);
  if (!id || !para) {
    console.error(m.uso);
    return 2;
  }
  // RM-047: como no registrar-pr, o `--remoto` so chega ao git como nome de remoto (ship.remoto-invalido),
  // e `--remoto` sem valor nao vira `origin` em silencio.
  if (args.opcoes.remoto !== undefined) exigirRemoto(args.opcoes.remoto, 'ship');
  const autorizar = args.opcoes['autorizar-push'];
  // Security scan: `--allow-unscanned` exige quem autoriza; sem valor nao vira autorizacao em silencio.
  const semScan = args.opcoes['allow-unscanned'];
  if (semScan !== undefined && (typeof semScan !== 'string' || !semScan.trim())) {
    console.error(m.allowUnscannedSemValor);
    return 2;
  }
  // RM-061 (F2b, G2): o que o ship grava (ledger, verificacao, mensagem do merge) nasce em pt-BR.
  const r = comLocale('pt-BR', () => ship(carregado, id, {
    para,
    de: texto(args.opcoes.de),
    remoto: texto(args.opcoes.remoto),
    mensagem: texto(args.opcoes.mensagem),
    dryRun: args.opcoes['dry-run'] === true,
    autorizarPush: typeof autorizar === 'string' ? autorizar : undefined,
    allowUnscanned: typeof semScan === 'string' ? semScan.trim() : undefined,
    semPush: args.opcoes['sem-push'] === true,
    // RM-058 N2 (A1 da rodada 2 do CHECK): o `--esperar` chega à fila pesada da verificação do ship, com aviso.
    ...((f) => ({ esperarFilaPesadaMs: f.esperarMs, avisoDaFilaPesada: { aoEsperar: f.aoEsperar, comandoDeEsperar: f.comandoDeEsperar } }))(
      filaPesadaDoCli(args, 'verify', `ork ship ${id} --para ${para} --esperar 30`)),
  }));
  console.log(textoDoShip(r));
  return r.ok ? 0 : 1;
}

/**
 * RM-043 (sobra achada na RM-044): opcoes que o `portfolio show` herdou do `objective`,
 * aposentado na I-43. A ajuda as listava e o `parseArgs` as aceitava, mas o `show` nunca as
 * leu: eram ignoradas em silencio. A recusa e tipada e diz para onde ir, como a do
 * `objective.aposentado`.
 */
const SOBRAS_DO_OBJECTIVE = ['constraints', 'outcomes', 'threads', 'execution-runtime', 'validation-runtimes'];

function recusarSobraDoObjective(opcao: string): number {
  console.error(msg().operacao.produto.portfolio.opcaoAposentada(opcao));
  return 2;
}

function comandoPortfolio(args: Args): number {
  const root = exigirManifesto().raiz;
  const sub = args.posicionais[1] ?? 'list';
  const m = msg().operacao.produto.portfolio;
  if (sub === 'inspect') {
    const id = args.posicionais[2];
    if (!id) { console.error(m.usoInspect); return 2; }
    console.log(JSON.stringify(inspectPortfolio(root, id), null, 2));
    return 0;
  }
  const aliases: Record<string, PortfolioKind> = { product: 'product', project: 'project', initiative: 'initiative', prod: 'product', proj: 'project', init: 'initiative' };
  const split = (value: string | undefined, separator = ',') => value?.split(separator).map((item) => item.trim()).filter(Boolean) ?? [];
  if (sub === 'list') {
    const rawKind = args.posicionais[2];
    const kind = rawKind ? aliases[rawKind] : undefined;
    if (rawKind && !kind) { console.error(m.tipo); return 2; }
    const items = listEntities(root, kind, texto(args.opcoes.parent));
    console.log(args.opcoes.json === true ? JSON.stringify({ schema: 'ork.portfolio-list/v1', updatedAt: readPortfolio(root).updatedAt, items }, null, 2)
      : items.length ? items.map((item) => `${item.id}\t${item.kind}\t${item.status}\t${item.title}`).join('\n') : m.vazio);
    return 0;
  }
  if (sub === 'show') {
    const sobra = SOBRAS_DO_OBJECTIVE.find((opcao) => args.opcoes[opcao] !== undefined);
    if (sobra) return recusarSobraDoObjective(sobra);
    const id = args.posicionais[2];
    if (!id) { console.error(m.usoShow); return 2; }
    const item = findEntity(root, id);
    if (!item) { console.error(m.naoEncontrada(id)); return 1; }
    console.log(args.opcoes.json === true ? JSON.stringify(item, null, 2) : m.estado(item.id, item.title, item.status));
    return 0;
  }
  if (sub === 'create') {
    const kind = aliases[args.posicionais[2] ?? ''];
    const id = args.posicionais[3], title = texto(args.opcoes.title), parent = texto(args.opcoes.parent);
    if (!kind || !id || !title) { console.error(m.usoCreate); return 2; }
    const common = { id, title, description: texto(args.opcoes.description), ownerId: texto(args.opcoes.owner), status: texto(args.opcoes.status) as PortfolioStatus | undefined, acceptanceCriteria: split(texto(args.opcoes.acceptance), ';') };
    const item = kind === 'product' ? createProduct(root, common)
      : kind === 'project' ? createProject(root, { ...common, productId: parent ?? '', workspaceIds: split(texto(args.opcoes.workspaces)) })
      : createInitiative(root, { ...common, projectId: parent ?? '', dependsOn: split(texto(args.opcoes.depends)) });
    console.log(JSON.stringify({ schema: 'ork.portfolio-created/v1', item }, null, 2));
    return 0;
  }
  console.error(m.desconhecido(sub));
  return 2;
}

function comandoCreation(args: Args): number {
  const loaded = exigirManifesto();
  // CLI local opera com a autoridade do usuário do SO, assim como portfolio create.
  // Fachadas HTTP devem usar a API com principal e authorize autenticados no servidor.
  const actor: CreationActor = { principal: `local:uid:${userInfo().uid}`, authorize: () => {} };
  const sub = args.posicionais[1], id = args.posicionais[2];
  const m = msg().operacao.produto.creation;
  if (args.opcoes.principal !== undefined || args.opcoes.por !== undefined) throw new Error(m.identidade);
  let result: unknown;
  if (sub === 'session') {
    const portfolio = readPortfolio(loaded.raiz);
    result = {
      schema: 'ork.creation-session/v1', principal: actor.principal,
      workspaceIds: [...new Set(portfolio.projects.flatMap((project) => project.workspaceIds))].sort(),
      modes: loaded.manifesto.conduction.allowed_modes,
      actions: ['create_entity', 'create_entity_with_ticket', 'open_ticket'],
    };
  } else if (sub === 'start') {
    const file = texto(args.opcoes['input-file']);
    if (!file) { console.error(m.usoStart); return 2; }
    const content = fs.readFileSync(file, 'utf8');
    if (Buffer.byteLength(content) > 100_000) throw new Error(m.arquivoGrande);
    result = startCreation(loaded, actor, JSON.parse(content));
  } else if (sub === 'list') result = listCreationOperations(loaded.raiz, actor.principal);
  else if (!id) { console.error(m.exigeId); return 2; }
  else if (sub === 'show' || sub === 'events') {
    const op = readCreationOperation(loaded.raiz, id, actor.principal);
    result = sub === 'events' ? { schema: 'ork.creation-events/v1', operationId: id, version: op.version, events: op.events } : op;
  } else if (sub === 'resume' || sub === 'compensate') {
    const version = Number(texto(args.opcoes['expected-version']));
    if (!Number.isSafeInteger(version) || version < 1) { console.error(m.versao); return 2; }
    result = sub === 'resume' ? resumeCreation(loaded, actor, id, version) : compensateCreation(loaded, actor, id, version);
  } else { console.error(m.desconhecido); return 2; }
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

/**
 * `ork objective`: APOSENTADO na I-43 (D4).
 *
 * O Objective Envelope descrevia um gate que nao bloqueava nada, e a medida foi mais
 * dura que a suspeita do GOAL: das 137 threads do projeto, ZERO tinham
 * `creationOrigin`, e `creationOrigin` era a unica via pela qual `phase.ts` consultava
 * o envelope. O ramo nunca disparou para thread nenhuma. Havia um envelope em disco,
 * `obj-i27gatedomae`, em `awaiting_approval` desde 17/09, com tres threads de zero
 * sessoes: a unica pausa do `#Maestro` nao bloqueava o despacho das proprias threads
 * que ela criou, e aprova-la nao teria efeito.
 *
 * As DUAS VIGAS que ele guardava sairam vivas, e viraram propriedade de thread comum:
 *   - validacao por runtime diferente -> `thread.exigeRuntimeDiferente` (T9);
 *   - `doneWhen` executavel -> `thread.doneWhen`, que vira claim do nucleo (T10).
 *
 * A recusa e TIPADA e diz para onde ir. Sumir em silencio seria o mesmo pecado da
 * #TAG aposentada virando default: quem tem o comando num script precisa saber.
 */
function comandoObjective(args: Args): number {
  const sub = args.posicionais[1] ?? 'list';
  console.error(msg().operacao.produto.objective(sub));
  return 2;
}


function comandoCi(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1] ?? 'status';
  const m = msg().operacao.produto.ci;
  if (sub === 'prepare') {
    const thread = args.posicionais[2];
    if (!thread) {
      console.error(m.usoPrepare);
      return 2;
    }
    // RM-061 (F3d, GO-FIX 1): o lint vai ao ledger e o bundle ao disco no escopo pt-BR, como antes do `ci` entrar na
    // lista (D2); o aviso sai remontado no locale do comando, e a recusa, pela entrada do CLI. As linhas da barreira de
    // dado privado (RM-062) saem junto com os avisos, na ordem em que nascem.
    const linhas: Array<{ aviso: boolean; linha: string }> = [];
    let arquivo: string;
    try {
      arquivo = comLocale('pt-BR', () => prepararBundleCi(carregado, thread, { aoAvisar: (linha) => linhas.push({ aviso: true, linha }),
        aoInformar: (linha) => linhas.push({ aviso: false, linha }) }));
    } finally {
      for (const { aviso, linha } of linhas) console.log(aviso ? m.aviso(remontar(linha)) : remontar(linha));
    }
    console.log(m.bundle(arquivo));
    return 0;
  }
  if (sub === 'run') {
    const bundle = texto(args.opcoes.bundle);
    if (bundle) {
      const result = executarBundleCi(carregado, bundle);
      console.log(JSON.stringify(result, null, 2));
      return result.ok ? 0 : 1;
    }
    // RM-037 (rm037noite, defeito 1): o CI passa a branch e acha o `.ork-ci/<thread>.json` dela.
    const branch = texto(args.opcoes.branch);
    if (branch) {
      const result = executarCiDaBranch(carregado, branch);
      console.log(JSON.stringify(result, null, 2));
      return result.ok ? 0 : 1;
    }
    const thread = args.posicionais[2];
    if (!thread) {
      console.error(m.usoRun);
      return 2;
    }
    const result = executarCi(carregado, thread);
    console.log(args.opcoes.json === true ? JSON.stringify(result, null, 2) : m.resultado(result.status.ok, result.status.detail));
    return result.status.ok ? 0 : 1;
  }
  if (sub === 'status') {
    const sha = texto(args.opcoes.sha) ?? args.posicionais[2] ?? exec('git', ['rev-parse', 'HEAD'], carregado.raiz).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      // Ensaio de 03/10 (R4): `--sha HEAD` ou um sha curto respondiam so a linha de uso, sem dizer por que.
      console.error(m.sha);
      console.error(m.usoStatus);
      return 2;
    }
    // RM-047: recusa o `--remoto` que nao e nome de remoto mesmo com o gate de CI desligado.
    const remoto = exigirRemoto(args.opcoes.remoto === undefined ? 'origin' : args.opcoes.remoto, 'ci');
    const result = consultarCi(carregado, sha, remoto);
    console.log(args.opcoes.json === true ? JSON.stringify(result, null, 2) : m.status(result.ok, result.detail));
    return result.ok ? 0 : 1;
  }
  console.error(m.desconhecido(sub));
  return 2;
}

/**
 * RM-062 (F1): `ork privado varrer [--base REF] [--json]`, a varredura de dado privado do repositorio do diretorio
 * atual. Sem `--base`, os nomes e as linhas dos arquivos versionados (o passo do CI); com ela, o diff contra a
 * merge-base com `REF` e os nao rastreados. Sai 1 com achado sob a policy `dado_privado` em `block` ou sem a policy
 * (quem roda o comando pediu a varredura); em `warn` e `off`, 0 com o aviso. Sai 2 quando a varredura nao roda.
 */
function comandoPrivado(args: Args): number {
  const uso = 'uso: ork privado varrer [--base REF] [--json]';
  const opcoes = Object.keys(args.opcoes);
  if (args.posicionais[1] !== 'varrer' || args.posicionais.length > 2 || opcoes.some((k) => k !== 'base' && k !== 'json') ||
      ('json' in args.opcoes && args.opcoes.json !== true) || ('base' in args.opcoes && typeof args.opcoes.base !== 'string')) {
    console.error(uso);
    return 2;
  }
  const topo = exec('git', ['rev-parse', '--show-toplevel'], process.cwd());
  if (!topo.ok) {
    console.error('erro: privado varrer: o diretorio atual nao esta num repositorio git');
    return 2;
  }
  const raiz = topo.stdout.trim();
  const carregado = carregarManifesto(raiz);
  const severidade = carregado ? severidadeDeclarada(carregado.manifesto, 'dado_privado') : null;
  let estado: string | null = null;
  try { estado = raizDoEstado(raiz); } catch { estado = null; }
  const contexto = contextoDaVarredura(raiz, estado);
  const ref = texto(args.opcoes.base);
  const base = contexto.ok && ref ? mergeBase(raiz, ref) : null;
  const v = !contexto.ok ? null : ref ? (base ? varrerDiff(contexto.valor, base) : null) : varrerArvore(contexto.valor);
  const erro = !contexto.ok ? contexto.erro : !v ? `--base ${ref} nao tem merge-base com HEAD` : v.erro;
  const achados = v?.achados.length ?? 0;
  const reprova = !erro && achados > 0 && (severidade === null || severidade === 'block');
  if (args.opcoes.json === true) {
    console.log(JSON.stringify({ ...(v ?? {}), erro, severidade, ok: !erro && !reprova }, null, 2));
  } else {
    if (v) for (const linha of relatorioDoDadoPrivado(v)) console.log(linha);
    const policy = severidade === null ? 'policy dado_privado nao declarada: o comando explicito reprova'
      : `policy dado_privado em ${severidade}`;
    console.log(erro ? `Veredito: NAO RODOU (${erro})`
      : !achados ? 'Veredito: nenhum dado privado nas linhas e nos nomes varridos.'
      : reprova ? `Veredito: REPROVADO (${achados} achado(s) de dado privado; ${policy})`
      : `Veredito: AVISO (${achados} achado(s) de dado privado; ${policy}, que nao reprova)`);
  }
  return erro ? 2 : reprova ? 1 : 0;
}

function comandoLease(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  const ml = msg().operacao.restante.lease;
  if (sub === undefined || sub === 'list') {
    console.log(tabelaDeLeases(carregado.raiz));
    return 0;
  }
  if (sub === 'acquire' || sub === 'take') {
    const nome = args.posicionais[2];
    const thread = texto(args.opcoes.thread);
    const motivo = texto(args.opcoes.motivo) ?? msg('pt-BR').operacao.restante.lease.semMotivo;
    if (!nome || !thread) {
      console.error(ml.usoAcquire);
      return 2;
    }
    lerThread(carregado.raiz, thread);
    const r = comLocale('pt-BR', () => adquirirRegiao(carregado.raiz, nome, { thread, motivo }));
    if (r.ok) {
      console.log(ml.adquirido(r.nome, r.tipo, thread));
      console.log(ml.expira(formatarDataHoraRotulada(r.lease?.expiraEm)));
      if (r.tomadoDeVencido) console.log(ml.tomado);
      return 0;
    }
    console.error(ml.naoAdquirido(r.nome));
    console.error(ml.motivoTipado(r.motivo));
    console.error(ml.detalhe(localizarTextoRotulado(r.detalhe)));
    console.error(ml.posicao(r.posicaoNaFila));
    console.error(ml.correcao(r.correcao));
    return 1;
  }
  if (sub === 'release') {
    const nome = args.posicionais[2];
    if (!nome) {
      console.error(ml.usoRelease);
      return 2;
    }
    const r = comLocale('pt-BR', () => liberar(
      carregado.raiz,
      nome,
      texto(args.opcoes.thread) ?? '',
      args.opcoes.forcar === true
    ));
    console.log(r.detalhe);
    return r.ok ? 0 : 1;
  }
  console.error(ml.desconhecido(sub));
  return 2;
}

/**
 * RM-052: o cabecalho do board. O board le as threads DESTE projeto nesta maquina; o roadmap nunca
 * e lido aqui, e "0 threads" nunca quer dizer "roadmap vazio". As outras maquinas so entram com a
 * fabrica compartilhada e um remoto de verdade.
 */
function consultaDoBoard(carregado: ManifestoCarregado, opcoes: { plano: boolean; todos: boolean }) {
  const remoto = carregado.manifesto.fabrica.remoto;
  const comFabrica = !opcoes.plano && fabricaCompartilhada(carregado.manifesto);
  const url = remotoDoProjeto(carregado.raiz, remoto);
  return consultaDoProjeto(carregado, {
    remoto: url,
    lido: [`${FORA_DA_CONSULTA.threadsDaMaquina}${opcoes.todos ? ' (todos os perfis)' : ''}`,
      ...(comFabrica && url !== null ? [`outras máquinas (ork/fabrica-estado em ${remoto})`] : [])],
    naoLido: [FORA_DA_CONSULTA.roadmap, FORA_DA_CONSULTA.reservas,
      ...(url === null ? [semRemoto(remoto)] : comFabrica ? [] : [FORA_DA_CONSULTA.outrasMaquinas])],
  });
}

function comandoBoard(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  const todos = args.opcoes.all === true || args.opcoes.todos === true;
  const mb = msg().operacao.restante.board;
  if (sub === 'plan' || sub === 'plano') {
    const plano = planejar(carregado);
    const consulta = consultaDoBoard(carregado, { plano: true, todos: false });
    if (args.opcoes.json === true) console.log(JSON.stringify({ ...plano, consulta }, null, 2));
    else console.log([...linhasDaConsulta(consulta), '', textoDoPlano(plano)].join('\n'));
    return 0;
  }
  if (sub === 'reap') {
    const devolvidas = comLocale('pt-BR', () => devolverVagas(carregado, { por: texto(args.opcoes.por) }));
    if (args.opcoes.json === true) console.log(JSON.stringify(devolvidas, null, 2));
    else console.log(textoDoReap(devolvidas));
    return 0;
  }
  if (sub !== undefined && sub !== 'list') {
    console.error(mb.desconhecido(sub));
    console.error(mb.uso);
    return 2;
  }
  const consulta = consultaDoBoard(carregado, { plano: false, todos });
  if (args.opcoes.json === true) {
    // RM-052 (D6): objeto com o cabecalho; a lista de threads continua inteira em `threads`.
    console.log(JSON.stringify({ contrato: CONTRATO_DO_BOARD, consulta, threads: threadsDeTodosOsPerfis(carregado, todos) }, null, 2));
    return 0;
  }
  console.log([...linhasDaConsulta(consulta), ''].join('\n'));
  console.log(textoDoBoard(carregado, todos));
  // I-51 (RM-047): com a fabrica compartilhada, o board mostra tambem as outras maquinas.
  if (fabricaCompartilhada(carregado.manifesto)) {
    console.log('');
    // RM-052: sem o remoto, nada foi lido; dizer "nenhuma publicou" seria a frase do incidente de 29/09.
    if (consulta.projeto.remoto === null) {
      console.log(mb.semRemoto(carregado.manifesto.project.name, carregado.manifesto.fabrica.remoto));
    } else {
      const painel = lerFabrica(carregado.raiz, { remoto: carregado.manifesto.fabrica.remoto,
        semRemoto: args.opcoes['sem-remoto'] === true });
      console.log(textoDasOutrasMaquinas(painel, nomeDaMaquina()));
    }
  }
  return 0;
}

/** RM-052 (D6): `ork board --json` deixou de ser lista para carregar o cabecalho da consulta. */
const CONTRATO_DO_BOARD = 'ork.board/v1';

/**
 * I-51 (RM-047): `ork fabrica` mostra o que cada maquina conduz; `ork fabrica publicar` grava o
 * retrato desta maquina na branch `ork/fabrica-estado`. O `--silencioso` e o da publicacao em
 * segundo plano: nada no terminal, uma linha em `.orkastery/monitor/fabrica.log`.
 */
function comandoFabrica(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  const mf = msg().operacao.restante.fabrica;
  // RM-063 (F1): a batida e do crontab desta maquina; nao le nem escreve o remoto.
  if (sub === 'batida') return comandoDaBatida(carregado, args);
  // RM-047: o remoto vem do manifesto de quem fez o repositorio; fora do formato, recusa antes do git.
  // O `publicar` recusa dentro do try (publicarMaquina), para o silencioso deixar a recusa no log.
  const remoto = texto(args.opcoes.remoto) ?? carregado.manifesto.fabrica.remoto;
  if (sub !== 'publicar') exigirRemoto(remoto, 'fabrica');
  if (sub === 'publicar') {
    const silencioso = args.opcoes.silencioso === true;
    try {
      const r = publicarMaquina(carregado, { remoto, forcar: args.opcoes.forcar === true });
      if (silencioso) { registrarPublicacao(carregado.raiz, { ...r }); return 0; }
      if (args.opcoes.json === true) console.log(JSON.stringify(r, null, 2));
      else console.log(r.acao === 'publicou'
        ? mf.publicou(r.maquina, r.threads, r.commit?.slice(0, 7), r.tentativas)
        : r.acao === 'ocupado' ? mf.ocupada : mf.igual(r.maquina));
      if (!fabricaCompartilhada(carregado.manifesto) && !silencioso) {
        console.log(mf.soQuandoPede);
        // RM-047 (P5): o manifesto que pede a fabrica nao liga a publicacao desta maquina.
        if (carregado.manifesto.fabrica.compartilhada) console.log(mf.manifestoPede);
      }
      return 0;
    } catch (e) {
      if (silencioso) { registrarPublicacao(carregado.raiz, { acao: 'falhou', erro: (e as Error).message }); return 1; }
      throw e;
    }
  }
  if (sub === 'entrar') {
    // A adesao e o nome ficam no arquivo do usuario: valem para o shell, o cron e os gateways.
    const config = gravarConfigDaMaquina({ nome: texto(args.opcoes.maquina) ?? lerConfigDaMaquina()?.nome ?? nomeDaMaquina(),
      fabricaCompartilhada: true });
    const r = publicarMaquina(carregado, { remoto, forcar: true });
    // RM-052 (D7): a maquina que entra na fabrica deste projeto passa a conhece-lo pelo nome.
    const avisoDoRegistro = registrarProjetoEmSilencio(carregado.raiz, 'fabrica entrar');
    if (avisoDoRegistro) console.error(avisoDoRegistro);
    console.log(mf.entrou(config.nome));
    console.log(mf.primeiro(r.threads, r.commit?.slice(0, 7)));
    if (process.env.ORK_MAQUINA && process.env.ORK_MAQUINA.trim() !== config.nome) {
      console.log(mf.maquinaAmbiente(process.env.ORK_MAQUINA));
    }
    return 0;
  }
  if (sub === 'sair') {
    const config = gravarConfigDaMaquina({ fabricaCompartilhada: false });
    const r = removerMaquina(carregado, { remoto });
    console.log(mf.saiu(nomeDaMaquina(), r ? r.slice(0, 7) : null));
    if (fabricaCompartilhada(carregado.manifesto)) console.log(mf.ambienteLiga);
    void config;
    return 0;
  }
  if (sub !== undefined && sub !== 'list') {
    console.error(mf.desconhecido(sub));
    console.error(mf.uso);
    return 2;
  }
  // RM-052: a fabrica le a branch de UM projeto, no remoto dele; o cabecalho diz qual e o que ficou de fora.
  const url = remotoDoProjeto(carregado.raiz, remoto);
  const painel = url === null ? { maquinas: [], atualizado: false, ponta: null }
    : lerFabrica(carregado.raiz, { remoto, semRemoto: args.opcoes['sem-remoto'] === true });
  const consulta = consultaDoProjeto(carregado, {
    remoto: url,
    lido: url === null ? [] : [`ork/fabrica-estado em ${remoto} (${painel.atualizado ? 'lido agora' : 'última cópia local'})`],
    naoLido: [FORA_DA_CONSULTA.roadmap, FORA_DA_CONSULTA.reservas, ...(url === null ? [semRemoto(remoto)] : [])],
  });
  if (args.opcoes.json === true) {
    // RM-053 (fatia 2): o mesmo JSON, com o invisivel do remoto escrito como \uXXXX.
    console.log(jsonSemInvisivel({ ...painel, consulta }));
    return 0;
  }
  console.log([...linhasDaConsulta(consulta), ''].join('\n'));
  console.log(url === null
    ? mf.semRemoto(carregado.manifesto.project.name, remoto)
    : textoDaFabrica(painel, nomeDaMaquina()));
  // RM-047 (P5): o manifesto pede a fabrica, mas quem liga a publicacao e a maquina.
  const pedida = avisoDaFabricaPedida(carregado.manifesto);
  if (pedida) console.log(`\n${pedida}`);
  return 0;
}

/**
 * RM-063 (F1): `ork fabrica batida` instala, mostra e remove a batida da varredura do pulse no crontab desta
 * maquina. `status` sai 0 com a batida instalada e 1 sem ela (ou sem crontab legivel); `instalar` e
 * `remover` gravam o evento no ledger da maquina quando o crontab muda.
 */
function comandoDaBatida(carregado: ManifestoCarregado, args: Args): number {
  const acao = args.posicionais[2] ?? 'status';
  const json = args.opcoes.json === true;
  if (acao === 'status') {
    const estado = estadoDaBatida(carregado.raiz, { projeto: carregado.manifesto.project.name });
    console.log(json ? JSON.stringify(estado, null, 2) : textoDoEstadoDaBatida(estado));
    return estado.leitura.ok && estado.instalada ? 0 : 1;
  }
  if ((acao === 'instalar' || acao === 'remover') && args.posicionais.length === 3) {
    const por = texto(args.opcoes.por);
    const r = acao === 'instalar' ? instalarBatida(carregado.raiz, { por }) : removerBatida(carregado.raiz, { por });
    console.log(json ? JSON.stringify(r, null, 2) : textoDoResultadoDaBatida(r));
    return 0;
  }
  console.error(msg().operacao.restante.fabrica.batida.uso);
  return 2;
}

/**
 * RM-053: `ork network` e a Orkastery Network, as maquinas de uma pessoa em rede. Roda de qualquer
 * diretorio, com ou sem projeto: a rede e da pessoa, nao de um repositorio. O projeto do diretorio
 * atual, quando ha, so entra no retrato e na leitura da fabrica legada.
 */
function comandoNetwork(args: Args): number {
  const sub = args.posicionais[1];
  // RM-054: `network roadmap` tem o proprio --projeto e o proprio uso (e segue em pt-BR, G6 da RM-061 F3b).
  if (sub === 'roadmap') return comandoNetworkRoadmap(args);
  const diretorio = process.cwd();
  // RM-061 (F3b, D3): o texto pelo catalogo; o que se grava (adesao, retrato, casa) roda no escopo pt-BR, e o nome da
  // maquina, a casa, a forja e o commit saem como vieram.
  const mn = msg().network;
  const forja = texto(args.opcoes.forja), repositorio = texto(args.opcoes.repositorio);
  if ((args.opcoes.forja !== undefined && !ehNomeDeForja(forja)) || args.opcoes.repositorio === true ||
      (repositorio !== undefined && !/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repositorio))) {
    console.error(mn.uso);
    return 2;
  }
  if (sub === 'entrar') {
    const r = comLocale('pt-BR', () => entrarNaRede({ maquina: texto(args.opcoes.maquina), forja: ehNomeDeForja(forja) ? forja : undefined,
      repositorio, diretorio, tomarNome: args.opcoes.forcar === true }));
    console.log(mn.entrou(r.publicacao.maquina, r.casa.dono, r.casa.forja, refDaCasa(r.casa), r.criado));
    console.log(mn.primeiroRetrato(String(r.publicacao.commit?.slice(0, 7))));
    if (r.publicacao.tomouNome) console.log(mn.tomouNome(r.publicacao.maquina));
    console.log(mn.eAoCriar);
    for (const d of r.publicacao.descartados) console.log(mn.avisoDescartado(d.padrao, d.campo));
    if (process.env.ORK_MAQUINA && process.env.ORK_MAQUINA.trim() !== r.publicacao.maquina) {
      console.log(mn.avisoOrkMaquina(process.env.ORK_MAQUINA));
    }
    return 0;
  }
  if (sub === 'sair') {
    const r = comLocale('pt-BR', () => sairDaRede({ forja: ehNomeDeForja(forja) ? forja : undefined, repositorio }));
    console.log(mn.saiu(r.maquina, r.commit ? mn.retratoRemovido(r.casa, r.commit.slice(0, 7))
      : r.alheio ? mn.retratoDeOutraInstalacao(r.maquina, r.casa, r.mesmoHostname === true)
        : mn.semRetrato(r.casa)));
    if (lerConfigDaMaquina()?.fabricaCompartilhada) console.log(mn.fabricaContinua);
    return 0;
  }
  if (sub === 'publicar') {
    if (args.opcoes.silencioso === true) {
      // O filho do evento de thread: quem disparou ja tomou a vez (teto de 14 min) e nao espera.
      // RM-061 (F3b): o rede.log guarda o que aconteceu em pt-BR, com qualquer lingua no ambiente.
      try { comLocale('pt-BR', () => registrarNaRede({ ...publicarRede({ diretorio }), origem: 'evento' })); return 0; }
      catch (e) { comLocale('pt-BR', () => registrarNaRede({ acao: 'falhou', origem: 'evento', erro: (e as Error).message })); return 1; }
    }
    const r = comLocale('pt-BR', () => publicarRede({ diretorio, forcar: args.opcoes.forcar === true,
      forja: ehNomeDeForja(forja) ? forja : undefined, repositorio }));
    if (args.opcoes.json === true) console.log(JSON.stringify(r, null, 2));
    else console.log(r.acao === 'publicou' ? mn.publicou(r.maquina, r.casa, r.commit?.slice(0, 7), r.tentativas)
      : r.acao === 'ocupado' ? mn.ocupado : mn.igual(r.maquina, r.casa));
    if (args.opcoes.json !== true) {
      for (const d of r.descartados) console.log(mn.avisoDescartado(d.padrao, d.campo));
    }
    return 0;
  }
  if (sub !== undefined && sub !== 'status') {
    console.error(msg().cli.subcomandoDesconhecido('network', sub));
    console.error(mn.uso);
    return 2;
  }
  // RM-054 (fatia 3): o host sem cwd de projeto (RM-052, D3) nao faz do diretorio do gateway um projeto lido.
  const doHost = (process.env[ENV_PROJETO_EXPLICITO] ?? '').trim() === '1';
  const status = comLocale('pt-BR', () => lerRede({ semRemoto: args.opcoes['sem-remoto'] === true, diretorio: doHost ? null : diretorio }));
  console.log(args.opcoes.json === true ? jsonDaRede(status) : textoDaRede(status));
  return 0;
}

/**
 * RM-052: `ork projetos` lista o registro desta maquina (`~/.orkastery/projetos.json`); `registrar`
 * poe uma copia que ja existia antes do registro (init, thread new e fabrica entrar ja registram) e
 * `esquecer` tira a copia que sumiu ou sobrou. Sem segredo: so nome, abbrev, raiz e remoto redigido.
 */
function comandoProjetos(args: Args, projeto: string | undefined): number {
  const sub = args.posicionais[1] ?? 'list';
  const m = msg().projetos.cli;
  if (sub === 'list' || sub === 'listar') {
    const projetos = listarProjetos();
    if (args.opcoes.json === true) {
      console.log(JSON.stringify({ contrato: CONTRATO_PROJETOS, arquivo: caminhoDoRegistro(), projetos }, null, 2));
      return 0;
    }
    console.log(m.titulo(raizParaExibir(caminhoDoRegistro())));
    console.log('');
    if (projetos.length === 0) {
      console.log(m.nenhum);
      return 0;
    }
    console.log(tabela([...m.cabecalho], projetos.map((p) => [
      p.nome, p.abbrev || '-', raizParaExibir(p.raiz), p.remoto ?? m.semRemoto, p.presente ? m.sim : m.ausente,
      formatarDataHora(p.atualizadoEm)])));
    console.log('');
    console.log(`${m.selecao} ${legendaDoFuso()}`);
    return 0;
  }
  if (sub === 'registrar') {
    const caminho = args.posicionais[2];
    if (caminho !== undefined && projeto !== undefined) throw new Error(m.usoRegistrar);
    const alvo = caminho === undefined ? resolverProjetoAlvo({ opcao: projeto ?? null }) : null;
    const p = registrarProjeto(caminho ?? alvo?.raiz ?? process.cwd(), 'projetos registrar');
    if (args.opcoes.json === true) { console.log(JSON.stringify(p, null, 2)); return 0; }
    console.log(m.registrado(p.nome, p.abbrev || '-', raizParaExibir(p.raiz), p.remoto ?? m.semRemoto));
    return 0;
  }
  if (sub === 'esquecer') {
    const alvo = args.posicionais[2] ?? projeto;
    if (!alvo) throw new Error(m.usoEsquecer);
    const sairam = esquecerProjeto(alvo);
    if (args.opcoes.json === true) { console.log(JSON.stringify(sairam, null, 2)); return 0; }
    for (const p of sairam) console.log(m.esquecido(p.nome, raizParaExibir(p.raiz)));
    return 0;
  }
  console.error(m.desconhecido(sub));
  console.error(m.uso);
  return 2;
}

/**
 * `ork orquestracao status` (alias `ork monitor`): pausas e impedimentos de uma chamada.
 *
 * Existe para o orquestrador ser PROATIVO: ele roda isto em laco, ve quem esta parado
 * esperando veredito humano e avisa o humano com alternativas, em vez de descobrir a
 * pausa so quando o humano pergunta. O `ork` entrega o estado; quem notifica e a
 * Camada 1, que consome o `--json`.
 */
function comandoOrquestracao(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  const m = msg().operacao.restante.monitor;
  if (sub !== undefined && sub !== 'status') {
    console.error(m.desconhecido(sub));
    console.error(m.uso);
    return 2;
  }
  const bruto = texto(args.opcoes.atencao);
  const atencaoMin = bruto === undefined ? undefined : Number(bruto);
  if (atencaoMin !== undefined && (!Number.isFinite(atencaoMin) || atencaoMin < 0)) {
    console.error(m.atencao(bruto ?? ''));
    return 2;
  }
  const monitor = montarMonitor(carregado, {
    todos: args.opcoes.all === true || args.opcoes.todos === true,
    atencaoMin,
    soParadas: args.opcoes['so-paradas'] === true,
    semRuntime: args.opcoes['sem-runtime'] === true,
  });
  console.log(args.opcoes.json === true ? JSON.stringify(monitor, null, 2) : textoDoMonitor(monitor));

  // `--exigir-limpo` transforma o monitor em watchdog: sai != 0 enquanto houver thread
  // parada. E o que deixa o orquestrador (ou um cron) tratar "tem gente esperando" como
  // falha acionavel, sem precisar interpretar texto.
  if (args.opcoes['exigir-limpo'] === true) {
    return monitor.resumo.aguardandoHumano + monitor.resumo.comImpedimento > 0 ? 1 : 0;
  }
  return 0;
}

/**
 * RM-037 (defeito 2 de 19 e 20/10/2026): o preparo de `worktree.dependencias` na worktree nova, dito ao lado dela. A
 * falha vai ao stderr com o comando exato e o diretorio, e a thread continua criada.
 */
function relatarDependencias(p: PreparoDasDependencias | null | undefined, dir: string): void {
  if (!p) return;
  const m = msg().worktree;
  if (p.ok) console.log(m.dependenciasProntas(p.comando, Math.round(p.duracaoMs / 1000)));
  else console.error(m.dependenciasFalharam(p.comando, p.code, p.causa === 'timeout', dir, ultimaLinhaDoPreparo(p)));
}

function comandoWorktree(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  const id = args.posicionais[2];
  // RM-061 (F3b, D3): a moldura pelo catalogo; o que os quatro subcomandos gravam (ledger, thread.json, a soltura dos
  // leases) roda no escopo pt-BR, e o detalhe e a correcao do resultado sao remontados no locale do comando.
  const m = msg().worktree;
  if (!sub || !id) {
    console.error(m.uso);
    return 2;
  }
  const bloqueio = (titulo: string, r: { motivo: string | null; detalhe: string; correcao: string }) => {
    console.error(titulo);
    console.error(m.motivoTipado(r.motivo));
    console.error(m.detalhe(remontar(r.detalhe)));
    console.error(m.correcao(remontar(r.correcao)));
  };
  if (sub === 'ensure') {
    const r = comLocale('pt-BR', () => garantirWorktree(carregado, id));
    if (!r.ok) {
      bloqueio(m.naoGarantida(id), r);
      return 1;
    }
    console.log(r.criada ? m.criada(id) : m.jaExistia(id));
    console.log(m.linhaDir(r.dir));
    console.log(m.linhaBranch(r.branch));
    console.log(m.linhaBase(r.base));
    console.log(`  ${remontar(r.detalhe)}`);
    relatarDependencias(r.dependencias, r.dir);
    return 0;
  }
  if (sub === 'sync') {
    const r = comLocale('pt-BR', () => sincronizarWorktree(carregado, id, { dryRun: args.opcoes['dry-run'] === true }));
    if (!r.ok) {
      bloqueio(m.syncBloqueado(id), r);
      return 1;
    }
    console.log(r.dryRun ? m.syncEnsaio(id) : m.syncFeito(id));
    console.log(m.syncBase(r.base, r.shaBase.slice(0, 8)));
    console.log(m.syncBranch(r.branch, r.shaAntes.slice(0, 8), r.shaDepois.slice(0, 8)));
    console.log(m.syncRebase(r.rebaseFeito ? 'feito' : r.jaAtualizada ? 'desnecessario' : 'seria feito'));
    console.log(`  ${remontar(r.detalhe)}`);
    if (r.passos.length > 0) {
      console.log('');
      console.log(m.comandosReais);
      for (const passo of r.passos) console.log(`    ${remontar(passo)}`);
    }
    return 0;
  }
  if (sub === 'audit') {
    const r = comLocale('pt-BR', () => auditarWorktree(carregado, id));
    console.log(textoDoAudit(id, r));
    return r.ok ? 0 : 1;
  }
  if (sub === 'release') {
    const r = comLocale('pt-BR', () => liberarWorktree(carregado, id, { forcar: args.opcoes.forcar === true }));
    if (!r.ok) {
      bloqueio(m.releaseBloqueado(id), r);
      return 1;
    }
    console.log(m.liberada(id));
    console.log(m.releaseDir(r.dir));
    console.log(m.releaseRemovida(r.removida));
    console.log(m.releaseLeases(r.leasesLiberados.join(', ')));
    console.log(`  ${remontar(r.detalhe)}`);
    return 0;
  }
  console.error(msg().cli.subcomandoDesconhecido('worktree', sub));
  return 2;
}


function comandoMaster(args: Args): number {
  const carregado = exigirManifesto();
  const primeiro = args.posicionais[1];
  if (primeiro === 'audit') {
    const r = auditarMaster(carregado.raiz);
    console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 1;
  }
  if (primeiro === 'pedir') {
    // RM-048 (item 8): a nota com prova. O canal mostra a linha; o dono responde pelo Telegram.
    const id = args.posicionais[2];
    const formato = texto(args.opcoes.formato) ?? 'telegram';
    if (!id || !['telegram', 'terminal', 'json'].includes(formato)) throw new Error(msg().master.usoPedir);
    // RM-061 (F2b, G2): o pedido de nota e gravado no escopo pt-BR; o erro da entrega volta no locale do comando.
    const pedido = comLocale('pt-BR', () => pedirNota(carregado.raiz, id, { codigosEmUso: codigosEmUso(carregado.raiz) }));
    console.log(formato === 'json' ? JSON.stringify(pedido, null, 2) : textoDoPedidoDeNota(carregado.raiz, pedido, formato as 'telegram' | 'terminal'));
    return 0;
  }
  if (primeiro === 'digest') {
    const sub = args.posicionais[2];
    if (sub === 'responder') {
      exigirNotaSemHost();
      console.log(JSON.stringify(responderLoteDigest(carregado.raiz, texto(args.opcoes.resposta) ?? '', texto(args.opcoes.por) ?? '').map(r => ({ thread: r.thread.id, score: r.masterLog.score })), null, 2));
      return 0;
    }
    if (sub === 'preview') {
      console.log(JSON.stringify(montarDigest(carregado.raiz, new Date().toISOString()), null, 2));
      return 0;
    }
    if (sub !== 'enviar') throw new Error(msg().cli.masterDigestUso);
    const r = enviarDigest({ raiz: carregado.raiz });
    console.log(JSON.stringify(r, null, 2)); return r.code;
  }
  if (primeiro === 'migrar') {
    console.log(JSON.stringify(migrarMaster(carregado.raiz, { dryRun: args.opcoes['dry-run'] === true, por: texto(args.opcoes.por) ?? '' }), null, 2));
    return 0;
  }
  if (primeiro === 'classes') {
    console.log(tabelaDeClasses());
    return 0;
  }
  if (primeiro === 'ratificar' || ((args.opcoes.batch === true || primeiro === 'batch') && args.opcoes.aceitar)) {
    exigirNotaSemHost();
    let selecao: SelecaoMaster[];
    if (primeiro === 'ratificar') {
      const partes = (texto(args.opcoes.resposta) ?? '').trim().split(/\s+/);
      const classe = parseClasse(partes[3]);
      if (partes.length !== 4 || partes[0] !== 'ratificar' || !classe) throw new Error(msg().cli.masterRatificarUso);
      selecao = [{ thread: partes[1], assinatura: partes[2], classe }];
    } else {
      selecao = (texto(args.opcoes.aceitar) ?? '').split(',').map(v => {
        const partes = v.trim().split(':');
        if (partes.length !== 2 || !/^[a-f0-9]{64}$/.test(partes[1])) throw new Error(msg().cli.masterSelecaoUso);
        return { thread: partes[0], assinatura: partes[1] };
      });
    }
    console.log(JSON.stringify(ratificarBatch(carregado.raiz, selecao, texto(args.opcoes.por) ?? '').map(r => ({ thread: r.thread.id, score: r.masterLog.score, por: r.masterLog.avaliadoPor })), null, 2));
    return 0;
  }
  // I-43 (T8): a FILA saiu. `--batch` recebe recusa tipada em vez de sumir em
  // silencio: quem tem o comando no dedo ou num script precisa SABER que o regime
  // mudou, e para onde ir. Desaparecer sem dizer nada seria o mesmo pecado da #TAG
  // aposentada virando default.
  if (args.opcoes.batch === true || primeiro === 'batch') {
    console.error(msg().master.complementar.batchAposentado);
    return 2;
  }
  if (args.opcoes['aceitar-omissao'] !== undefined) {
    return comandoAceitarOmissao(args, carregado.raiz, primeiro);
  }
  if (primeiro === undefined) {
    console.log(args.opcoes.json
      ? JSON.stringify({ entregas: listarBatch(carregado.raiz, args.opcoes.todas === true),
          aceitasPorOmissao: aceitosPorOmissao(carregado.raiz) }, null, 2)
      : tabelaDeEntregas(carregado.raiz, args.opcoes.todas === true));
    return 0;
  }
  const propor = primeiro === 'propor';
  const id = propor ? args.posicionais[2] : primeiro;
  const mm = msg().master.complementar;
  if (!id) throw new Error(mm.informeThread);
  const brutoScore = texto(args.opcoes.score);
  const justificativa = texto(args.opcoes.justificativa) ?? texto(args.opcoes.porque);
  if (brutoScore === undefined) {
    console.error(mm.usoScore);
    console.error(mm.scoreHumano);
    return 2;
  }
  if (!justificativa) {
    console.error(mm.justificativa(id));
    console.error(mm.justificativaRazao);
    console.error(mm.justificativaComando(id, brutoScore));
    return 2;
  }
  const brutasClasses = texto(args.opcoes.classe) ?? texto(args.opcoes.classes);
  const classes: ClasseDeFalha[] = [];
  for (const bruta of (brutasClasses ?? '').split(',').map((c) => c.trim()).filter(Boolean)) {
    const classe = parseClasse(bruta);
    if (!classe) {
      console.error(mm.classeInvalida(bruta));
      console.error(mm.classesFixas(ORDEM_DAS_CLASSES.join(', ')));
      return 2;
    }
    classes.push(classe);
  }
  const opcoesMaster = {
    score: Number(brutoScore),
    justificativa,
    classes,
    resumo: texto(args.opcoes.resumo),
    por: texto(args.opcoes.por) ?? texto(args.opcoes.quem),
    refazer: args.opcoes.refazer === true,
  };
  if (propor) {
    console.log(JSON.stringify(proporMaster(carregado.raiz, id, opcoesMaster), null, 2));
    return 0;
  }
  // RM-048 (D8): nota em nome de pessoa, de processo de host, so pelo ingresso autenticado.
  exigirNotaSemHost();
  const r = registrarMaster(carregado.raiz, id, opcoesMaster);
  console.log(textoDoMaster(r));
  // Bloco B6: fechada a thread, a licao (POSTMORTEM + score) vai para a colecao
  // `learning`, e e o que uma thread NOVA do mesmo produto recebe no GOAL.
  relatarPublicacao(publicar(carregado, id));
  // I-55 (RM-008): a thread fechada pode fazer uma falha recorrente passar do piso. A proposta
  // vai ao ledger do projeto uma vez por janela; virar policy continua sendo do dono.
  for (const p of registrarPropostasNovas(carregado.raiz)) {
    console.log('');
    console.log(mm.proposta(p.chave, p.threads.length, p.janelaDias));
    console.log(`  ${p.sugestao}`);
    console.log(mm.soProposta);
  }
  console.log('');
  console.log(mm.proximo);
  return 0;
}

/**
 * RM-008 (03/10/2026): `ork master [<thread>] --aceitar-omissao [--thread T] [--dry-run] [--json]`.
 *
 * Tres vezes na madrugada de 03/10, um condutor rodou `ork master --aceitar-omissao` para fechar a
 * propria thread, e o comando fechou tambem as entregues de outras frentes (ork-rm057fatia3t,
 * ork-rm025modocon). A thread indicada (posicional, `--thread T` ou `--aceitar-omissao=T`) limita o
 * aceite a ela. Sem thread, o padrao continua o mesmo, por decisao registrada: drenar todas, agora
 * listando cada uma e avisando em stderr quando quem roda e processo de agente.
 */
function comandoAceitarOmissao(args: Args, raiz: string, posicional: string | undefined): number {
  const bruto = args.opcoes['aceitar-omissao'];
  const candidatos = [posicional, texto(args.opcoes.thread), typeof bruto === 'string' ? bruto : undefined]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
  if (args.opcoes.thread === true || new Set(candidatos).size > 1) {
    console.error(msg().master.usoOmissao);
    return 2;
  }
  const alvo = candidatos[0];
  const dryRun = args.opcoes['dry-run'] === true;
  const json = args.opcoes.json === true;
  if (alvo) {
    const fora = motivoForaDaOmissao(raiz, alvo);
    if (fora) {
      if (json) console.log(JSON.stringify(dryRun ? { dryRun: true, fecharia: [], motivo: fora.motivo } : [], null, 2));
      else (fora.motivo === 'ja-fechada' ? console.log : console.error)(fora.texto);
      return fora.motivo === 'ja-fechada' ? 0 : 1;
    }
  }
  if (dryRun) {
    const fecharia = entregasParaOmissao(raiz, alvo).map((p) => ({ thread: p.thread.id, indice: indiceDaThread(raiz, p.thread.id) }));
    if (json) { console.log(JSON.stringify({ dryRun: true, fecharia }, null, 2)); return 0; }
    const m = msg().master;
    console.log(m.ensaio);
    if (fecharia.length === 0) { console.log(m.nadaEsperando); return 0; }
    console.log(m.fecharia(fecharia.length));
    for (const f of fecharia) console.log(m.linhaDoIndice(f.thread, f.indice.valor, f.indice.base));
    avisoDeOmissaoSemAlvo(alvo, fecharia.length, true);
    return 0;
  }
  // RM-061 (F2b, G2): o MASTER log, o POSTMORTEM e o registro da omissao nascem em pt-BR.
  const aceitos = comLocale('pt-BR', () => aceitarPendentesPorOmissao(raiz, { thread: alvo }));
  avisoDeOmissaoSemAlvo(alvo, aceitos.length, false);
  if (json) { console.log(JSON.stringify(aceitos, null, 2)); return 0; }
  const m = msg().master;
  if (aceitos.length === 0) { console.log(m.nadaEsperando); return 0; }
  console.log(m.aceitas(aceitos.length));
  for (const a of aceitos) console.log(m.linhaDoIndice(a.thread, a.indice.valor, a.indice.base));
  console.log('');
  console.log(m.discordou);
  return 0;
}

/**
 * O aviso do aceite SEM thread vindo de processo de agente que alcanca mais de uma entrega. A marca
 * e a mesma do `master.prova-de-canal` (ambiente do host ou do despacho). Vai para stderr: o stdout,
 * inclusive o `--json`, fica como era.
 */
function avisoDeOmissaoSemAlvo(alvo: string | undefined, quantas: number, ensaio: boolean): void {
  if (alvo || quantas <= 1) return;
  const marca = marcaDeHost(process.env);
  if (!marca) return;
  const propria = (process.env[ENV_THREAD_DO_DESPACHO] ?? '').trim();
  console.error('');
  console.error(msg().master.avisoSemThread(marca, ensaio, quantas));
  console.error(msg().master.avisoSoASua(propria || '<thread-id>', ensaio));
}

/** I-55 (RM-008): `ork licoes` mostra o que volta no proximo GOAL e PLAN, e as propostas de policy. */
function comandoLicoes(args: Args): number {
  const carregado = exigirManifesto();
  if (args.opcoes.json === true) {
    console.log(JSON.stringify({ resumo: resumoDasLicoes(carregado.raiz, null), propostas: propostasDePolicy(carregado.raiz) }, null, 2));
    return 0;
  }
  console.log(textoDeLicoes(carregado.raiz));
  return 0;
}

/**
 * `ork prompt list|lint|render`: os prompts do `ork` como templates versionados (bloco B4).
 *
 * O `lint` reprova template quebrado ANTES de ele virar despacho; o `render` mostra o prompt
 * exato com o mesmo sha256 que iria para o ledger, para o builder revisar texto sem gastar
 * uma sessao do runtime para descobrir o que foi pedido.
 */
/**
 * I-44: documentacao como codigo. `verificar` le docs e git (roda no CI); `sincronizar` le tambem
 * o estado das threads, que nao e versionado, e por isso roda na maquina do projeto.
 */
/** I-47: reservas de item do roadmap entre maquinas (`ork roadmap reservas|pegar|soltar`). */
function comandoRoadmap(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1] ?? 'reservas';
  const remoto = texto(args.opcoes.remoto);
  if (sub === 'reservas') {
    // RM-037 (rm037noite, defeito 3): a reserva de thread ja fechada aparece como orfa e sai com registro.
    if (args.opcoes['soltar-orfas'] === true) {
      // RM-061 (F3b, D3): a soltura grava no escopo pt-BR (ledger, branch de reservas); o detalhe e remontado no texto.
      const soltas = comLocale('pt-BR', () => soltarReservasOrfas(carregado.raiz, { remoto }));
      const mr = msg().reservas;
      if (args.opcoes.json === true) console.log(JSON.stringify(soltas, null, 2));
      else console.log(soltas.length === 0 ? mr.nenhumaOrfa
        : soltas.map((s) => mr.soltura(s.item, remontar(s.detalhe), s.thread)).join('\n'));
      return 0;
    }
    // RM-052 (fatia 2, D4): as reservas moram no remoto do projeto. Sem ele, nada e lido; com ele mudo e
    // sem copia, tambem nao. A resposta diz qual projeto leu e o que ficou de fora, nunca "nenhum item".
    // RM-047: nome fora do formato de remoto recusa antes do git, como sempre.
    const nomeDoRemoto = exigirRemoto(remoto ?? REMOTO_PADRAO, 'roadmap');
    const url = remotoDoProjeto(carregado.raiz, nomeDoRemoto);
    const painel: PainelDeReservas = url === null ? { reservas: [], feats: [], atualizado: false, ponta: null }
      : listarReservas(carregado.raiz, { remoto });
    const leitura = leituraDasReservas(painel, url !== null);
    const orfas = reservasOrfas(carregado.raiz, painel.reservas);
    const lido = leitura === 'lido-agora' || leitura === 'copia-local';
    const consulta = consultaDoProjeto(carregado, {
      remoto: url,
      lido: lido ? [`reservas do roadmap (${BRANCH_DE_RESERVAS} em ${nomeDoRemoto}, ${leitura === 'lido-agora' ? 'lido agora' : 'última cópia local'})`] : [],
      naoLido: [FORA_DA_CONSULTA.roadmap,
        ...(leitura === 'sem-remoto' ? [`reservas do roadmap: o projeto não tem o remoto ${nomeDoRemoto}, nada foi lido de ${BRANCH_DE_RESERVAS}`]
          : leitura === 'sem-copia' ? [`reservas do roadmap: o remoto ${nomeDoRemoto} não respondeu e não há cópia local de ${BRANCH_DE_RESERVAS}`]
            : [])],
    });
    console.log(args.opcoes.json === true ? JSON.stringify({ ...painel, orfas, leitura, consulta }, null, 2)
      : [...linhasDaConsulta(consulta), '', textoDasReservas(painel, orfas,
        { remoto: nomeDoRemoto, projeto: carregado.manifesto.project.name, temRemoto: url !== null })].join('\n'));
    return 0;
  }
  if (sub === 'status') {
    // RM-048 (item 7): o status report unico do roadmap. Os canais chamam isto e transportam o texto.
    // RM-052: com o projeto consultado e o que ficou de fora (as outras maquinas nao sao lidas aqui).
    const consulta = consultaDoProjeto(carregado, { lido: ['roadmap (docs/roadmap)', FORA_DA_CONSULTA.threadsDaMaquina],
      naoLido: [FORA_DA_CONSULTA.reservas, 'threads de outras máquinas (ork network roadmap)'] });
    // RM-061 (F2b, G2): o status e montado em pt-BR, como o --json; so o texto segue o locale. Os canais (Hermes,
    // OpenClaw) transportam o texto: com owner.language ou LANG en no host, o dono o recebe em ingles.
    // RM-063 (F2): o fecho le a mesma fila do `ork pulse`, sem forja e sem registrar.
    const status = comLocale('pt-BR', () => montarStatusDoRoadmap(carregado.raiz, { projeto: carregado.manifesto.project.name, consulta,
      fila: (quando) => filaDoDono(carregado, { quando }) }));
    console.log(args.opcoes.json === true ? JSON.stringify(status, null, 2) : textoDoStatusDoRoadmap(status));
    return 0;
  }
  // RM-037 (rm037noite, defeito 6): o numero da FEAT nova sai da mesma branch de reservas.
  if (sub === 'feat') {
    const r = comLocale('pt-BR', () => reservarFeat(carregado.raiz, { remoto, por: texto(args.opcoes.por), maquina: texto(args.opcoes.maquina),
      thread: texto(args.opcoes.thread) ?? null, nota: texto(args.opcoes.nota) ?? null }));
    const mr = msg().reservas;
    if (args.opcoes.json === true) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(mr.feat(r.feat, r.reserva.thread ?? null));
      console.log(mr.crieAPagina(r.feat));
      console.log(mr.branch(r.commit.slice(0, 7)));
    }
    return 0;
  }
  const item = args.posicionais[2];
  if ((sub !== 'pegar' && sub !== 'soltar') || !item) {
    console.error(msg().reservas.uso);
    return 2;
  }
  const opcoes = {
    remoto,
    por: texto(args.opcoes.por),
    maquina: texto(args.opcoes.maquina),
    ...(texto(args.opcoes.thread) !== undefined ? { thread: texto(args.opcoes.thread) } : {}),
    ...(texto(args.opcoes.nota) !== undefined ? { nota: texto(args.opcoes.nota) } : {}),
    forcar: args.opcoes.forcar === true,
    motivo: texto(args.opcoes.motivo),
  };
  const r = comLocale('pt-BR', () => sub === 'pegar' ? pegarItem(carregado.raiz, item, opcoes) : soltarItem(carregado.raiz, item, opcoes));
  if (args.opcoes.json === true) {
    console.log(JSON.stringify(r, null, 2));
    return 0;
  }
  const mr = msg().reservas;
  console.log(mr.itemAcao(r.item, mr.acao(r.acao)));
  if (r.reserva && r.acao !== 'soltou') console.log(mr.com(r.reserva.por, r.reserva.maquina, r.reserva.thread ?? null));
  if (r.commit) console.log(mr.branch(r.commit.slice(0, 7)));
  return 0;
}

/**
 * RM-054 (fatia 1): `ork network roadmap`, o roadmap da rede de qualquer diretorio. Pedido de projeto
 * ambiguo ou desconhecido e resposta, nao erro: a recusa com os candidatos, e o codigo da RM-052.
 */
function comandoNetworkRoadmap(args: Args): number {
  const pedido = texto(args.opcoes.projeto);
  if (args.posicionais[1] !== 'roadmap' || args.posicionais.length > 2 || (args.opcoes.projeto !== undefined && !pedido)) {
    console.error(msg().network.roadmap.uso);
    return 2;
  }
  try {
    // RM-054 (fatia 2, D-G4 e D-G6): o host que declara nao ter cwd de projeto (RM-052, D3) pede por
    // nome ou pela forja, e o projeto do diretorio dele so entra pelo registro.
    const host = (process.env[ENV_PROJETO_EXPLICITO] ?? '').trim() === '1';
    const p = montarPanoramaDaRede({ pedido, semRemoto: args.opcoes['sem-remoto'] === true, host });
    console.log(args.opcoes.json === true ? JSON.stringify(p, null, 2) : textoDoPanoramaDaRede(p));
    return p.projetos.length ? 0 : 2;
  } catch (e) {
    if (!(e instanceof ErroDoPedidoDeProjeto)) throw e;
    console.log(args.opcoes.json === true ? JSON.stringify(e.recusa, null, 2) : e.texto);
    return SAIDA_DO_PEDIDO;
  }
}

/**
 * RM-026 K7 (fatia 2, D11 e D13): o conhecimento escrito, so leitura. O JSON e o das tools `ork_conhecimento_*`,
 * em pt-BR nas duas linguas; so o texto segue o locale. Sai 1 quando a consulta nao responde e 2 com uso errado
 * (D13 revista no CHECK: o gate de CI separa o erro de digitacao da lacuna).
 */
function comandoConhecimento(args: Args): number {
  const [, sub = 'listar', id, ...resto] = args.posicionais;
  const colecao = args.opcoes.colecao;
  const valido = (CONSULTAS_DO_CONHECIMENTO as readonly string[]).includes(sub) && !resto.length &&
    (args.opcoes.json === undefined || args.opcoes.json === true) &&
    Object.keys(args.opcoes).every((k) => k === 'json' || (k === 'colecao' && sub === 'listar')) &&
    (colecao === undefined || (typeof colecao === 'string' && NOME_DE_COLECAO.test(colecao))) &&
    (sub === 'mostrar' ? typeof id === 'string' && ID_DE_DOCUMENTO.test(id) : id === undefined);
  if (!valido) {
    console.error(msg().cli.erro(msg().conhecimento.uso));
    return 2;
  }
  const pedido: PedidoDoConhecimento = sub === 'mostrar' ? { consulta: 'mostrar', id }
    : sub === 'listar' ? { consulta: 'listar', ...(typeof colecao === 'string' ? { colecao } : {}) }
      : { consulta: sub as 'colecoes' | 'verificar' };
  const carregado = exigirManifesto();
  const r = consultarConhecimento(carregado, pedido);
  console.log(args.opcoes.json === true ? jsonSemInvisivel(r) : textoDoConhecimento(r));
  return consultaRespondeu(r) ? 0 : 1;
}

function comandoDocs(args: Args): number {
  const sub = args.posicionais[1] ?? 'verificar';
  const carregado = carregarManifesto();
  const raiz = carregado?.raiz ?? diretorioDoProjeto();
  const baseBranch = carregado?.manifesto.worktree?.base_branch ?? 'main';

  const md = msg().docs;
  if (sub === 'verificar') {
    // RM-037 (fatia 3, GO-FIX 2): o CI passa --pr no pull_request; no push da main as duas regras novas reprovam.
    // RM-061 (F3b, G4): verifica no escopo pt-BR, como o `--json` leva os achados; o texto os remonta no locale do comando.
    const threadDaWorktree = escopoPadraoDoSync(raiz).thread;
    const baseCarimbada = threadDaWorktree ? lerThread(raiz, threadDaWorktree).base?.commit : undefined;
    const { docs, achados } = comLocale('pt-BR', () => verificarDocs(raiz,
      { baseBranch, baseCarimbada, ajudaDoCli: AJUDA, pr: args.opcoes.pr === true }));
    if (args.opcoes.json === true) {
      console.log(JSON.stringify({ paginas: docs.length, erros: achados.filter((a) => a.gravidade === 'erro').length,
        achados }, null, 2));
    } else {
      console.log(textoDaVerificacao(docs, achados));
    }
    return achados.some((a) => a.gravidade === 'erro') ? 2 : 0;
  }
  if (sub === 'sincronizar') {
    const escrever = args.opcoes.escrever === true;
    // RM-037 (rm037noite, defeito 5): o escopo. `--so` diz os itens; sem ele, na worktree de uma thread
    // com item, so o item dela; `--todos` (ou fora de worktree de thread) volta a todo item.
    // Sugestao 4 do CHECK 1 (e 8 do CHECK 2, `--so=`): `--so` sem item e erro de uso, nunca o escopo
    // padrao em silencio.
    if (args.opcoes.so === true || (typeof args.opcoes.so === 'string' && !args.opcoes.so.trim())) {
      console.error(md.usoSoSemItem);
      return 2;
    }
    const so = texto(args.opcoes.so);
    let itens: string[] | undefined;
    let escopo = md.escopoTodos;
    if (so) {
      itens = so.split(',').map((i) => i.trim().toUpperCase()).filter(Boolean);
      const fora = itens.filter((i) => !/^RM-\d{3}$/.test(i));
      if (fora.length || itens.length === 0) {
        console.error(md.usoSoInvalido(so));
        return 2;
      }
      escopo = md.escopoSo(itens.join(', '));
    } else if (args.opcoes.todos !== true) {
      const padrao = escopoPadraoDoSync(raiz);
      if (padrao.itens) {
        itens = padrao.itens;
        escopo = md.escopoDaThread(itens.join(', '), String(padrao.thread));
      }
    }
    const r = comLocale('pt-BR', () => sincronizarDocs(raiz, { baseBranch, escrever, itens }));
    console.log(args.opcoes.json === true ? JSON.stringify({ ...r, escopo: itens ?? null }, null, 2)
      : `${md.escopo(escopo)}\n${textoDaSincronizacao(r, escrever)}`);
    return 0;
  }
  if (sub === 'init') {
    // RM-061 (F3a, D1 e D5): os sete arquivos nascem na lingua do dono, resolvida pelo manifesto (tambem com `--json`,
    // que tira so o texto impresso do locale); o texto segue o locale do comando coberto.
    const criados = iniciarDocs(raiz, resolverLocale(carregado?.manifesto.owner?.language).locale);
    const m = msg().gerados.docsInit;
    console.log(criados.length === 0
      ? m.jaEstava
      : [m.criado, ...criados.map((c) => `  ${c}`), '', m.proximoPasso].join('\n'));
    return 0;
  }
  console.error(md.uso);
  return 2;
}

function comandoPrompt(args: Args): number {
  const sub = args.posicionais[1] ?? 'list';
  const carregado = carregarManifesto();
  const raiz = carregado?.raiz;
  const mp = msg().prompts.cli;
  // RM-061 F3c: o template e a lingua do prompt sao os do despacho (a lingua declarada do dono, `owner.language`;
  // sem ela, pt-BR), para o render mostrar o que o `phase run` grava; so o texto do CLI em volta segue o locale ativo.
  // Os templates do projeto sempre aparecem; dos embutidos, o da lingua do prompt.
  const linguaDoPrompt = linguaDeclaradaDoDono(carregado?.manifesto.owner?.language);
  const templatesDaLingua = () => carregarTemplates(raiz).filter(
    (t) => t.origem !== 'embutido' || (linguaDoPrompt === 'en' ? t.id.endsWith('.en') : !t.id.endsWith('.en'))
  );

  if (sub === 'list') {
    console.log(tabelaDeTemplates(templatesDaLingua()));
    return 0;
  }

  if (sub === 'lint') {
    const id = texto(args.opcoes.template);
    const templates = id ? [exigirTemplate(id, raiz)] : templatesDaLingua();
    const problemas: ProblemaDeTemplate[] = [...templates.flatMap((t) => lintTemplate(t)),
      ...(id ? [] : avisosDeLingua(templates, linguaDoPrompt))];
    console.log(mp.lintTitulo(raiz ?? null));
    console.log('');
    console.log(textoDoLint(problemas, templates.length));
    return problemas.some((p) => p.gravidade === 'erro') ? 2 : 0;
  }

  if (sub === 'render') {
    const fase = exigirFaseCanonica(texto(args.opcoes.fase) ?? args.posicionais[3]);
    const pedido = texto(args.opcoes.pedido) ?? mp.pedidoExemplo;
    const idTemplate = texto(args.opcoes.template);

    // Modo exemplo: renderiza sem thread nenhuma, para revisar o texto de um modo antes de
    // abrir trabalho. Nada e gravado, e o `ork` diz em voz alta que a thread e ficticia.
    if (args.opcoes.exemplo === true || args.opcoes.modo !== undefined || args.opcoes.mode !== undefined) {
      const bruto = texto(args.opcoes.modo) ?? texto(args.opcoes.mode) ?? 'classic';
      let modo: Modo;
      try { modo = exigirModoVivo(bruto); }
      catch (e) { console.error((e as Error).message); return 2; }
      const exemplo = threadDeExemplo(modo, fase, carregado?.manifesto.project);
      const template = idTemplate ? exigirTemplate(idTemplate, raiz) : templateDaFase(fase, raiz, linguaDoPrompt);
      const prompt = renderizar(template, valoresDoPrompt(exemplo, fase, pedido, '', idiomaDoTemplate(template)));
      console.log(mp.cabecalhoTemplate(template.id, template.versao, template.origem));
      console.log(mp.cabecalhoExemplo(MODOS[modo].tag, hashDoPrompt(prompt)));
      console.log('');
      console.log(prompt);
      return 0;
    }

    const obrigatorio = exigirManifesto();
    const threadId = args.posicionais[2];
    if (!threadId) {
      console.error(mp.usoRenderThread);
      console.error(mp.usoRenderExemplo);
      return 2;
    }
    const thread = lerThread(obrigatorio.raiz, threadId);
    // RM-059 (T6.0): sem --pedido, o pedido guardado na criacao, conferido pelo sha256; thread sem pedido
    // guardado segue com o texto de exemplo, como antes.
    const guardado = texto(args.opcoes.pedido) === undefined ? pedidoDaThread(obrigatorio.raiz, thread) : null;
    const pedidoDaFase = guardado?.texto ?? pedido;
    const template = idTemplate ? exigirTemplate(idTemplate, obrigatorio.raiz) : templateDaFase(fase, obrigatorio.raiz, linguaDoPrompt);
    const prompt = idTemplate
      ? renderizar(template, valoresDoPrompt(thread, fase, pedidoDaFase, '', idiomaDoTemplate(template)))
      : montarPrompt(thread, fase, pedidoDaFase, obrigatorio.raiz, '', linguaDoPrompt);
    console.log(mp.cabecalhoTemplate(template.id, template.versao, template.origem));
    console.log(mp.cabecalhoThread(thread.id, fase, hashDoPrompt(prompt)));
    if (guardado) console.log(mp.pedidoGuardado(shaCurto(guardado.sha256)));
    console.log('');
    console.log(prompt);
    return 0;
  }

  console.error(mp.subcomandoDesconhecido(sub));
  return 2;
}

/** Fase canonica a partir do texto do usuario, com erro tipado quando nao existe. */
function exigirFaseCanonica(bruto: string | undefined): Fase {
  const alvo = (bruto ?? '').toUpperCase();
  if (!(FASES as readonly string[]).includes(alvo)) {
    throw new Error(msg().prompts.cli.faseForaDoCiclo(bruto ?? '', FASES.join(' ')));
  }
  return alvo as Fase;
}

/**
 * `ork adapter list|show|install <host>`: instalacao dos adaptadores de Camada 1 (bloco B4).
 */
/**
 * O caminho real do `ork` em execução, quando o processo é este CLI (argv[1] resolve para este arquivo).
 * Importado por outro script, devolve undefined e o install volta à ordem antiga (PATH, catálogo).
 */
function orkEmExecucao(): string | undefined {
  try {
    const proprio = fs.realpathSync(__filename);
    return process.argv[1] && fs.realpathSync(process.argv[1]) === proprio ? proprio : undefined;
  } catch { return undefined; }
}

function comandoAdapter(args: Args): number {
  const sub = args.posicionais[1] ?? 'list';
  const ma = msg().adapter;

  if (sub === 'list') {
    console.log(tabelaDeHosts());
    return 0;
  }

  if (sub === 'show') {
    const host = parseHost(args.posicionais[2]);
    if (!host) {
      console.error(ma.hostDesconhecido(args.posicionais[2] ?? '', ORDEM_DOS_HOSTS.join(' | ')));
      return 2;
    }
    console.log(ma.adaptador(host));
    console.log(`  ${ma.hosts[host].descricao}`);
    console.log(`  ${ma.destinoPadrao(destinoPadraoDe(host))}`);
    console.log('');
    console.log(textoDosPitfalls(host));
    return 0;
  }

  if (sub === 'install') {
    const host = parseHost(args.posicionais[2]);
    if (!host) {
      console.error(ma.hostDesconhecido(args.posicionais[2] ?? '', ORDEM_DOS_HOSTS.join(' | ')));
      return 2;
    }
    const carregado = carregarManifesto();
    // RM-061 (F3b, G4): instala no escopo pt-BR; os avisos nascem pelo catalogo e o texto os remonta no locale do comando.
    const r = comLocale('pt-BR', () => instalarAdaptador(host, {
      projeto: carregado?.raiz ?? diretorioDoProjeto(),
      dir: texto(args.opcoes.dir),
      dryRun: args.opcoes['dry-run'] === true,
      force: args.opcoes.force === true || args.opcoes.forcar === true,
      orkBin: texto(args.opcoes.ork),
      // Ensaio de 03/10: a extensão chama o ork que a instalou, não o primeiro do PATH.
      orkEmExecucao: orkEmExecucao(),
      versao: VERSAO,
      // I-43 (D5): a decisao por ARQUIVO, que e o que faz `--force` deixar de ser o
      // unico caminho de saida. `;` separa varios, como o resto do CLI ja faz.
      aceitarCatalogo: (texto(args.opcoes['aceitar-catalogo']) ?? '').split(';').map(x => x.trim()).filter(Boolean),
      manterCopia: (texto(args.opcoes['manter-copia']) ?? '').split(';').map(x => x.trim()).filter(Boolean),
      // RM-061 (F3a, D1 e D9): o bloco da experiência nasce na língua do dono; na F3b, o texto impresso segue o locale.
      locale: resolverLocale(carregado?.manifesto.owner?.language).locale,
    }));
    console.log(textoDaInstalacao(r));
    return r.ok ? 0 : 2;
  }

  console.error(ma.subcomandoDesconhecido(sub));
  return 2;
}

/**
 * `ork eval`: canarios de comportamento e o corpus das skills finas (bloco B4).
 *
 * Skill sem eval nao entra, e comportamento sem canario tambem nao. O comando sai diferente
 * de zero em qualquer falha, para o CI do kit poder barrar merge sem eval.
 */
function comandoEval(args: Args): number {
  // RM-047 (P4): o eval so executa o catalogo do proprio pacote, nunca o achado a partir do cwd.
  const catalogo = exigirCatalogoDoPacote(carregarManifesto()?.raiz ?? diretorioDoProjeto());
  const lista = (v: string | boolean | undefined): string[] | undefined => {
    const t = texto(v);
    return t ? t.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
  };
  const r = rodarEval({
    catalogo,
    skills: lista(args.opcoes.skill),
    canarios: lista(args.opcoes.canario) ?? lista(args.opcoes.fixture),
    soCanarios: args.opcoes['so-canarios'] === true,
    soSkills: args.opcoes['so-skills'] === true,
  });
  if (args.opcoes.json === true) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(textoDoEval(r));
  }
  return r.ok ? 0 : 1;
}

/**
 * `ork audit ...`: os auditores periodicos (bloco B5).
 *
 * O comando existe para ser chamado por CRON e por orquestrador sem sessao interativa:
 * e por isso que ele mora no CLI deterministico e nao numa skill. Todo subcomando sai
 * diferente de zero quando reprova, para o agendador do host perceber sem ler texto.
 */

function comandoAudit(args: Args): number {
  const m = msg().audit;
  if (args.posicionais[1] === 'process') {
    const r = auditarProcesso(exigirManifesto(), args.opcoes.registrar === true);
    console.log(JSON.stringify(r, null, 2));
    const chave = texto(args.opcoes['exigir-achado']);
    return chave && !r.achados.some(a => a.chave === chave) ? 1 : 0;
  }
  const sub = args.posicionais[1] ?? 'packs';

  // `audit packs` e `audit lint` funcionam sem manifesto: sao catalogo, nao estado.
  if (sub === 'packs' || sub === 'pack') {
    const carregado = carregarManifesto();
    const bruto = texto(args.opcoes.estagio) ?? texto(args.opcoes.stage);
    const estagio = bruto ? parseEstagio(bruto) : carregado?.manifesto.project.stage;
    if (bruto && !estagio) {
      console.error(m.erro.estagio(bruto));
      return 2;
    }
    const pack = texto(args.opcoes.pack) ?? args.posicionais[2];
    if (pack) {
      const alvo = parsePack(pack);
      if (!alvo) {
        console.error(m.erro.pack(pack, ORDEM_DOS_PACKS.join(', ')));
        return 2;
      }
      console.log(textoDoPack(alvo, estagio ?? undefined));
      return 0;
    }
    console.log(
      m.packs.titulo(estagio ?? undefined)
    );
    console.log('');
    console.log(tabelaDePacks(estagio ?? undefined));
    if (estagio) {
      console.log('');
      console.log(m.packs.ativo(packsAtivos(estagio).join(', ')));
      console.log(m.packs.postura(posturaDoPack(estagio)));
    }
    return 0;
  }

  if (sub === 'lint') {
    const raiz = carregarManifesto()?.raiz;
    const templates = carregarTemplatesDeAuditoria(raiz);
    const problemas = templates.flatMap((t) => lintTemplateDeAuditoria(t));
    console.log(m.cli.lintTitulo(raiz));
    console.log('');
    for (const p of problemas) {
      console.log(m.cli.lintItem(p.gravidade, p.template, p.regra));
      console.log(m.cli.lintDetalhe(p.detalhe));
    }
    if (problemas.length === 0) console.log(m.cli.lintOk(templates.length));
    console.log('');
    console.log(
      m.cli.lintResumo(templates.length, problemas.filter((p) => p.gravidade === 'erro').length,
        problemas.filter((p) => p.gravidade === 'aviso').length)
    );
    return problemas.some((p) => p.gravidade === 'erro') ? 2 : 0;
  }

  const carregado = exigirManifesto();

  if (sub === 'run') {
    const pack = parsePack(args.posicionais[2]);
    if (!pack) {
      console.error(m.uso('run'));
      console.error(m.cli.packs(ORDEM_DOS_PACKS.join(', ')));
      return 2;
    }
    const autorizar = args.opcoes.agora;
    const r = rodarAuditoria(carregado, pack, {
      perfil: texto(args.opcoes.profile) ?? texto(args.opcoes.perfil),
      since: texto(args.opcoes.since),
      tudo: args.opcoes.tudo === true,
      effort: texto(args.opcoes.effort),
      model: texto(args.opcoes.model),
      dryRun: args.opcoes['dry-run'] === true,
      agora: typeof autorizar === 'string' ? autorizar : undefined,
      forcar: args.opcoes.forcar === true || args.opcoes.force === true,
    });
    if (r.status === 'bloqueada') {
      console.error(m.cli.bloqueada(r.id));
      console.error(`  ${DESCRICAO_DO_MOTIVO_DE_AUDITORIA[r.motivo ?? 'runtime.unavailable']}`);
      console.error(m.cli.motivo(String(r.motivo)));
      console.error(m.cli.detalhe(r.detalhe));
      console.error(m.cli.estado(r.id));
      return 1;
    }
    if (r.status === 'ensaio') {
      console.log(m.cli.ensaio(r.id));
      console.log(`  pack        ${r.pack} (postura ${r.postura} no estagio ${r.estagio})`);
      console.log(`  escopo      ${r.escopo.detalhe}`);
      console.log(`  graphify    ${r.escopo.graphify}`);
      console.log(`  custo       effort ${r.custo.effort}, ${r.custo.janela.detalhe}`);
      console.log(`  prompt      ${r.promptPath} (sha256 ${r.promptSha256})`);
      console.log(
        `  comando     claude --bg "<prompt>" --name ${r.slug} --model ${r.custo.model} --effort ${r.custo.effort}`
      );
      if (r.superficie) {
        console.log(`  superficie  ${r.superficie.detalhe}`);
        console.log(
          m.cli.superficieDry(r.id)
        );
      }
      return 0;
    }
    console.log(m.cli.despachada(r.id, r.runtime));
    console.log(`  pack        ${r.pack} (${PACKS[r.pack].titulo})`);
    console.log(`  produto     ${r.produto} (perfil ${r.perfil}), estagio ${r.estagio}, postura ${r.postura}`);
    console.log(`  escopo      ${r.escopo.detalhe}`);
    console.log(`  graphify    ${r.escopo.graphify}`);
    console.log(`  custo       effort ${r.custo.effort}, model ${r.custo.model}`);
    console.log(`  janela      ${r.custo.janela.detalhe}`);
    console.log(`  sessionId   ${r.sessionId}`);
    console.log(`  prompt      ${r.promptPath} (sha256 ${r.promptSha256})`);
    console.log(m.cli.verificada(r.verificada));
    if (r.superficie) {
      console.log(`  superficie  ${r.superficie.detalhe}`);
      console.log(
        m.cli.superficieBoard(r.superficie.registrados, r.superficie.aConfirmar)
      );
    }
    console.log('');
    console.log(m.cli.proposta);
    console.log(m.cli.depois(r.id));
    return r.verificada ? 0 : 1;
  }

  if (sub === 'list') {
    console.log(tabelaDeRodadas(carregado.raiz));
    console.log('');
    console.log(m.cli.board(resumoDoBoard(carregado.raiz)));
    return 0;
  }

  if (sub === 'show') {
    const sobra = SOBRAS_DO_OBJECTIVE.find((opcao) => args.opcoes[opcao] !== undefined);
    if (sobra) return recusarSobraDoObjective(sobra);
    const id = args.posicionais[2];
    if (!id) {
      console.error(m.uso('show'));
      return 2;
    }
    if (args.opcoes.ledger === true) {
      console.log(tabelaDoLedgerDaRodada(carregado.raiz, id));
      return 0;
    }
    console.log(textoDaRodada(carregado.raiz, id));
    return 0;
  }

  if (sub === 'prompt') {
    const pack = parsePack(args.posicionais[2]);
    if (!pack) {
      console.error(m.uso('prompt'));
      console.error(m.cli.packs(ORDEM_DOS_PACKS.join(', ')));
      return 2;
    }
    const { raiz, manifesto } = carregado;
    const estagio = manifesto.project.stage;
    const escopo = escopoDaRodada(raiz, manifesto, {
      since: texto(args.opcoes.since),
      tudo: args.opcoes.tudo === true,
      pack,
    });
    const template = templateDoPack(pack, raiz);
    const prompt = montarPromptDeAuditoria(
      {
        pack,
        produto: manifesto.project.name,
        perfil: texto(args.opcoes.profile) ?? manifesto.board.default,
        estagio,
        postura: posturaDoPack(estagio),
        rodada: '<rodada ainda nao criada>',
        dirDaRodada: '.orkastery/audits/<rodada>',
        escopo,
        janela: janelaDeCusto(manifesto),
        effort: texto(args.opcoes.effort) ?? manifesto.audit.effort,
      },
      raiz
    );
    console.log(`# template ${template.id} v${template.versao} (origem: ${template.origem})`);
    console.log(`# pack ${pack}, estagio ${estagio}, sha256 ${hashDoPrompt(prompt)}`);
    console.log('');
    console.log(prompt);
    return 0;
  }

  if (sub === 'ingest') {
    const id = args.posicionais[2];
    const arquivo = texto(args.opcoes.arquivo) ?? texto(args.opcoes.file);
    if (!id || !arquivo) {
      console.error(m.uso('ingest'));
      return 2;
    }
    const r = ingerirAchados(carregado, id, arquivo);
    console.log(m.cli.ingestao(r.rodada, r.registrados.length));
    // Bloco B6: cada proposta enderecada ao roadmap tambem vai para a colecao `roadmap`.
    if (r.registrados.length > 0) {
      const naMemoria = publicarPropostas(carregado, r.registrados);
      if (naMemoria.regime === 'orkmind') {
        console.log(m.cli.memoriaMuitas(naMemoria.detalhe));
      }
    }
    for (const a of r.registrados) {
      console.log(textoDoAchado(a));
    }
    if (r.duplicados.length > 0) {
      console.log('');
      console.log(
        m.cli.duplicados(r.duplicados.map((a) => a.id).join(', '))
      );
    }
    if (r.recusados.length > 0) {
      console.log('');
      console.error(m.cli.recusados(r.recusados.length));
      for (const rec of r.recusados) {
        console.error(m.cli.recusado(rec.indice + 1, rec.erro));
      }
    }
    console.log('');
    console.log(m.cli.prove(r.rodada));
    return r.recusados.length > 0 ? 1 : 0;
  }

  if (sub === 'finding' || sub === 'achado') {
    const acao = args.posicionais[2];
    if (acao === 'add') {
      const id = args.posicionais[3];
      if (!id) {
        console.error(
          'uso: ork audit finding add <rodada> --regra R --titulo T --arquivo caminho:linha --impacto I --fix F --estimativa E'
        );
        return 2;
      }
      const verificar = texto(args.opcoes.verificar) ?? texto(args.opcoes.verify);
      const achado = registrarAchadoDaRodada(carregado, id, {
        regra: texto(args.opcoes.regra),
        severidade: texto(args.opcoes.severidade) ?? texto(args.opcoes.severity),
        titulo: texto(args.opcoes.titulo),
        arquivo: texto(args.opcoes.arquivo),
        descricao: texto(args.opcoes.descricao),
        alegacao: texto(args.opcoes.alegacao) ?? texto(args.opcoes.claim),
        verificar: verificar ? [verificar] : [],
        impacto: texto(args.opcoes.impacto),
        fix: texto(args.opcoes.fix),
        irreversivel: texto(args.opcoes.irreversivel) ?? 'nenhum',
        estimativa: texto(args.opcoes.estimativa),
      });
      console.log(m.cli.achadoRegistrado(achado.id, id));
      console.log(textoDoAchado(achado));
      const naMemoria = publicarPropostas(carregado, [achado]);
      if (naMemoria.regime === 'orkmind') {
        console.log(m.cli.memoriaUma(naMemoria.detalhe));
      }
      return 0;
    }
    if (acao === 'estado') {
      const id = args.posicionais[3];
      const estado = parseEstadoDeAchado(args.posicionais[4]);
      if (!id || !estado) {
        console.error(
          'uso: ork audit finding estado <achado-id> <aberto|adiado|resolvido|descartado>'
        );
        return 2;
      }
      if (estado === 'virou-thread') {
        console.error(m.cli.estadoReservado);
        return 2;
      }
      const achado = exigirAchado(carregado.raiz, id);
      const atualizado = carimbarAchado(carregado.raiz, achado, { estado });
      console.log(m.cli.achadoEstado(atualizado.id, atualizado.estado));
      console.log(textoDoAchado(atualizado));
      return 0;
    }
    console.error(m.cli.findingDesconhecido(acao ?? ''));
    return 2;
  }

  if (sub === 'verify') {
    const id = args.posicionais[2];
    if (!id) {
      console.error(m.uso('verify'));
      return 2;
    }
    const v = verificarRodada(carregado, id);
    console.log(m.cli.verifyTitulo(v.rodada));
    console.log(m.cli.verifyHead(v.commit));
    console.log(m.cli.verifyDir(v.cwd));
    console.log('');
    if (v.resultados.length === 0) {
      console.log(m.cli.verifyVazio);
    }
    for (const r of v.resultados) {
      console.log(m.cli.verifyClaim(r.claim.id, r.verificado, r.claim.alegacao));
      console.log(m.cli.arquivo(r.claim.arquivo));
      console.log(
        r.claim.verificar.length > 0 ? m.cli.comandos(r.claim.verificar.join(' && ')) : m.cli.semComando
      );
      if (!r.verificado) console.log(m.cli.motivoDetalhe(String(r.motivo), r.detalhe));
    }
    console.log('');
    console.log(
      v.ok
        ? m.cli.vereditoOk
        : m.cli.vereditoRuim(v.motivos.join(', '))
    );
    if (v.motivos.includes('claims.unverifiable')) {
      console.log(m.cli.unverifiable);
    }
    return v.ok ? 0 : 1;
  }

  if (sub === 'report' || sub === 'relatorio') {
    const id = args.posicionais[2];
    if (!id) {
      console.error(m.uso('report'));
      return 2;
    }
    const r = relatorioDaRodada(carregado, id, { publicar: args.opcoes.publicar === true });
    console.log(r.texto);
    console.log(m.cli.relatorio(r.caminho));
    if (r.publicado) console.log(m.cli.publicado(r.publicado));
    return 0;
  }

  if (sub === 'divida' || sub === 'board') {
    const bruto = texto(args.opcoes.pack);
    const pack = bruto ? parsePack(bruto) : undefined;
    if (bruto && !pack) {
      console.error(m.erro.pack(bruto, ORDEM_DOS_PACKS.join(', ')));
      return 2;
    }
    console.log(
      tabelaDaDivida(carregado.raiz, {
        pack: pack ?? undefined,
        todos: args.opcoes.todos === true || args.opcoes.all === true,
      })
    );
    return 0;
  }

  // `audit surface`: a varredura deterministica da superficie de ataque de rede (SP8..SP12).
  // Ela roda sozinha dentro de `audit run security-privacy`; aqui ela e exposta para o
  // operador olhar a superficie sem despachar rodada nenhuma, e para registrar no board os
  // achados de uma rodada que rodou em `--dry-run`.
  if (sub === 'surface' || sub === 'superficie') {
    const bruta = texto(args.opcoes.regra);
    if (bruta && !(REGRAS_DE_SUPERFICIE as readonly string[]).includes(bruta.toUpperCase())) {
      console.error(m.erro.regra(bruta, REGRAS_DE_SUPERFICIE.join(', ')));
      return 2;
    }
    const regra = bruta ? (bruta.toUpperCase() as RegraDeSuperficie) : undefined;
    const limiteBruto = texto(args.opcoes.limite);
    const limite = limiteBruto ? Number(limiteBruto) : undefined;
    if (limite !== undefined && (!Number.isFinite(limite) || limite < 1)) {
      console.error(m.erro.limite(limiteBruto ?? ''));
      return 2;
    }

    const rodadaAlvo = texto(args.opcoes.registrar);
    if (rodadaAlvo) {
      const r = varrerSuperficieDaRodada(carregado, rodadaAlvo, { registrar: true, limitePorRegra: limite });
      console.log(textoDaVarredura(r.resultado));
      console.log('');
      console.log(m.cli.rodadaRegistrada(r.rodada, r.registrados.length));
      for (const a of r.registrados) console.log(`  ${a.id}  ${a.regra}  ${a.arquivo}:${a.linha}  ${a.titulo}`);
      if (r.duplicados.length > 0) {
        console.log(m.cli.jaRegistrados(r.duplicados.map((a) => a.id).join(', ')));
      }
      for (const rec of r.recusados) {
        console.error(m.cli.recusadoSuperficie(rec.achado.regra, rec.achado.arquivo, rec.achado.linha, rec.erro));
      }
      console.log('');
      console.log(m.cli.prove(r.rodada));
      if (r.recusados.length > 0) return 1;
      return r.registrados.length > 0 ? 1 : 0;
    }

    const resultado = varrerSuperficie(carregado.raiz, {
      dir: args.posicionais[2],
      regra,
      limitePorRegra: limite,
    });
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(resultado, null, 2));
    } else {
      console.log(textoDaVarredura(resultado));
    }
    // Codigo != 0 com achado: o agendador do host percebe a superficie aberta sem ler texto.
    return resultado.achados.length > 0 ? 1 : 0;
  }

  console.error(m.uso(sub));
  return 2;
}

/** Roteia o comando. Devolve o codigo de saida do processo. */
/**
 * Imprime o resultado de uma publicacao na memoria semantica (bloco B6).
 *
 * Em regime `files` ele nao imprime nada: o comando que chamou continua com a mesma saida
 * que sempre teve. E o que garante que ligar o B6 nao muda o que o builder ja conhece.
 */
function relatarPublicacao(r: ResultadoDoSync): void {
  const m = msg().thread;
  if (r.publicacao?.estado === 'pendente') { console.log(m.publicacaoPendente(`${r.publicacao.motivo}`)); return; }
  if (r.regime !== 'orkmind') return;
  const gravados = [
    `${r.decisoes.gravadas.filter((g) => g.ok).length} decision`,
    `${r.policies.gravadas.filter((g) => g.ok).length} rule`,
    r.handoff?.ok ? '1 handoff' : '',
    r.learning?.ok ? '1 learning' : '',
    r.roadmap?.ok ? '1 roadmap' : '',
  ].filter((t) => t !== '');
  console.log('');
  console.log(m.memoriaGravada(`${r.estado.tenant}`, gravados.join(', ') || m.nadaAGravar));
  if (r.falhas > 0) console.log(m.gravacoesFalhas(r.falhas));
}

/** Janela de origem e corte de apresentação são inteiros positivos explícitos. */
function limiteDeLeitura(valor: string | boolean | undefined): number | undefined {
  if (valor === undefined) return undefined;
  if (typeof valor !== 'string' || !/^[0-9]+$/.test(valor) ||
      Number(valor) < 1 || Number(valor) > 1000) throw Error('memory.query.invalid');
  return Number(valor);
}

/** `ork recall`: recuperacao tardia dos ponteiros do handoff, no momento indicado. */
function comandoRecall(args: Args): number {
  const carregado = memoryState(exigirManifesto()).loaded;
  const id = args.posicionais[1];
  if (!id) {
    console.error(msg().operacao.restante.recall.uso);
    return 2;
  }
  const thread = lerThread(carregado.raiz, id);
  const faseBruta = texto(args.opcoes.fase) ?? texto(args.opcoes.momento);
  const momento = faseBruta ? exigirFase(thread, faseBruta) : undefined;
  const memoria = abrirMemoria(carregado, { leituraRestrita: { thread: id, limite: limiteDeLeitura(args.opcoes.janela) } });
  const r = comLocale('pt-BR', () => recallDaThread(carregado, memoria, id, {
    momento,
    id: texto(args.opcoes.id),
    todos: args.opcoes.todos === true,
    forcar: args.opcoes.forcar === true,
  }));
  if (args.opcoes.json === true) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(textoDoRecall(r, args.opcoes['sem-conteudo'] !== true));
  }
  // Ponteiro que deveria resolver e nao resolveu e falha, nao relatorio.
  return r.falhas.length > 0 ? 1 : 0;
}

/** `ork memory`: o regime, a publicacao e a busca deterministica por tag. */
function comandoMemory(args: Args): number {
  const candidate = exigirManifesto();
  const carregado = memoryState(candidate).loaded;
  const sub = args.posicionais[1] ?? 'status';
  const mm = msg().operacao.restante.memory.cli;
  const escopo = texto(args.opcoes.escopo)?.split(',').map(s => s.trim());
  if (sub === 'inventory' || (sub === 'migrate' && args.opcoes['dry-run'] === true)) {
    const r = inventariarHandoffs(carregado, escopo);
    if (args.opcoes.json === true) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(mm.inventario(r.tenant, r.incluidos, r.excluidos));
      for (const f of r.fontes) console.log(mm.fonte(f.incluir, f.arquivo, f.motivo));
    }
    return r.fontes.some(f => f.bloqueante) ? 1 : 0;
  }
  if (sub === 'migrate') {
    const operadora = texto(args.opcoes.operadora);
    if (!operadora || !escopo) throw new Error('scope.write.required: --operadora <thread> --escopo <thread,...>');
    if (carregado.manifesto.memory.mode === 'orkmind') {
      const autorizacao = exigirAtivacao(carregado, operadora, 'memory');
      if (escopo.some(id => !autorizacao.threads.includes(id))) throw Error('write.activation.scope-denied');
    }
    const r = migrarHandoffs(carregado, { operadora, escopo });
    if (args.opcoes.json === true) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(mm.migracao(r.inventario.tenant, r.resultados.filter(i => i.ok).length, r.falhas, r.inventario.excluidos));
      for (const item of r.resultados) console.log(`  ${item.arquivo}: ${item.ok ? item.gravacao?.id : item.erro}`);
    }
    return r.ok ? 0 : 1;
  }
  if (sub === 'sync' && args.posicionais[2]) validarDiretorioDeThread(carregado.raiz, args.posicionais[2]);
  if (sub === 'status') {
    const memoria = abrirMemoria(candidate, { embeddings: 'detalhado' });
    // I-38 (D7): --sondar faz UMA chamada real pelo caminho ativo e mede a latencia.
    if (args.opcoes.sondar === true && memoria.ativo && memoria.estado.embeddings) {
      const driver = new DriverCliOrkMind(configDoManifesto(carregado.manifesto));
      memoria.estado.embeddings.sonda = sondarEmbeddings(carregado.manifesto, memoria.estado.embeddings,
        (p, o) => driver.embeddar(p, o), configDoManifesto(carregado.manifesto).timeoutMs);
    }
    if (args.opcoes.json === true) {
      console.log(JSON.stringify({ ...memoria.estado, configSource: memoria.configSource, configDivergent: memoria.configDivergent }, null, 2));
      return 0;
    }
    console.log(textoDoEstado(memoria.estado));
    return 0;
  }

  if (sub === 'sync') {
    const memoria = abrirMemoria(carregado);
    const threadId = args.posicionais[2];
    // Thread inexistente reprova aqui, e nao no meio da gravacao.
    if (threadId) lerThread(carregado.raiz, threadId);
    const perfil = (texto(args.opcoes.perfil) ?? 'integral') as PerfilPublicacao;
    if (!['fabrica','integral'].includes(perfil)) throw Error('memory.publication.profile-invalid');
    if (carregado.manifesto.memory.mode === 'orkmind') {
      try {
        const autorizacao = exigirAtivacao(carregado, threadId ?? '', 'memory');
        if (autorizacao.perfil !== 'integral' && perfil !== autorizacao.perfil) throw Error('write.activation.profile-denied');
      } catch (error) {
        const motivo = error instanceof Error
          ? /^(?:write\.activation|scope|memory)\.[a-z.-]+/.exec(error.message)?.[0] ?? 'write.activation.invalid'
          : 'write.activation.invalid';
        const detalhe = comLocale('pt-BR', () => textoDoCatalogo(m => m.operacao.restante.memory.cli.syncDetalhe));
        if (args.opcoes.json === true) console.log(JSON.stringify({
          regime: memoria.regime, estado: memoria.estado, thread: threadId ?? null, perfil,
          publicacao: { estado: 'pendente', motivo }, falhas: 1, gravadas: [], erro: motivo, detalhe,
        }, null, 2));
        console.error(`${motivo}: ${remontar(detalhe)}`);
        return 1;
      }
    }
    const r = sincronizarMemoria(carregado, memoria, threadId ?? null, undefined, perfil);
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      console.log(textoDoSync(r));
    }
    return r.estado.pedido === 'orkmind' && r.falhas > 0 ? 1 : 0;
  }

  if (sub === 'search' && args.opcoes.texto !== undefined) return buscaPorTexto(args, carregado);

  if (sub === 'search') {
    const threadId = texto(args.opcoes.thread);
    if ((args.opcoes.restrito !== undefined || args.opcoes.thread !== undefined ||
        args.opcoes.janela !== undefined) && !threadId) {
      throw Error('memory.query.thread-required: use --thread <id>');
    }
    const janela = limiteDeLeitura(args.opcoes.janela);
    const tagsBrutas = texto(args.opcoes.tags);
    if (!tagsBrutas) {
      console.error(mm.tagsUso);
      return 2;
    }
    let tags: Record<string, string[]>;
    try {
      tags = JSON.parse(tagsBrutas) as Record<string, string[]>;
    } catch (e) {
      console.error(mm.tagsInvalidas((e as Error).message));
      return 2;
    }
    const colecao = texto(args.opcoes.colecao) ?? texto(args.opcoes.collection);
    const limiteBruto = texto(args.opcoes.limite);
    const limite = threadId ? limiteDeLeitura(args.opcoes.limite) : limiteBruto ? Number(limiteBruto) : undefined;
    if (threadId) validarConsultaDelimitada({ collection: colecao,
      escopo: criarEscopoDeLeitura(carregado.manifesto, threadId), tags,
      limite: janela ?? LIMITE_CONSULTA_PADRAO });
    const memoria = abrirMemoria(carregado, threadId ? { leituraRestrita: { thread: threadId, limite: janela } } : {});
    const entradas = memoria.buscar({
      collection: colecao as ColecaoDoOrk | undefined,
      tags,
      limite,
    });
    if (threadId && memoria.regime === 'files') console.error(mm.files(`${memoria.estado.motivo}`));
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(entradas, null, 2));
      return 0;
    }
    console.log(mm.buscaTag(memoria.regime));
    console.log('');
    if (memoria.regime === 'files') {
      console.log(`  ${memoria.estado.detalhe}`);
      console.log(mm.correcao(memoria.estado.correcao));
      return 0;
    }
    for (const e of entradas) {
      console.log(`  [${e.collection}] ${e.id}  ${e.priority}${e.mandatory ? ' [MANDATORY]' : ''}`);
      console.log(`      ${e.content.split('\n')[0].slice(0, 100)}`);
    }
    console.log('');
    console.log(mm.entradas(entradas.length));
    return 0;
  }

  if (sub === 'index') {
    const modelo = texto(args.opcoes.modelo) ?? 'primario';
    if (!['primario', 'fallback', 'todos'].includes(modelo)) {
      console.error(mm.indexUso);
      return 2;
    }
    const memoria = abrirMemoria(carregado);
    if (!memoria.ativo) {
      const falha = { motivo: memoria.estado.motivo, detalhe: memoria.estado.detalhe, correcao: memoria.estado.correcao };
      if (args.opcoes.json === true) console.log(JSON.stringify(falha, null, 2));
      else console.error(mm.indexFalha(memoria.regime, `${memoria.estado.motivo}`, memoria.estado.correcao));
      return 1;
    }
    const config = configDeEmbedding(carregado.manifesto);
    const driver = configDoManifesto(carregado.manifesto);
    const embedder = new DriverCliOrkMind(driver);
    // RM-038: o universo da busca inteiro, numa leitura; sem ele, nada e embedado (nunca um pedaco).
    let universo: UniversoDaBusca;
    try { universo = universoDaBusca(memoria, memoria.estado.tenant); } catch (erro) {
      const motivo = codigoDaFalha(erro);
      const detalhe = mm.universoDetalhe;
      if (args.opcoes.json === true) console.log(JSON.stringify({ motivo, detalhe }, null, 2));
      else console.error(mm.universoFalhou(motivo, detalhe));
      return 1;
    }
    const alvos: AlvoDeEmbedding[] = modelo === 'todos' ? ['primario', 'fallback'] : [modelo as AlvoDeEmbedding];
    const resultados: ResultadoDoIndice[] = alvos.map(alvo => indexar({ raiz: carregado.raiz, tenant: memoria.estado.tenant,
      dsn: driver.dsn, config, alvo, universo, dryRun: args.opcoes['dry-run'] === true,
      chavePresente: !!config.api_key_env && chaveDeEmbeddingAceita((process.env[config.api_key_env] ?? '').trim(), driver.dsn),
      chaveRecusada: !!config.api_key_env && (process.env[config.api_key_env] ?? '').trim() !== '' &&
        !chaveDeEmbeddingAceita((process.env[config.api_key_env] ?? '').trim(), driver.dsn),
      embeddar: (p, o) => embedder.embeddar(p, o) }));
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(modelo === 'todos' ? { alvo: 'todos', resultados } : resultados[0], null, 2));
    } else {
      for (const r of resultados) console.log(textoDoIndice(r));
    }
    return resultados.some(r => !r.dryRun && r.motivo) ? 1 : 0;
  }

  console.error(mm.desconhecido(sub));
  return 2;
}

/** Aviso informativo: não consulta rede, não reserva e não bloqueia criação. */
export function avisoRoadmapSemAssociacao(nome: string, roadmap?: string): string | null {
  const item = /\bRM-\d{3}\b/i.exec(nome)?.[0].toUpperCase();
  if (!item || roadmap) return null;
  return msg().thread.roadmapNoNome(item);
}

/**
 * `ork memory search --texto` (I-38 D7): busca por significado, separada da busca por tag.
 * Nao combina com --tags nem com a leitura restrita por thread nesta versao (erro tipado).
 */
function buscaPorTexto(args: Args, carregado: ManifestoCarregado): number {
  const mm = msg().operacao.restante.memory.cli;
  const frase = texto(args.opcoes.texto);
  if (args.opcoes.tags !== undefined || args.opcoes.thread !== undefined || args.opcoes.restrito !== undefined ||
      args.opcoes.janela !== undefined) {
    console.error(mm.textoExclusivo);
    return 2;
  }
  const modo = (texto(args.opcoes.modo) ?? 'hibrido') as ModoDeBusca;
  const colecao = texto(args.opcoes.colecao) ?? texto(args.opcoes.collection);
  const limiteBruto = texto(args.opcoes.limite);
  const limite = limiteBruto === undefined ? LIMITE_PADRAO_DA_BUSCA : Number(limiteBruto);
  if (!textoDeBuscaValido(frase) || !MODOS_DE_BUSCA.includes(modo) ||
      (colecao !== undefined && !COLECOES_DO_ORK.includes(colecao as ColecaoDoOrk)) ||
      !Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO_DA_BUSCA) {
    console.error(mm.textoUso(MODOS_DE_BUSCA.join('|'), COLECOES_DO_ORK.join('|'), LIMITE_MAXIMO_DA_BUSCA));
    return 2;
  }
  const memoria = abrirMemoria(carregado);
  const config = configDeEmbedding(carregado.manifesto);
  let r: ResultadoDaBuscaSemantica;
  const vazio = { texto: frase, modo, origem: 'nenhum' as const, modeloUsado: null, deterministico: false as const,
    resultados: [], listas: { vetor: [], fts: [] }, ftsForaDoUniverso: 0, coberturaDoIndice: null };
  let universo: UniversoDaBusca | null = null;
  let falhaDoUniverso = '';
  if (memoria.ativo) {
    try { universo = universoDaBusca(memoria, memoria.estado.tenant); } catch (erro) { falhaDoUniverso = codigoDaFalha(erro); }
  }
  if (!memoria.ativo) {
    r = { ...vazio, motivo: memoria.estado.motivo, detalhe: `${memoria.estado.detalhe}; correcao: ${memoria.estado.correcao}` };
  } else if (!universo) {
    // RM-038: sem o universo inteiro nao ha busca; o motivo tipado sai, nunca um resultado parcial.
    r = { ...vazio, motivo: falhaDoUniverso, detalhe: mm.buscaUniversoDetalhe };
  } else {
    const driver = configDoManifesto(carregado.manifesto);
    const transporte = new DriverCliOrkMind(driver);
    const fallback = memoria.estado.embeddings?.fallback;
    r = buscarPorSignificado({ raiz: carregado.raiz, tenant: memoria.estado.tenant, dsn: driver.dsn, config,
      universo, colecao: colecao as ColecaoDoOrk | undefined,
      texto: frase, modo, limite, timeoutMs: driver.timeoutMs,
      chavePresente: memoria.estado.embeddings?.chavePresente === true,
      fallbackUsavel: memoria.estado.embeddings?.sondado === true && fallback?.dependencias === true,
      embeddar: (p, o) => transporte.embeddar(p, o), buscarTexto: (t, q) => transporte.buscarTexto(t, q) });
  }
  const codigo = universo ? 0 : 1;
  if (args.opcoes.json === true) {
    console.log(JSON.stringify(r, null, 2));
    return codigo;
  }
  console.log(textoDaBuscaPorSignificado(r));
  return codigo;
}

/**
 * RM-052: `--projeto <nome|caminho>` e opcao GLOBAL. Sai do argv em qualquer posicao, antes de
 * qualquer despacho (inclusive do `maestro`, que tem parse proprio), e so aparece uma vez.
 */
export function extrairOpcaoDeProjeto(argv: readonly string[]): { argv: string[]; projeto: string | undefined } {
  const resto: string[] = [];
  let projeto: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== '--projeto' && !a.startsWith('--projeto=')) { resto.push(a); continue; }
    if (projeto !== undefined) throw new Error('uso: --projeto <nome|caminho> aparece uma vez só');
    if (a !== '--projeto') { projeto = a.slice('--projeto='.length); continue; }
    const valor = argv[i + 1];
    projeto = valor !== undefined && !valor.startsWith('--') ? valor : '';
    if (projeto) i++;
  }
  return { argv: resto, projeto };
}

/** Comandos que nao leem projeto: o alvo nao e resolvido (nem recusado) para eles. */
// RM-062 (F1): `privado varrer` le o repositorio do diretorio atual (o checkout do CI, o clone de um site), nao o alvo.
const COMANDOS_SEM_PROJETO = new Set(['demo', 'ciclos', 'mcp', 'init', 'projetos', 'privado']);

/**
 * Fatia 2 (D3): os comandos que leem projeto e nao terminam com a linha `Projeto consultado`. Hoje so
 * o `sessions event`, o sensor dos hooks do Claude Code: maquina falando com maquina, e o sensor compara
 * o stderr da recusa. O `maestro` declara no snapshot e nao passa por aqui.
 */
const SEM_DECLARACAO_DO_PROJETO: ReadonlySet<string> = new Set(['sessions event']);

/**
 * Comandos cujo `--projeto` e DELES (RM-054: `ork network roadmap --projeto github:dono/repo`, que
 * le varios projetos). A opcao volta intacta ao argv do subcomando e o alvo global nao e resolvido:
 * nem `--projeto`, nem `ORK_PROJETO`, nem o modo host escolhem um projeto por eles.
 */
export const COMANDOS_COM_PROJETO_PROPRIO: ReadonlySet<string> = new Set(['network']);

/**
 * Resolve e fixa o projeto-alvo do processo (D2, D3). `null`: vale o cwd de sempre. Fatia 2 (D3): com
 * `declarar`, o comando termina dizendo qual projeto leu, quando o leitor nao tem como saber.
 */
function fixarAlvoDoProcesso(projeto: string | undefined, declarar = true): ProjetoAlvo | null {
  const alvo = resolverProjetoAlvo({ opcao: projeto ?? null });
  fixarProjetoAlvo(alvo);
  if (declarar) pedirDeclaracaoDoProjeto(alvo);
  return alvo;
}

/**
 * RM-052 (fatia 2, D3): o comando que leu um projeto que o leitor nao tem como adivinhar (no host, ou
 * fora do diretorio dele) escreve no fim a linha `Projeto consultado: ...` no stderr, salvo se ja montou
 * o proprio cabecalho. Quando ele falha, a linha sai antes da mensagem de erro, que a entrada imprime.
 */
export function main(argvBruto: string[]): number {
  // I-35: todo horário para pessoa sai no fuso do dono deste projeto (lido só se for preciso, e já
  // depois de o projeto-alvo abaixo estar fixado: a fonte é preguiçosa).
  registrarFonteDoFuso(() => fusoDoManifesto(carregarManifesto()));
  // RM-052: sem alvo herdado de uma chamada anterior no mesmo processo (os testes chamam `main` em serie).
  fixarProjetoAlvo(null);
  // Prova de conceito do CLI por locale: cada chamada comeca em pt-BR; so os comandos cobertos trocam.
  ativarLocale(undefined);
  // RM-061 (F2b, D1): e sem o registro dos textos remontaveis, que so os comandos cobertos ligam.
  ligarRemontagem(false);
  iniciarDeclaracaoDoProjeto();
  try { return executarComando(argvBruto); }
  finally {
    // RM-061 (F2b): o registro dos textos remontaveis nao sobrevive a chamada (o locale sim: a entrada do CLI
    // ainda imprime o erro no locale do comando).
    ligarRemontagem(false);
    const linha = declaracaoQueFaltou();
    if (linha) console.error(linha);
  }
}

function executarComando(argvBruto: string[]): number {
  const extraida = extrairOpcaoDeProjeto(argvBruto);
  const proprio = COMANDOS_COM_PROJETO_PROPRIO.has(parseArgs(extraida.argv).posicionais[0] ?? '');
  const argv = proprio && extraida.projeto !== undefined
    ? [...extraida.argv, ...(extraida.projeto ? ['--projeto', extraida.projeto] : ['--projeto'])] : extraida.argv;
  const projeto = proprio ? undefined : extraida.projeto;
  // Helper fixo do host confiável: o projeto vem da instalação, nunca de toolargs.
  if (argv[0] === 'receipt-verifiers') {
    if (argv.length !== 2 || argv[1] !== '--json' || projeto !== undefined) {
      ativarLocale(localeDaAjuda());
      throw new ErroDoCatalogo((m) => m.cli.receiptVerifiersUso);
    }
    const root = process.env.ORK_HITL_ROOT;
    const privateKey = Object.keys(process.env).some(name => /^ORK_HITL_(?:INGRESS_KEY|NATIVE_KEY)/.test(name));
    if (root !== undefined || privateKey) {
      if (!root || !isAbsolute(root) || fs.realpathSync(root) !== root) throw Error('hitl.receipt.project-unavailable');
      const carregado = exigirManifesto(root);
      if (carregado.raiz !== root) throw Error('hitl.receipt.project-unavailable');
      for (const id of listarIds(root)) prepararRecibosParaDespacho(root, id);
    }
    console.log(publicHitlVerifiers() ?? 'null');
    return 0;
  }
  if (argv[0] === 'maestro') {
    const textos = msg(localeDaAjuda(projeto)).maestro;
    if (argv.length === 2 && argv[1] === '--help') return runMaestroCli(argv.slice(1), process.cwd(), {}, undefined, textos);
    // RM-052: o alvo explicito vira SELECAO entre as raizes permitidas; sem ele, o cwd de sempre. O
    // snapshot ja declara o projeto consultado (project.root, notConsulted): sem a linha da fatia 2.
    const alvo = fixarAlvoDoProcesso(projeto, false);
    return alvo ? runMaestroCli(argv.slice(1), alvo.raiz, { allowedRoots: [alvo.raiz], selected: alvo.raiz }, undefined, textos)
      : runMaestroCli(argv.slice(1), process.cwd(), {}, undefined, textos);
  }
  const args = parseArgs(argv);
  const comando = args.posicionais[0];

  // `ork --version` tambem chega sem comando: a versao e conferida antes da ajuda.
  if (args.opcoes.version === true || comando === 'version') {
    console.log(VERSAO);
    return 0;
  }
  if (!comando || args.opcoes.help === true || comando === 'help') {
    ativarLocale(localeDaAjuda(projeto));
    console.log(msg().ajuda.texto(dadosDaAjuda()));
    return 0;
  }
  // F3e (D2): a recusa do projeto-alvo e os usos das rotas cobertas acontecem antes do manifesto efetivo.
  // Resolva a lingua aqui; `--json` continua fora e um `mcp serve` valido desliga o locale antes de servir.
  if (cobreLocale(args.posicionais, args.opcoes)) {
    ativarLocale(localeDaAjuda(projeto));
    ligarRemontagem(true);
  }
  if (!COMANDOS_SEM_PROJETO.has(comando) && !proprio) {
    fixarAlvoDoProcesso(projeto, !SEM_DECLARACAO_DO_PROJETO.has(`${comando} ${args.posicionais[1] ?? ''}`.trim()));
  } else if (projeto !== undefined && comando !== 'projetos') {
    const mp = msg().projetos;
    throw new Error(comando === 'init'
      ? mp.initNaoLeProjeto
      : comando === 'mcp' ? mp.mcpNaoLeProjeto
        : mp.comandoNaoLeProjeto(comando));
  }

  const nomesHerdados = nomesDeProviderAtivos();
  const ambienteManifesto = carregarManifesto();
  if (ambienteManifesto?.manifesto.runtime.provider_policy === 'subscription-only') {
    // Avaliar ANTES de limpar: um redirecionamento bloqueante não pode desaparecer.
    const violacoes = avaliarPolicies(ambienteManifesto.manifesto, { gate: 'phase.dispatch' });
    // O gate oficial precisa observar e registrar a violação (inclusive warn).
    // Diagnósticos continuam acessíveis; os adapters sanitizam seus filhos sempre.
    if (violacoes.length === 0) for (const nome of ENVS_DE_PROVIDER_PAGO) delete process.env[nome];
  }

  // CLI por locale (RM-061, EN1 e EN7): a escolha do onboarding (owner.language) ou o LC_ALL/LC_MESSAGES/LANG
  // decidem a lingua do TEXTO dos comandos cobertos (`cobreLocale`); `--json` e contrato, e os recortes ainda
  // fora do catalogo (`doctor --modo` e os subcomandos fora da lista) ficam em pt-BR.
  switch (comando) {
    case 'mcp': {
      const projeto=texto(args.opcoes.project), host=texto(args.opcoes.host),threadId=texto(args.opcoes.thread);
      // I-36 (D4): a identidade do despacho so chega com a thread vinculada da sessao filha.
      const dispatchId=texto(args.opcoes.dispatch);
      const transporteDado=texto(args.opcoes['ship-transport']);
      const transporteShip=transporteDado??'github-ssh';
      const impressaoSsh=texto(args.opcoes['ssh-fingerprint']);
      const permissoesFilho=texto(args.opcoes['child-permissions'])??'interactive';
      const permissoesDono=texto(args.opcoes['owner-permissions']);
      const acao=args.posicionais[1];
      // RM-067 (F4b): o grok e host do install e do serve; o servidor dele recusa sem --thread (so a sessao filha).
      if(args.posicionais.length!==2 || !['serve','install'].includes(acao) || !projeto ||
          (host!=='codex' && host!=='claude-code' && host!=='grok') ||
          Object.keys(args.opcoes).some(k=>!['project','host','ship-transport','child-permissions',...(acao==='install'?['dry-run','owner-permissions','ssh-fingerprint']:['thread','dispatch'])].includes(k)) ||
          (args.opcoes.dispatch!==undefined && (!threadId || !dispatchId || !/^[a-f0-9-]{36}$/.test(dispatchId))) ||
          argv.filter(a=>a==='--ship-transport' || a.startsWith('--ship-transport=')).length>1 ||
          argv.filter(a=>a==='--child-permissions' || a.startsWith('--child-permissions=')).length>1 ||
          argv.filter(a=>a==='--ssh-fingerprint' || a.startsWith('--ssh-fingerprint=')).length>1 ||
          (args.opcoes['ssh-fingerprint']!==undefined && (transporteShip!=='forja-ssh' || typeof args.opcoes['ssh-fingerprint']!=='string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(impressaoSsh??''))) ||
          (args.opcoes['owner-permissions']!==undefined && (host!=='codex' || typeof args.opcoes['owner-permissions']!=='string' || !['interactive','orchestrate'].includes(permissoesDono??''))) ||
          argv.filter(a=>a==='--owner-permissions' || a.startsWith('--owner-permissions=')).length>1 ||
          !['interactive','worktree'].includes(permissoesFilho) ||
          (args.opcoes['child-permissions']!==undefined && typeof args.opcoes['child-permissions']!=='string') ||
          !ehTransporteShipMcp(transporteShip) ||
          (args.opcoes['ship-transport']!==undefined && typeof args.opcoes['ship-transport']!=='string') ||
          (args.opcoes.thread!==undefined && (!threadId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(threadId))) ||
          (args.opcoes['dry-run']!==undefined && args.opcoes['dry-run']!==true))
        throw new Error(msg().operacao.restante.mcp.uso);
      if(acao==='install') {
        void import('./mcp-install').then(({instalarMcp,textoInstalacaoMcp})=>
          console.log(textoInstalacaoMcp(instalarMcp({projeto,host,dryRun:args.opcoes['dry-run']===true,
            transporteShip:transporteDado===undefined?undefined:transporteShip as TransporteShipMcp,impressaoSsh,
            permissoesFilho:permissoesFilho as 'interactive'|'worktree',permissoesDono:permissoesDono as 'interactive'|'orchestrate'|undefined}))))
          .catch(e=>{console.error(msg().operacao.restante.mcp.erro((e as Error).message));process.exitCode=1;});
        return 0;
      }
      // O servidor e contrato com hosts e nao ganha uma moldura inglesa por herdar o locale do erro de uso.
      ativarLocale(undefined);
      ligarRemontagem(false);
      void import('./mcp-server').then(({servirMcp})=>servirMcp({projeto,host,threadId,dispatchId,nomesProviderHerdados:nomesHerdados,transporteShip:transporteShip as TransporteShipMcp,permissoesFilho:permissoesFilho as 'interactive'|'worktree'})).catch(e=>{console.error(`mcp: ${(e as Error).message}`);process.exitCode=1;});
      return 0;
    }
    case 'doctor': {
      if(args.opcoes.modo!==undefined) {
        const bruto=texto(args.opcoes.modo);
        if(args.posicionais.length!==1 || !bruto ||
            Object.keys(args.opcoes).some(k=>k!=='modo') || argv.filter(a=>a==='--modo' || a.startsWith('--modo=')).length!==1)
          throw Error(msg().doctor.modoUso(ORDEM_DOS_MODOS.join('|')));
        const r=preflight(diretorioDoProjeto(),exigirModoVivo(bruto),nomesHerdados);console.log(textoPreflight(r));return r.prontoPrimeiroBloco?0:1;
      }
      // RM-031: o check dos analisadores do grafo entra por aqui, a porta da familia do grafo (fronteira do KG1).
      // RM-061 (F2a): a redacao do check vem do catalogo, no locale do comando (a familia do grafo nao o importa).
      const analisadores = () => checarAnalisadoresDoGrafo(VERSAO_DO_ORK, undefined, undefined, msg().doctor.grafo);
      // `--forja=false` ou `--forja <valor>` nao vira `nao-medida` calado: a flag e booleana.
      if (args.opcoes.forja !== undefined && args.opcoes.forja !== true) {
        console.error(msg().forja.doctor.flagComValor);
        return 2;
      }
      // RM-063 (fatia 3, H1): `--json` e o contrato `ork.doctor/v1` que a batida do host le, com a idade da batida.
      if (args.opcoes.json === true) {
        // A batida dos hosts le o --json com frequencia: a secao forja (rede e CLI) so com --forja.
        const j = doctorJson(diretorioDoProjeto(), nomesHerdados, analisadores, undefined, args.opcoes.forja === true ? checarForja : undefined);
        console.log(JSON.stringify(j.json, null, 2));
        return j.codigo;
      }
      const r = doctor(diretorioDoProjeto(), nomesHerdados, analisadores, checarForja);
      console.log(r.texto);
      return r.codigo;
    }
    case 'init': {
      exigirRepositorioParaInit(process.cwd());
      // RM-061 (F3a, D1 e D2): os arquivos nascem na lingua do dono no momento da geracao, resolvida pelo manifesto lido
      // antes do `--force` regrava-lo (o YAML e o AGENTS.md saem na mesma lingua) e independente do texto impresso, que
      // nao segue o locale com `--json` (GO-FIX do CHECK, W3).
      const localeDosArquivos = resolverLocale(ambienteManifesto?.manifesto.owner?.language).locale;
      const r = init(process.cwd(), {
        force: args.opcoes.force === true,
        nome: texto(args.opcoes.name) ?? texto(args.opcoes.nome),
        abbrev: texto(args.opcoes.abbrev),
        locale: localeDosArquivos,
      });
      const carregado = exigirManifesto(r.deteccao.raiz);
      const agents = atualizarAgentsMd(r.deteccao.raiz, carregado.manifesto, localeDosArquivos);
      // RM-052 (D7): o projeto entra no registro desta maquina; falha vira aviso, nunca derruba o init.
      const avisoDoRegistro = registrarProjetoEmSilencio(r.deteccao.raiz, 'init');
      if (avisoDoRegistro) console.error(avisoDoRegistro);
      const m = msg().init, estadoAgents = m.estadosAgents[agents.estado] ?? agents.estado;
      if (!r.criado) {
        console.log(m.jaExiste(r.caminho));
        console.log(m.nadaSobrescrito);
        console.log(m.agentsMd(estadoAgents, agents.caminho));
        return 0;
      }
      console.log(m.criado(r.caminho));
      console.log(m.projeto(r.deteccao.nome, r.deteccao.abbrev));
      console.log(m.branchBase(r.deteccao.baseBranch));
      console.log(m.gerenciador(r.deteccao.gerenciador));
      console.log(m.verify(Object.entries(r.deteccao.verify).map(([k, v]) => `${k}="${v}"`).join(', ') || m.semScript));
      console.log(m.agentsMdLinha(estadoAgents, agents.caminho));
      // Fatia 2 do ensaio da 0.5.0 (P3): o estado fica fora do git por um `.gitignore` proprio.
      if (r.estadoIgnorado) console.log(m.estado(DIR_ESTADO));
      console.log('');
      console.log(m.proximoPasso);
      return 0;
    }
    case 'modos': {
      // I-43 (T4): `ork modos migrar` tira modo aposentado da CONFIGURACAO do projeto
      // (`orkastery.yaml` e `setup.json`) e nao toca em historico nenhum. Idempotente:
      // rodar de novo num projeto ja migrado nao escreve nada.
      if (args.posicionais[1] === 'migrar') {
        const carregado = exigirManifesto();
        const r = migrarModosAposentados(carregado.raiz, {
          dryRun: args.opcoes['dry-run'] === true,
          por: texto(args.opcoes.por),
        });
        console.log(args.opcoes.json === true ? JSON.stringify(r, null, 2) : textoDaMigracaoModos(r));
        return 0;
      }
      // `--do-pedido` existe para os adaptadores de host: eles extraem a #TAG do texto do
      // builder SEM reimplementar o parse, e repassam `--mode` ao `ork`. A validacao contra
      // `conduction.allowed_modes` continua sendo do nucleo, no `ork thread new`.
      const pedido = texto(args.opcoes['do-pedido']);
      if (pedido !== undefined) {
        const carregado = carregarManifesto();
        // I-43: `#Look` no pedido nao pode cair no default em silencio. O adaptador
        // recebe a recusa tipada e saida != 0, e quem escreveu a #TAG fica sabendo.
        // RM-058 N6 (D1): `#Noctum` é o modo do arco e só vale com envelope vigente; sem ele, recusa tipada, nunca o padrão.
        if (tagNoctumNoPedido(pedido)) {
          let arcos: ReturnType<typeof aceitarModoNoctum>;
          try { arcos = aceitarModoNoctum(carregado?.raiz ?? null); }
          catch (e) { if (e instanceof RecusaDoArco) { console.error(e.message); return 2; } throw e; }
          console.log(args.opcoes.json === true ? JSON.stringify({ modo: 'noctum', tag: '#Noctum', daTag: true, origem: 'tag no pedido',
            arcos, modoDasThreads: 'auto' }) : 'noctum');
          return 0;
        }
        const aposentado = extrairTagAposentadaDoPedido(pedido);
        if (aposentado) { console.error(recusaDeModoAposentado(aposentado)); return 2; }
        const extraido = extrairTagDoPedido(pedido);
        const modo = extraido ?? carregado?.manifesto.conduction.default_mode ?? 'classic';
        if (args.opcoes.json === true) {
          console.log(
            JSON.stringify({
              modo,
              tag: MODOS[modo].tag,
              daTag: extraido !== null,
              origem: extraido !== null ? 'tag no pedido' : 'conduction.default_mode',
              pausas: pausasDoModo(modo),
            })
          );
        } else {
          console.log(modo);
        }
        return 0;
      }
      console.log(tabelaDeModos());
      return 0;
    }
    case 'setup':
      return comandoSetup(args);
    case 'accounts':
      return comandoAccounts(args);
    case 'onboarding':
      return comandoOnboarding(args);
    case 'experiencia': {
      if (args.posicionais[1] === 'uninstall') {
        const host = parseHost(args.posicionais[2]);
        if (!host || !['claude-code', 'codex'].includes(host) || args.posicionais.length !== 3 ||
            Object.keys(args.opcoes).some(k => !['dry-run', 'json'].includes(k)) ||
            Object.values(args.opcoes).some(v => v !== true)) throw Error(msg().onboarding.experienciaUninstallUso);
        const r = desinstalarExperiencia(exigirManifesto().raiz, host as 'claude-code' | 'codex', args.opcoes['dry-run'] === true);
        console.log(args.opcoes.json ? JSON.stringify(r, null, 2) : msg().onboarding.experienciaUninstall(r.dryRun, r.arquivos.length));
        return 0;
      }
      if ((args.posicionais[1] ?? 'show') !== 'show' || args.posicionais.length > 2 ||
          Object.keys(args.opcoes).some(k => k !== 'json') || ('json' in args.opcoes && args.opcoes.json !== true)) {
        throw Error(msg().onboarding.experienciaUso);
      }
      const manifesto = exigirManifesto(), p = resolverExperiencia(manifesto.manifesto.owner);
      // Preferência inválida vale o padrão e faz o adapter install pular o pacote: a consulta avisa.
      const avisos = manifesto.avisos.filter(a => a.startsWith('experiencia.config.invalid'));
      const m = msg().onboarding;
      console.log(args.opcoes.json ? JSON.stringify({ ...p, avisos }, null, 2) :
        `${m.experiencia(p.experience, p.language, p.timezone, p.depth)}\nSkill: ${p.skill}\n` +
        // Fatia 2 do ensaio da 0.5.0 (R2): as origens em texto, e nao o JSON cru.
        m.experienciaOrigens(Object.entries(p.origem).map(([chave, origem]) => `${chave} ${m.origemDaPreferencia(origem)}`).join(', ')) +
        avisos.map(a => `\n${m.experienciaAviso(m.avisoDaPreferencia(a))}`).join(''));
      return 0;
    }
    case 'thread':
      return comandoThread(args);
    case 'objective':
      return comandoObjective(args);
    case 'creation':
      return comandoCreation(args);
    case 'portfolio':
      return comandoPortfolio(args);
    case 'phase':
      return comandoPhase(args);
    case 'ledger':
      return comandoLedger(args);
    case 'sessions':
      return comandoSessions(args);
    case 'noctum':
      // RM-058 N6: a porta do CLI para o arco #Noctum (propor, responder, status, tique e relatorio).
      return comandoNoctum(args);
    case 'pulse': {
      if (args.posicionais[1] === 'responder') {
        // I-41 (GO-FIX 1, B1 e B2): o caminho de volta do resumo. So o ingresso autenticado chama;
        // argv traz identificadores e o envelope assinado vem por stdin, como no `gate answer`.
        if (args.opcoes['resposta-stdin'] !== true || args.opcoes.resposta !== undefined || args.posicionais.length !== 2) {
          throw new Error(msg().operacao.pulseCadencia.responderUso);
        }
        const carregado = exigirManifesto();
        const envelope = lerRespostaStdin({ por: texto(args.opcoes.por), mensagem: texto(args.opcoes.mensagem),
          origem: texto(args.opcoes.origem), canal: texto(args.opcoes.canal), conta: texto(args.opcoes.conta) });
        const formato = texto(args.opcoes.formato);
        if (formato !== undefined && formato !== 'telegram' && formato !== 'terminal') throw new Error(msg().operacao.pulseCadencia.responderFormato);
        // RM-057 (resposta curta, D3; GO-FIX 1, achado 2): a mensagem respondida (reply), `<código>:<id>`, que o gateway
        // assinou no endereço do pulse; o núcleo só a aceita quando o id é o da mensagem em que a pergunta foi entregue.
        // GO-FIX 2 (R1): `outra` é a palavra solta em reply a outra mensagem, que o núcleo recusa dizendo por quê.
        const referencia = args.opcoes['em-resposta-a'];
        if (referencia !== undefined && !referenciaDoReplyValida(referencia)) {
          throw new Error(msg().operacao.pulseCadencia.responderReferencia);
        }
        console.log(JSON.stringify(responderPeloPulse(carregado.raiz, envelope, { canal: formato ?? 'telegram',
          ...(typeof referencia === 'string' ? { referencia } : {}) })));
        return 0;
      }
      if (args.posicionais[1] === 'cadencia') return comandoCadenciaDoPulse(args);
      // RM-061 (F2b, G2): o pulse grava (sensores, condução) e monta o --json em pt-BR; so o texto segue o locale.
      const carregadoDoPulse = exigirManifesto();
      const p = comLocale('pt-BR', () => montarPulse(carregadoDoPulse, { registrar: args.opcoes.registrar === true,
        escopo: texto(args.opcoes.escopo)?.split(',').map(s => s.trim()),
        semRuntime: args.opcoes['sem-runtime'] === true,
        linhasLogs: texto(args.opcoes.linhas) === undefined ? undefined : Number(texto(args.opcoes.linhas)) }));
      console.log(args.opcoes.json === true ? JSON.stringify(p, null, 2) : textoDoPulse(p));
      return p.runtime.ok || args.opcoes['sem-runtime'] === true ? 0 : 1;
    }
    case 'claims':
      return comandoClaims(args);
    case 'decisao':
      return comandoDecisao(args);
    case 'verify':
      return comandoVerify(args);
    case 'ci':
      return comandoCi(args);
    case 'privado':
      return comandoPrivado(args);
    case 'gate':
      return comandoGate(args);
    case 'retry':
      return comandoRetry(args);
    case 'fix':
      return comandoFix(args);
    case 'handoff':
      return comandoHandoff(args);
    case 'recall':
      return comandoRecall(args);
    case 'brain': {
      const result = comLocale('pt-BR', () => runBrain(exigirManifesto(), args.posicionais[1] ?? 'status', args.opcoes, args.posicionais.slice(2)));
      console.log(JSON.stringify(result, null, 2));
      return ['ok','empty','unknown','withheld','applied','rolled-back'].includes(result.state) ? 0 : 1;
    }
    case 'conhecimento':
      return comandoConhecimento(args);
    case 'memory':
      return comandoMemory(args);
    case 'grafo': {
      // RM-031 KG3 (D7): o argv cru depois do comando; o parser do grafo e estrito.
      const carregado = exigirManifesto();
      return executarGrafo(argv.slice(argv.indexOf('grafo') + 1),
        { raiz: carregado.raiz, estado: raizDoEstado(carregado.raiz), repositorio: carregado.manifesto.project.name, versao: VERSAO_DO_ORK,
          contextoDaThread: (id) => lerEntradaDaThread(carregado.raiz, id),
          // RM-061 (F3d): a familia do grafo nao importa o catalogo (fronteira do KG3); a redacao vem daqui, no locale do comando.
          textos: msg().grafo,
          escrever: (texto) => console.log(texto) });
    }
    case 'security-scan': {
      // Relatorio por SHA no estado da arvore principal; o argv cru depois do comando (o parser e estrito).
      const carregado = exigirManifesto();
      return executarSecurityScan(argv.slice(argv.indexOf('security-scan') + 1),
        { raiz: carregado.raiz, estado: raizDoEstado(carregado.raiz), escrever: (texto) => console.log(texto),
          ...(carregado.manifesto.check?.mode ? { modoDoManifesto: carregado.manifesto.check.mode } : {}),
          ...(carregado.manifesto.check?.agile ? { agile: { osv_scanner: carregado.manifesto.check.agile.osv_scanner,
            oxlint: carregado.manifesto.check.agile.oxlint } } : {}) });
    }
    case 'ship':
      return comandoShip(args);
    case 'activation':
      try { return comLocale('pt-BR', () => comandoAtivacao(exigirManifesto(), args)); }
      catch (e) {
        if ((e as Error).message === 'uso: ork activation plan|status|enable|disable')
          throw new ErroDoCatalogo((m) => m.cli.activationUso);
        throw e;
      }
    case 'lease':
      return comandoLease(args);
    case 'conducao':
      return comandoConducao(args);
    case 'board':
      return comandoBoard(args);
    case 'orquestracao':
    case 'monitor':
      return comandoOrquestracao(args);
    case 'worktree':
      return comandoWorktree(args);
    case 'master':
      return comandoMaster(args);
    case 'eval':
      return comandoEval(args);
    case 'audit':
      return comandoAudit(args);
    case 'adapter':
      return comandoAdapter(args);
    case 'prompt':
      return comandoPrompt(args);
    case 'docs':
      return comandoDocs(args);
    case 'roadmap':
      return comandoRoadmap(args);
    case 'demo': {
      // I-56 (RM-046): a promessa em trinta segundos, offline, sem runtime e sem tocar o projeto.
      const r = executarDemo({ dir: texto(args.opcoes.dir), manter: args.opcoes.manter === true, escrever: (l) => console.log(l) });
      return r.ok ? 0 : 1;
    }
    case 'fabrica':
      return comandoFabrica(args);
    case 'projetos':
      return comandoProjetos(args, projeto);
    case 'network':
      return comandoNetwork(args);
    case 'licoes':
      return comandoLicoes(args);
    case 'ciclos':
      console.log(tabelaDeVariantes());
      return 0;
    default:
      ativarLocale(localeDaAjuda());
      console.error(msg().ajuda.comandoDesconhecido(comando));
      console.log(msg().ajuda.texto(dadosDaAjuda()));
      return 2;
  }
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    // I-36 (T12): a recusa de conducao e resposta, nao erro: o texto para o humano, ou o JSON.
    if (e instanceof ErroDeConducao) {
      console.log(process.argv.includes('--json') ? JSON.stringify(e.recusa, null, 2) : e.recusa.texto);
      process.exitCode = 3;
    } else if (e instanceof ErroDaFilaPesada) {
      // RM-058 N2 (D10): a fila pesada que nao deu a vez no prazo responde como a conducao: o texto ou o JSON, e 3.
      console.log(process.argv.includes('--json') ? JSON.stringify(e.recusa, null, 2) : e.recusa.texto);
      process.exitCode = 3;
    } else if (e instanceof ErroDeProjeto) {
      // RM-052 (D3): a recusa de projeto-alvo e a resposta (a escolha, os candidatos), nao um stack trace.
      console.log(process.argv.includes('--json') ? JSON.stringify(e.recusa, null, 2) : e.texto);
      process.exitCode = SAIDA_DE_PROJETO;
    } else {
      // RM-061 (F2a, D11): o prefixo segue o locale do comando coberto; a mensagem sai como veio, salvo o
      // erro do catalogo, remontado no locale do comando (D14).
      console.error(msg().cli.erro(mensagemDoErro(e)));
      process.exitCode = 1;
    }
  }
}
