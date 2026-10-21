/**
 * RM-061, F3d (snapshot pt-BR): `sessions` (inventario, limpeza, radar e a sessao localizada nas contas), `gate` (usos e
 * o parecer de tokens), `decisao` (o pedido HITL v2 da classe `pergunta`, a selecao de conducao e o pedido curto) e a
 * cadencia do `pulse`. O texto montado por funcao pura entra com entradas fixas; o que so o `index.ts` imprime, pelo CLI.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { exigirSelecaoDeConducao, validarPedidoHitlV2 } from '../src/hitl-contract';
import { entradaDoPedido, linhaDeResposta, montarPedidoCurto, textoDoPedidoCurto } from '../src/hitl-curto';
import { textoDoRadar } from '../src/hitl';
import { CADENCIAS, gravarCadencia, textoDaCadencia } from '../src/pulse-cadencia';
import { textoDaLimpeza, textoDoInventario } from '../src/sessoes';
import { textoDoGateDeTokens } from '../src/tokens';
import {
  Ambiente, caso, Casos, dirTemp, erro, idDaThread, ork, orkComEntrada, orkComEnv, projeto, T0, T1, T2, texto,
} from './locale-f3d-apoio';

// ---------------------------------------------------------------------------------------------------------------------
// sessions: inventario, limpeza e radar (funcoes puras)
// ---------------------------------------------------------------------------------------------------------------------

function casosDoInventario(casos: Casos): void {
  const fonte = (origem: string, extra: object = {}) => ({ origem, ok: true, detalhe: '', ...extra });
  const sessao = (sessionId: string, extra: object = {}) => ({ sessionId, runtime: 'claude-bg', perfil: null, fantasma: false,
    viva: true, cwd: '/srv/x', vinculos: [], ...extra });
  const vinculo = (thread: string, fase: string) => ({ raiz: '/repo', thread, fase, origem: `/repo/.orkastery/threads/${thread}/thread.json` });
  const inventario = (extra: object) => ({ ok: true, escopo: { usuario: 'builder', global: false, historico: false, raiz: '/repo' },
    fontes: [fonte('claude-bg')], sessoes: [], total: 0, semThread: 0, ambiguas: 0, fantasmas: 0, ...extra });
  caso(casos, 'sessions: inventario vazio do projeto', () => textoDoInventario(inventario({}) as never));
  caso(casos, 'sessions: inventario do projeto com historico', () => textoDoInventario(inventario({
    escopo: { usuario: 'builder', global: false, historico: true, raiz: '/repo' }, total: 1, semThread: 0,
    sessoes: [sessao('sessao-do-projeto', { state: 'working', vinculos: [vinculo('loc-x1', 'GO')] })],
  }) as never));
  caso(casos, 'sessions: inventario global com fantasma e fontes', () => textoDoInventario(inventario({
    ok: false, escopo: { usuario: 'builder', global: true, historico: true, raiz: '/repo' },
    fontes: [fonte('claude-bg'), fonte('claude-bg perfil p1', { ok: false, detalhe: 'claude agents falhou (codigo 1)' }),
      fonte('codex', { ausente: true, detalhe: 'codex fora do PATH', correcao: 'instale o codex e rode codex login' }),
      fonte('claude-bg perfil p2', { ausente: true, detalhe: 'diretorio do perfil ausente' })],
    sessoes: [
      sessao('sessao-fantasma', { fantasma: true, viva: false }),
      sessao('sessao-em-duas-threads', { perfil: 'p1', state: 'working',
        vinculos: [vinculo('loc-x1', 'GO'), vinculo('loc-x2', 'PLAN')] }),
      sessao('sessao-codex', { runtime: 'codex', perfil: 'c1', status: 'idle', vinculos: [vinculo('loc-x3', 'CHECK')] }),
    ],
    total: 3, semThread: 1, ambiguas: 1, fantasmas: 1,
  }) as never));
}

function casosDaLimpeza(casos: Casos): void {
  const item = (sessionId: string, acao: string, extra: object = {}) =>
    ({ sessionId, perfil: null, thread: 'loc-x1', fase: 'GO', acao, ...extra });
  caso(casos, 'sessions: limpeza sem fantasma', () => textoDaLimpeza({ ok: true, dryRun: false, itens: [], falhas: [] }));
  caso(casos, 'sessions: limpeza sem fantasma com conta sem resposta', () => textoDaLimpeza({ ok: false, dryRun: false, itens: [],
    falhas: ['p1: claude agents falhou (codigo 1)', 'p2: claude agents respondeu JSON invalido'] }));
  const itens = [item('fantasma-solto', 'solto'),
    item('fantasma-ja-solto', 'ja-solto', { perfil: 'p1' }),
    item('fantasma-sem-thread', 'sem-thread', { thread: null, fase: null }),
    item('fantasma-de-outro-projeto', 'outro-projeto', { thread: 'out-y1', fase: 'PLAN' })];
  caso(casos, 'sessions: limpeza em ensaio', () => textoDaLimpeza({ ok: true, dryRun: true, itens, falhas: [] } as never));
  caso(casos, 'sessions: limpeza gravada com falha', () => textoDaLimpeza({ ok: false, dryRun: false, itens,
    falhas: ['p2: claude agents respondeu JSON invalido'] } as never));
}

function casosDoRadar(casos: Casos): void {
  const resumo = (extra: object = {}) => ({ total: 0, precisamDeHumano: 0, hitl: 0, abandonadas: 0, falhas: 0, trabalhando: 0,
    desconhecidas: 0, acimaDoLimite: 0, foraDoOrk: 0, ...extra });
  const radar = (extra: object) => ({ consultadoEm: T1, atencaoMin: 15, runtimeConsultado: true, runtimeDetalhe: '', logsLidos: true,
    raiz: '/repo', sessoes: [], resumo: resumo(), ...extra });
  const sessao = (id: string, extra: object) => ({ id, sessionId: `${id}-0000-4000-8000-000000000000`, nome: `sessao-${id}`,
    cwd: '/srv/x/loja', kind: 'bg', estadoBruto: 'working', classe: 'trabalhando', tipoDeHitl: null, jobVivo: true,
    precisaDeHumano: false, detalhe: 'sessao trabalhando', desdeEm: T0, idadeMin: 5, pergunta: '', alternativas: [], thread: null,
    recomendacao: '', comandos: { logs: `ork sessions logs ${id}`, attach: `claude attach ${id}`, parar: `ork sessions stop ${id}` },
    acimaDoLimite: false, ...extra });
  const thread = (id: string, fase: string) => ({ id, fase, slug: `${id}-${fase.toLowerCase()}` });
  caso(casos, 'sessions: radar sem runtime', () => textoDoRadar(radar({ runtimeConsultado: false,
    runtimeDetalhe: 'claude fora do PATH' }) as never));
  caso(casos, 'sessions: radar sem logs e sem sessao', () => textoDoRadar(radar({ logsLidos: false, atencaoMin: 30 }) as never));
  caso(casos, 'sessions: radar sem ninguem esperando', () => textoDoRadar(radar({
    sessoes: [sessao('desc0001', { estadoBruto: '', classe: 'desconhecida', idadeMin: 0 }),
      sessao('trab0002', { thread: thread('loc-x1', 'GO'), idadeMin: 75 })],
    resumo: resumo({ total: 2, trabalhando: 1, desconhecidas: 1, foraDoOrk: 1 }),
  }) as never));
  const vivaComThread = sessao('hitl0003', { estadoBruto: 'blocked', classe: 'hitl', tipoDeHitl: 'hitl.permissao', precisaDeHumano: true,
    detalhe: 'sessao parada com job vivo pedindo permissao', idadeMin: 125, paradaHaMin: 45, acimaDoLimite: true,
    pergunta: 'Do you want to run npm publish?', alternativas: ['1. Yes', '2. No, and tell Claude what to do differently'],
    contextoLogs: ['npm publish', 'Bash command'], thread: thread('loc-x1', 'GO'), recomendacao: 'responda 2 e peca o comando ao dono' });
  const vivaSemThread = sessao('hitl0004', { estadoBruto: 'blocked', classe: 'hitl', tipoDeHitl: null, precisaDeHumano: true,
    detalhe: 'sessao parada com job vivo, mas a ultima tela nao mostra o menu', idadeMin: 0.5, paradaHaMin: null,
    recomendacao: 'veja a tela com ork sessions logs hitl0004' });
  const falha = sessao('falh0005', { estadoBruto: 'failed', classe: 'falha', precisaDeHumano: true, detalhe: 'sessao terminou com falha',
    idadeMin: 300, paradaHaMin: 10, thread: thread('loc-x2', 'PLAN'), recomendacao: 'leia os logs e redespache a fase' });
  const mortaComThread = sessao('mort0006', { estadoBruto: 'blocked', classe: 'abandonada', tipoDeHitl: null, jobVivo: false,
    precisaDeHumano: true, detalhe: 'job ja saiu do runtime', idadeMin: 1500, thread: thread('loc-x3', 'CHECK'),
    recomendacao: 'redespache a fase CHECK' });
  const mortaSemThread = sessao('mort0007', { estadoBruto: 'blocked', classe: 'abandonada', jobVivo: false, precisaDeHumano: true,
    detalhe: 'job ja saiu do runtime', idadeMin: 61, recomendacao: 'remova a sessao com claude rm' });
  caso(casos, 'sessions: radar com sessoes esperando', () => textoDoRadar(radar({
    sessoes: [vivaComThread, vivaSemThread, falha, mortaComThread, mortaSemThread, sessao('trab0002', { thread: thread('loc-x1', 'GO') })],
    resumo: resumo({ total: 6, precisamDeHumano: 5, hitl: 2, abandonadas: 2, falhas: 1, trabalhando: 1, acimaDoLimite: 1, foraDoOrk: 2 }),
  }) as never));
  caso(casos, 'sessions: radar so com mortas', () => textoDoRadar(radar({ logsLidos: false, sessoes: [mortaSemThread],
    resumo: resumo({ total: 1, precisamDeHumano: 1, abandonadas: 1, foraDoOrk: 1 }) }) as never));
}

// ---------------------------------------------------------------------------------------------------------------------
// sessions pelo CLI: usos e recusas que so o index.ts imprime
// ---------------------------------------------------------------------------------------------------------------------

function casosDeSessoesNoCli(casos: Casos, amb: Ambiente): void {
  const fora = dirTemp('sessoes-fora', '<FORA>');
  caso(casos, 'cli sessions: limpar-fantasmas fora de projeto', () => texto(ork(fora, amb, 'sessions', 'limpar-fantasmas')));
  caso(casos, 'cli sessions: hitl com atencao invalida', () => texto(ork(fora, amb, 'sessions', 'hitl', '--atencao', 'abc')));
  caso(casos, 'cli sessions: hitl sem sessao no runtime', () => texto(ork(fora, amb, 'sessions', 'hitl', '--sem-logs')));
  caso(casos, 'cli sessions: stop de sessao que nao existe', () => texto(ork(fora, amb, 'sessions', 'stop', 'nada')));
  const repo = projeto('sessoes', 'loc', amb);
  caso(casos, 'cli sessions: watch sem thread', () => texto(ork(repo, amb, 'sessions', 'watch')));
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'sessoes-a', '--sem-worktree'));
  caso(casos, 'cli sessions: watch de thread sem sessao', () => texto(ork(repo, amb, 'sessions', 'watch', '--thread', id)));
  caso(casos, 'cli sessions: event sem tipo', () => texto(ork(repo, amb, 'sessions', 'event', '--sessao', 'abc')));
  caso(casos, 'cli sessions: event com tipo invalido', () =>
    texto(orkComEntrada(repo, amb, '{}', {}, 'sessions', 'event', '--tipo', 'voar', '--sessao', 'abc')));
  caso(casos, 'cli sessions: request sem fase', () => texto(ork(repo, amb, 'sessions', 'request', id, 'abc')));
  caso(casos, 'cli sessions: answer sem stdin', () => texto(ork(repo, amb, 'sessions', 'answer', id, 'p1')));
  caso(casos, 'cli sessions: reconcile sem pedido', () => texto(ork(repo, amb, 'sessions', 'reconcile', id)));
  caso(casos, 'cli sessions: supersede sem runtime', () => texto(ork(repo, amb, 'sessions', 'supersede', id, 'abc', '--fase', 'GO')));
  caso(casos, 'cli sessions: stop sem sessao', () => texto(ork(repo, amb, 'sessions', 'stop')));
  caso(casos, 'cli sessions: subcomando desconhecido', () => texto(ork(repo, amb, 'sessions', 'voar', 'abc')));
}

const SESSAO_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const SESSAO_B = 'bbbbbbbb-0000-4000-8000-000000000002';

/**
 * Um `claude` falso com sessoes por conta: a do processo ve a A; a `conta-b` ve a A e a B; a `conta-ruim` responde JSON
 * invalido. `stop` sai 0 sem texto, e o `ork` diz que parou.
 */
const CLAUDE_COM_SESSOES = `#!/bin/sh
A='{"sessionId":"${SESSAO_A}","id":"aaaaaaaa","name":"sessao-a","cwd":"/srv/x","kind":"bg","state":"working"}'
B='{"sessionId":"${SESSAO_B}","id":"bbbbbbbb","name":"sessao-b","cwd":"/srv/x","kind":"bg","state":"working"}'
case "$1" in
  auth) echo '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}'; exit 0 ;;
  --version) echo "stub de teste 0.0.1"; exit 0 ;;
  agents)
    case "$CLAUDE_CONFIG_DIR" in
      */conta-ruim) echo 'nao e json' ;;
      */conta-b) echo "[$A,$B]" ;;
      *) echo "[$A]" ;;
    esac
    exit 0 ;;
  stop) exit 0 ;;
esac
echo '[]'
exit 0
`;

/**
 * O inventario abre com o usuario do sistema de quem roda (`os.userInfo`), que muda de maquina para maquina: so essa
 * posicao vira marcador, para nao tocar o resto do texto.
 */
const semUsuario = (t: string): string => t.replace(/^(Inventário (?:global|do projeto) da conta )[^;\n]*(; histórico: )/m, '$1<USUARIO>$2');

function casosDeSessoesNasContas(casos: Casos, amb: Ambiente): void {
  const repo = projeto('contas', 'loc', amb);
  const stub = dirTemp('sessoes-stub', '<STUB-SESSOES>');
  fs.writeFileSync(path.join(stub, 'claude'), CLAUDE_COM_SESSOES, { mode: 0o755 });
  const env = { PATH: `${stub}:${amb.bin}` };
  const contas = dirTemp('sessoes-contas', '<CONTAS>');
  const conta = (id: string, dir: string): void => {
    const r = orkComEnv(repo, amb, env, 'accounts', 'add', id, '--runtime', 'claude-bg', '--dir', path.join(contas, dir), '--sem-login');
    if (r.status !== 0) throw new Error(`accounts add ${id} falhou: ${r.stdout}\n${r.stderr}`);
  };
  const sessoes = (...args: string[]) => texto(orkComEnv(repo, amb, env, 'sessions', ...args));
  caso(casos, 'cli sessions: stop na conta do processo', () => sessoes('stop', SESSAO_A));
  conta('p1', 'conta-b');
  caso(casos, 'cli sessions: list global com fantasmas nas contas', () => semUsuario(sessoes('list', '--global')));
  caso(casos, 'cli sessions: limpar-fantasmas em ensaio', () => sessoes('limpar-fantasmas', '--dry-run'));
  caso(casos, 'cli sessions: hitl com sessao trabalhando', () => sessoes('hitl'));
  caso(casos, 'cli sessions: stop pelo nome visto em duas contas', () => sessoes('stop', 'sessao-a'));
  caso(casos, 'cli sessions: stop na conta do perfil', () => sessoes('stop', SESSAO_B));
  conta('p2', 'conta-ruim');
  caso(casos, 'cli sessions: stop com conta sem resposta', () => sessoes('stop', 'nada'));
  caso(casos, 'cli sessions: list com conta sem resposta', () => semUsuario(sessoes('list')));
  caso(casos, 'cli sessions: limpar-fantasmas com conta sem resposta', () => sessoes('limpar-fantasmas'));
}

// ---------------------------------------------------------------------------------------------------------------------
// gate: o parecer de tokens (funcao pura) e os usos pelo CLI
// ---------------------------------------------------------------------------------------------------------------------

function casosDoGate(casos: Casos, amb: Ambiente): void {
  const veredito = (extra: object) => ({ thread: 'loc-x1', proximoPasso: null, passoPesado: false, veredito: 'same-session',
    medida: { ocupacao: null, fonte: 'unavailable', detalhe: 'o runtime nao expoe a ocupacao da janela' },
    decididoPor: 'ausencia-de-medida', razao: 'sem medida, a sessao segue', slugSugerido: null,
    limiares: { rotate_above: 0.7, force_rotate_above: 0.9 }, decididoEm: T0, ...extra });
  caso(casos, 'gate: tokens sem medida', () => textoDoGateDeTokens(veredito({}) as never));
  caso(casos, 'gate: tokens leve na mesma sessao', () => textoDoGateDeTokens(veredito({ proximoPasso: 'CHECK', decididoPor: 'medicao',
    medida: { ocupacao: 0.1234, fonte: 'estimated', detalhe: 'estimada pelo transcript da sessao' },
    razao: 'ocupacao 12.3% abaixo de rotate_above (70%)' }) as never));
  caso(casos, 'gate: tokens com nova sessao', () => textoDoGateDeTokens(veredito({ proximoPasso: 'GO', passoPesado: true,
    veredito: 'new-session', decididoPor: 'medicao', slugSugerido: 'loc-x1-go-2',
    medida: { ocupacao: 0.8, fonte: 'informada', detalhe: 'ocupacao 80.0% declarada pelo chamador como fonte informada' },
    razao: 'ocupacao 80.0% >= rotate_above (70%) e o proximo passo e pesado (GO), ou refazer fase reprovada' }) as never));

  const repo = projeto('gate', 'loc', amb);
  caso(casos, 'cli gate: context sem pedido', () => texto(ork(repo, amb, 'gate', 'context', 'loc-x1')));
  caso(casos, 'cli gate: request sem thread', () => texto(ork(repo, amb, 'gate', 'request')));
  caso(casos, 'cli gate: request com formato invalido', () => texto(ork(repo, amb, 'gate', 'request', 'loc-x1', '--formato', 'sms')));
  caso(casos, 'cli gate: answer sem resposta-stdin', () => texto(ork(repo, amb, 'gate', 'answer', 'loc-x1', 'p1')));
  caso(casos, 'cli gate: next sem thread', () => texto(ork(repo, amb, 'gate', 'next')));
  caso(casos, 'cli gate: approve sem autor', () => texto(ork(repo, amb, 'gate', 'approve', 'loc-x1', 'push')));
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'gate-a', '--sem-worktree'));
  // Com thread, sobre e autor, a aprovacao cega e recusada no nucleo: as linhas de "registrada" nao saem mais.
  caso(casos, 'cli gate: approve com autor', () => texto(ork(repo, amb, 'gate', 'approve', id, 'push', '--por', 'operador')));
  caso(casos, 'cli gate: next com ocupacao informada', () => texto(ork(repo, amb, 'gate', 'next', id, '--ocupacao', '0.8')));
  caso(casos, 'cli gate: next sem medida', () => texto(ork(repo, amb, 'gate', 'next', id)));
  caso(casos, 'cli gate: subcomando desconhecido', () => texto(ork(repo, amb, 'gate', 'voar')));
}

// ---------------------------------------------------------------------------------------------------------------------
// decisao: o pedido HITL v2 da classe `pergunta`, a selecao de conducao e o pedido curto
// ---------------------------------------------------------------------------------------------------------------------

const alternativa = (letra: string, texto: string, acao: string, consequencia: string, porque?: string) =>
  ({ letra, texto, acao, consequencia, ...(porque ? { recomendada: true, porque } : {}) });

const ALTERNATIVAS = [
  alternativa('a', 'Aprovar com as evidencias apresentadas', 'aprovar', 'a fase segue para o proximo passo', 'a fase registrou conclusao'),
  alternativa('b', 'Solicitar revisao', 'recusar', 'a fase volta para correcao'),
  alternativa('c', 'Continuar esperando', 'esperar', 'nada muda ate a proxima resposta'),
];

const BASE_PERGUNTA: Record<string, unknown> = {
  contrato: 'ork.hitl/v2', classe: 'pergunta', id: 'pedido-1', thread: 'loc-x1', fase: 'GO', modo: 'auto', criadoEm: T0,
  profundidade: 'resumo', alvo: { tipo: 'gate', sobre: 'evidencias do GO' }, motivo: 'human.pending',
  pergunta: 'Qual e o veredito sobre evidencias do GO?', alternativas: ALTERNATIVAS, corpo: ['Fase GO, motivo human.pending'],
  tipoDeResposta: 'objetiva', irreversivel: false, codigo: 'AB12', prazo: T2, acaoPadraoAoExpirar: 'esperar',
  respostaAceita: { tipo: 'opcao', maxCaracteres: 100 },
};

const BASE_DECIDIDO = {
  contrato: 'ork.hitl/v2', classe: 'decidido', id: 'decisao-1', thread: 'loc-x1', fase: 'GO', modo: 'auto', criadoEm: T0,
  profundidade: 'resumo', decidido: 'a decisao', porque: 'o porque', comoMudar: 'como mudar',
  custoDeReverter: { agora: 'baixo', depois: 'medio' }, criterio: { tipo: 'medicao', referencia: 'npm test' },
};

const pergunta = (v: Record<string, unknown>): Record<string, unknown> => {
  const p: Record<string, unknown> = { ...BASE_PERGUNTA, ...v };
  for (const k of Object.keys(v)) if (v[k] === undefined) delete p[k];
  return p;
};

const comAlternativa = (i: number, extra: object) => ALTERNATIVAS.map((a, j) => (j === i ? { ...a, ...extra } : a));

function casosDoContratoDaPergunta(casos: Casos): void {
  const semRecomendada = (a: Record<string, unknown>) => { const { recomendada: _r, porque: _p, ...resto } = a; return resto; };
  const variantes: [string, Record<string, unknown>][] = [
    ['valido', {}], ['id invalido', { id: '' }], ['modo invalido', { modo: 'voar' }], ['instante sem fuso', { criadoEm: '2025-09-19 18:16' }],
    ['profundidade invalida', { profundidade: 'rasa' }], ['pergunta com quebra', { pergunta: 'linha um\nlinha dois' }],
    ['pergunta longa', { pergunta: 'x'.repeat(201) }], ['motivo vazio', { motivo: '' }],
    ['uma alternativa', { alternativas: [ALTERNATIVAS[0]] }], ['seis alternativas', { alternativas: [...ALTERNATIVAS, ...ALTERNATIVAS] }],
    ['letra fora de ordem', { alternativas: [ALTERNATIVAS[1], ALTERNATIVAS[0]] }],
    ['alternativa sem texto', { alternativas: comAlternativa(1, { texto: '' }) }],
    ['alternativa sem acao', { alternativas: comAlternativa(1, { acao: 'voar' }) }],
    ['alternativa sem consequencia', { alternativas: comAlternativa(2, { consequencia: 'a\nb' }) }],
    ['porque sem recomendada', { alternativas: comAlternativa(1, { porque: 'tambem serve' }) }],
    ['recomendada nao booleana', { alternativas: comAlternativa(1, { recomendada: 'sim', porque: 'x' }) }],
    ['recomendada sem porque', { alternativas: [semRecomendada(ALTERNATIVAS[0]), { ...ALTERNATIVAS[1], recomendada: true }, ALTERNATIVAS[2]] }],
    ['nenhuma recomendada', { alternativas: ALTERNATIVAS.map(semRecomendada) }],
    ['duas recomendadas', { alternativas: comAlternativa(1, { recomendada: true, porque: 'tambem serve' }) }],
    ['corpo em prosa', { corpo: 'um paragrafo corrido' }], ['corpo longo', { corpo: Array.from({ length: 9 }, (_, i) => `linha ${i}`) }],
    ['tipo de resposta invalido', { tipoDeResposta: 'livre' }], ['codigo curto invalido', { codigo: 'a' }],
    ['alvo sem sobre', { alvo: { tipo: 'gate' } }], ['alvo de sessao sem runtime', { alvo: { tipo: 'session', sessionId: 'abc12345' } }],
    ['resposta aceita sem teto', { respostaAceita: { tipo: 'opcao', maxCaracteres: 0 } }],
    ['prazo igual a criacao', { prazo: T0 }], ['expiracao invalida', { acaoPadraoAoExpirar: 'avancar' }],
    ['dependencia sem porque', { dependenciaTecnica: { comando: 'claude auth login' } }],
    ['irreversivel ausente', { irreversivel: undefined }], ['ato fora da lista', { irreversivel: true, ato: 'voar' }],
    ['irreversivel que segue a recomendada', { irreversivel: true, ato: 'dinheiro', acaoPadraoAoExpirar: 'seguir-recomendada' }],
    ['ato sem irreversivel', { ato: 'dinheiro' }],
  ];
  for (const [nome, v] of variantes) caso(casos, `decisao pergunta: ${nome}`, () => erro(() => validarPedidoHitlV2(pergunta(v))));
  caso(casos, 'decisao pergunta: contrato desconhecido', () => erro(() => validarPedidoHitlV2({ ...BASE_PERGUNTA, contrato: 'ork.hitl/v9' })));
  caso(casos, 'decisao pergunta: nao objeto', () => erro(() => validarPedidoHitlV2('pedido')));
  caso(casos, 'decisao pergunta: classe invalida', () => erro(() => validarPedidoHitlV2({ ...BASE_PERGUNTA, classe: 'aviso' })));
}

function casosDaSelecao(casos: Casos): void {
  const selecao = (p: unknown) => erro(() => exigirSelecaoDeConducao(p as never));
  caso(casos, 'decisao selecao: pedido v1', () => selecao({ contrato: 'ork.hitl/v1', pergunta: 'x' }));
  caso(casos, 'decisao selecao: decisao informada', () => selecao(BASE_DECIDIDO));
  caso(casos, 'decisao selecao: duas alternativas', () => selecao(pergunta({ alternativas: ALTERNATIVAS.slice(0, 2) })));
  caso(casos, 'decisao selecao: sem recomendada', () => selecao(pergunta({ alternativas: comAlternativa(0, { recomendada: undefined }) })));
  caso(casos, 'decisao selecao: duas recomendadas', () => selecao(pergunta({ alternativas: comAlternativa(1, { recomendada: true }) })));
  caso(casos, 'decisao selecao: resposta aberta sem dependencia', () => selecao(pergunta({ tipoDeResposta: 'aberta' })));
  caso(casos, 'decisao selecao: resposta em texto sem dependencia', () =>
    selecao(pergunta({ respostaAceita: { tipo: 'texto', maxCaracteres: 400 } })));
  caso(casos, 'decisao selecao: resposta aberta com dependencia', () => selecao(pergunta({ tipoDeResposta: 'aberta',
    dependenciaTecnica: { comando: 'claude auth login', porque: 'a conta precisa de login interativo' } })));
  caso(casos, 'decisao selecao: valida', () => selecao(BASE_PERGUNTA));
}

function casosDoPedidoCurto(casos: Casos): void {
  type Responder = Parameters<typeof montarPedidoCurto>[1]['responder'];
  const curto = (p: Record<string, unknown>, responder: Responder, desde: string | null = T0) =>
    montarPedidoCurto(entradaDoPedido(p as never, desde), { quando: T1, responder });
  const nos2 = (p: ReturnType<typeof montarPedidoCurto>) =>
    `[terminal]\n${textoDoPedidoCurto(p, 'terminal')}\n[telegram]\n${textoDoPedidoCurto(p, 'telegram')}`;
  const codigo: Responder = { tipo: 'codigo', codigo: 'AB12' };
  caso(casos, 'decisao curto: gate com codigo', () => nos2(curto(BASE_PERGUNTA, codigo)));
  caso(casos, 'decisao curto: gate sem desde', () => nos2(curto(BASE_PERGUNTA, { tipo: 'dialogo' }, null)));
  caso(casos, 'decisao curto: sessao parada', () => nos2(curto(pergunta({ alvo: { tipo: 'session', sessionId: SESSAO_A, runtime: 'claude-bg' },
    corpo: ['a sessao pede permissao', 'comando npm publish', 'terceira linha fica de fora'] }), codigo)));
  caso(casos, 'decisao curto: segue a recomendada no prazo', () =>
    nos2(curto(pergunta({ acaoPadraoAoExpirar: 'seguir-recomendada' }), { tipo: 'numero', numero: 2 })));
  caso(casos, 'decisao curto: escala no prazo', () => nos2(curto(pergunta({ acaoPadraoAoExpirar: 'escalar' }), { tipo: 'texto' })));
  caso(casos, 'decisao curto: comando no terminal', () =>
    nos2(curto(BASE_PERGUNTA, { tipo: 'terminal', comando: 'ork phase run loc-x1 GO' })));
  for (const ato of ['dinheiro', 'publicacao-externa', 'apagar-dado', 'push-base-protegida']) {
    caso(casos, `decisao curto: sem volta ${ato}`, () => nos2(curto(pergunta({ irreversivel: true, ato }), codigo)));
  }
  // A entrada montada a mao: sem thread nem fase, e sem prazo na expiracao que escala.
  const entrada = (extra: object) => ({ thread: null, fase: null, pergunta: 'Qual conta usar no despacho?',
    alternativas: [{ chave: 'a', texto: 'Conta p1', consequencia: 'despacha na p1', recomendada: { porque: 'tem cota livre' } },
      { chave: 'b', texto: 'Conta p2', consequencia: 'despacha na p2' }], ...extra });
  const montar = (e: object, responder: Responder = codigo) => montarPedidoCurto(e as never, { quando: T1, responder });
  caso(casos, 'decisao curto: sem thread e sem fase', () => nos2(montar(entrada({ expiracao: 'escalar' }))));
  caso(casos, 'decisao curto: escala com prazo de outro dia', () => nos2(montar(entrada({ thread: 'loc-x1', expiracao: 'escalar',
    prazo: '2025-09-21T12:00:00.000Z', desde: '2025-09-18T12:00:00.000Z' }))));
  caso(casos, 'decisao curto: linha de resposta por numero', () => linhaDeResposta(montar(entrada({}), { tipo: 'numero', numero: 1 }), 'terminal'));
  caso(casos, 'decisao curto: so pergunta', () => erro(() => entradaDoPedido(BASE_DECIDIDO as never)));
  caso(casos, 'decisao curto: uma alternativa', () => erro(() => montar(entrada({ alternativas: [entrada({}).alternativas[0]] }))));
  caso(casos, 'decisao curto: seis alternativas', () => erro(() => montar(entrada({
    alternativas: Array.from({ length: 6 }, (_, i) => ({ chave: 'abcdef'[i], texto: `opcao ${i}`, consequencia: 'x',
      ...(i === 0 ? { recomendada: { porque: 'y' } } : {}) })) }))));
  caso(casos, 'decisao curto: sem recomendada', () => erro(() => montar(entrada({
    alternativas: entrada({}).alternativas.map((a) => ({ chave: a.chave, texto: a.texto, consequencia: a.consequencia })) }))));
  caso(casos, 'decisao curto: contrato invalido', () => erro(() => textoDoPedidoCurto({ contrato: 'ork.hitl-curto/v0' } as never, 'terminal')));
  caso(casos, 'decisao curto: acima do teto de linhas', () => erro(() => textoDoPedidoCurto({ ...montar(entrada({})),
    corpo: Array.from({ length: 12 }, (_, i) => `evidencia ${i}`) }, 'telegram')));
}

// ---------------------------------------------------------------------------------------------------------------------
// pulse cadencia: o texto de cada tag (funcao pura), a gravacao recusada e o comando
// ---------------------------------------------------------------------------------------------------------------------

function casosDaCadencia(casos: Casos, amb: Ambiente): void {
  for (const tag of Object.keys(CADENCIAS) as (keyof typeof CADENCIAS)[]) {
    caso(casos, `pulse cadencia: texto ${tag}`, () => textoDaCadencia(CADENCIAS[tag], T1));
  }
  caso(casos, 'pulse cadencia: tag fora do catalogo usa a descricao do dado', () =>
    textoDaCadencia({ tag: '#OrkPulseOn-5m', janelaMin: 5, ancoraMin: 0, descricao: 'de 5 em 5 minutos' } as never, T1));
  const estado = dirTemp('cadencia', '<ESTADO>');
  caso(casos, 'pulse cadencia: gravar tag desconhecida', () =>
    erro(() => gravarCadencia(estado, '#OrkPulseOn-5m' as never, { por: 'operador', canal: 'terminal', em: T0 }, estado)));
  caso(casos, 'pulse cadencia: gravar sem autor', () =>
    erro(() => gravarCadencia(estado, '#OrkPulseOn', { por: '   ', canal: 'terminal', em: T0 }, estado)));

  // O comando usa o relogio de agora: a data do proximo resumo e a da troca saem normalizadas (<DATA>).
  const repo = projeto('pulse', 'loc', amb);
  caso(casos, 'cli pulse: responder sem resposta-stdin', () => texto(ork(repo, amb, 'pulse', 'responder')));
  caso(casos, 'cli pulse: responder com formato invalido', () =>
    texto(orkComEntrada(repo, amb, '{}', {}, 'pulse', 'responder', '--resposta-stdin', '--formato', 'sms')));
  caso(casos, 'cli pulse: cadencia com duas tags', () => texto(ork(repo, amb, 'pulse', 'cadencia', 'OrkPulseOn', 'OrkPulseOff')));
  caso(casos, 'cli pulse: cadencia com tag desconhecida', () => texto(ork(repo, amb, 'pulse', 'cadencia', 'OrkPulseOn-5m')));
  caso(casos, 'cli pulse: cadencia padrao', () => texto(ork(repo, amb, 'pulse', 'cadencia')));
  caso(casos, 'cli pulse: cadencia trocada', () =>
    texto(ork(repo, amb, 'pulse', 'cadencia', '#OrkPulseOff', '--por', 'operador', '--canal', 'telegram')));
  caso(casos, 'cli pulse: cadencia gravada', () => texto(ork(repo, amb, 'pulse', 'cadencia')));
}

export function gerarGrupo(casos: Casos, amb: Ambiente): void {
  casosDoInventario(casos);
  casosDaLimpeza(casos);
  casosDoRadar(casos);
  casosDeSessoesNoCli(casos, amb);
  casosDeSessoesNasContas(casos, amb);
  casosDoGate(casos, amb);
  casosDoContratoDaPergunta(casos);
  casosDaSelecao(casos);
  casosDoPedidoCurto(casos);
  casosDaCadencia(casos, amb);
}
