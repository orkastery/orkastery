#!/usr/bin/env node
import { runBrain } from './company-brain-cli';
import { raizDoEstado } from './estado-thread';
import { executarGrafo } from './intelligence-graph-cli';
import { runMaestroCli } from './maestro-cli';
import { publicHitlVerifiers } from './hitl-public-receipt';
import { apresentarDecisao, ofertaDoPedido, prazoLocalDoPedido } from './hitl-presentation';
import { desdeDoPedido, entradaDoPedido, montarPedidoCurto, textoDoPedidoCurto } from './hitl-curto';
import { montarStatusDoRoadmap, textoDoStatusDoRoadmap } from './roadmap-status';
import { exigirNotaSemHost, pedirNota, textoDoPedidoDeNota } from './master-nota';
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
import { montarPulse, textoDoPulse } from './pulse';
import { codigosEmUso, interpretarRespostaDoPulse, responderPeloPulse } from './pulse-resposta';
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
import { parseVariante, tabelaDeVariantes, VARIANTES } from './ciclos';
import { adicionarClaim, anexarComando, retirarClaim, tabelaDeClaims } from './claims';
import { exigirCatalogo } from './catalogo';
import { doctor } from './doctor';
import { endurecerUmask, preflight, textoPreflight } from './preflight';
import { rodarEval, textoDoEval } from './evalrunner';
import { aprovarGateHumano } from './gates';
import { abrirPedidoGate, contextoDoPedidoNativo, lerRespostaStdin, responderGate } from './hitl-gates';
import { exportarHandoff, recall, textoDoHandoff } from './handoff';
import {
  HOSTS,
  instalarAdaptador,
  ORDEM_DOS_HOSTS,
  parseHost,
  tabelaDeHosts,
  textoDaInstalacao,
  textoDosPitfalls,
} from './hosts';
import { init } from './init';
import { createInitiative, createProduct, createProject, findEntity, listEntities, PortfolioKind, PortfolioStatus, readPortfolio } from './portfolio';
import { atualizarAgentsMd } from './agents-md';
import { adquirirRegiao, liberar, tabelaDeLeases } from './leases';
import { inventariarSessoes } from './sessoes-inventario';
import { coletarEstatisticas, registrarEstimativaPlano, textoDasEstatisticas } from './ledger-stats';
import { adotarSessao } from './sessoes-adopt';
import { textoDoInventario } from './sessoes';
import { ENVS_DE_PROVIDER_PAGO, nomesDeProviderAtivos } from './runtime-ambiente';
import { avaliarPolicies, linhasDeAviso } from './policies';
import {
  aceitarPendentesPorOmissao,
  aceitosPorOmissao,
  ORDEM_DAS_CLASSES,
  parseClasse,
  registrarMaster,
  tabelaDeClasses,
  tabelaDeEntregas,
  textoDoMaster,
} from './master';
import { carregarManifesto, configDeEmbedding, diretorioDoProjeto, exigirManifesto, ManifestoCarregado } from './manifest';
import { formatarDataHora, formatarDataHoraRotulada, fusoDoManifesto, legendaDoFuso, localizarTextoRotulado,
  registrarFonteDoFuso } from './horario';
import { gravarEtapa, lerOnboarding, resetarOnboarding, textoDaPauta } from './onboarding';
import { resolverExperiencia } from './experiencia';
import { desinstalarExperiencia } from './hosts';
import { PROXIMO_PASSO_INIT } from './init';
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
import { AlvoDeEmbedding, indexar, ResultadoDoIndice, universoDoTenant } from './indice-vetorial';
import { buscarPorSignificado, LIMITE_MAXIMO_DA_BUSCA, LIMITE_PADRAO_DA_BUSCA, ModoDeBusca, MODOS_DE_BUSCA, ResultadoDaBuscaSemantica } from './busca-semantica';
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
import { exigirModoVivo, extrairTagAposentadaDoPedido, extrairTagDoPedido, MODOS, ORDEM_DOS_MODOS,
  parseModo, pausasDoModo, recusaDeModoAposentado, tabelaDeModos } from './modos';
import { migrarModosAposentados, textoDaMigracaoModos } from './modos-migracao';
import { editarBloco, lerSetup, resetarSetup, textoDaEntrevista, textoDoSetup, versionarSetup } from './setup';
import {
  adicionarPerfil, COLUNAS_DE_PERFIS, desativarPerfil, lerPerfis, lerPerfisComContas, linhasDePerfis, marcarFalhaDePerfil, perfilDeDespacho, PerfilDeDespacho,
  perfisComHorario, prepararDiretorioDoPerfil, reativarPerfil, registrarConferenciaInconclusiva, VARIAVEL_DO_PERFIL,
} from './runtime-profiles';
import { ambienteDoPerfil as ambienteDoPerfilClaude, conferirAuth as conferirAuthClaude } from './adapters/claude-bg';
import { ambienteDoDespacho as ambienteDoDespachoCodex, conferirAuth as conferirAuthCodex } from './adapters/codex';
import {
  assumirConducao, canalDoProcesso, conducaoDaThread, ErroDeConducao, ESPERA_PADRAO_MS, esperarConducaoLivre, liberarSeOrfa,
  textoDoPedidoRepetido, textoDoStatusDaConducao,
} from './conducao';
import { descreverSlug, hashDoPrompt, montarPrompt, rodarFase, tabelaDoLedger, valoresDoPrompt } from './phase';
import {
  carregarTemplates,
  exigirTemplate,
  lintTemplate,
  ProblemaDeTemplate,
  renderizar,
  tabelaDeTemplates,
  templateDaFase,
  textoDoLint,
  threadDeExemplo,
} from './prompts';
import { comandoDeAttach, logsDaSessao, pararSessao } from './sessoes';
import { exec, tabela } from './util';
import { ship, textoDoShip } from './ship';
import { consultarCi, executarBundleCi, executarCi, executarCiDaBranch, prepararBundleCi } from './ci';
import { avisoDeThreadSemBase, canalDaSessao, dirThread, exigirFase, lerThread, listarIds, novaThread, resumoDaThread,
  tabelaDeThreads, threadsDaListagem } from './thread';
import { escopoPadraoDoSync, iniciarDocs, sincronizarDocs, textoDaSincronizacao, textoDaVerificacao, verificarDocs } from './docs';
import { listarReservas, pegarItem, reservarFeat, reservasOrfas, soltarItem, soltarReservasOrfas, textoDasReservas } from './roadmap-reservas';
import { lerFabrica, publicarMaquina, registrarPublicacao, removerMaquina, textoDaFabrica, textoDasOutrasMaquinas } from './fabrica-estado';
import { ErroDoPedidoDeProjeto, montarPanoramaDaRede, SAIDA_DO_PEDIDO, textoDoPanoramaDaRede } from './network-roadmap';
import { publicarEmSegundoPlano } from './fabrica-publicar';
import { fabricaCompartilhada, gravarConfigDaMaquina, lerConfigDaMaquina, nomeDaMaquina } from './maquina';
import { lerLedger } from './ledger';
import { gateDeTokens, textoDoGateDeTokens } from './tokens';
import { ClasseDeFalha, ColecaoDoOrk, Fase, FASES, FonteDeMedida, Modo, MotivoGate } from './types';
import { gravarBaseline, textoDoVerify, verificar } from './verify';
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
import {
  caminhoDoRegistro, consultaDoProjeto, CONTRATO_PROJETOS, ENV_PROJETO_EXPLICITO, ErroDeProjeto, esquecerProjeto, fixarProjetoAlvo,
  FORA_DA_CONSULTA,
  linhasDaConsulta, listarProjetos, ProjetoAlvo, raizParaExibir, registrarProjeto, registrarProjetoEmSilencio, remotoDoProjeto,
  resolverProjetoAlvo, SAIDA_DE_PROJETO, semRemoto,
} from './projeto-alvo';

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
 * I-36 (D2, D6): o que o CLI declara sobre a conducao. `--canal` (sem ele, o que a borda exporta),
 * `--correlacao` (conversa ou mensagem de origem) e `--esperar [minutos]` (sem valor, 30).
 */
function conducaoDoCli(args: Args): { canal: ReturnType<typeof canalDoProcesso>; correlacao: string | null; esperarMs: number | undefined } {
  if (args.opcoes.canal === true) throw new Error('uso: --canal <claude-code|hermes|openclaw|codex|mcp|cli>');
  const bruto = args.opcoes.esperar;
  let esperarMs: number | undefined;
  if (bruto === true) esperarMs = ESPERA_PADRAO_MS;
  else if (typeof bruto === 'string') {
    const minutos = Number(bruto);
    if (!Number.isFinite(minutos) || minutos <= 0 || minutos > 24 * 60) throw new Error('uso: --esperar [minutos], de 1 a 1440 (sem valor, 30)');
    esperarMs = Math.round(minutos * 60_000);
  }
  return { canal: canalDoProcesso(texto(args.opcoes.canal)), correlacao: texto(args.opcoes.correlacao) ?? null, esperarMs };
}

const AJUDA = `ork ${VERSAO}, nucleo de orquestracao do Orkastery

Uso: ork [--projeto <nome|caminho>] <comando> [argumentos]

  --projeto <nome|caminho>                  Projeto-alvo de qualquer comando (RM-052): vence ORK_PROJETO, que vence o
                                            diretorio atual; nome ambiguo ou desconhecido recusa com os candidatos (saida 4)
  projetos [--json]                         Projetos conhecidos desta maquina (~/.orkastery/projetos.json)
  projetos registrar [caminho]              Registra a copia (init, thread new e fabrica entrar ja registram)
  projetos esquecer <nome|caminho>          Tira do registro a copia que sumiu ou sobrou (nada no disco e apagado)

  doctor                                    O que vale nesta maquina agora (sai != 0 se bloqueado)
  init [--force] [--name N] [--abbrev A]    Gera o orkastery.yaml do repositorio
  modos                                     Tabela dos ${ORDEM_DOS_MODOS.length} modos de conducao vivos por #TAG

  setup                                     Pauta da entrevista #setup: runtime/modelo/esforco
  onboarding [show|set <etapa>|reset [etapa]] Pauta e respostas do projeto (9 etapas)
        [--conteudo JSON] [--por Q] [--json]  Valores secretos somente em ~/.hermes/.env
        [--reset [etapa]]                    Reset seletivo ou total, idempotente
  onboarding sync [--json]                  Publicação opcional na memória, com degradação
                                            por bloco de cada modo (default claude-bg/opus/high; #Fast: sonnet)
  experiencia show [--json]                 Preferências efetivas; configure por onboarding set maestro --conteudo '{"owner":{"experience":true}}'
  experiencia uninstall <host> [--dry-run] [--json]
                                            Remove o bloco de Claude Code/Codex; sem --dry-run aplica a remoção
  setup <modo>                              Config atual de cada bloco do modo
  setup <modo> --bloco N [--runtime R]      Edita o bloco (runtimes: claude-bg, codex);
        [--model M] [--effort E] [--por Q]       evento setup_configured no ledger do projeto
        [--fallback R:M[:E],...]                  ordem de fallback de runtime do bloco (I-33)
  accounts list [--json]                    Perfis de conta por runtime, sem segredo (I-33)
  accounts add <id> --runtime R --dir D     Cria o perfil e roda o login do proprio CLI com o env
        [--sem-login]                            do perfil (nunca copia credencial)
  accounts remove <id>                      Desativa o perfil (diretorio e login ficam onde estao)
  accounts check [<id>]                     Confere o login de cada perfil e marca o store
  setup [<modo>] --reset                    Volta o modo (ou tudo) ao default
  setup versionar                           Leva o setup que vale para orkastery.setup.json: por PR, vale em
                                            todas as maquinas e passa a ser o arquivo editado (I-52)

  thread new <nome> --modo <MODO>           Cria a thread, o slug de 3 partes e o ledger
        [--exige-runtime-diferente]              o CHECK precisa de runtime que o GO nao usou
        [--done "<criterio> :: <comando>"]       criterio de pronto EXECUTAVEL (use ;; para varios)
        [--slug S] [--assunto A] [--worktree auto|DIR] [--dry-run]
        [--roadmap RM-NNN]                       reserva o item do roadmap antes de criar (I-47)
  thread list [--todas] [--json]            Threads NAO fechadas do projeto (--todas inclui as fechadas)
  thread close <id> --motivo orfa|engano|superada --por Q --justificativa J
  thread entrega <id> --arquivo A --sha256 H --por Q
  thread status <thread-id> [--json]        Estado da thread, cruzado com o runtime

  portfolio inspect <id> --json              Entidade, origem e ciclos com lacunas explícitas
  creation start --input-file F --json       Criação durável com identidade do processo local
  creation show|list|events [id] --json       Consulta journal e recuperação
  creation resume|compensate <id> --expected-version N --json
  portfolio create <product|project|initiative> <id> --title T [--parent ID]
  portfolio list [product|project|initiative] [--parent ID] [--json]
  portfolio show <id> [--json]              Catálogo prod -> proj -> init
        [--constraints A;B] [--outcomes A;B] [--threads N]
        [--execution-runtime R] [--validation-runtimes R1,R2]
  objective ...                             Aposentado na I-43: as duas vigas viraram
                                            --exige-runtime-diferente e --done de thread

  phase run <thread-id> <FASE> --prompt "<texto>"
        [--runtime R] [--model M]           Despacha a fase como background agent
        [--effort E] [--dry-run]                 (runtime: CLI > setup do bloco > manifesto;
                                             so --model assume --effort high; o trio
                                             efetivo vai ao ledger como fato verificavel)
        [--canal C] [--correlacao ID]        Canal de origem (sem ele, o que o host declara)
        [--esperar [min]]                    Com a thread ja conduzida, espera a vez (sem: recusa na hora)
  phase list <thread-id>                    Historico do ledger da thread
                                            (mostra o modelo/esforco reais de cada fase)
  ledger stats --desde 7d [--ate ISO]       Telemetria economica do ledger (intervalo [desde,ate))
        [--thread T] [--modo M] [--runtime R] [--json]
  ledger estimate <thread-id> --sem-ia H --ia-sem-ork H --por Q --metodo M --premissas P
        [--incerteza I]                     Registra estimativas explicitas da fase PLAN

  sessions [--all] [--global] [--json]      Inventário Claude e Codex da conta atual
        [--exigir-limpo]                    Sai != 0 com fonte inválida ou sessão sem thread
  sessions adopt <id> [--json]             Adota identidade real sem executar prompt
  sessions event --tipo T --sessao ID       Ingere JSON limitado no stdin; observa sem aprovar gates
  sessions watch --thread T [--sessao ID]   Observa somente a sessão selecionada; --once faz uma varredura
  sessions logs <sessao> [--linhas N]       Logs de uma sessao
  sessions supersede <thread> <UUID> --fase F --runtime R  Confirma encerramento de sessão superada
  sessions request <thread> <UUID> --fase F --runtime R --pergunta P  Abre pedido vinculado ao prompt nativo
  sessions answer <thread> <pedido> --stdin --origem telegram --canal C --por ID --mensagem REF [--conta ID]  Confirma entrega autenticada
  sessions reconcile <thread> <pedido>      Fecha envio pendente so com thread e pedido; consulta recibo, nunca reenvia
  sessions stop <sessao>                    Para uma sessao
  sessions attach <sessao>                  Imprime o comando de attach (precisa de TTY)
  pulse [--json] [--registrar]             Fila unificada de atenção humana e retry de órfãs
  pulse responder --resposta-stdin --origem telegram --canal C --por ID --mensagem REF [--conta ID]
                                            Recebe o que o dono digitou no canal do resumo (P4EJ a, 1a 2c)
  pulse cadencia [<tag>] [--por P] [--json] Mostra ou troca a cadencia do resumo: OrkPulseOn, OrkPulseOn-15m,
                                            -30m, -60m ou OrkPulseOff; pergunta nova sai na hora (I-50)
  sessions hitl [--json] [--so-paradas]     Radar de sessoes que exigem acao humana AGORA:
        [--atencao N] [--sem-logs]              classifica o estado de cada sessao do runtime,
        [--so-da-raiz] [--exigir-limpo]         le a pergunta que a sessao trava e diz o que
                                                destrava (pega HITL de sessao SEM thread)

  claims add <thread-id> <arquivo> --claim "<alegacao>" [--verificar "<comando>"] [--fase F]
                                            Registra alegacao verificavel da thread
  claims list <thread-id>                   Claims da thread e o estado de cada uma
  decisao registrar <thread-id> --decidido D --porque P --como-mudar C --custo-agora A --custo-depois B
        --criterio manifesto:CHAVE|ledger:REF|medicao:COMANDO --quem Q --evidencia E [--razao R] [--reverte ID]
                                            Decisao tomada sem perguntar: chega ao dono no resumo
  decisao placar <thread-id> [--json]       Decididas contra perguntas por fase, reversoes e o limiar
  claims verificar <thread-id> <claim-id> --comando "<comando>"
                                            Anexa o comando que comprova uma claim ja feita
  claims retirar <thread-id> <claim-id> --motivo "<motivo>"
                                            Retira a alegacao (o historico fica no claims.jsonl)
  claims ausente <thread-id> --paths A,B --motivo "<motivo>" [--commit SHA]
                                            Ciclo sem CHECK: declara no ledger o que ficou sem prova
  verify <thread-id> [--baseline]           Reexecuta claims e verify do manifesto no HEAD real
        [--so-claims]                       --baseline grava o estado do mundo antes do GO
        [--canal C] [--esperar [min]]       So executa com a conducao da thread (sai 3 se outra conduz)
  ci prepare <thread-id>                    Exporta claims/comandos para a candidata (.ork-ci/<thread>.json)
  ci run [<thread-id>] [--bundle ARQ]       Executa o CHECK no runner independente
        [--branch B]                         acha o bundle da thread pelo nome da branch (o CI usa)
  ci status [--sha SHA] [--remoto origin]   Consulta o check exato publicado no GitHub

  gate next <thread-id> [--proximo FASE]    Gate de tokens: mesma sessao ou nova sessao
        [--ocupacao 0..1] [--fonte F] [--transcript ARQ] [--janela N] [--refazer]
  gate request <thread-id> [--motivo M]     Apresenta pedido HITL correlacionado à pausa
        [--formato telegram|terminal]           no contrato curto, com o codigo estavel para responder
  gate answer <thread-id> <pedido>          Recebe envelope do ingresso humano autenticado
        --resposta-stdin --por Q --mensagem ID --origem telegram [--canal hermes|openclaw]
        [--conta ID]  conta homologada do canal; obrigatoria no canal openclaw
  gate approve                             Aposentado: aprovação sem pedido é recusada

  retry policy [--motivo M] [--json]        Politica de retry por motivo tipado de gate
  retry plan <thread-id> [--motivo M]       O que o ork faria pelo ultimo gate reprovado
        [--fase F] [--json]                      (calcula, nao executa, nao gasta tentativa)
  retry run <thread-id> [--reverify]        Executa a acao tipada do ultimo gate reprovado
        [--por Q] [--dry-run]                    (--por autoriza quando o bloco do modo pausa)
  retry list [--json]                       Fila DURAVEL de rate limit do projeto
  retry resume [--id R1] [--agora ISO]      Retoma a fase morta por rate limit na janela seguinte
        [--ocupacao 0..1] [--forcar] [--dry-run] (playbooks: mesma-sessao, nova-sessao, escalada)
  retry cancel <id> --motivo M              Tira um pedido da fila, com motivo registrado
  retry parse --stderr "<texto>"            Le o horario de reset do stderr do adapter

  fix open <thread-id> [--so-claims]        GO-FIX: deriva a spec exata do CHECK reprovado
        [--reverify] [--json]                    (uma correcao por motivo tipado, tipo A ou B)
  fix list <thread-id> [--rodada N]         Correcoes da rodada e o veredito de cada uma
  fix reverify <thread-id> [--rodada N]     CHECK-REVERIFY com veredito POR correcao
        [--parcial] [--json]                     (--parcial e RECUSADO se houver tipo B)

  handoff export <thread-id>                Handoff triado CRITICO/IMPORTANTE/RESUMIVEL
        [--proxima-fase FASE] [--slug S]
  handoff recall <thread-id> <ponteiro>     Resolve um ponteiro path#ancora de volta ao conteudo

  recall <thread-id> --fase FASE            Recuperacao TARDIA: resolve so os ponteiros do
        [--id ptr-N] [--todos] [--forcar]        momento (retrieve_when), nunca a janela inteira
        [--sem-conteudo] [--json]                (orkmind por tag, files por path#ancora)

  brain status|inventory|get|query|receipts|context|dossie|sync|reconcile|apply|rollback|bind
  brain dossie --thread T [--decisao ID]    Dossie de decisao: vinculo, contexto citavel, alternativas,
                                            quem decidiu e evidencia, com os ids do Brain (so leitura)
  memory status [--json] [--sondar]         Regime efetivo (files|orkmind), tenant, degradacao e embeddings
                                            (--sondar: uma chamada real de embedding, com a latencia)
  memory sync [<thread-id>] [--json]        Publica decisoes, policies, handoff, licao e roadmap
  memory inventory --escopo <threads> [--json]                 Inventaria fontes canonicas e tenants excluidos, sem gravar
  memory migrate --operadora <thread> --escopo <threads> [--dry-run] [--json]                   Migra handoffs por G3, com pacote integral e readback
  memory search --tags '<json>' [--colecao C]  Busca deterministica por tag (mandatory sempre volta)
        [--thread ID] [--restrito] [--janela N] [--limite N] [--json]
  memory search --texto "<frase>"          Busca por significado (I-38): vetor + FTS por RRF no tenant,
        [--modo hibrido|vetor|fts]               NAO deterministica; nao combina com --tags nem --thread
        [--colecao C] [--limite N] [--json]
  memory index [--modelo primario|fallback|todos] Indice vetorial local do tenant (I-38), idempotente,
        [--dry-run] [--json]                     com tokens e custo estimados; --dry-run nao chama o provider

  grafo indexar [--verificar] [--forcar]    Indice do grafo de codigo do HEAD limpo (RM-031 KG3) no estado do projeto:
        [--json]                                 pastas 0700, chave por revisao e extrator, idempotente; --verificar
                                                 confere contrato, bytes e determinismo; precisa de typescript e micromark
  grafo status [--json]                     Indices guardados, o do HEAD, os analisadores e o tamanho
  grafo vizinhos <no> [--profundidade N]    Vizinhanca de arquivo ou simbolo, com extrator e evidencia de cada aresta
        [--sentido entrada|saida|ambos] [--tipo T,...] [--limite N] [--json]
  grafo chamadores <simbolo>                Quem chama (arestas calls que chegam) [--profundidade N] [--limite N] [--json]
  grafo importadores <arquivo|simbolo>      Quem importa (arestas imports que chegam) [--profundidade N] [--limite N] [--json]
  grafo caminho <de> <para>                 Menor caminho pelas arestas [--sentido saida|entrada|ambos] [--tipo T,...] [--json]
  grafo amostra [--por-estrato N]           Amostra de arestas para auditoria manual; --conferir ARQ confere a auditada
  grafo limpar [--tudo] [--json]            Apaga os indices que nao sao do HEAD e as sobras com mais de uma hora

  ship <thread-id> --para <branch>          Merge --no-ff serializado por lease e push PROVADO
  ship registrar-pr <thread-id>|--todas    A entrega feita por PR vira ship_done: merge ship(<thread>) na base
        [--remoto R] [--json]                    remota e CI verde no head do PR; depois, ork master --aceitar-omissao
        [--repo <dono/nome> --pr <n>]            PR mesclado em repositorio externo de ci.external_repositories
        [--de <branch>] [--remoto origin] [--autorizar-push <quem>] [--sem-push] [--dry-run]

  board [--all] [--sem-remoto]              Visao unica das threads (todos os perfis com --all); com a
                                            fabrica compartilhada, tambem as outras maquinas (I-51)
  board plan                                Escalonador: quem avanca agora, quem espera e por que

  orquestracao status [--all] [--json]      Monitor PROATIVO de pausas e impedimentos: quem esta
        [--atencao N] [--so-paradas]             parado, esperando o que, ha quanto tempo e o que
        [--sem-runtime] [--exigir-limpo]         destrava (alias curto: ork monitor)

  worktree ensure <thread-id>               Garante a worktree da thread (base resolvida pelo ork)
  worktree sync <thread-id> [--dry-run]     Rebasa a branch da thread quando a base avancou
  worktree audit <thread-id>                Confere a worktree no proprio git (sai != 0 se divergir)
  worktree release <thread-id> [--forcar]   Remove a worktree e limpa o registro

  activation plan|status|enable|disable     Escrita escopada com aceite, hash, leases e recibo
  lease list                                Leases, familias e as filas (merge e colisao de regiao)
  lease acquire <nome> --thread T --motivo M   Toma um lease tipado (entra na fila se colidir)
  lease release <nome> [--thread T] [--forcar]
  conducao status <thread-id> [--json]      Quem conduz a thread agora (canal, sessao, fase, desde)
  conducao assumir <thread-id> --por Q --motivo M
                                            Handoff: encerra a conducao atual pelo runtime e registra quem assumiu

  master propor <id> --score N --justificativa J --por <agente>
  master batch --aceitar <thread:assinatura,...> --por <humano>
  master migrar --dry-run --por Q           Inspeciona correções sem alterar originais
  master digest <enviar|preview|responder>  Digest semanal com recibos do host
  master <thread-id> --score 0-5 --justificativa "<texto>"
        [--classe C[,C]] [--resumo R] [--por Q] [--refazer]
                                            Fecha a thread: POSTMORTEM + MASTER log + score (so do terminal;
                                            de processo de host e recusado com master.prova-de-canal)
  master pedir <thread-id> [--formato telegram|terminal|json]
                                            Pede a nota ao dono com codigo curto; ele responde pelo Telegram
                                            (<codigo> <0 a 5> <porque>) e a nota vai ao ledger com o recibo (RM-048)
  master [--todas] [--json]                 As entregas, com o indice derivado do ledger
  master --aceitar-omissao [--json]         Aceita as entregues por omissao, com registro
  master classes                            As classes de falha fixas do POSTMORTEM
  licoes [--json]                           O que volta no GOAL e no PLAN da proxima thread (POSTMORTEM e
                                            MASTER) e as propostas de policy por recorrencia (I-55)

  demo [--manter] [--dir D]                 A promessa em 30 s: uma afirmacao falsa reprovada e a corrigida aceita,
                                            offline, num repositorio temporario (I-56)
  ciclos                                    Variantes de ciclo de "ork thread new --ciclo"
  modos --do-pedido "<texto>" [--json]      Le a #TAG do pedido do builder (usado pelos adaptadores)
  modos migrar [--dry-run] [--por Q]        Tira modo aposentado do orkastery.yaml e do setup.json
        [--json]                             (idempotente, com backup; nao toca em historico)

  prompt list                               Templates de prompt (embutidos e os do projeto)
  prompt lint [--template ID]               Reprova template quebrado antes de ele virar despacho
  prompt render <thread-id> --fase F        Mostra o prompt exato, com o sha256 que vai ao ledger
        [--pedido "<texto>"] [--template ID]
  prompt render --exemplo --fase F --modo M Renderiza sem thread nenhuma, para revisar o texto

  roadmap status [--json]                   Status report unico do roadmap: grupos com icones, #HITL no que espera
                                            voce e o fecho com o que precisa de voce e o que vem a seguir (RM-048)
  roadmap reservas [--json] [--remoto R]    Quem esta com cada item do roadmap, lido da branch ork/roadmap-reservas
        [--soltar-orfas]                     marca a reserva de thread ja fechada (orfa) e, com a opcao, solta
                                             ou passa para outra thread aberta do mesmo item, com registro
  roadmap pegar <RM-NNN> [--thread T]       Reserva o item para esta maquina (push atomico: o primeiro vence)
        [--nota N] [--por Q] [--maquina M]       maquina = --maquina, ORK_MAQUINA ou o hostname
        [--forcar --motivo M]                    tomar a reserva de outra maquina fica registrado
  roadmap soltar <RM-NNN> [--forcar --motivo M]  Devolve o item
  roadmap feat [--thread T] [--nota N]      Reserva o proximo numero de FEAT na mesma branch (push atomico: duas
                                            maquinas nunca levam o mesmo numero; numero reservado nao volta)
  fabrica [--json] [--sem-remoto]           O que cada maquina conduz, lido da branch ork/fabrica-estado (I-51)
  fabrica entrar [--maquina NOME]           Esta maquina entra na fabrica compartilhada deste usuario, com
                                            este nome (~/.orkastery/maquina.json), e publica o primeiro retrato
  fabrica publicar [--forcar] [--json]      Grava o retrato desta maquina na branch (push atomico, sem forca);
                                            depois de entrar, sai sozinho ao criar thread, despachar fase,
                                            entregar e fechar, e a cada batida do pulse
  fabrica sair                              Para de publicar daqui e tira o retrato desta maquina da branch
  network roadmap [--projeto P] [--json]    Roadmap, reservas e threads de cada maquina de cada projeto, de qualquer diretorio:
        [--sem-remoto]                           fonte e hora de cada parte, lacuna tipada no que nao leu. P = caminho do clone,
                                                 github:dono/repo, gitlab:grupo/repo ou nome conhecido; sem clone, le a forja (RM-054)
  docs verificar [--json]                   Documentacao de produto e roadmap contra o codigo e o git
                                            (padrao do dono: frontmatter, leitura, paridade; sai != 0 com erro)
  docs sincronizar [--escrever]             Fatos do ledger e do git para o roadmap (merge, fase) e indices;
                                            sem --escrever so mostra; nunca muda status por passagem de tempo
        [--so RM-NNN[,RM-MMM]] [--todos]     so esses itens (e os indices); na worktree de uma thread com item,
                                             o padrao e o item dela; --todos volta a todo item (RM-037)
  docs init                                 Cria padroes, modelos, indices e o lint de Markdown no projeto

  mcp serve --project RAIZ --host HOST       Servidor MCP stdio deste projeto (codex|claude-code)
  mcp install --project RAIZ --host HOST     Prepara MCP; aceita --dry-run, --ship-transport, --child-permissions e --owner-permissions (Codex)

  adapter list                              Adaptadores de host (Camada 1) e o destino de cada um
  adapter show <host>                       Os 3 pitfalls de instalacao do host
  adapter install <host> [--dir D]          Instala o adaptador (claude-code|codex|hermes|openclaw)
        [--dry-run] [--force]                    divergencia segura resolve sozinha; o resto pergunta
        [--aceitar-catalogo <arquivo>]           sobrescreve a copia com o catalogo, arquivo a arquivo
        [--manter-copia <arquivo>]               deixa a copia como esta, arquivo a arquivo

  eval [--skill S] [--canario C]            Canarios de comportamento + corpus das skills finas
        [--so-canarios] [--so-skills] [--json]   (sai != 0 em qualquer falha)

  audit packs [--estagio E] [--pack P]      Os 7 packs, o estagio que os ativa e a postura
  audit run <pack> [--profile P]            Monta o prompt do pack e despacha pelo runtime adapter
        [--since Nd] [--tudo] [--effort E] [--model M] [--agora "<quem>"] [--forcar] [--dry-run]
  audit list                                Rodadas de auditoria do projeto
  audit show <rodada> [--ledger]            Contexto, achados e propostas de uma rodada
  audit prompt <pack> [--since Nd]          O prompt exato do pack, com o sha256 que vai ao ledger
  audit lint                                Reprova template de auditoria quebrado (auditors/)
  audit ingest <rodada> --arquivo J         Registra em lote os achados que o auditor escreveu
  audit finding add <rodada> --regra R      Registra um achado com evidencia, claim e proposta
        --titulo T --arquivo caminho:linha --impacto I --fix F --estimativa E
        [--severidade critico|maior|menor] [--irreversivel "<passo>"] [--verificar "<comando>"]
  audit verify <rodada>                     Reexecuta as claims dos achados (auditor sem self-report)
  audit report <rodada> [--publicar]        Relatorio com o bloco OBRIGATORIO de propostas
  audit divida [--pack P] [--todos]         Board de divida: propostas abertas e recorrencia
  audit surface [<dir>] [--regra SPn]       Varredura DETERMINISTICA da superficie de ataque de rede
        [--limite N] [--json]                    (SP8..SP12; sai != 0 quando ha achado)
  audit surface --registrar <rodada>        Grava os achados da varredura no board da rodada
  audit finding estado <id> <estado>        Carimba o achado (aberto|adiado|resolvido|descartado)

  thread new <nome> --from-finding <ID>     Abre a thread a partir de um achado de auditoria
        [--modo M] [--worktree auto] [--dry-run]   (evidencia, claim e proposta viajam junto)

Regimes de memoria: files (fallback honesto) e orkmind (bloco B6, base propria por tenant
declarada em memory.database_url_env pelo NOME da variavel de ambiente, sem fallback).
Colecoes gravadas no OrkMind: decision, handoff, rule, learning, roadmap (source=agent,
nunca mandatory: regra critica so nasce de humano autenticado).

Retry tipado (bloco B3): reexecutar, corrigir-dirigido, sincronizar-worktree,
escalar-esforco, esperar-janela, escalar-humano, sem-retry. Violacao de custo
(cost.violation) NUNCA recebe retry automatico. O limite de escalacao do manifesto
(retry.max_tentativas) pausa QUALQUER modo, inclusive #Auto.

Monitor de orquestracao (ork orquestracao status / ork monitor): duas naturezas de parada.
pausa-humana e a parada PREVISTA pelo modo (o bloco fechou e espera veredito, com o
pausaSobre do bloco dizendo o que o humano decide); impedimento e a nao prevista
(lease.busy, runtime.rate-limited, concurrency.limite e os demais gates tipados). Tudo e
DERIVADO de thread.json, ledger.jsonl e das filas em disco: o monitor le, nunca grava.
--exigir-limpo sai != 0 enquanto houver thread parada, para virar watchdog do orquestrador.

Fases: GOAL PLAN GO CHECK SHIP MASTER. Modos: ${ORDEM_DOS_MODOS.map((m) => MODOS[m].tag).join(' ')}.
Familias de lease: main-tree, worktree-write:<thread>, path:<glob>, board:<card>, service:<porta>.
Ciclos: greenfield, merge-branch, goal-plan, gap, feature-xl-faseada.
Fontes de medida do gate de tokens: runtime_reported, estimated, informada, unavailable.
Hosts de Camada 1: claude-code, codex, hermes, openclaw. Canarios: fx-happy, fx-hallucination,
fx-stale-base, fx-wiki-destroy, fx-schema-drift, fx-concurrency.
Packs de auditoria: clean-code, reuse, architecture, data-model, ux, security-privacy, process.
Superficie de ataque de rede (SP8..SP12, varredura deterministica): rota sem auth, endpoint de
administracao exposto, rota sem rate limit, CORS permissivo, rota sem esquema de payload.
Estagios do produto: nascente, crescendo, maduro (hardening gradual, visao secao 5.2).
`;


function comandoThread(args: Args): number {
  if (args.posicionais[1] === 'close' || args.posicionais[1] === 'entrega') {
    const raiz = exigirManifesto().raiz, id = args.posicionais[2];
    if (!id) throw new Error('informe o id da thread');
    const por = texto(args.opcoes.por) ?? '';
    const r = args.posicionais[1] === 'close'
      ? fecharAdministrativamente(raiz, id, { motivo: texto(args.opcoes.motivo) ?? '', por, justificativa: texto(args.opcoes.justificativa) ?? '' })
      : registrarArtefato(raiz, id, texto(args.opcoes.arquivo) ?? '', texto(args.opcoes.sha256) ?? '', por);
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
      const brutoModoAchado = texto(args.opcoes.modo) ?? texto(args.opcoes.mode);
      let modoAchado: Modo | undefined;
      if (brutoModoAchado !== undefined) {
        try { modoAchado = exigirModoVivo(brutoModoAchado); }
        catch (e) { console.error((e as Error).message); return 2; }
      }
      const brutoWorktreeAchado = args.opcoes.worktree;
      const criarWorktreeAchado = brutoWorktreeAchado === true || brutoWorktreeAchado === 'auto';
      const r = abrirThreadDoAchado(carregado, doAchado, {
        nome: args.posicionais[2],
        modo: modoAchado ?? undefined,
        slug: texto(args.opcoes.slug),
        assunto: texto(args.opcoes.assunto),
        criarWorktree: criarWorktreeAchado,
        worktree: criarWorktreeAchado ? null : (texto(brutoWorktreeAchado) ?? null),
        dryRun: args.opcoes['dry-run'] === true,
      });
      if (!r.ok) {
        console.error(`Thread a partir do achado ${r.achado.id} RECUSADA.`);
        console.error(`  ${DESCRICAO_DO_MOTIVO_DE_AUDITORIA[r.motivo ?? 'claims.failed']}`);
        console.error(`  motivo tipado: ${r.motivo}`);
        console.error(`  detalhe: ${r.detalhe}`);
        console.error(`  correcao: ${r.correcao}`);
        return 1;
      }
      const gravadaDoAchado = args.opcoes['dry-run'] !== true;
      // RM-052 (D7): thread nova, projeto conhecido; o aviso nunca derruba a criacao.
      const avisoDoRegistroDoAchado = gravadaDoAchado && r.thread ? registrarProjetoEmSilencio(carregado.raiz, 'thread new') : null;
      if (avisoDoRegistroDoAchado) console.error(avisoDoRegistroDoAchado);
      console.log(
        gravadaDoAchado
          ? `Thread criada a partir do achado ${r.achado.id}.`
          : 'Simulacao (--dry-run), nada foi gravado.'
      );
      console.log(textoDoAchado(r.achado));
      console.log('');
      if (r.thread) {
        console.log(resumoDaThread(r.thread));
        console.log('');
        console.log(`  slug em 3 partes: ${descreverSlug(r.thread.slug)}`);
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
        console.log(`  origem do GOAL: .orkastery/threads/${r.thread.id}/achado.json`);
        console.log('');
        console.log('Pedido de GOAL ja montado a partir do achado:');
        console.log('');
        console.log(r.pedido);
        console.log('');
        console.log('Proximo passo:');
        console.log(
          `  ork phase run ${r.thread.id} GOAL --prompt "$(cat .orkastery/threads/${r.thread.id}/pedido-goal.md)"`
        );
      }
      return 0;
    }

    const nome = args.posicionais[2];
    if (!nome) {
      console.error('uso: ork thread new <nome> --modo <MODO>');
      return 2;
    }
    const avisoRoadmap = avisoRoadmapSemAssociacao(nome, texto(args.opcoes.roadmap));
    if (avisoRoadmap) console.error(avisoRoadmap);
    const brutoModo = texto(args.opcoes.modo) ?? texto(args.opcoes.mode);
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
        if (corte < 0) {
          throw new Error(`done.sem-comando: "${entrada}" nao traz comando. `
            + 'Use --done "<criterio> :: <comando que o prova>"; criterio sem comando e prosa, nao criterio de pronto.');
        }
        const criterio = entrada.slice(0, corte).trim();
        const comando = entrada.slice(corte + 2).trim();
        if (!criterio || !comando) throw new Error(`done.incompleto: "${entrada}" precisa de criterio E comando`);
        return { criterio, comando };
      });
    const dryRun = args.opcoes['dry-run'] === true;
    const brutoWorktree = args.opcoes.worktree;
    // `--worktree auto` (ou `--worktree` sozinho) cria a worktree isolada da thread;
    // um caminho reusa um diretorio que ja existe.
    const criarWorktree = brutoWorktree === true || brutoWorktree === 'auto';
    const brutoCiclo = texto(args.opcoes.ciclo) ?? texto(args.opcoes.variante);
    const variante = brutoCiclo ? parseVariante(brutoCiclo) : null;
    if (brutoCiclo && !variante) {
      console.error(
        `variante de ciclo invalida: "${brutoCiclo}". Use uma de: ${Object.keys(VARIANTES).join(', ')}`
      );
      return 2;
    }
    const brutoFatias = texto(args.opcoes.fatias);
    // I-47: `--roadmap RM-NNN` reserva o item ANTES de criar a thread. A reserva e o passo
    // atomico entre maquinas (o primeiro push vence); a thread e local. Se a criacao falhar,
    // a reserva e devolvida; se der certo, ela passa a apontar para a thread.
    const itemDoRoadmap = dryRun ? undefined : texto(args.opcoes.roadmap);
    const itemReservado = itemDoRoadmap ? pegarItem(carregado.raiz, itemDoRoadmap).item : undefined;
    let criada: ReturnType<typeof novaThread>;
    try {
      criada = novaThread(carregado, {
        nome,
        modo,
        slug: texto(args.opcoes.slug),
        assunto: texto(args.opcoes.assunto),
        worktree: criarWorktree ? null : (texto(brutoWorktree) ?? null),
        criarWorktree,
        dryRun,
        variante,
        branch: texto(args.opcoes.branch),
        fatias: brutoFatias !== undefined ? Number(brutoFatias) : undefined,
        exigeRuntimeDiferente,
        doneWhen,
        roadmap: itemReservado,
      });
    } catch (e) {
      if (itemDoRoadmap) {
        try { soltarItem(carregado.raiz, itemDoRoadmap); } catch { /* fica reservado; `ork roadmap soltar` resolve */ }
      }
      throw e;
    }
    const { thread, gravada } = criada;
    const reservaDoItem = itemDoRoadmap && gravada ? pegarItem(carregado.raiz, itemDoRoadmap, { thread: thread.id }) : null;
    // I-51 (RM-047): com a fabrica compartilhada, as outras maquinas veem a thread nova.
    if (gravada) publicarEmSegundoPlano(carregado.raiz);
    // RM-052 (D7): quem abre thread aqui conhece este projeto; o aviso nunca derruba a criacao.
    const avisoDoRegistro = gravada ? registrarProjetoEmSilencio(carregado.raiz, 'thread new') : null;
    if (avisoDoRegistro) console.error(avisoDoRegistro);
    console.log(gravada ? 'Thread criada.' : 'Simulacao (--dry-run), nada foi gravado.');
    if (reservaDoItem) console.log(`  roadmap: ${reservaDoItem.item} reservado para esta maquina (${reservaDoItem.reserva?.maquina})`);
    console.log(resumoDaThread(thread));
    console.log('');
    console.log(`  slug em 3 partes: ${descreverSlug(thread.slug)}`);
    if (gravada) {
      console.log(`  estado: .orkastery/threads/${thread.id}/thread.json`);
      // Bloco B6: a origem da thread e as policies do projeto vao para a memoria
      // semantica quando ela esta ligada. Em regime files nada muda nesta saida.
      relatarPublicacao(publicar(carregado, thread.id));
      console.log('');
      console.log(`Proximo passo: ork phase run ${thread.id} ${thread.faseAtual} --prompt "<pedido>"`);
    }
    const avisoSemBase = avisoDeThreadSemBase(thread, gravada);
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
    if (!id) {
      console.error('uso: ork thread status <thread-id>');
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
      console.log('  nenhuma sessao despachada ainda');
    } else {
      console.log('  sessoes despachadas (estado real conferido em `ork sessions`)');
      for (const s of thread.sessoes) {
        console.log(
          `    ${s.slug.padEnd(24)} ${s.fase.padEnd(6)} ${s.sessionId.slice(0, 8)}  ` +
            `verificada no runtime: ${s.verificada ? 'sim' : 'nao'}  canal: ${canalDaSessao(s)}`
        );
      }
    }
    console.log('');
    console.log(`  pausas humanas do modo: ${pausasDoModo(thread.modo)}`);
    return 0;
  }
  console.error(`subcomando desconhecido: thread ${sub}`);
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
  const invalido = () => { throw new Error('onboarding.input.invalid: use ork onboarding [show|set <etapa>|reset [etapa]] --conteudo <JSON> [--por Q] [--json]'); };
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
  if (sub === 'sync' && 'por' in args.opcoes) throw new Error('onboarding.input.invalid: sync não aceita --por; informe autoria em set ou reset.');
  const carregado = exigirManifesto(), raiz = carregado.raiz, por = texto(args.opcoes.por) ?? 'owner';
  if (sub === 'sync') {
    const r = sincronizarOnboarding(carregado);
    console.log(args.opcoes.json === true ? JSON.stringify(r, null, 2) : `${r.regime}${r.motivo ? ` (${r.motivo})` : ''}: ${r.detalhe}`);
    return 0;
  }
  let estado;
  if (sub === 'set') {
    let conteudo: unknown;
    try { conteudo = JSON.parse(args.opcoes.conteudo as string); } catch { return invalido(); }
    estado = gravarEtapa(raiz, etapa!, conteudo, por);
  } else if (sub === 'reset') estado = resetarOnboarding(raiz, etapa, por);
  else estado = lerOnboarding(raiz);
  console.log(args.opcoes.json === true ? JSON.stringify(estado, null, 2) : textoDaPauta(estado, exigirManifesto(raiz).manifesto.owner));
  return 0;
}

/**
 * I-33 (D8): `ork accounts list|add|remove|check`. O login e sempre do proprio CLI com o env do
 * perfil (`claude auth login`, `codex login`); o `ork` so guarda identidade, diretorio e estado,
 * nunca le, copia ou migra o que o CLI grava. A lista nao tem segredo porque o store nao tem.
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
  for (const a of carregado.avisos) if (a.startsWith('runtime_profiles.')) console.error(`aviso: ${a}`);
}

function comandoAccounts(args: Args): number {
  const carregado = exigirManifesto();
  avisarChavesDePerfis(carregado);
  const raiz = carregado.raiz;
  const sub = args.posicionais[1] ?? 'list';
  const conferir = (p: PerfilDeDespacho) => p.runtime === 'claude-bg' ? conferirAuthClaude(p) : conferirAuthCodex(p);
  const imprimir = () => {
    const store = lerPerfis(raiz);
    if (args.opcoes.json === true) { console.log(JSON.stringify(store, null, 2)); return; }
    // I-49: a tabela mostra o que o despacho enxerga, com o que outra fabrica viu na mesma conta.
    const visto = lerPerfisComContas(raiz);
    console.log(visto.perfis.length === 0 ? 'Nenhum perfil configurado: cada runtime despacha pelo ambiente do processo.'
      : tabela(COLUNAS_DE_PERFIS, linhasDePerfis(visto)));
    // I-35: a tabela mostra horario do dono; o fuso sai uma vez, no fim da mensagem.
    if (perfisComHorario(store)) console.log(legendaDoFuso());
  };
  if (sub === 'list') { imprimir(); return 0; }
  if (sub === 'add') {
    const id = args.posicionais[2], runtime = texto(args.opcoes.runtime), dirBruto = texto(args.opcoes.dir);
    if (!id || !runtime || !dirBruto) {
      console.error('uso: ork accounts add <id> --runtime claude-bg|codex --dir <diretorio> [--sem-login]');
      return 2;
    }
    const dir = path.resolve(dirBruto);
    let perfil;
    try {
      // A7: diretorio inacessivel ou de outro usuario e recusado antes de qualquer gravacao no store.
      prepararDiretorioDoPerfil(dir);
      const desativado = lerPerfis(raiz).perfis.some(p => p.id === id && p.estado === 'desativado');
      perfil = adicionarPerfil(raiz, { id, runtime, dir });
      if (desativado) console.log(`Perfil ${id} reativado: mesmo id, runtime e diretorio do perfil desativado.`);
    } catch (e) { console.error(`perfil recusado: ${(e as Error).message}`); return 1; }
    const despacho = perfilDeDespacho(perfil);
    const variavel = VARIAVEL_DO_PERFIL[perfil.runtime];
    // D13: o login do claude e fixado na assinatura (`--claudeai`), nunca no Console de API.
    const comando = perfil.runtime === 'claude-bg' ? ['claude', 'auth', 'login', '--claudeai'] : ['codex', 'login'];
    if (args.opcoes['sem-login'] !== true && process.stdin.isTTY && process.stdout.isTTY) {
      // Login interativo do proprio CLI, com o env do perfil sobre a assinatura higienizada.
      const env = perfil.runtime === 'claude-bg' ? ambienteDoPerfilClaude(despacho) : ambienteDoDespachoCodex(process.env, despacho);
      spawnSync(comando[0], comando.slice(1), { stdio: 'inherit', env });
    } else {
      console.log(`Login pendente: rode ${variavel}=${aspasDeShell(dir)} ${comando.join(' ')} e depois ork accounts check ${id}`);
    }
    const auth = conferir(despacho);
    // A14: conferencia inconclusiva nao marca sem-auth; o preflight do proximo despacho confere de novo.
    if (!auth.ok && !auth.transitorio) marcarFalhaDePerfil(raiz, id, auth.pago
      ? { estado: 'provider-pago', esgotadoAte: null, motivo: 'cost.violation', detalhe: auth.detalhe }
      : { estado: 'sem-auth', esgotadoAte: null, motivo: 'runtime.auth-missing', detalhe: auth.detalhe });
    console.log(`Perfil ${id} (${perfil.runtime}) em ${dir}: ${auth.ok ? 'login de assinatura conferido'
      : auth.transitorio ? `conferencia de login inconclusiva (${auth.detalhe}); o proximo despacho confere de novo`
      : auth.pago ? `provider pago (${auth.detalhe}); nunca recebe despacho` : `sem login (${auth.detalhe}); fora do rodizio`}`);
    return 0;
  }
  if (sub === 'remove') {
    const id = args.posicionais[2];
    if (!id) { console.error('uso: ork accounts remove <id>'); return 2; }
    try { desativarPerfil(raiz, id); } catch (e) { console.error((e as Error).message); return 1; }
    console.log(`Perfil ${id} desativado: o diretorio e o login do CLI ficam onde estao.`);
    return 0;
  }
  if (sub === 'check') {
    const alvo = args.posicionais[2];
    const perfis = lerPerfis(raiz).perfis.filter(p => p.estado !== 'desativado' && (alvo === undefined || p.id === alvo));
    if (alvo !== undefined && perfis.length === 0) { console.error(`perfil ativo "${alvo}" nao existe (veja: ork accounts list)`); return 1; }
    let falhas = 0;
    for (const p of perfis) {
      const auth = conferir(perfilDeDespacho(p));
      if (auth.ok && (p.estado === 'sem-auth' || p.estado === 'provider-pago')) reativarPerfil(raiz, p.id);
      if (!auth.ok) falhas++;
      if (!auth.ok && auth.transitorio) registrarConferenciaInconclusiva(raiz, p.id, auth.detalhe);
      else if (!auth.ok) {
        marcarFalhaDePerfil(raiz, p.id, auth.pago
          ? { estado: 'provider-pago', esgotadoAte: null, motivo: 'cost.violation', detalhe: auth.detalhe }
          : { estado: 'sem-auth', esgotadoAte: null, motivo: 'runtime.auth-missing', detalhe: auth.detalhe });
      }
      console.log(`${p.id} (${p.runtime}): ${auth.ok ? 'login de assinatura conferido'
        : auth.transitorio ? `conferencia de login inconclusiva, estado mantido (${auth.detalhe})`
        : auth.pago ? `provider pago, nunca despacha (${auth.detalhe})` : `sem login (${auth.detalhe})`}`);
    }
    console.log('');
    imprimir();
    return falhas > 0 ? 1 : 0;
  }
  console.error(`subcomando desconhecido: accounts ${sub} (use list, add, remove ou check)`);
  return 2;
}

function comandoSetup(args: Args): number {
  const carregado = exigirManifesto();
  const raiz = carregado.raiz;
  const modoBruto = args.posicionais[1];
  const por = texto(args.opcoes.por) ?? 'owner';

  if (modoBruto === 'versionar') {
    // I-52 (RM-047): o setup que vale agora vai para orkastery.setup.json, para entrar por PR.
    const r = versionarSetup(raiz, por);
    if (args.opcoes.json === true) { console.log(JSON.stringify({ caminho: r.caminho, setup: r.setup }, null, 2)); return 0; }
    console.log(`Setup versionado em ${r.caminho}.`);
    console.log('  Leve para o repositorio por PR: dali em diante ele vale em todas as maquinas, e ork setup <modo> --bloco N passa a editar este arquivo.');
    return 0;
  }
  if (!modoBruto) {
    if (args.opcoes.reset === true) {
      resetarSetup(raiz, undefined, por);
      if (args.opcoes.json === true) { console.log(JSON.stringify(lerSetup(raiz), null, 2)); return 0; }
      console.log('Setup resetado: todos os blocos de todos os modos voltaram ao default.');
      console.log(textoDaEntrevista(raiz));
      return 0;
    }
    console.log(args.opcoes.json === true ? JSON.stringify(lerSetup(raiz), null, 2) : textoDaEntrevista(raiz));
    return 0;
  }

  const modo = parseModo(modoBruto);
  if (!modo) {
    console.error(`modo de conducao desconhecido: "${modoBruto}" (aceitos: ${ORDEM_DOS_MODOS.join(', ')})`);
    return 2;
  }

  if (args.opcoes.reset === true) {
    resetarSetup(raiz, modo, por);
    if (args.opcoes.json === true) { console.log(JSON.stringify(lerSetup(raiz).modos[modo], null, 2)); return 0; }
    console.log(`Setup do modo ${MODOS[modo].tag} resetado para o default.`);
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
    console.error('para editar, informe o bloco: ork setup <modo> --bloco N [--runtime R] [--model M] [--effort E] [--fallback R:M,...]');
    return 2;
  }
  if (bloco !== undefined) {
    if (runtime === undefined && model === undefined && effort === undefined && fallback === undefined) {
      console.error('nada para editar: informe --runtime, --model, --effort e/ou --fallback junto de --bloco');
      return 2;
    }
    const r = editarBloco(raiz, modo, Number(bloco), { runtime, model, effort, ...(fallback !== undefined ? { fallback } : {}) }, por);
    if (!r.ok) {
      console.error(`edicao recusada: ${r.erro}`);
      return 1;
    }
    if (args.opcoes.json === true) { console.log(JSON.stringify(r.setup.modos[modo], null, 2)); return 0; }
    console.log(
      `Bloco ${r.bloco} do modo ${MODOS[modo].tag}: ` +
        `${r.de?.runtime}/${r.de?.model}/${r.de?.effort} -> ${r.para?.runtime}/${r.para?.model}/${r.para?.effort}`
    );
    console.log(`  gravado em ${r.caminho}; evento setup_configured no ledger do projeto`);
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
  if (sub === 'run') {
    avisarChavesDePerfis(carregado);
    const id = args.posicionais[2];
    const faseBruta = args.posicionais[3];
    const prompt = texto(args.opcoes.prompt);
    if (!id || !faseBruta || !prompt) {
      console.error('uso: ork phase run <thread-id> <FASE> --prompt "<texto>"');
      return 2;
    }
    const thread = lerThread(carregado.raiz, id);
    const fase: Fase = exigirFase(thread, faseBruta);
    const conducao = conducaoDoCli(args);
    const r = rodarFase(carregado, id, {
      fase,
      prompt,
      runtime: texto(args.opcoes.runtime),
      model: texto(args.opcoes.model),
      effort: texto(args.opcoes.effort),
      dryRun: args.opcoes['dry-run'] === true,
      canal: conducao.canal,
      ...(conducao.correlacao ? { correlacao: conducao.correlacao } : {}),
      ...(conducao.esperarMs ? { esperarMs: conducao.esperarMs } : {}),
    });
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
      console.log(`Despacho recusado: concurrency.limite. O projeto ja tem ${r.vaga.ocupam.length} sessao(oes) viva(s) ` +
        `em outras threads e o limite e ${r.vaga.limite} (concurrency.max_parallel_threads).`);
      for (const o of r.vaga.ocupam) {
        console.log(`  ${o.thread.padEnd(20)} ${(o.fase ?? '-').padEnd(6)} ` +
          `${o.sessao ? `${o.runtime} ${o.sessao.slice(0, 8)}` : 'despacho em curso'}, desde ${localizarTextoRotulado(o.desde)}`);
      }
      console.log(`  correcao: ${r.vaga.correcao}`);
      console.log(r.dryRun ? '  ensaio (--dry-run): nada foi gravado.' : `  evento slot_refused no ledger de ${id}; nenhuma sessao aberta.`);
      return 3;
    }
    // RM-037 (S-4 do CHECK 3): a baseline que o despacho nao conseguiu gravar nao e gate reprovado.
    if (r.motivo === 'baseline.pendente') {
      if (args.opcoes.json === true) { console.log(JSON.stringify({ motivo: r.motivo, detalhe: r.erro }, null, 2)); return 1; }
      console.error(`Despacho recusado: ${r.erro}`);
      console.error('  nenhuma sessao aberta; o ledger nao ganhou gate_blocked');
      return 1;
    }
    if (r.dryRun && !r.bloqueado) {
      console.log('Simulacao (--dry-run), nada foi despachado.');
      console.log(`  slug da sessao : ${r.slug}`);
      console.log(`  prompt         : ${r.promptPath}`);
      console.log(`  sha256         : ${r.promptSha256}`);
      console.log(`  pausa ao fim   : ${r.pausaAoFim ? 'sim' : 'nao'}`);
      console.log(`  runtime        : ${r.runtime}`);
      console.log(`  modelo/esforco : ${r.model}/${r.effort}`);
      // O prompt inteiro nao cabe na tela: o argumento longo aparece mascarado.
      console.log(`  comando        : ${r.comando.map((c) => (c.length > 80 ? '"<prompt>"' : c)).join(' ')}`);
      for (const l of linhasDeAviso(r.violacoes ?? [])) console.log(l);
      return 0;
    }
    if (r.bloqueado) {
      console.error(`Despacho BLOQUEADO pelo gate tipado: ${r.motivo}`);
      for (const v of r.violacoes) {
        console.error(`  [${v.severidade}] policy ${v.policy}: ${v.detalhe}`);
        console.error(`           correcao: ${v.correcao}`);
      }
      console.error(`  o prompt nao foi gravado em disco; evento gate_blocked no ledger de ${id}`);
      return 1;
    }
    if (!r.sessionId) {
      // I-35: o erro vai ao ledger com o ISO; o dono le no fuso dele, com o fuso dito uma vez.
      console.error(`Despacho falhou: ${r.erro ? localizarTextoRotulado(r.erro) : r.erro}`);
      console.error(`  evento registrado no ledger de ${id}`);
      return 1;
    }
    console.log(`Fase ${fase} despachada como background agent.`);
    for (const l of linhasDeAviso(r.violacoes ?? [])) console.log(l);
    console.log(`  sessionId      : ${r.sessionId}`);
    console.log(`  slug da sessao : ${r.slug} (${descreverSlug(r.slug)})`);
    console.log(`  prompt         : ${r.promptPath}`);
    console.log(`  sha256         : ${r.promptSha256}`);
    console.log(`  runtime        : ${r.runtime}`);
    console.log(`  modelo/esforco : ${r.model}/${r.effort} (gravado no ledger, veja \`ork phase list\`)`);
    console.log(`  verificada no runtime: ${r.verificada ? 'sim' : 'NAO (confira `ork sessions`)'}`);
    console.log(`  pausa ao fim do bloco: ${r.pausaAoFim ? 'sim' : 'nao (decisao autonoma no ledger)'}`);
    console.log('');
    if (r.runtime === 'claude-bg') {
      console.log(`Acompanhe: claude attach ${r.sessionId}  |  ork phase list ${id}`);
    } else {
      console.log(`Acompanhe: ork phase list ${id} (eventos do despacho no log da thread)`);
    }
    return r.verificada ? 0 : 1;
  }
  if (sub === 'list') {
    const id = args.posicionais[2];
    if (!id) {
      console.error('uso: ork phase list <thread-id>');
      return 2;
    }
    console.log(tabelaDoLedger(carregado.raiz, id));
    return 0;
  }
  console.error(`subcomando desconhecido: phase ${sub}`);
  return 2;
}

function comandoLedger(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  if (sub === 'stats') {
    const desde = texto(args.opcoes.desde);
    if (!desde) throw Error('uso: ork ledger stats --desde 7d [--ate ISO] [--thread T] [--modo M] [--runtime R] [--json]');
    const r = coletarEstatisticas(carregado.raiz, { desde, ate: texto(args.opcoes.ate), thread: texto(args.opcoes.thread), modo: texto(args.opcoes.modo), runtime: texto(args.opcoes.runtime) });
    console.log(args.opcoes.json === true ? JSON.stringify(r, null, 2) : textoDasEstatisticas(r));
    return 0;
  }
  if (sub === 'estimate') {
    const thread = args.posicionais[2], semIa = Number(texto(args.opcoes['sem-ia'])), iaSemOrk = Number(texto(args.opcoes['ia-sem-ork']));
    const por = texto(args.opcoes.por), metodo = texto(args.opcoes.metodo), premissas = texto(args.opcoes.premissas);
    if (!thread || !por || !metodo || !premissas) throw Error('uso: ork ledger estimate <thread-id> --sem-ia H --ia-sem-ork H --por Q --metodo M --premissas P [--incerteza I]');
    const e = registrarEstimativaPlano(carregado.raiz, thread, { semIaHoras: semIa, iaSemOrkHoras: iaSemOrk, por, metodo, premissas, incerteza: texto(args.opcoes.incerteza) });
    console.log(args.opcoes.json === true ? JSON.stringify(e, null, 2) : `Estimativa PLAN registrada em ${thread}: sem IA ${semIa} h; IA sem Orkastery ${iaSemOrk} h.`);
    return 0;
  }
  throw Error('uso: ork ledger stats|estimate ...');
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
  const bruto = texto(args.opcoes.atencao);
  const atencaoMin = bruto === undefined ? undefined : Number(bruto);
  if (atencaoMin !== undefined && (!Number.isFinite(atencaoMin) || atencaoMin < 0)) {
    console.error(`--atencao espera minutos (inteiro >= 0), recebeu "${bruto}"`);
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
  const sub = args.posicionais[1];
  const carregado = carregarManifesto();
  const raiz = carregado?.raiz ?? diretorioDoProjeto();
  if (sub === 'watch') {
    const id = texto(args.opcoes.thread);
    if (!carregado || !id) { console.error('uso: ork sessions watch --thread T [--sessao ID] [--once]'); return 2; }
    const thread = lerThread(raiz, id);
    const sessionId = texto(args.opcoes.sessao) ?? thread.sessoes.at(-1)?.sessionId;
    if (!sessionId || !thread.sessoes.some(s => s.sessionId === sessionId)) throw new Error('sessão não pertence à thread');
    console.log(JSON.stringify(args.opcoes.once === true ? observarSessao(carregado, sessionId) : { pid: iniciarWatcher(raiz, sessionId) }));
    return 0;
  }
  if (sub === 'event') {
    const tipo = texto(args.opcoes.tipo), sessao = texto(args.opcoes.sessao);
    if (!carregado || !tipo || !sessao) {
      console.error('uso: ork sessions event --tipo <tipo> --sessao <id> < payload.json (máximo 16384 bytes)');
      return 2;
    }
    try { console.log(JSON.stringify(ingerirEvento(raiz, sessao, tipo, lerPayloadSensor()))); return 0; }
    catch (e) { console.error(`evento recusado: ${(e as Error).message}`); return 1; }
  }
  if (sub === undefined || sub === 'list') {
    const r = inventariarSessoes(raiz, { todas: args.opcoes.all === true, global: args.opcoes.global === true });
    console.log(args.opcoes.json === true ? JSON.stringify(r, null, 2) : textoDoInventario(r));
    return !r.ok || (args.opcoes['exigir-limpo'] === true && r.semThread > 0) ? 1 : 0;
  }
  if (sub === 'hitl') {
    return comandoSessionsHitl(args, carregado ? raiz : '');
  }
  if (sub === 'request') {
    const id = args.posicionais[2], sessionId = args.posicionais[3];
    const fase = texto(args.opcoes.fase), runtime = texto(args.opcoes.runtime), pergunta = texto(args.opcoes.pergunta);
    if (!id || !sessionId || !fase || !FASES.includes(fase as Fase) || !runtime) throw new Error('sessions request exige thread, UUID, --fase e --runtime; --pergunta só confere o conteúdo nativo');
    console.log(JSON.stringify(abrirPedidoSessao(raiz, id, sessionId, { fase: fase as Fase, runtime, pergunta, prazo: texto(args.opcoes.prazo) })));
    return 0;
  }
  if (sub === 'answer') {
    const id = args.posicionais[2], pedido = args.posicionais[3];
    if (!id || !pedido || args.opcoes.stdin !== true) throw new Error('sessions answer exige thread, pedido e envelope autenticado em --stdin');
    const r = lerRespostaStdin({ origem: texto(args.opcoes.origem), por: texto(args.opcoes.por),
      mensagem: texto(args.opcoes.mensagem), canal: texto(args.opcoes.canal), conta: texto(args.opcoes.conta) });
    console.log(JSON.stringify(responderSessao(raiz, id, pedido, r)));
    return 0;
  }
  if (sub === 'reconcile') {
    // FX3: fecha um envio pendente so com (thread, pedido). Nao reenvia e nao re-elicita:
    // pergunta ao receptor, pelo recibo correlacionado, se ele recebeu aquele envioId.
    const id = args.posicionais[2], pedido = args.posicionais[3];
    if (!id || !pedido) throw new Error('sessions reconcile exige thread e pedido');
    const r = reconciliarEnvioDeSessao(raiz, id, pedido);
    console.log(JSON.stringify(r));
    return r.estado === 'entregue' ? 0 : 1;
  }
  if (sub === 'supersede') {
    const id = args.posicionais[2], sessionId = args.posicionais[3];
    const fase = texto(args.opcoes.fase), runtime = texto(args.opcoes.runtime);
    if (!id || !sessionId || !fase || !FASES.includes(fase as Fase) || !runtime) throw new Error('sessions supersede exige thread, UUID, --fase e --runtime');
    console.log(JSON.stringify(superarSessao(raiz, id, sessionId, fase as Fase, runtime)));
    return 0;
  }
  const chave = args.posicionais[2];
  if (!chave) {
    console.error(`uso: ork sessions ${sub} <sessao>`);
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
  console.error(`subcomando desconhecido: sessions ${sub}`);
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
      if (!v) throw new Error(`decisao registrar exige --${nome}`);
      return v;
    };
    if (!id) throw new Error('uso: ork decisao registrar <thread-id> --decidido D --porque P ...');
    const bruto = campo('criterio'), separador = bruto.indexOf(':');
    const tipo = bruto.slice(0, separador) as TipoDeCriterio, referencia = bruto.slice(separador + 1);
    if (separador < 1 || !['manifesto', 'ledger', 'medicao'].includes(tipo) || !referencia.trim()) {
      throw new Error('decisao registrar: --criterio manifesto:CHAVE, ledger:REF ou medicao:COMANDO');
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
    if (!id) throw new Error('uso: ork decisao placar <thread-id> [--json]');
    lerThread(carregado.raiz, id);
    const placar = placarDaThread(lerLedger(dirThread(carregado.raiz, id)));
    const taxa = taxaDeReversao(placar);
    if (args.opcoes.json === true) {
      console.log(JSON.stringify({ thread: id, limiar: LIMIAR_DE_DECISOES_POR_FASE, taxaDeReversao: taxa, fases: placar }, null, 2));
      return 0;
    }
    console.log(tabela(['FASE', 'DECIDIDAS', 'INFORMADAS', 'PERGUNTAS', 'REVERTIDAS', 'SEM RASTRO', 'LIMIAR'],
      placar.map(f => [f.fase, String(f.decididas), String(f.informadas), String(f.perguntas), String(f.revertidas),
        String(f.semRastro), f.acimaDoLimiar ? `acima de ${LIMIAR_DE_DECISOES_POR_FASE}: revisar` : 'ok'])));
    console.log(`\ntaxa de reversão das decisões informadas: ${taxa === null ? 'sem decisão informada ainda' : `${Math.round(taxa * 100)}%`}`);
    return 0;
  }
  throw new Error('uso: ork decisao registrar|placar <thread-id>');
}

/**
 * I-50 (RM-039): a tag que o dono manda no Telegram, pelo terminal. Sem tag, mostra a cadencia em
 * vigor. O `#` e opcional porque o shell trata `#` no inicio da palavra como comentario.
 */
function comandoCadenciaDoPulse(args: Args): number {
  const carregado = exigirManifesto();
  if (args.posicionais.length > 3) throw new Error('pulse cadencia: uma tag por vez');
  const bruta = args.posicionais[2];
  const agora = new Date().toISOString();
  if (bruta !== undefined) {
    const lido = interpretarRespostaDoPulse(bruta.trim().startsWith('#') ? bruta : `#${bruta.trim()}`);
    if (lido.forma !== 'cadencia') {
      throw new Error(`pulse cadencia: tag desconhecida "${bruta}"; use ${Object.keys(CADENCIAS).join(', ')}`);
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
    ? `Trocada por ${vigente.gravada.por} (${vigente.gravada.canal}) em ${formatarDataHoraRotulada(vigente.gravada.em)}.`
    : 'Nenhuma tag gravada: vale a cadência padrão.');
  return 0;
}

function comandoClaims(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  if (sub === 'add') {
    const id = args.posicionais[2];
    const arquivo = args.posicionais[3];
    const alegacao = texto(args.opcoes.claim) ?? texto(args.opcoes.alegacao);
    if (!id || !arquivo || !alegacao) {
      console.error('uso: ork claims add <thread-id> <arquivo> --claim "<alegacao>" [--verificar "<comando>"]');
      return 2;
    }
    const comando = texto(args.opcoes.verificar) ?? texto(args.opcoes.verify);
    const faseBruta = texto(args.opcoes.fase);
    const thread = lerThread(carregado.raiz, id);
    const claim = adicionarClaim(carregado.raiz, id, {
      arquivo,
      alegacao,
      verificar: comando ? [comando] : [],
      fase: faseBruta ? exigirFase(thread, faseBruta) : undefined,
    });
    console.log(`Claim ${claim.id} registrada na thread ${id}.`);
    console.log(`  arquivo    ${claim.arquivo}`);
    console.log(`  alegacao   ${claim.alegacao}`);
    console.log(`  negativa   ${claim.negativa ? 'sim (exige comando de verificacao)' : 'nao'}`);
    console.log(`  verificar  ${claim.verificar.join(' && ') || '(nenhum comando declarado)'}`);
    console.log(`  estado     ${claim.estado}`);
    if (claim.negativa && claim.verificar.length === 0) {
      console.log('');
      console.log('AVISO: alegacao negativa sem comando de verificacao reprova em `ork verify`.');
    }
    // I-53 (RM-037, P6): o lint avisa aqui; a suite inteira e recusada no `ci prepare`.
    for (const a of claim.lint ?? []) {
      console.log('');
      console.log(`AVISO: ${linhaDoLintDeClaim(claim.id, a)}${a.regra === 'suite-inteira' ? '. O `ci prepare` recusa esta claim.' : ''}`);
    }
    return 0;
  }
  if (sub === 'verificar') {
    const id = args.posicionais[2];
    const claimId = args.posicionais[3];
    const comando = texto(args.opcoes.comando) ?? texto(args.opcoes.verificar);
    if (!id || !claimId || !comando) {
      console.error('uso: ork claims verificar <thread-id> <claim-id> --comando "<comando>"');
      return 2;
    }
    const claim = anexarComando(carregado.raiz, id, claimId, comando);
    console.log(`Claim ${claim.id} agora tem comando de verificacao.`);
    console.log(`  verificar  ${claim.verificar.join(' && ')}`);
    console.log(`  estado     ${claim.estado}`);
    console.log('');
    console.log(`Prove agora: ork verify ${id}`);
    return 0;
  }
  if (sub === 'retirar') {
    const id = args.posicionais[2];
    const claimId = args.posicionais[3];
    const motivo = texto(args.opcoes.motivo);
    if (!id || !claimId || !motivo) {
      console.error('uso: ork claims retirar <thread-id> <claim-id> --motivo "<motivo>"');
      return 2;
    }
    const claim = retirarClaim(carregado.raiz, id, claimId, motivo);
    console.log(`Claim ${claim.id} retirada da thread ${id}.`);
    console.log(`  alegacao   ${claim.alegacao}`);
    console.log(`  motivo     ${motivo}`);
    console.log('  o historico da alegacao continua no claims.jsonl e no ledger.');
    return 0;
  }
  if (sub === 'ausente') {
    const id = args.posicionais[2];
    const paths = (texto(args.opcoes.paths) ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    const motivo = texto(args.opcoes.motivo);
    if (!id || paths.length === 0 || !motivo) {
      console.error('uso: ork claims ausente <thread-id> --paths A,B --motivo "<motivo>" [--commit SHA]');
      return 2;
    }
    registrarProvaAusente(carregado.raiz, id, { paths, motivo, commit: texto(args.opcoes.commit) });
    console.log(`Ausencia de prova registrada na thread ${id}: ${paths.join(', ')}.`);
    console.log(`  motivo     ${motivo}`);
    return 0;
  }
  if (sub === 'list' || sub === undefined) {
    const id = args.posicionais[2];
    if (!id) {
      console.error('uso: ork claims list <thread-id>');
      return 2;
    }
    console.log(tabelaDeClaims(carregado.raiz, id));
    return 0;
  }
  console.error(`subcomando desconhecido: claims ${sub}`);
  return 2;
}

function comandoVerify(args: Args): number {
  const carregado = exigirManifesto();
  const id = args.posicionais[1];
  if (!id) {
    console.error('uso: ork verify <thread-id> [--baseline] [--so-claims] [--canal C] [--esperar [min]]');
    return 2;
  }
  const conducao = conducaoDoCli(args);
  if (args.opcoes.baseline === true) {
    const b = gravarBaseline(carregado, id, undefined, conducao);
    console.log(`Baseline gravada para a thread ${id}.`);
    console.log(`  commit ${b.commit}`);
    for (const c of b.comandos) {
      console.log(`  ${c.nome.padEnd(10)} ${c.ok ? 'passava' : `ja falhava (codigo ${c.code})`}  ${c.comando}`);
    }
    if (b.comandos.length === 0) {
      console.log('  (nenhum comando em verify: no manifesto; sem baseline nao ha como separar regressao)');
    }
    return 0;
  }
  const r = verificar(carregado, id, { soClaims: args.opcoes['so-claims'] === true, conducao });
  console.log(textoDoVerify(r));
  return r.ok ? 0 : 1;
}

/**
 * `ork conducao status|assumir` (I-36, T15): quem conduz a thread agora, e o handoff explicito. O
 * status tambem libera, com prova no ledger, a conducao que ficou sem dono (T16).
 */
function comandoConducao(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  const id = args.posicionais[2];
  if (sub === 'status') {
    if (!id) throw new Error('uso: ork conducao status <thread-id> [--json]');
    lerThread(carregado.raiz, id);
    liberarSeOrfa(carregado.raiz, id);
    const atual = conducaoDaThread(carregado.raiz, id);
    console.log(args.opcoes.json === true ? JSON.stringify({ thread: id, conducao: atual }, null, 2) : textoDoStatusDaConducao(id, atual));
    return 0;
  }
  if (sub === 'assumir') {
    const por = texto(args.opcoes.por), motivo = texto(args.opcoes.motivo);
    if (!id || !por || !motivo) throw new Error('uso: ork conducao assumir <thread-id> --por <quem> --motivo "<por que>" [--canal C]');
    const r = assumirConducao(carregado.raiz, id, { por, motivo, canal: conducaoDoCli(args).canal });
    console.log(args.opcoes.json === true ? JSON.stringify(r, null, 2) : `${r.ok ? 'Conducao assumida.' : 'Handoff recusado.'} ${r.detalhe}`);
    return r.ok ? 0 : 3;
  }
  throw new Error('uso: ork conducao status|assumir <thread-id>');
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
  if (sub === 'context') {
    const id = args.posicionais[2], pedido = args.posicionais[3];
    if (!id || !pedido || args.posicionais.length !== 4 ||
        Object.entries(args.opcoes).some(([k, v]) => k !== 'native-offer-stdin' || v !== true))
      throw Error('uso: ork gate context <thread> <pedido> [--native-offer-stdin]');
    const view = contextoDoPedidoNativo(carregado.raiz, id, pedido);
    const callback = args.opcoes['native-offer-stdin'] ? readNativeOfferStdin() : undefined;
    console.log(JSON.stringify({ ...view, canais: ofertaDoPedido(view.pedido, [],
      callback === undefined ? undefined : { callback, raiz: carregado.raiz }),
      apresentacao: apresentarDecisao(view.pedido), prazoLocal: prazoLocalDoPedido(view.pedido) }));
    return 0;
  }
  if (sub === 'request') {
    const id = args.posicionais[2];
    if (!id) throw new Error('gate request exige thread');
    const formato = texto(args.opcoes.formato);
    if (formato !== undefined && formato !== 'telegram' && formato !== 'terminal') throw new Error('gate request: --formato telegram|terminal');
    const pedido = abrirPedidoGate(carregado.raiz, id, texto(args.opcoes.motivo));
    // RM-048 (D1): com --formato, o que sai e o pedido no contrato curto, pronto para o canal, com
    // o codigo estavel na ultima linha. Sem ele, o JSON de sempre, para quem integra.
    console.log(formato ? textoDoGateCurto(carregado.raiz, pedido, formato) : JSON.stringify(pedido));
    return 0;
  }
  if (sub === 'answer') {
    const id = args.posicionais[2], pedido = args.posicionais[3];
    if (!id || !pedido || args.opcoes['resposta-stdin'] !== true || args.opcoes.resposta !== undefined) throw new Error('gate answer exige thread, pedido e --resposta-stdin');
    const r = lerRespostaStdin({ por: texto(args.opcoes.por), mensagem: texto(args.opcoes.mensagem),
      origem: texto(args.opcoes.origem), canal: texto(args.opcoes.canal), conta: texto(args.opcoes.conta) });
    console.log(JSON.stringify(responderGate(carregado.raiz, id, pedido, r)));
    return 0;
  }
  if (sub === 'next') {
    const id = args.posicionais[2];
    if (!id) {
      console.error('uso: ork gate next <thread-id> [--proximo FASE] [--ocupacao 0..1]');
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
      console.error('gate approve aposentado: aprovação sem pedido é recusada. Use ork gate request <thread-id> e responda pelo ingresso humano autenticado.');
      return 2;
    }
    lerThread(carregado.raiz, id);
    const e = aprovarGateHumano(carregado.raiz, id, sobre, por, texto(args.opcoes.obs));
    console.log(`Autorizacao humana registrada no ledger da thread ${id}.`);
    console.log(`  sobre          ${sobre}`);
    console.log(`  autorizado por ${por}`);
    console.log(`  quando         ${formatarDataHoraRotulada(e.ts)}`);
    return 0;
  }
  console.error(`subcomando desconhecido: gate ${sub}`);
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

  if (sub === 'policy') {
    const alvo = texto(args.opcoes.motivo);
    if (alvo) {
      const politica = POLITICA_DE_RETRY[alvo as keyof typeof POLITICA_DE_RETRY];
      if (!politica) {
        console.error(`motivo tipado desconhecido: ${alvo}`);
        console.error(`  conhecidos: ${Object.keys(POLITICA_DE_RETRY).join(', ')}`);
        return 2;
      }
      if (args.opcoes.json === true) {
        console.log(JSON.stringify(politica, null, 2));
        return 0;
      }
      console.log(`motivo tipado: ${politica.motivo}`);
      console.log(`  significado  ${DESCRICAO_DO_MOTIVO_DE_AUDITORIA[politica.motivo]}`);
      console.log(`  acao         ${politica.acao}`);
      console.log(`  automatica   ${politica.automatica ? 'sim' : 'nao'}`);
      console.log(`  por que      ${politica.porque}`);
      console.log(`  correcao     ${politica.correcao}`);
      return 0;
    }
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(Object.values(POLITICA_DE_RETRY), null, 2));
      return 0;
    }
    console.log('Politica de retry por motivo tipado de gate (bloco B3)');
    console.log('');
    console.log(tabelaDaPolitica());
    console.log('');
    console.log('A politica e a MESMA em todos os modos: o modo afrouxa a pausa, nunca a');
    console.log('verificacao. cost.violation nunca recebe retry automatico, e o limite de');
    console.log('escalacao (retry.max_tentativas) pausa qualquer modo, inclusive #Auto.');
    return 0;
  }

  if (sub === 'parse') {
    const bruto = texto(args.opcoes.stderr) ?? args.posicionais.slice(2).join(' ');
    if (!bruto) {
      console.error('uso: ork retry parse --stderr "<texto do stderr do adapter>"');
      return 2;
    }
    const sinal = parseRateLimit(bruto);
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(sinal, null, 2));
      return sinal ? 0 : 1;
    }
    if (!sinal) {
      console.log('Nenhum sinal de rate limit reconhecido neste texto.');
      return 1;
    }
    console.log('Sinal de rate limit reconhecido no stderr do runtime:');
    console.log(`  fonte da hora  ${sinal.fonte}`);
    console.log(`  reset em       ${sinal.resetEm ? formatarDataHoraRotulada(sinal.resetEm) : '(o runtime nao disse a hora)'}`);
    console.log(`  trecho         ${sinal.trecho}`);
    if (sinal.resetEm === null) {
      console.log('');
      console.log('  Sem hora no texto, a fila usa retry.janela_padrao_min do manifesto e marca');
      console.log('  o pedido como janela ESTIMADA. O `ork` nao inventa horario de reset.');
    }
    return 0;
  }

  const carregado = exigirManifesto();
  avisarChavesDePerfis(carregado);

  if (sub === 'plan' || sub === 'run') {
    const id = args.posicionais[2];
    if (!id) {
      console.error(`uso: ork retry ${sub} <thread-id> [--motivo M] [--fase F]`);
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
      const plano = planejarRetry(carregado, id, opcoes);
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
    const r = executarRetry(carregado, id, {
      ...opcoes,
      dryRun: args.opcoes['dry-run'] === true,
      reverify: args.opcoes.reverify === true,
    });
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
      console.log(`Proxima janela: ${formatarDataHora(espera[0].liberaEm)} (${faltaPara(espera[0])}).`);
      console.log('Retome com: ork retry resume');
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
      console.error('uso: ork retry cancel <id> --motivo "<motivo>"');
      return 2;
    }
    const p = cancelarPedido(carregado, idPedido, motivo);
    console.log(`Pedido ${p.id} cancelado na fila de rate limit.`);
    console.log(`  thread   ${p.thread}`);
    console.log(`  fase     ${p.fase}`);
    console.log(`  motivo   ${motivo}`);
    return 0;
  }

  console.error(`subcomando desconhecido: retry ${sub ?? ''}`);
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

  if (sub === 'open') {
    if (!id) {
      console.error('uso: ork fix open <thread-id> [--so-claims] [--reverify]');
      return 2;
    }
    const conducao = conducaoDoCli(args);
    const rodada = abrirRodada(carregado, id, { soClaims: args.opcoes['so-claims'] === true, conducao });
    const reverify =
      args.opcoes.reverify === true && rodada.correcoes.length > 0
        ? reverificar(carregado, id, { rodada: rodada.rodada, conducao })
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
      console.error('uso: ork fix list <thread-id> [--rodada N]');
      return 2;
    }
    lerThread(carregado.raiz, id);
    const rodadaBruta = texto(args.opcoes.rodada);
    const rodada = rodadaBruta ? Number(rodadaBruta) : ultimaRodada(carregado.raiz, id);
    if (rodada === 0) {
      console.log(`A thread ${id} nao tem rodada de GO-FIX. Abra com: ork fix open ${id}`);
      return 0;
    }
    const correcoes = correcoesDaRodada(carregado.raiz, id, rodada);
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(correcoes, null, 2));
      return 0;
    }
    console.log(`Correcoes da rodada ${rodada} da thread ${id}`);
    console.log('');
    console.log(
      tabela(
        ['ID', 'TIPO', 'MOTIVO', 'ALVO', 'ESTADO', 'JULGADO POR'],
        correcoes.map((c) => [
          c.id,
          c.tipo,
          c.origem,
          c.alvo,
          c.estado,
          c.verificar.join(' && ') || '(verify completo)',
        ])
      )
    );
    return 0;
  }

  if (sub === 'reverify') {
    if (!id) {
      console.error('uso: ork fix reverify <thread-id> [--rodada N] [--parcial]');
      return 2;
    }
    const rodadaBruta = texto(args.opcoes.rodada);
    const r = reverificar(carregado, id, {
      conducao: conducaoDoCli(args),
      rodada: rodadaBruta ? Number(rodadaBruta) : undefined,
      parcial: args.opcoes.parcial === true,
    });
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      console.log(textoDoReverify(r));
    }
    return r.veredito === 'PASSOU' ? 0 : 1;
  }

  console.error(`subcomando desconhecido: fix ${sub ?? ''}`);
  return 2;
}

function comandoHandoff(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  const id = args.posicionais[2];
  if (sub === 'export') {
    if (!id) {
      console.error('uso: ork handoff export <thread-id> [--proxima-fase FASE]');
      return 2;
    }
    const thread = lerThread(carregado.raiz, id);
    const faseBruta = texto(args.opcoes['proxima-fase']) ?? texto(args.opcoes.fase);
    const r = exportarHandoff(carregado, id, {
      proximaFase: faseBruta ? exigirFase(thread, faseBruta) : undefined,
      slugDestino: texto(args.opcoes.slug),
    });
    console.log(textoDoHandoff(r.handoff, r.caminho));
    console.log('');
    console.log(`Historico: ${r.caminhoHistorico}`);
    return 0;
  }
  if (sub === 'recall') {
    const ponteiro = args.posicionais[3];
    if (!id || !ponteiro) {
      console.error('uso: ork handoff recall <thread-id> <path#ancora>');
      return 2;
    }
    const r = recall(carregado, id, ponteiro);
    console.log(`Ponteiro resolvido: ${r.location}`);
    console.log(`  metodo       ${r.metodo}`);
    console.log(`  sha256       ${r.sha256}`);
    console.log(
      `  linhas       ${r.intervalo ? `${r.intervalo.inicio}-${r.intervalo.fim}` : '(nao aplicavel)'}`
    );
    console.log('');
    console.log(r.conteudo);
    return 0;
  }
  console.error(`subcomando desconhecido: handoff ${sub}`);
  return 2;
}

function comandoShip(args: Args): number {
  const carregado = exigirManifesto();
  if (args.posicionais[1] === 'registrar-pr') {
    // I-57 (RM-008): a entrega feita por PR vira ship_done, provada no remoto e no CI.
    const alvo = args.posicionais[2];
    const remoto = texto(args.opcoes.remoto);
    // RM-037 (defeito 5): PR mesclado em repositorio externo declarado em ci.external_repositories.
    const repo = texto(args.opcoes.repo), numeroDoPr = texto(args.opcoes.pr);
    if ((!alvo && args.opcoes.todas !== true) || (!!repo !== !!numeroDoPr) || (repo && !alvo)) {
      console.error('uso: ork ship registrar-pr <thread-id> [--repo <dono/nome> --pr <n>] | --todas [--remoto R] [--json]');
      return 2;
    }
    const r = alvo && repo ? [registrarEntregaExternaPorPr(carregado, alvo, { repositorio: repo, pr: Number(numeroDoPr) })]
      : alvo ? [registrarEntregaPorPr(carregado, alvo, { remoto })] : registrarEntregasPorPr(carregado, { remoto });
    if (args.opcoes.json === true) { console.log(JSON.stringify(r, null, 2)); return r.some((x) => x.acao === 'recusada') ? 1 : 0; }
    if (r.length === 0) console.log('Nenhuma thread aberta com merge ship(<thread>) na base.');
    for (const x of r) console.log(`  ${x.thread.padEnd(20)} ${x.acao.padEnd(13)} ${x.motivo}`);
    const registradas = r.filter((x) => x.acao === 'registrou').length;
    if (registradas) {
      console.log('');
      console.log(`${registradas} entrega(s) registrada(s). Fechar pelo MASTER: ork master --aceitar-omissao (a nota humana sobrescreve).`);
    }
    return r.some((x) => x.acao === 'recusada') ? 1 : 0;
  }
  const id = args.posicionais[1];
  const para = texto(args.opcoes.para) ?? texto(args.opcoes.to);
  if (!id || !para) {
    console.error('uso: ork ship <thread-id> --para <branch> [--de <branch>] [--dry-run]');
    return 2;
  }
  const autorizar = args.opcoes['autorizar-push'];
  const r = ship(carregado, id, {
    para,
    de: texto(args.opcoes.de),
    remoto: texto(args.opcoes.remoto),
    mensagem: texto(args.opcoes.mensagem),
    dryRun: args.opcoes['dry-run'] === true,
    autorizarPush: typeof autorizar === 'string' ? autorizar : undefined,
    semPush: args.opcoes['sem-push'] === true,
  });
  console.log(textoDoShip(r));
  return r.ok ? 0 : 1;
}

function comandoPortfolio(args: Args): number {
  const root = exigirManifesto().raiz;
  const sub = args.posicionais[1] ?? 'list';
  if (sub === 'inspect') {
    const id = args.posicionais[2];
    if (!id) { console.error('uso: ork portfolio inspect <id> --json'); return 2; }
    console.log(JSON.stringify(inspectPortfolio(root, id), null, 2));
    return 0;
  }
  const aliases: Record<string, PortfolioKind> = { product: 'product', project: 'project', initiative: 'initiative', prod: 'product', proj: 'project', init: 'initiative' };
  const split = (value: string | undefined, separator = ',') => value?.split(separator).map((item) => item.trim()).filter(Boolean) ?? [];
  if (sub === 'list') {
    const rawKind = args.posicionais[2];
    const kind = rawKind ? aliases[rawKind] : undefined;
    if (rawKind && !kind) { console.error('tipo deve ser product, project ou initiative'); return 2; }
    const items = listEntities(root, kind, texto(args.opcoes.parent));
    console.log(args.opcoes.json === true ? JSON.stringify({ schema: 'ork.portfolio-list/v1', updatedAt: readPortfolio(root).updatedAt, items }, null, 2)
      : items.length ? items.map((item) => `${item.id}\t${item.kind}\t${item.status}\t${item.title}`).join('\n') : 'Portfólio vazio.');
    return 0;
  }
  if (sub === 'show') {
    const id = args.posicionais[2];
    if (!id) { console.error('uso: ork portfolio show <id>'); return 2; }
    const item = findEntity(root, id);
    if (!item) { console.error(`entidade ${id} não encontrada`); return 1; }
    console.log(args.opcoes.json === true ? JSON.stringify(item, null, 2) : `${item.id}\n${item.title}\nEstado: ${item.status}`);
    return 0;
  }
  if (sub === 'create') {
    const kind = aliases[args.posicionais[2] ?? ''];
    const id = args.posicionais[3], title = texto(args.opcoes.title), parent = texto(args.opcoes.parent);
    if (!kind || !id || !title) { console.error('uso: ork portfolio create <product|project|initiative> <id> --title T [--parent ID]'); return 2; }
    const common = { id, title, description: texto(args.opcoes.description), ownerId: texto(args.opcoes.owner), status: texto(args.opcoes.status) as PortfolioStatus | undefined, acceptanceCriteria: split(texto(args.opcoes.acceptance), ';') };
    const item = kind === 'product' ? createProduct(root, common)
      : kind === 'project' ? createProject(root, { ...common, productId: parent ?? '', workspaceIds: split(texto(args.opcoes.workspaces)) })
      : createInitiative(root, { ...common, projectId: parent ?? '', dependsOn: split(texto(args.opcoes.depends)) });
    console.log(JSON.stringify({ schema: 'ork.portfolio-created/v1', item }, null, 2));
    return 0;
  }
  console.error(`subcomando desconhecido: portfolio ${sub}`);
  return 2;
}

function comandoCreation(args: Args): number {
  const loaded = exigirManifesto();
  // CLI local opera com a autoridade do usuário do SO, assim como portfolio create.
  // Fachadas HTTP devem usar a API com principal e authorize autenticados no servidor.
  const actor: CreationActor = { principal: `local:uid:${userInfo().uid}`, authorize: () => {} };
  const sub = args.posicionais[1], id = args.posicionais[2];
  if (args.opcoes.principal !== undefined || args.opcoes.por !== undefined) throw new Error('creation.identity: payload não escolhe principal');
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
    if (!file) { console.error('uso: ork creation start --input-file F --json'); return 2; }
    const content = fs.readFileSync(file, 'utf8');
    if (Buffer.byteLength(content) > 100_000) throw new Error('creation.input: arquivo excede limite');
    result = startCreation(loaded, actor, JSON.parse(content));
  } else if (sub === 'list') result = listCreationOperations(loaded.raiz, actor.principal);
  else if (!id) { console.error('creation exige id'); return 2; }
  else if (sub === 'show' || sub === 'events') {
    const op = readCreationOperation(loaded.raiz, id, actor.principal);
    result = sub === 'events' ? { schema: 'ork.creation-events/v1', operationId: id, version: op.version, events: op.events } : op;
  } else if (sub === 'resume' || sub === 'compensate') {
    const version = Number(texto(args.opcoes['expected-version']));
    if (!Number.isSafeInteger(version) || version < 1) { console.error('creation exige --expected-version inteiro positivo'); return 2; }
    result = sub === 'resume' ? resumeCreation(loaded, actor, id, version) : compensateCreation(loaded, actor, id, version);
  } else { console.error('subcomando creation desconhecido'); return 2; }
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
  console.error(
    `objective.aposentado: o Objective Envelope saiu do produto na I-43 (subcomando "${sub}").\n` +
    '  Ele descrevia um gate que nao bloqueava nada: das 137 threads do projeto, zero\n' +
    '  tinham creationOrigin, que era a unica via pela qual o despacho o consultava.\n' +
    '  As duas vigas que ele guardava viraram propriedade de thread comum:\n' +
    '    ork thread new "<nome>" --modo <MODO> --exige-runtime-diferente\n' +
    '        o CHECK precisa de runtime que o GO nao usou\n' +
    '    ork thread new "<nome>" --modo <MODO> --done "<criterio> :: <comando>"\n' +
    '        criterio de pronto EXECUTAVEL, que vira claim e roda no ork verify\n' +
    '  Os envelopes ja gravados continuam em .orkastery/objectives, intocados.'
  );
  return 2;
}


function comandoCi(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1] ?? 'status';
  if (sub === 'prepare') {
    const thread = args.posicionais[2];
    if (!thread) {
      console.error('uso: ork ci prepare <thread-id>');
      return 2;
    }
    const arquivo = prepararBundleCi(carregado, thread, { aoAvisar: (linha) => console.log(`AVISO: ${linha}`) });
    console.log(`Bundle de CI: ${arquivo}`);
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
      console.error('uso: ork ci run <thread-id> [--json] | ork ci run --bundle <arquivo> | ork ci run --branch <branch>');
      return 2;
    }
    const result = executarCi(carregado, thread);
    console.log(args.opcoes.json === true ? JSON.stringify(result, null, 2) : `${result.status.ok ? 'CI APROVADO' : 'CI REPROVADO'}: ${result.status.detail}`);
    return result.status.ok ? 0 : 1;
  }
  if (sub === 'status') {
    const sha = texto(args.opcoes.sha) ?? args.posicionais[2] ?? exec('git', ['rev-parse', 'HEAD'], carregado.raiz).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      console.error('uso: ork ci status --sha <commit> [--remoto origin]');
      return 2;
    }
    const result = consultarCi(carregado, sha, texto(args.opcoes.remoto) ?? 'origin');
    console.log(args.opcoes.json === true ? JSON.stringify(result, null, 2) : `${result.ok ? 'CI VERDE' : 'CI NÃO LIBEROU'}: ${result.detail}`);
    return result.ok ? 0 : 1;
  }
  console.error(`subcomando desconhecido: ci ${sub}`);
  return 2;
}

function comandoLease(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  if (sub === undefined || sub === 'list') {
    console.log(tabelaDeLeases(carregado.raiz));
    return 0;
  }
  if (sub === 'acquire' || sub === 'take') {
    const nome = args.posicionais[2];
    const thread = texto(args.opcoes.thread);
    const motivo = texto(args.opcoes.motivo) ?? 'sem motivo declarado';
    if (!nome || !thread) {
      console.error('uso: ork lease acquire <nome> --thread <thread-id> [--motivo "<motivo>"]');
      return 2;
    }
    lerThread(carregado.raiz, thread);
    const r = adquirirRegiao(carregado.raiz, nome, { thread, motivo });
    if (r.ok) {
      console.log(`Lease ${r.nome} [${r.tipo}] adquirido pela thread ${thread}.`);
      console.log(`  expira em ${formatarDataHoraRotulada(r.lease?.expiraEm)}`);
      if (r.tomadoDeVencido) console.log('  (o lease anterior estava VENCIDO e foi tomado)');
      return 0;
    }
    console.error(`Lease ${r.nome} NAO adquirido.`);
    console.error(`  motivo tipado: ${r.motivo}`);
    console.error(`  detalhe: ${localizarTextoRotulado(r.detalhe)}`);
    console.error(`  posicao na fila: ${r.posicaoNaFila}`);
    console.error(`  correcao: ${r.correcao}`);
    return 1;
  }
  if (sub === 'release') {
    const nome = args.posicionais[2];
    if (!nome) {
      console.error('uso: ork lease release <nome> [--thread <thread-id>] [--forcar]');
      return 2;
    }
    const r = liberar(
      carregado.raiz,
      nome,
      texto(args.opcoes.thread) ?? '',
      args.opcoes.forcar === true
    );
    console.log(r.detalhe);
    return r.ok ? 0 : 1;
  }
  console.error(`subcomando desconhecido: lease ${sub}`);
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
  if (sub === 'plan' || sub === 'plano') {
    const plano = planejar(carregado);
    const consulta = consultaDoBoard(carregado, { plano: true, todos: false });
    if (args.opcoes.json === true) console.log(JSON.stringify({ ...plano, consulta }, null, 2));
    else console.log([...linhasDaConsulta(consulta), '', textoDoPlano(plano)].join('\n'));
    return 0;
  }
  if (sub === 'reap') {
    const devolvidas = devolverVagas(carregado, { por: texto(args.opcoes.por) });
    if (args.opcoes.json === true) console.log(JSON.stringify(devolvidas, null, 2));
    else console.log(textoDoReap(devolvidas));
    return 0;
  }
  if (sub !== undefined && sub !== 'list') {
    console.error(`subcomando desconhecido: board ${sub}`);
    console.error('uso: ork board [list|plan|reap] [--all] [--por <quem>] [--json]');
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
      console.log(`Outras maquinas: o projeto ${carregado.manifesto.project.name} nao tem o remoto ${carregado.manifesto.fabrica.remoto}; nada foi lido de ork/fabrica-estado.`);
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
  const remoto = texto(args.opcoes.remoto) ?? carregado.manifesto.fabrica.remoto;
  if (sub === 'publicar') {
    const silencioso = args.opcoes.silencioso === true;
    try {
      const r = publicarMaquina(carregado, { remoto, forcar: args.opcoes.forcar === true });
      if (silencioso) { registrarPublicacao(carregado.raiz, { ...r }); return 0; }
      if (args.opcoes.json === true) console.log(JSON.stringify(r, null, 2));
      else console.log(r.acao === 'publicou'
        ? `Fabrica: ${r.maquina} publicou ${r.threads} thread(s) em ork/fabrica-estado (${r.commit?.slice(0, 7)}, ${r.tentativas} tentativa(s)).`
        : r.acao === 'ocupado'
          ? `Fabrica: outra publicacao desta maquina esta em andamento; tente de novo em instantes.`
          : `Fabrica: retrato de ${r.maquina} igual ao ultimo publicado; nada a enviar (use --forcar para publicar mesmo assim).`);
      if (!fabricaCompartilhada(carregado.manifesto) && !silencioso) {
        console.log('  esta maquina nao entrou na fabrica compartilhada: so publica quando voce pede (ork fabrica entrar liga).');
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
    console.log(`Fabrica: esta maquina entrou como ${config.nome}; publica ao criar thread, despachar fase, entregar e fechar,`);
    console.log(`  e a cada batida do pulse. Primeiro retrato: ${r.threads} thread(s) em ork/fabrica-estado (${r.commit?.slice(0, 7)}).`);
    if (process.env.ORK_MAQUINA && process.env.ORK_MAQUINA.trim() !== config.nome) {
      console.log(`  AVISO: ORK_MAQUINA=${process.env.ORK_MAQUINA} neste shell vence o arquivo; alinhe os dois.`);
    }
    return 0;
  }
  if (sub === 'sair') {
    const config = gravarConfigDaMaquina({ fabricaCompartilhada: false });
    const r = removerMaquina(carregado, { remoto });
    console.log(`Fabrica: ${nomeDaMaquina()} saiu; nada mais e publicado daqui.` +
      (r ? ` Retrato removido de ork/fabrica-estado (${r.slice(0, 7)}).` : ' Nao havia retrato desta maquina na branch.'));
    if (fabricaCompartilhada(carregado.manifesto)) console.log('  AVISO: o manifesto do projeto (ou ORK_FABRICA_COMPARTILHADA) ainda liga a fabrica aqui.');
    void config;
    return 0;
  }
  if (sub !== undefined && sub !== 'list') {
    console.error(`subcomando desconhecido: fabrica ${sub}`);
    console.error('uso: ork fabrica [--json] [--sem-remoto] | fabrica publicar [--forcar] [--json] | fabrica entrar [--maquina NOME] | fabrica sair');
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
    console.log(JSON.stringify({ ...painel, consulta }, null, 2));
    return 0;
  }
  console.log([...linhasDaConsulta(consulta), ''].join('\n'));
  console.log(url === null
    ? `Fabrica: o projeto ${carregado.manifesto.project.name} nao tem o remoto ${remoto}; nada foi lido de ork/fabrica-estado.`
    : textoDaFabrica(painel, nomeDaMaquina()));
  return 0;
}

/**
 * RM-052: `ork projetos` lista o registro desta maquina (`~/.orkastery/projetos.json`); `registrar`
 * poe uma copia que ja existia antes do registro (init, thread new e fabrica entrar ja registram) e
 * `esquecer` tira a copia que sumiu ou sobrou. Sem segredo: so nome, abbrev, raiz e remoto redigido.
 */
function comandoProjetos(args: Args, projeto: string | undefined): number {
  const sub = args.posicionais[1] ?? 'list';
  if (sub === 'list' || sub === 'listar') {
    const projetos = listarProjetos();
    if (args.opcoes.json === true) {
      console.log(JSON.stringify({ contrato: CONTRATO_PROJETOS, arquivo: caminhoDoRegistro(), projetos }, null, 2));
      return 0;
    }
    console.log(`Projetos conhecidos desta maquina (${raizParaExibir(caminhoDoRegistro())})`);
    console.log('');
    if (projetos.length === 0) {
      console.log('  Nenhum ainda. ork init, ork thread new e ork fabrica entrar registram; ou: ork projetos registrar <caminho>');
      return 0;
    }
    console.log(tabela(['NOME', 'ABBREV', 'RAIZ', 'REMOTO', 'NO DISCO', 'ATUALIZADO'], projetos.map((p) => [
      p.nome, p.abbrev || '-', raizParaExibir(p.raiz), p.remoto ?? 'sem remoto', p.presente ? 'sim' : 'ausente',
      formatarDataHora(p.atualizadoEm)])));
    console.log('');
    console.log('Use --projeto <nome> em qualquer comando (ORK_PROJETO vale para o shell inteiro). ' + legendaDoFuso());
    return 0;
  }
  if (sub === 'registrar') {
    const caminho = args.posicionais[2];
    if (caminho !== undefined && projeto !== undefined) throw new Error('uso: ork projetos registrar [caminho] (um caminho ou --projeto, não os dois)');
    const alvo = caminho === undefined ? resolverProjetoAlvo({ opcao: projeto ?? null }) : null;
    const p = registrarProjeto(caminho ?? alvo?.raiz ?? process.cwd(), 'projetos registrar');
    if (args.opcoes.json === true) { console.log(JSON.stringify(p, null, 2)); return 0; }
    console.log(`Projeto ${p.nome} (${p.abbrev || '-'}) registrado: ${raizParaExibir(p.raiz)} · ${p.remoto ?? 'sem remoto'}`);
    return 0;
  }
  if (sub === 'esquecer') {
    const alvo = args.posicionais[2] ?? projeto;
    if (!alvo) throw new Error('uso: ork projetos esquecer <nome|caminho>');
    const sairam = esquecerProjeto(alvo);
    if (args.opcoes.json === true) { console.log(JSON.stringify(sairam, null, 2)); return 0; }
    for (const p of sairam) console.log(`Projeto ${p.nome} esquecido: ${raizParaExibir(p.raiz)} (nada no disco foi apagado)`);
    return 0;
  }
  console.error(`subcomando desconhecido: projetos ${sub}`);
  console.error('uso: ork projetos [--json] | projetos registrar [caminho] | projetos esquecer <nome|caminho>');
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
  if (sub !== undefined && sub !== 'status') {
    console.error(`subcomando desconhecido: orquestracao ${sub}`);
    console.error('uso: ork orquestracao status [--all] [--json] [--atencao N] [--so-paradas]');
    return 2;
  }
  const bruto = texto(args.opcoes.atencao);
  const atencaoMin = bruto === undefined ? undefined : Number(bruto);
  if (atencaoMin !== undefined && (!Number.isFinite(atencaoMin) || atencaoMin < 0)) {
    console.error(`--atencao espera minutos (inteiro >= 0), recebeu "${bruto}"`);
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

function comandoWorktree(args: Args): number {
  const carregado = exigirManifesto();
  const sub = args.posicionais[1];
  const id = args.posicionais[2];
  if (!sub || !id) {
    console.error('uso: ork worktree <ensure|sync|audit|release> <thread-id>');
    return 2;
  }
  if (sub === 'ensure') {
    const r = garantirWorktree(carregado, id);
    if (!r.ok) {
      console.error(`Worktree da thread ${id} NAO garantida.`);
      console.error(`  motivo tipado: ${r.motivo}`);
      console.error(`  detalhe: ${r.detalhe}`);
      console.error(`  correcao: ${r.correcao}`);
      return 1;
    }
    console.log(r.criada ? `Worktree criada para a thread ${id}.` : `Worktree ja existia para a thread ${id}.`);
    console.log(`  dir     ${r.dir}`);
    console.log(`  branch  ${r.branch}`);
    console.log(`  base    ${r.base} (resolvida pelo ork, nao pelo executor)`);
    console.log(`  ${r.detalhe}`);
    return 0;
  }
  if (sub === 'sync') {
    const r = sincronizarWorktree(carregado, id, { dryRun: args.opcoes['dry-run'] === true });
    if (!r.ok) {
      console.error(`Sync da worktree da thread ${id} BLOQUEADO.`);
      console.error(`  motivo tipado: ${r.motivo}`);
      console.error(`  detalhe: ${r.detalhe}`);
      console.error(`  correcao: ${r.correcao}`);
      return 1;
    }
    console.log(r.dryRun ? `Sync (--dry-run) da thread ${id}: nada foi executado.` : `Sync da thread ${id}.`);
    console.log(`  base       ${r.base} @ ${r.shaBase.slice(0, 8)}`);
    console.log(`  branch     ${r.branch} @ ${r.shaAntes.slice(0, 8)} -> ${r.shaDepois.slice(0, 8)}`);
    console.log(`  rebase     ${r.rebaseFeito ? 'feito' : r.jaAtualizada ? 'desnecessario' : 'seria feito'}`);
    console.log(`  ${r.detalhe}`);
    if (r.passos.length > 0) {
      console.log('');
      console.log('  Comandos reais, na ordem:');
      for (const passo of r.passos) console.log(`    ${passo}`);
    }
    return 0;
  }
  if (sub === 'audit') {
    const r = auditarWorktree(carregado, id);
    console.log(textoDoAudit(id, r));
    return r.ok ? 0 : 1;
  }
  if (sub === 'release') {
    const r = liberarWorktree(carregado, id, { forcar: args.opcoes.forcar === true });
    if (!r.ok) {
      console.error(`Release da worktree da thread ${id} BLOQUEADO.`);
      console.error(`  motivo tipado: ${r.motivo}`);
      console.error(`  detalhe: ${r.detalhe}`);
      console.error(`  correcao: ${r.correcao}`);
      return 1;
    }
    console.log(`Worktree da thread ${id} liberada.`);
    console.log(`  dir      ${r.dir}`);
    console.log(`  removida ${r.removida ? 'sim' : 'nao (o diretorio ja nao existia)'}`);
    console.log(`  leases   ${r.leasesLiberados.join(', ') || '(nenhum lease de escrita para soltar)'}`);
    console.log(`  ${r.detalhe}`);
    return 0;
  }
  console.error(`subcomando desconhecido: worktree ${sub}`);
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
    if (!id || !['telegram', 'terminal', 'json'].includes(formato)) throw new Error('uso: ork master pedir <thread> [--formato telegram|terminal|json]');
    const pedido = pedirNota(carregado.raiz, id, { codigosEmUso: codigosEmUso(carregado.raiz) });
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
    if (sub !== 'enviar') throw new Error('uso: ork master digest <enviar|preview|responder>');
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
      if (partes.length !== 4 || partes[0] !== 'ratificar' || !classe) throw new Error('resposta deve ser ratificar <thread> <assinatura> <classe>');
      selecao = [{ thread: partes[1], assinatura: partes[2], classe }];
    } else {
      selecao = (texto(args.opcoes.aceitar) ?? '').split(',').map(v => {
        const partes = v.trim().split(':');
        if (partes.length !== 2 || !/^[a-f0-9]{64}$/.test(partes[1])) throw new Error('seleção deve ser thread:assinatura');
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
    console.error(
      'master.fila-aposentada: a fila de ratificacao de score saiu na I-43. ' +
      'Entregue e aceito, a menos que voce diga o contrario.\n' +
      '  ork master                     as entregas, com o indice ja derivado do ledger\n' +
      '  ork master --aceitar-omissao   aceita as entregues, com indice e insumos no ledger\n' +
      '  ork master <id> --score <0-5> --justificativa "<por que>" --por <humano>   para reclamar'
    );
    return 2;
  }
  if (args.opcoes['aceitar-omissao'] === true) {
    const aceitos = aceitarPendentesPorOmissao(carregado.raiz);
    if (args.opcoes.json === true) { console.log(JSON.stringify(aceitos, null, 2)); return 0; }
    if (aceitos.length === 0) { console.log('Nenhuma entrega esperando decisao.'); return 0; }
    console.log(`Aceitas por omissao: ${aceitos.length}. O indice e os insumos foram ao ledger.`);
    for (const a of aceitos) console.log(`  ${a.thread.padEnd(20)} indice ${a.indice.valor}/${a.indice.base}`);
    console.log('');
    console.log('Discordou? A nota humana sobrescreve, e o registro da omissao permanece.');
    return 0;
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
  if (!id) throw new Error('informe a thread para propor MASTER');
  const brutoScore = texto(args.opcoes.score);
  const justificativa = texto(args.opcoes.justificativa) ?? texto(args.opcoes.porque);
  if (brutoScore === undefined) {
    console.error('uso: ork master <thread-id> --score 0-5 --justificativa "<texto>"');
    console.error('  o score do MASTER e humano, de 0 a 5, e a justificativa e obrigatoria.');
    return 2;
  }
  if (!justificativa) {
    console.error(`Score RECUSADO para a thread ${id}: falta --justificativa "<texto>".`);
    console.error('  Score sem justificativa nao vira aprendizado; o `ork` nao o registra.');
    console.error(`  ork master ${id} --score ${brutoScore} --justificativa "<por que este score>"`);
    return 2;
  }
  const brutasClasses = texto(args.opcoes.classe) ?? texto(args.opcoes.classes);
  const classes: ClasseDeFalha[] = [];
  for (const bruta of (brutasClasses ?? '').split(',').map((c) => c.trim()).filter(Boolean)) {
    const classe = parseClasse(bruta);
    if (!classe) {
      console.error(`classe de falha invalida: "${bruta}".`);
      console.error(`  classes fixas: ${ORDEM_DAS_CLASSES.join(', ')}`);
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
    console.log(`Proposta de policy: ${p.chave} em ${p.threads.length} threads nos ultimos ${p.janelaDias} dias.`);
    console.log(`  ${p.sugestao}`);
    console.log('  So proposta: vira policy quando voce a declara em policies: no orkastery.yaml (ork licoes).');
  }
  console.log('');
  console.log(`Proximo passo: ork board --all   |   entregas e indice: ork master`);
  return 0;
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
      const soltas = soltarReservasOrfas(carregado.raiz, { remoto });
      if (args.opcoes.json === true) console.log(JSON.stringify(soltas, null, 2));
      else console.log(soltas.length === 0 ? 'Nenhuma reserva órfã desta máquina.'
        : soltas.map((s) => `${s.item}: ${s.detalhe} (thread fechada ${s.thread})`).join('\n'));
      return 0;
    }
    const painel = listarReservas(carregado.raiz, { remoto });
    const orfas = reservasOrfas(carregado.raiz, painel.reservas);
    console.log(args.opcoes.json === true ? JSON.stringify({ ...painel, orfas }, null, 2) : textoDasReservas(painel, orfas));
    return 0;
  }
  if (sub === 'status') {
    // RM-048 (item 7): o status report unico do roadmap. Os canais chamam isto e transportam o texto.
    // RM-052: com o projeto consultado e o que ficou de fora (as outras maquinas nao sao lidas aqui).
    const consulta = consultaDoProjeto(carregado, { lido: ['roadmap (docs/roadmap)', FORA_DA_CONSULTA.threadsDaMaquina],
      naoLido: [FORA_DA_CONSULTA.reservas, 'threads de outras máquinas (ork network roadmap)'] });
    const status = montarStatusDoRoadmap(carregado.raiz, { projeto: carregado.manifesto.project.name, consulta });
    console.log(args.opcoes.json === true ? JSON.stringify(status, null, 2) : textoDoStatusDoRoadmap(status));
    return 0;
  }
  // RM-037 (rm037noite, defeito 6): o numero da FEAT nova sai da mesma branch de reservas.
  if (sub === 'feat') {
    const r = reservarFeat(carregado.raiz, { remoto, por: texto(args.opcoes.por), maquina: texto(args.opcoes.maquina),
      thread: texto(args.opcoes.thread) ?? null, nota: texto(args.opcoes.nota) ?? null });
    if (args.opcoes.json === true) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(`${r.feat}: reservado para esta maquina${r.reserva.thread ? `, thread ${r.reserva.thread}` : ''}.`);
      console.log(`  crie docs/produto/${r.feat}-<assunto>.md; o numero nao volta, mesmo que a feature nao saia`);
      console.log(`  branch ork/roadmap-reservas em ${r.commit.slice(0, 7)}`);
    }
    return 0;
  }
  const item = args.posicionais[2];
  if ((sub !== 'pegar' && sub !== 'soltar') || !item) {
    console.error('uso: ork roadmap status [--json] | reservas [--soltar-orfas] | pegar <RM-NNN> [--thread T] [--nota N] | ' +
      'soltar <RM-NNN> [--forcar --motivo M] | feat [--thread T] [--nota N]');
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
  const r = sub === 'pegar' ? pegarItem(carregado.raiz, item, opcoes) : soltarItem(carregado.raiz, item, opcoes);
  if (args.opcoes.json === true) {
    console.log(JSON.stringify(r, null, 2));
    return 0;
  }
  const verbo = { pegou: 'reservado para esta maquina', renovou: 'reserva renovada', tomou: 'reserva TOMADA de outra maquina',
    soltou: 'devolvido', nada: 'ja estava livre' }[r.acao];
  console.log(`${r.item}: ${verbo}.`);
  if (r.reserva && r.acao !== 'soltou') console.log(`  com ${r.reserva.por} em ${r.reserva.maquina}${r.reserva.thread ? `, thread ${r.reserva.thread}` : ''}`);
  if (r.commit) console.log(`  branch ork/roadmap-reservas em ${r.commit.slice(0, 7)}`);
  return 0;
}

/**
 * RM-054 (fatia 1): `ork network roadmap`, o roadmap da rede de qualquer diretorio. Pedido de projeto
 * ambiguo ou desconhecido e resposta, nao erro: a recusa com os candidatos, e o codigo da RM-052.
 */
function comandoNetwork(args: Args): number {
  const pedido = texto(args.opcoes.projeto);
  if (args.posicionais[1] !== 'roadmap' || args.posicionais.length > 2 || (args.opcoes.projeto !== undefined && !pedido)) {
    console.error('uso: ork network roadmap [--projeto <caminho|github:dono/repo|gitlab:grupo/repo|nome>] [--json] [--sem-remoto]');
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

function comandoDocs(args: Args): number {
  const sub = args.posicionais[1] ?? 'verificar';
  const carregado = carregarManifesto();
  const raiz = carregado?.raiz ?? diretorioDoProjeto();
  const baseBranch = carregado?.manifesto.worktree?.base_branch ?? 'main';

  if (sub === 'verificar') {
    const { docs, achados } = verificarDocs(raiz, { baseBranch, ajudaDoCli: AJUDA });
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
      console.error('uso: ork docs sincronizar --so RM-NNN[,RM-MMM] (faltou o item depois de --so)');
      return 2;
    }
    const so = texto(args.opcoes.so);
    let itens: string[] | undefined;
    let escopo = 'todo item do roadmap';
    if (so) {
      itens = so.split(',').map((i) => i.trim().toUpperCase()).filter(Boolean);
      const fora = itens.filter((i) => !/^RM-\d{3}$/.test(i));
      if (fora.length || itens.length === 0) {
        console.error(`uso: ork docs sincronizar --so RM-NNN[,RM-MMM] (recebido: ${so})`);
        return 2;
      }
      escopo = `so ${itens.join(', ')} (--so)`;
    } else if (args.opcoes.todos !== true) {
      const padrao = escopoPadraoDoSync(raiz);
      if (padrao.itens) {
        itens = padrao.itens;
        escopo = `so ${itens.join(', ')}, o item da thread ${padrao.thread} desta worktree (--todos para todo item)`;
      }
    }
    const r = sincronizarDocs(raiz, { baseBranch, escrever, itens });
    console.log(args.opcoes.json === true ? JSON.stringify({ ...r, escopo: itens ?? null }, null, 2)
      : `Escopo: ${escopo}.\n${textoDaSincronizacao(r, escrever)}`);
    return 0;
  }
  if (sub === 'init') {
    const criados = iniciarDocs(raiz);
    console.log(criados.length === 0
      ? 'Documentacao como codigo ja estava no projeto: nada criado.'
      : ['Criado:', ...criados.map((c) => `  ${c}`), '',
        'Proximo passo: copie docs/produto/_modelo-feature.md e docs/roadmap/_modelo-item.md, e rode ork docs verificar'].join('\n'));
    return 0;
  }
  console.error(`uso: ork docs verificar [--json] | sincronizar [--escrever] [--so RM-NNN] [--todos] | init`);
  return 2;
}

function comandoPrompt(args: Args): number {
  const sub = args.posicionais[1] ?? 'list';
  const carregado = carregarManifesto();
  const raiz = carregado?.raiz;

  if (sub === 'list') {
    console.log(tabelaDeTemplates(carregarTemplates(raiz)));
    return 0;
  }

  if (sub === 'lint') {
    const id = texto(args.opcoes.template);
    const templates = id ? [exigirTemplate(id, raiz)] : carregarTemplates(raiz);
    const problemas: ProblemaDeTemplate[] = templates.flatMap((t) => lintTemplate(t));
    console.log(`Lint dos templates de prompt${raiz ? ` (projeto ${raiz})` : ' (somente embutidos)'}`);
    console.log('');
    console.log(textoDoLint(problemas, templates.length));
    return problemas.some((p) => p.gravidade === 'erro') ? 2 : 0;
  }

  if (sub === 'render') {
    const fase = exigirFaseCanonica(texto(args.opcoes.fase) ?? args.posicionais[3]);
    const pedido = texto(args.opcoes.pedido) ?? '<pedido do builder>';
    const idTemplate = texto(args.opcoes.template);

    // Modo exemplo: renderiza sem thread nenhuma, para revisar o texto de um modo antes de
    // abrir trabalho. Nada e gravado, e o `ork` diz em voz alta que a thread e ficticia.
    if (args.opcoes.exemplo === true || args.opcoes.modo !== undefined || args.opcoes.mode !== undefined) {
      const bruto = texto(args.opcoes.modo) ?? texto(args.opcoes.mode) ?? 'classic';
      let modo: Modo;
      try { modo = exigirModoVivo(bruto); }
      catch (e) { console.error((e as Error).message); return 2; }
      const exemplo = threadDeExemplo(modo, fase, carregado?.manifesto.project);
      const template = idTemplate ? exigirTemplate(idTemplate, raiz) : templateDaFase(fase, raiz);
      const prompt = renderizar(template, valoresDoPrompt(exemplo, fase, pedido));
      console.log(`# template ${template.id} v${template.versao} (origem: ${template.origem})`);
      console.log(`# thread de EXEMPLO (nada foi gravado), modo ${MODOS[modo].tag}, sha256 ${hashDoPrompt(prompt)}`);
      console.log('');
      console.log(prompt);
      return 0;
    }

    const obrigatorio = exigirManifesto();
    const threadId = args.posicionais[2];
    if (!threadId) {
      console.error('uso: ork prompt render <thread-id> <FASE> --pedido "<texto>"');
      console.error('     ork prompt render --exemplo --fase GOAL --modo auto --pedido "<texto>"');
      return 2;
    }
    const thread = lerThread(obrigatorio.raiz, threadId);
    const template = idTemplate ? exigirTemplate(idTemplate, obrigatorio.raiz) : templateDaFase(fase, obrigatorio.raiz);
    const prompt = idTemplate
      ? renderizar(template, valoresDoPrompt(thread, fase, pedido))
      : montarPrompt(thread, fase, pedido, obrigatorio.raiz);
    console.log(`# template ${template.id} v${template.versao} (origem: ${template.origem})`);
    console.log(`# thread ${thread.id}, fase ${fase}, sha256 ${hashDoPrompt(prompt)}`);
    console.log('');
    console.log(prompt);
    return 0;
  }

  console.error(`subcomando desconhecido: prompt ${sub}`);
  return 2;
}

/** Fase canonica a partir do texto do usuario, com erro tipado quando nao existe. */
function exigirFaseCanonica(bruto: string | undefined): Fase {
  const alvo = (bruto ?? '').toUpperCase();
  if (!(FASES as readonly string[]).includes(alvo)) {
    throw new Error(`fase "${bruto ?? ''}" fora do ciclo canonico (${FASES.join(' ')})`);
  }
  return alvo as Fase;
}

/**
 * `ork adapter list|show|install <host>`: instalacao dos adaptadores de Camada 1 (bloco B4).
 */
function comandoAdapter(args: Args): number {
  const sub = args.posicionais[1] ?? 'list';

  if (sub === 'list') {
    console.log(tabelaDeHosts());
    return 0;
  }

  if (sub === 'show') {
    const host = parseHost(args.posicionais[2]);
    if (!host) {
      console.error(`host desconhecido: "${args.posicionais[2] ?? ''}". Use: ${ORDEM_DOS_HOSTS.join(' | ')}`);
      return 2;
    }
    const def = HOSTS[host];
    console.log(`Adaptador ${host}`);
    console.log(`  ${def.descricao}`);
    console.log(`  destino padrao: <projeto>/${def.destinoPadrao}${def.subdir ? '/' + def.subdir : ''}`);
    console.log('');
    console.log(textoDosPitfalls(host));
    return 0;
  }

  if (sub === 'install') {
    const host = parseHost(args.posicionais[2]);
    if (!host) {
      console.error(`host desconhecido: "${args.posicionais[2] ?? ''}". Use: ${ORDEM_DOS_HOSTS.join(' | ')}`);
      return 2;
    }
    const carregado = carregarManifesto();
    const r = instalarAdaptador(host, {
      projeto: carregado?.raiz ?? diretorioDoProjeto(),
      dir: texto(args.opcoes.dir),
      dryRun: args.opcoes['dry-run'] === true,
      force: args.opcoes.force === true || args.opcoes.forcar === true,
      orkBin: texto(args.opcoes.ork),
      versao: VERSAO,
      // I-43 (D5): a decisao por ARQUIVO, que e o que faz `--force` deixar de ser o
      // unico caminho de saida. `;` separa varios, como o resto do CLI ja faz.
      aceitarCatalogo: (texto(args.opcoes['aceitar-catalogo']) ?? '').split(';').map(x => x.trim()).filter(Boolean),
      manterCopia: (texto(args.opcoes['manter-copia']) ?? '').split(';').map(x => x.trim()).filter(Boolean),
    });
    console.log(textoDaInstalacao(r));
    return r.ok ? 0 : 2;
  }

  console.error(`subcomando desconhecido: adapter ${sub}`);
  return 2;
}

/**
 * `ork eval`: canarios de comportamento e o corpus das skills finas (bloco B4).
 *
 * Skill sem eval nao entra, e comportamento sem canario tambem nao. O comando sai diferente
 * de zero em qualquer falha, para o CI do kit poder barrar merge sem eval.
 */
function comandoEval(args: Args): number {
  const catalogo = exigirCatalogo(carregarManifesto()?.raiz ?? diretorioDoProjeto());
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
      console.error(`estagio invalido: "${bruto}". Use: nascente | crescendo | maduro`);
      return 2;
    }
    const pack = texto(args.opcoes.pack) ?? args.posicionais[2];
    if (pack) {
      const alvo = parsePack(pack);
      if (!alvo) {
        console.error(`pack desconhecido: "${pack}". Use um de: ${ORDEM_DOS_PACKS.join(', ')}`);
        return 2;
      }
      console.log(textoDoPack(alvo, estagio ?? undefined));
      return 0;
    }
    console.log(
      `Packs de auditoria periodica${estagio ? ` (estagio declarado do projeto: ${estagio})` : ''}`
    );
    console.log('');
    console.log(tabelaDePacks(estagio ?? undefined));
    if (estagio) {
      console.log('');
      console.log(`Ativos aqui e agora: ${packsAtivos(estagio).join(', ')}`);
      console.log(`Postura: ${posturaDoPack(estagio)}`);
    }
    return 0;
  }

  if (sub === 'lint') {
    const raiz = carregarManifesto()?.raiz;
    const templates = carregarTemplatesDeAuditoria(raiz);
    const problemas = templates.flatMap((t) => lintTemplateDeAuditoria(t));
    console.log(`Lint dos templates de auditoria${raiz ? ` (projeto ${raiz})` : ' (somente embutidos)'}`);
    console.log('');
    for (const p of problemas) {
      console.log(`  [${p.gravidade}] ${p.template} :: ${p.regra}`);
      console.log(`           ${p.detalhe}`);
    }
    if (problemas.length === 0) console.log(`  nenhum problema em ${templates.length} template(s)`);
    console.log('');
    console.log(
      `templates: ${templates.length} | erros: ${problemas.filter((p) => p.gravidade === 'erro').length} | ` +
        `avisos: ${problemas.filter((p) => p.gravidade === 'aviso').length}`
    );
    return problemas.some((p) => p.gravidade === 'erro') ? 2 : 0;
  }

  const carregado = exigirManifesto();

  if (sub === 'run') {
    const pack = parsePack(args.posicionais[2]);
    if (!pack) {
      console.error('uso: ork audit run <pack> [--profile P] [--since Nd]');
      console.error(`  packs: ${ORDEM_DOS_PACKS.join(', ')}`);
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
      console.error(`Rodada de auditoria ${r.id} BLOQUEADA.`);
      console.error(`  ${DESCRICAO_DO_MOTIVO_DE_AUDITORIA[r.motivo ?? 'runtime.unavailable']}`);
      console.error(`  motivo tipado: ${r.motivo}`);
      console.error(`  detalhe: ${r.detalhe}`);
      console.error(`  estado da rodada: .orkastery/audits/${r.id}/run.json`);
      return 1;
    }
    if (r.status === 'ensaio') {
      console.log(`Simulacao (--dry-run) da rodada ${r.id}: nada foi despachado.`);
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
          `              nada registrado no board (--dry-run). Para gravar: ork audit surface --registrar ${r.id}`
        );
      }
      return 0;
    }
    console.log(`Rodada de auditoria ${r.id} despachada pelo runtime adapter ${r.runtime}.`);
    console.log(`  pack        ${r.pack} (${PACKS[r.pack].titulo})`);
    console.log(`  produto     ${r.produto} (perfil ${r.perfil}), estagio ${r.estagio}, postura ${r.postura}`);
    console.log(`  escopo      ${r.escopo.detalhe}`);
    console.log(`  graphify    ${r.escopo.graphify}`);
    console.log(`  custo       effort ${r.custo.effort}, model ${r.custo.model}`);
    console.log(`  janela      ${r.custo.janela.detalhe}`);
    console.log(`  sessionId   ${r.sessionId}`);
    console.log(`  prompt      ${r.promptPath} (sha256 ${r.promptSha256})`);
    console.log(`  verificada no runtime: ${r.verificada ? 'sim' : 'NAO (confira `ork sessions`)'}`);
    if (r.superficie) {
      console.log(`  superficie  ${r.superficie.detalhe}`);
      console.log(
        `              ${r.superficie.registrados} achado(s) de superficie ja no board de divida` +
          (r.superficie.aConfirmar > 0
            ? `, ${r.superficie.aConfirmar} com confianca baixa (pedem confirmacao humana)`
            : '')
      );
    }
    console.log('');
    console.log('A rodada termina em PROPOSTA para o roadmap, nunca em correcao aplicada.');
    console.log(`Depois dos achados: ork audit verify ${r.id} && ork audit report ${r.id}`);
    return r.verificada ? 0 : 1;
  }

  if (sub === 'list') {
    console.log(tabelaDeRodadas(carregado.raiz));
    console.log('');
    console.log(`Board de divida: ${resumoDoBoard(carregado.raiz)}`);
    return 0;
  }

  if (sub === 'show') {
    const id = args.posicionais[2];
    if (!id) {
      console.error('uso: ork audit show <rodada> [--ledger]');
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
      console.error('uso: ork audit prompt <pack> [--since Nd]');
      console.error(`  packs: ${ORDEM_DOS_PACKS.join(', ')}`);
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
      console.error('uso: ork audit ingest <rodada> --arquivo <achados.json>');
      return 2;
    }
    const r = ingerirAchados(carregado, id, arquivo);
    console.log(`Ingestao da rodada ${r.rodada}: ${r.registrados.length} achado(s) no board de divida.`);
    // Bloco B6: cada proposta enderecada ao roadmap tambem vai para a colecao `roadmap`.
    if (r.registrados.length > 0) {
      const naMemoria = publicarPropostas(carregado, r.registrados);
      if (naMemoria.regime === 'orkmind') {
        console.log(`Memoria (orkmind): propostas na colecao roadmap, ${naMemoria.detalhe}.`);
      }
    }
    for (const a of r.registrados) {
      console.log(textoDoAchado(a));
    }
    if (r.duplicados.length > 0) {
      console.log('');
      console.log(
        'Ja registrados nesta rodada, ignorados (a ingestao e idempotente): ' +
          r.duplicados.map((a) => a.id).join(', ')
      );
    }
    if (r.recusados.length > 0) {
      console.log('');
      console.error(`RECUSADOS (${r.recusados.length}):`);
      for (const rec of r.recusados) {
        console.error(`  achado #${rec.indice + 1}: ${rec.erro}`);
      }
    }
    console.log('');
    console.log(`Prove os achados antes de qualquer thread: ork audit verify ${r.rodada}`);
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
      console.log(`Achado ${achado.id} registrado no board de divida da rodada ${id}.`);
      console.log(textoDoAchado(achado));
      const naMemoria = publicarPropostas(carregado, [achado]);
      if (naMemoria.regime === 'orkmind') {
        console.log(`Memoria (orkmind): proposta na colecao roadmap, ${naMemoria.detalhe}.`);
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
        console.error('o estado `virou-thread` e carimbado pelo proprio `ork thread new --from-finding`.');
        return 2;
      }
      const achado = exigirAchado(carregado.raiz, id);
      const atualizado = carimbarAchado(carregado.raiz, achado, { estado });
      console.log(`Achado ${atualizado.id} agora esta ${atualizado.estado}.`);
      console.log(textoDoAchado(atualizado));
      return 0;
    }
    console.error(`subcomando desconhecido: audit finding ${acao ?? ''}`);
    return 2;
  }

  if (sub === 'verify') {
    const id = args.posicionais[2];
    if (!id) {
      console.error('uso: ork audit verify <rodada>');
      return 2;
    }
    const v = verificarRodada(carregado, id);
    console.log(`Claims dos achados da rodada ${v.rodada}, reexecutadas no HEAD real.`);
    console.log(`  HEAD real   ${v.commit}`);
    console.log(`  diretorio   ${v.cwd}`);
    console.log('');
    if (v.resultados.length === 0) {
      console.log('  (nenhum achado aberto nesta rodada)');
    }
    for (const r of v.resultados) {
      console.log(`  ${r.claim.id}  verificado: ${r.verificado ? 'sim' : 'NAO'}  ${r.claim.alegacao}`);
      console.log(`      arquivo: ${r.claim.arquivo}`);
      console.log(
        `      ${r.claim.verificar.length > 0 ? `comando(s): ${r.claim.verificar.join(' && ')}` : 'sem comando de verificacao'}`
      );
      if (!r.verificado) console.log(`      motivo tipado: ${r.motivo} (${r.detalhe})`);
    }
    console.log('');
    console.log(
      v.ok
        ? 'Veredito: ACHADOS SUSTENTADOS (o auditor provou o que alegou).'
        : `Veredito: REPROVADO. Motivos tipados: ${v.motivos.join(', ')}`
    );
    if (v.motivos.includes('claims.unverifiable')) {
      console.log('  aviso: achado sem comando de verificacao avisa e nao bloqueia (regra do gate do B1).');
    }
    return v.ok ? 0 : 1;
  }

  if (sub === 'report' || sub === 'relatorio') {
    const id = args.posicionais[2];
    if (!id) {
      console.error('uso: ork audit report <rodada> [--publicar]');
      return 2;
    }
    const r = relatorioDaRodada(carregado, id, { publicar: args.opcoes.publicar === true });
    console.log(r.texto);
    console.log(`(relatorio gravado em ${r.caminho})`);
    if (r.publicado) console.log(`(publicado em ${r.publicado})`);
    return 0;
  }

  if (sub === 'divida' || sub === 'board') {
    const bruto = texto(args.opcoes.pack);
    const pack = bruto ? parsePack(bruto) : undefined;
    if (bruto && !pack) {
      console.error(`pack desconhecido: "${bruto}". Use um de: ${ORDEM_DOS_PACKS.join(', ')}`);
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
      console.error(`regra desconhecida: "${bruta}". Use uma de: ${REGRAS_DE_SUPERFICIE.join(', ')}`);
      return 2;
    }
    const regra = bruta ? (bruta.toUpperCase() as RegraDeSuperficie) : undefined;
    const limiteBruto = texto(args.opcoes.limite);
    const limite = limiteBruto ? Number(limiteBruto) : undefined;
    if (limite !== undefined && (!Number.isFinite(limite) || limite < 1)) {
      console.error(`--limite invalido: "${limiteBruto}". Use um inteiro >= 1.`);
      return 2;
    }

    const rodadaAlvo = texto(args.opcoes.registrar);
    if (rodadaAlvo) {
      const r = varrerSuperficieDaRodada(carregado, rodadaAlvo, { registrar: true, limitePorRegra: limite });
      console.log(textoDaVarredura(r.resultado));
      console.log('');
      console.log(`Rodada ${r.rodada}: ${r.registrados.length} achado(s) registrado(s) no board de divida.`);
      for (const a of r.registrados) console.log(`  ${a.id}  ${a.regra}  ${a.arquivo}:${a.linha}  ${a.titulo}`);
      if (r.duplicados.length > 0) {
        console.log(`  ja registrados nesta rodada: ${r.duplicados.map((a) => a.id).join(', ')}`);
      }
      for (const rec of r.recusados) {
        console.error(`  RECUSADO ${rec.achado.regra} ${rec.achado.arquivo}:${rec.achado.linha}: ${rec.erro}`);
      }
      console.log('');
      console.log(`Prove os achados antes de qualquer thread: ork audit verify ${r.rodada}`);
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

  console.error(`subcomando desconhecido: audit ${sub}`);
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
  if (r.publicacao?.estado === 'pendente') { console.log(`Memoria: publicacao pendente (${r.publicacao.motivo}); ativacao explicita necessaria.`); return; }
  if (r.regime !== 'orkmind') return;
  const gravados = [
    `${r.decisoes.gravadas.filter((g) => g.ok).length} decision`,
    `${r.policies.gravadas.filter((g) => g.ok).length} rule`,
    r.handoff?.ok ? '1 handoff' : '',
    r.learning?.ok ? '1 learning' : '',
    r.roadmap?.ok ? '1 roadmap' : '',
  ].filter((t) => t !== '');
  console.log('');
  console.log(`Memoria (orkmind, tenant ${r.estado.tenant}): ${gravados.join(', ') || 'nada a gravar'}.`);
  if (r.falhas > 0) console.log(`  ${r.falhas} gravacao(oes) nao concluida(s); veja ork memory status.`);
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
    console.error('uso: ork recall <thread-id> [--fase FASE] [--id ptr-N] [--todos] [--forcar]');
    return 2;
  }
  const thread = lerThread(carregado.raiz, id);
  const faseBruta = texto(args.opcoes.fase) ?? texto(args.opcoes.momento);
  const momento = faseBruta ? exigirFase(thread, faseBruta) : undefined;
  const memoria = abrirMemoria(carregado, { leituraRestrita: { thread: id, limite: limiteDeLeitura(args.opcoes.janela) } });
  const r = recallDaThread(carregado, memoria, id, {
    momento,
    id: texto(args.opcoes.id),
    todos: args.opcoes.todos === true,
    forcar: args.opcoes.forcar === true,
  });
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
  const escopo = texto(args.opcoes.escopo)?.split(',').map(s => s.trim());
  if (sub === 'inventory' || (sub === 'migrate' && args.opcoes['dry-run'] === true)) {
    const r = inventariarHandoffs(carregado, escopo);
    if (args.opcoes.json === true) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(`Inventario do tenant ${r.tenant}: ${r.incluidos} incluidos, ${r.excluidos} excluidos.`);
      for (const f of r.fontes) console.log(`  ${f.incluir ? 'incluir' : 'excluir'} ${f.arquivo}: ${f.motivo}`);
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
      console.log(`Migracao do tenant ${r.inventario.tenant}: ${r.resultados.filter(i => i.ok).length} confirmados, ${r.falhas} falhas, ${r.inventario.excluidos} excluidos.`);
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
        const detalhe = 'sync nao executado; colisao legada nao foi reavaliada';
        if (args.opcoes.json === true) console.log(JSON.stringify({
          regime: memoria.regime, estado: memoria.estado, thread: threadId ?? null, perfil,
          publicacao: { estado: 'pendente', motivo }, falhas: 1, gravadas: [], erro: motivo, detalhe,
        }, null, 2));
        console.error(`${motivo}: ${detalhe}`);
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
      console.error(
        'uso: ork memory search --tags \'{"project":["orkastery"],"skill":["orkastery-decision"]}\''
      );
      return 2;
    }
    let tags: Record<string, string[]>;
    try {
      tags = JSON.parse(tagsBrutas) as Record<string, string[]>;
    } catch (e) {
      console.error(`--tags nao e JSON valido: ${(e as Error).message}`);
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
    if (threadId && memoria.regime === 'files') console.error(`memory.query.files: ${memoria.estado.motivo}; resultado nao comprova ausencia na memoria semantica`);
    if (args.opcoes.json === true) {
      console.log(JSON.stringify(entradas, null, 2));
      return 0;
    }
    console.log(`Busca deterministica por tag (regime ${memoria.regime})`);
    console.log('');
    if (memoria.regime === 'files') {
      console.log(`  ${memoria.estado.detalhe}`);
      console.log(`  correcao: ${memoria.estado.correcao}`);
      return 0;
    }
    for (const e of entradas) {
      console.log(`  [${e.collection}] ${e.id}  ${e.priority}${e.mandatory ? ' [MANDATORY]' : ''}`);
      console.log(`      ${e.content.split('\n')[0].slice(0, 100)}`);
    }
    console.log('');
    console.log(`  ${entradas.length} entrada(s)`);
    return 0;
  }

  if (sub === 'index') {
    const modelo = texto(args.opcoes.modelo) ?? 'primario';
    if (!['primario', 'fallback', 'todos'].includes(modelo)) {
      console.error('uso: ork memory index [--modelo primario|fallback|todos] [--dry-run] [--json]');
      return 2;
    }
    const memoria = abrirMemoria(carregado);
    if (!memoria.ativo) {
      const falha = { motivo: memoria.estado.motivo, detalhe: memoria.estado.detalhe, correcao: memoria.estado.correcao };
      if (args.opcoes.json === true) console.log(JSON.stringify(falha, null, 2));
      else console.error(`memory.index: regime ${memoria.regime} (${memoria.estado.motivo}); ${memoria.estado.correcao}`);
      return 1;
    }
    const config = configDeEmbedding(carregado.manifesto);
    const driver = configDoManifesto(carregado.manifesto);
    const embedder = new DriverCliOrkMind(driver);
    const universo = universoDoTenant(memoria, memoria.estado.tenant);
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

  console.error(`subcomando desconhecido: memory ${sub}`);
  return 2;
}

/** Aviso informativo: não consulta rede, não reserva e não bloqueia criação. */
export function avisoRoadmapSemAssociacao(nome: string, roadmap?: string): string | null {
  const item = /\bRM-\d{3}\b/i.exec(nome)?.[0].toUpperCase();
  if (!item || roadmap) return null;
  return `Aviso: ${item} no nome não associa a thread ao roadmap. No terminal, consulte ork roadmap reservas e ork fabrica; para associar e reservar, use --roadmap ${item} em ork thread new. Nenhuma reserva foi criada por este aviso.`;
}

/**
 * `ork memory search --texto` (I-38 D7): busca por significado, separada da busca por tag.
 * Nao combina com --tags nem com a leitura restrita por thread nesta versao (erro tipado).
 */
function buscaPorTexto(args: Args, carregado: ManifestoCarregado): number {
  const frase = texto(args.opcoes.texto);
  if (args.opcoes.tags !== undefined || args.opcoes.thread !== undefined || args.opcoes.restrito !== undefined ||
      args.opcoes.janela !== undefined) {
    console.error('memory.search.texto-exclusivo: --texto nao combina com --tags, --thread, --restrito nem --janela');
    return 2;
  }
  const modo = (texto(args.opcoes.modo) ?? 'hibrido') as ModoDeBusca;
  const colecao = texto(args.opcoes.colecao) ?? texto(args.opcoes.collection);
  const limiteBruto = texto(args.opcoes.limite);
  const limite = limiteBruto === undefined ? LIMITE_PADRAO_DA_BUSCA : Number(limiteBruto);
  if (!textoDeBuscaValido(frase) || !MODOS_DE_BUSCA.includes(modo) ||
      (colecao !== undefined && !COLECOES_DO_ORK.includes(colecao as ColecaoDoOrk)) ||
      !Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO_DA_BUSCA) {
    console.error(`uso: ork memory search --texto "<frase>" [--modo ${MODOS_DE_BUSCA.join('|')}] [--colecao ${COLECOES_DO_ORK.join('|')}] [--limite 1..${LIMITE_MAXIMO_DA_BUSCA}] [--json]`);
    return 2;
  }
  const memoria = abrirMemoria(carregado);
  const config = configDeEmbedding(carregado.manifesto);
  let r: ResultadoDaBuscaSemantica;
  if (!memoria.ativo) {
    r = { texto: frase, modo, origem: 'nenhum', modeloUsado: null, deterministico: false, motivo: memoria.estado.motivo,
      detalhe: `${memoria.estado.detalhe}; correcao: ${memoria.estado.correcao}`, resultados: [], listas: { vetor: [], fts: [] } };
  } else {
    const driver = configDoManifesto(carregado.manifesto);
    const transporte = new DriverCliOrkMind(driver);
    const fallback = memoria.estado.embeddings?.fallback;
    r = buscarPorSignificado({ raiz: carregado.raiz, tenant: memoria.estado.tenant, dsn: driver.dsn, config,
      universo: universoDoTenant(memoria, memoria.estado.tenant, colecao ? [colecao as ColecaoDoOrk] : COLECOES_DO_ORK),
      texto: frase, modo, limite, timeoutMs: driver.timeoutMs,
      chavePresente: memoria.estado.embeddings?.chavePresente === true,
      fallbackUsavel: memoria.estado.embeddings?.sondado === true && fallback?.dependencias === true,
      embeddar: (p, o) => transporte.embeddar(p, o), buscarTexto: (t, q) => transporte.buscarTexto(t, q) });
  }
  if (args.opcoes.json === true) {
    console.log(JSON.stringify(r, null, 2));
    return 0;
  }
  console.log(`Busca por significado (NAO deterministica; modo ${r.modo}, origem ${r.origem}${r.modeloUsado ? ` ${r.modeloUsado}` : ''})`);
  if (r.motivo) console.log(`  motivo: ${r.motivo}${r.detalhe ? `; ${r.detalhe}` : ''}`);
  console.log('');
  r.resultados.forEach((e, i) => {
    const sim = e.similaridade === null ? '' : `  similaridade ${e.similaridade}`;
    console.log(`  ${i + 1}. [${e.collection}] ${e.id}  score ${e.score}  ${e.fontes.join('+')}${sim}`);
    console.log(`      ${e.resumo}`);
  });
  console.log('');
  console.log(`  ${r.resultados.length} resultado(s); busca por tag continua em ork memory search --tags`);
  return 0;
}

/** Texto de `ork memory index`: o que foi (ou seria) embedado e quanto custa estimado. */
function textoDoIndice(r: ResultadoDoIndice): string {
  const custo = r.custoEstimadoUsd === null ? 'nao estimado' : `US$ ${r.custoEstimadoUsd.toFixed(8)}`;
  return [
    `Indice vetorial (${r.alvo}${r.dryRun ? ', --dry-run' : ''}): ${r.modelo ?? '(sem modelo)'}${r.dim ? ` / ${r.dim} dim` : ''}`,
    `  universo do tenant   ${r.universo} entrada(s); coerentes ${r.coerentes}`,
    `  embedados            ${r.embedados} (reescritos ${r.reescritos}); removidos ${r.removidos}`,
    `  fora do indice       ${r.recusados} recusada(s) por padrao de segredo, ${r.foraDoLimite} acima do limite`,
    ...(r.truncados ? [`  truncados            ${r.truncados} acima do contexto do modelo local, embedados pelo comeco`] : []),
    `  estimativa           ${r.tokensEstimados} token(s), ${custo}; chamadas ao provider ${r.chamadasAoProvider}`,
    ...(r.arquivo ? [`  arquivo              ${r.arquivo}`] : []),
    ...(r.motivo ? [`  motivo               ${r.motivo}: ${r.detalhe}`] : r.detalhe ? [`  ${r.detalhe}`] : []),
  ].join('\n');
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
const COMANDOS_SEM_PROJETO = new Set(['demo', 'ciclos', 'mcp', 'init', 'projetos']);

/**
 * Comandos cujo `--projeto` e DELES (RM-054: `ork network roadmap --projeto github:dono/repo`, que
 * le varios projetos). A opcao volta intacta ao argv do subcomando e o alvo global nao e resolvido:
 * nem `--projeto`, nem `ORK_PROJETO`, nem o modo host escolhem um projeto por eles.
 */
export const COMANDOS_COM_PROJETO_PROPRIO: ReadonlySet<string> = new Set(['network']);

/** Resolve e fixa o projeto-alvo do processo (D2, D3). `null`: vale o cwd de sempre. */
function fixarAlvoDoProcesso(projeto: string | undefined): ProjetoAlvo | null {
  const alvo = resolverProjetoAlvo({ opcao: projeto ?? null });
  fixarProjetoAlvo(alvo);
  return alvo;
}

export function main(argvBruto: string[]): number {
  // I-35: todo horário para pessoa sai no fuso do dono deste projeto (lido só se for preciso, e já
  // depois de o projeto-alvo abaixo estar fixado: a fonte é preguiçosa).
  registrarFonteDoFuso(() => fusoDoManifesto(carregarManifesto()));
  // RM-052: sem alvo herdado de uma chamada anterior no mesmo processo (os testes chamam `main` em serie).
  fixarProjetoAlvo(null);
  const extraida = extrairOpcaoDeProjeto(argvBruto);
  const proprio = COMANDOS_COM_PROJETO_PROPRIO.has(parseArgs(extraida.argv).posicionais[0] ?? '');
  const argv = proprio && extraida.projeto !== undefined
    ? [...extraida.argv, ...(extraida.projeto ? ['--projeto', extraida.projeto] : ['--projeto'])] : extraida.argv;
  const projeto = proprio ? undefined : extraida.projeto;
  // Helper fixo do host confiável: o projeto vem da instalação, nunca de toolargs.
  if (argv[0] === 'receipt-verifiers') {
    if (argv.length !== 2 || argv[1] !== '--json' || projeto !== undefined) throw Error('uso: ork receipt-verifiers --json');
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
    if (argv.length === 2 && argv[1] === '--help') return runMaestroCli(argv.slice(1));
    // RM-052: o alvo explicito vira SELECAO entre as raizes permitidas; sem ele, o cwd de sempre.
    const alvo = fixarAlvoDoProcesso(projeto);
    return alvo ? runMaestroCli(argv.slice(1), alvo.raiz, { allowedRoots: [alvo.raiz], selected: alvo.raiz })
      : runMaestroCli(argv.slice(1));
  }
  const args = parseArgs(argv);
  const comando = args.posicionais[0];

  // `ork --version` tambem chega sem comando: a versao e conferida antes da ajuda.
  if (args.opcoes.version === true || comando === 'version') {
    console.log(VERSAO);
    return 0;
  }
  if (!comando || args.opcoes.help === true || comando === 'help') {
    console.log(AJUDA);
    return 0;
  }
  if (!COMANDOS_SEM_PROJETO.has(comando) && !proprio) fixarAlvoDoProcesso(projeto);
  else if (projeto !== undefined && comando !== 'projetos') {
    throw new Error(comando === 'init'
      ? 'uso: ork init cria o projeto no diretório atual; entre nele e rode ork init, sem --projeto'
      : comando === 'mcp' ? 'uso: o servidor MCP recebe a raiz por --project <raiz absoluta>, não por --projeto'
        : `uso: ork ${comando} não lê projeto; tire --projeto`);
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

  switch (comando) {
    case 'mcp': {
      const projeto=texto(args.opcoes.project), host=texto(args.opcoes.host),threadId=texto(args.opcoes.thread);
      // I-36 (D4): a identidade do despacho so chega com a thread vinculada da sessao filha.
      const dispatchId=texto(args.opcoes.dispatch);
      const transporteShip=texto(args.opcoes['ship-transport'])??'github-ssh';
      const permissoesFilho=texto(args.opcoes['child-permissions'])??'interactive';
      const permissoesDono=texto(args.opcoes['owner-permissions']);
      const acao=args.posicionais[1];
      if(args.posicionais.length!==2 || !['serve','install'].includes(acao) || !projeto ||
          (host!=='codex' && host!=='claude-code') ||
          Object.keys(args.opcoes).some(k=>!['project','host','ship-transport','child-permissions',...(acao==='install'?['dry-run','owner-permissions']:['thread','dispatch'])].includes(k)) ||
          (args.opcoes.dispatch!==undefined && (!threadId || !dispatchId || !/^[a-f0-9-]{36}$/.test(dispatchId))) ||
          argv.filter(a=>a==='--ship-transport' || a.startsWith('--ship-transport=')).length>1 ||
          argv.filter(a=>a==='--child-permissions' || a.startsWith('--child-permissions=')).length>1 ||
          (args.opcoes['owner-permissions']!==undefined && (host!=='codex' || typeof args.opcoes['owner-permissions']!=='string' || !['interactive','orchestrate'].includes(permissoesDono??''))) ||
          argv.filter(a=>a==='--owner-permissions' || a.startsWith('--owner-permissions=')).length>1 ||
          !['interactive','worktree'].includes(permissoesFilho) ||
          (args.opcoes['child-permissions']!==undefined && typeof args.opcoes['child-permissions']!=='string') ||
          !['github-ssh','bare-local'].includes(transporteShip) ||
          (args.opcoes['ship-transport']!==undefined && typeof args.opcoes['ship-transport']!=='string') ||
          (args.opcoes.thread!==undefined && (!threadId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(threadId))) ||
          (args.opcoes['dry-run']!==undefined && args.opcoes['dry-run']!==true))
        throw new Error('uso: ork mcp serve|install --project <raiz absoluta> --host codex|claude-code [--ship-transport github-ssh|bare-local] [--child-permissions interactive|worktree] [--owner-permissions interactive|orchestrate somente install Codex] [--dry-run somente install]');
      if(acao==='install') {
        void import('./mcp-install').then(({instalarMcp,textoInstalacaoMcp})=>
          console.log(textoInstalacaoMcp(instalarMcp({projeto,host,dryRun:args.opcoes['dry-run']===true,transporteShip:transporteShip as 'github-ssh'|'bare-local',permissoesFilho:permissoesFilho as 'interactive'|'worktree',permissoesDono:permissoesDono as 'interactive'|'orchestrate'|undefined}))))
          .catch(e=>{console.error(`mcp: ${(e as Error).message}`);process.exitCode=1;});
        return 0;
      }
      void import('./mcp-server').then(({servirMcp})=>servirMcp({projeto,host,threadId,dispatchId,nomesProviderHerdados:nomesHerdados,transporteShip:transporteShip as 'github-ssh'|'bare-local',permissoesFilho:permissoesFilho as 'interactive'|'worktree'})).catch(e=>{console.error(`mcp: ${(e as Error).message}`);process.exitCode=1;});
      return 0;
    }
    case 'doctor': {
      if(args.opcoes.modo!==undefined) {
        const bruto=texto(args.opcoes.modo);
        if(args.posicionais.length!==1 || !bruto ||
            Object.keys(args.opcoes).some(k=>k!=='modo') || argv.filter(a=>a==='--modo' || a.startsWith('--modo=')).length!==1)
          throw Error(`uso: ork doctor --modo ${ORDEM_DOS_MODOS.join('|')}`);
        const r=preflight(diretorioDoProjeto(),exigirModoVivo(bruto),nomesHerdados);console.log(textoPreflight(r));return r.prontoPrimeiroBloco?0:1;
      }
      const r = doctor(diretorioDoProjeto(), nomesHerdados);
      console.log(r.texto);
      return r.codigo;
    }
    case 'init': {
      const r = init(process.cwd(), {
        force: args.opcoes.force === true,
        nome: texto(args.opcoes.name) ?? texto(args.opcoes.nome),
        abbrev: texto(args.opcoes.abbrev),
      });
      const carregado = exigirManifesto(r.deteccao.raiz);
      const agents = atualizarAgentsMd(r.deteccao.raiz, carregado.manifesto);
      // RM-052 (D7): o projeto entra no registro desta maquina; falha vira aviso, nunca derruba o init.
      const avisoDoRegistro = registrarProjetoEmSilencio(r.deteccao.raiz, 'init');
      if (avisoDoRegistro) console.error(avisoDoRegistro);
      if (!r.criado) {
        console.log(`Manifesto ja existe: ${r.caminho}`);
        console.log('Nada foi sobrescrito. Use --force para regerar.');
        console.log(`AGENTS.md ${agents.estado}: ${agents.caminho}`);
        return 0;
      }
      console.log(`Manifesto criado: ${r.caminho}`);
      console.log(`  projeto     ${r.deteccao.nome} (abbrev "${r.deteccao.abbrev}")`);
      console.log(`  branch base ${r.deteccao.baseBranch}`);
      console.log(`  gerenciador ${r.deteccao.gerenciador}`);
      console.log(`  verify      ${Object.entries(r.deteccao.verify).map(([k, v]) => `${k}="${v}"`).join(', ') || '(nenhum script detectado)'}`);
      console.log(`  AGENTS.md   ${agents.estado}: ${agents.caminho}`);
      console.log('');
      console.log(PROXIMO_PASSO_INIT);
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
            Object.values(args.opcoes).some(v => v !== true)) throw Error('uso: ork experiencia uninstall claude-code|codex [--dry-run] [--json]');
        const r = desinstalarExperiencia(exigirManifesto().raiz, host as 'claude-code' | 'codex', args.opcoes['dry-run'] === true);
        console.log(args.opcoes.json ? JSON.stringify(r, null, 2) :
          `${r.dryRun ? 'Simulação de remoção' : 'Remoção concluída'}: ${r.arquivos.length} arquivo(s). O adaptador permanece instalado. Para manter o pacote desativado, configure owner.experience:false no onboarding.`);
        return 0;
      }
      if ((args.posicionais[1] ?? 'show') !== 'show' || args.posicionais.length > 2 ||
          Object.keys(args.opcoes).some(k => k !== 'json') || ('json' in args.opcoes && args.opcoes.json !== true)) {
        throw Error('uso: ork experiencia show [--json]');
      }
      const manifesto = exigirManifesto(), p = resolverExperiencia(manifesto.manifesto.owner);
      // Preferência inválida vale o padrão e faz o adapter install pular o pacote: a consulta avisa.
      const avisos = manifesto.avisos.filter(a => a.startsWith('experiencia.config.invalid'));
      console.log(args.opcoes.json ? JSON.stringify({ ...p, avisos }, null, 2) :
        `Experiência ${p.experience ? 'ativa' : 'desativada'}: ${p.language}, ${p.timezone}, profundidade ${p.depth}.\nSkill: ${p.skill}\nOrigens: ${JSON.stringify(p.origem)}` +
        avisos.map(a => `\nAviso: ${a}; o adapter install pula o pacote até ork onboarding set maestro corrigir.`).join(''));
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
    case 'pulse': {
      if (args.posicionais[1] === 'responder') {
        // I-41 (GO-FIX 1, B1 e B2): o caminho de volta do resumo. So o ingresso autenticado chama;
        // argv traz identificadores e o envelope assinado vem por stdin, como no `gate answer`.
        if (args.opcoes['resposta-stdin'] !== true || args.opcoes.resposta !== undefined || args.posicionais.length !== 2) {
          throw new Error('pulse responder exige --resposta-stdin e o envelope do ingresso autenticado');
        }
        const carregado = exigirManifesto();
        const envelope = lerRespostaStdin({ por: texto(args.opcoes.por), mensagem: texto(args.opcoes.mensagem),
          origem: texto(args.opcoes.origem), canal: texto(args.opcoes.canal), conta: texto(args.opcoes.conta) });
        const formato = texto(args.opcoes.formato);
        if (formato !== undefined && formato !== 'telegram' && formato !== 'terminal') throw new Error('pulse responder: --formato telegram|terminal');
        console.log(JSON.stringify(responderPeloPulse(carregado.raiz, envelope, { canal: formato ?? 'telegram' })));
        return 0;
      }
      if (args.posicionais[1] === 'cadencia') return comandoCadenciaDoPulse(args);
      const p = montarPulse(exigirManifesto(), { registrar: args.opcoes.registrar === true,
        escopo: texto(args.opcoes.escopo)?.split(',').map(s => s.trim()),
        semRuntime: args.opcoes['sem-runtime'] === true,
        linhasLogs: texto(args.opcoes.linhas) === undefined ? undefined : Number(texto(args.opcoes.linhas)) });
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
      const result = runBrain(exigirManifesto(), args.posicionais[1] ?? 'status', args.opcoes, args.posicionais.slice(2));
      console.log(JSON.stringify(result, null, 2));
      return ['ok','empty','unknown','withheld','applied','rolled-back'].includes(result.state) ? 0 : 1;
    }
    case 'memory':
      return comandoMemory(args);
    case 'grafo': {
      // RM-031 KG3 (D7): o argv cru depois do comando; o parser do grafo e estrito.
      const carregado = exigirManifesto();
      return executarGrafo(argv.slice(argv.indexOf('grafo') + 1),
        { raiz: carregado.raiz, estado: raizDoEstado(carregado.raiz), repositorio: carregado.manifesto.project.name, escrever: (texto) => console.log(texto) });
    }
    case 'ship':
      return comandoShip(args);
    case 'activation':
      return comandoAtivacao(exigirManifesto(), args);
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
      console.error(`comando desconhecido: ${comando}`);
      console.log(AJUDA);
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
    } else if (e instanceof ErroDeProjeto) {
      // RM-052 (D3): a recusa de projeto-alvo e a resposta (a escolha, os candidatos), nao um stack trace.
      console.log(process.argv.includes('--json') ? JSON.stringify(e.recusa, null, 2) : e.texto);
      process.exitCode = SAIDA_DE_PROJETO;
    } else {
      console.error(`erro: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
}
