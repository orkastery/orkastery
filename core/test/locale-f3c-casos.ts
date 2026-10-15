/**
 * RM-061, fatia F3c: os casos do snapshot pt-BR das cinco superficies da fatia. Cada caso produz um texto que a F3c
 * passa pelo catalogo de mensagens: o `.gitignore` do estado criado pelo `init`, as recusas de `decisao registrar`
 * (validacao HITL v2, criterio e rastro, nas duas superficies), o texto do `network roadmap`, a ficha e o pedido do
 * `thread new --from-finding` e os prompts de fase com o `ork prompt`. As funcoes sao chamadas com entradas fixas nos
 * ramos que a fatia toca; a matriz de prompts entra pelo sha256 e tres representantes entram por inteiro.
 *
 * A fixture `fixtures/locale-f3c-pt-BR.json` foi gerada UMA vez por estes casos sobre o codigo da main de integracao
 * (`1e88a932`, antes da F3c); o teste `locale-f3c-snapshot` so compara e nunca regrava. Pastas temporarias saem
 * normalizadas, igual na geracao e na comparacao. So entram funcoes que a main ja tinha, com a mesma assinatura.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { definirFusoDoDono } from '../src/horario';
import { CONTRATO_DAS_FASES, fechoDoGo, montarPrompt, REGRA_DAS_ESPERAS, REGRAS_DE_EVIDENCIA, valoresDoPrompt } from '../src/phase';
import {
  exigirTemplate, lintTemplate, parseTemplate, pedidoComDicaDoGrafo, renderizar, tabelaDeTemplates, textoDoLint, threadDeExemplo,
} from '../src/prompts';
import { MODOS } from '../src/modos';
import { CAMPOS_DA_DECISAO_NO_CLI, CAMPOS_DA_DECISAO_NO_MCP, recusaNaSuperficie, validarPedidoHitlV2 } from '../src/hitl-contract';
import { resolverCriterio } from '../src/hitl-gates';
import { exigirRastroDeDecisaoAutonoma } from '../src/ledger';
import { CONTRATO_PANORAMA_DA_REDE, ErroDoPedidoDeProjeto, PanoramaDaRede, textoDoPanoramaDaRede } from '../src/network-roadmap';
import { pedidoDoAchado, textoDoAchado } from '../src/divida';
import { init } from '../src/init';
import { exigirManifesto } from '../src/manifest';
import { novaThread } from '../src/thread';
import { exec } from '../src/util';
import { FASES, Fase, Modo } from '../src/types';

const SP = 'America/Sao_Paulo';
const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
const erro = (f: () => unknown): string => { try { f(); return '(sem erro)'; } catch (e) { return (e as Error).message; } };

function casosDePrompt(casos: Record<string, string>): void {
  casos['prompt: contratos das fases'] = FASES.map((f) => CONTRATO_DAS_FASES[f]).join('\n');
  casos['prompt: regras de evidencia'] = [...REGRAS_DE_EVIDENCIA, REGRA_DAS_ESPERAS].join('\n');
  casos['prompt: fecho do GO'] = fechoDoGo('ork-x1');
  casos['prompt: dica do grafo'] = pedidoComDicaDoGrafo('pedido y', 'ork-x1', true);
  for (const modo of Object.keys(MODOS)) {
    for (const fase of FASES) {
      let thread;
      try { thread = threadDeExemplo(modo as Modo, fase); } catch { continue; }
      if (!thread.fases.includes(fase)) continue;
      for (const variante of [null, 'gap'] as const) for (const worktree of ['mantida', null] as const) {
        for (const memoria of ['', '\n## Memoria injetada (regime x)\n- item']) {
          const t = { ...thread, ...(variante ? { variante } : {}), ...(worktree === null ? { worktree: null } : {}) };
          const nome = `prompt sha256: ${modo}/${fase}/${variante ?? 'sem-variante'}/${worktree ?? 'sem-worktree'}/${memoria ? 'memoria' : 'sem-memoria'}`;
          casos[nome] = sha(montarPrompt(t as never, fase as Fase, 'pedido do builder', undefined, memoria));
        }
      }
    }
  }
  for (const [modo, fase] of [['classic', 'GOAL'], ['auto', 'GO'], ['fast', 'GO']] as const) {
    casos[`prompt inteiro: ${modo}/${fase}`] = montarPrompt(threadDeExemplo(modo, fase), fase, 'pedido do builder');
  }
  casos['prompt: valores classic/CHECK'] = JSON.stringify(valoresDoPrompt(threadDeExemplo('classic', 'CHECK'), 'CHECK', 'pedido'), null, 1);
  const padrao = exigirTemplate('fase-padrao');
  const mutacoes: [string, (s: string) => string][] = [
    ['sem id', (s) => s.replace('id: fase-padrao', 'id: ')], ['versao invalida', (s) => s.replace(/versao: \d+/, 'versao: zero')],
    ['sem descricao', (s) => s.replace(/descricao: .*/, 'descricao: ')], ['fase invalida', (s) => s.replace('fases: [GOAL', 'fases: [GOL')],
    ['variavel nao declarada', (s) => s.replace('{{pedido}}', '{{pedido}} {{nova}}')], ['sem pedido', (s) => s.replace('{{pedido}}', '(o de sempre)')],
    ['sem secao', (s) => s.replace('## Ciclo canonico', '## outra')],
    ['sem regra central', (s) => s.replace('REGRA CENTRAL: o modo afrouxa a pausa, NUNCA a verificacao.', 'x')],
    ['segredo', (s) => s.replace('## Pedido do builder', '## Pedido do builder\nuse sk-ant-abcdefghijklmnopqrst')],
    ['tamanho', (s) => s + '\n' + 'x'.repeat(17000)], ['texto livre', (s) => s.replace('{{pedido}}', '{{pedido}}\nCole aqui o texto livre da resposta')],
    ['travessao', (s) => s + '\n\u2014'],
  ];
  for (const [nome, mutar] of mutacoes) casos[`prompt lint: ${nome}`] = textoDoLint(lintTemplate(parseTemplate(mutar(padrao.bruto), 'embutido')), 1);
  casos['prompt lint: id divergente do arquivo'] = textoDoLint(lintTemplate({ ...padrao, origem: '/x/fase-goal.md' }), 1);
  casos['prompt lint: nenhum problema'] = textoDoLint([], 3);
  casos['prompt list: embutido'] = tabelaDeTemplates([padrao]);
  casos['prompt erro: variavel sem valor'] = erro(() => renderizar(padrao, { pedido: 'x' }));
  casos['prompt erro: sem frontmatter'] = erro(() => parseTemplate('sem frontmatter', 'a.md'));
}

const BASE_DECIDIDO = {
  contrato: 'ork.hitl/v2', classe: 'decidido', id: '1ef53703-426f-4152-b308-533d1768ab25', thread: 'ork-x1', fase: 'GO', modo: 'auto',
  criadoEm: '2026-10-15T00:00:00.000Z', profundidade: 'resumo', decidido: 'a decisao', porque: 'o porque', comoMudar: 'como mudar',
  custoDeReverter: { agora: 'baixo', depois: 'medio' }, criterio: { tipo: 'medicao', referencia: 'npm test' },
};

function casosDeDecisao(casos: Record<string, string>): void {
  const variantes: [string, Record<string, unknown>][] = [
    ['sem decidido', { decidido: undefined }], ['porque vazio', { porque: '' }], ['quebra de linha', { comoMudar: 'a\nb' }],
    ['controle', { decidido: 'a\u0001b' }], ['porque longo', { porque: 'x'.repeat(5000) }], ['custo sem depois', { custoDeReverter: { agora: 'x' } }],
    ['custo com quebra', { custoDeReverter: { agora: 'x', depois: 'a\nb' } }], ['custo longo', { custoDeReverter: { agora: 'x'.repeat(5000), depois: 'y' } }],
    ['sem criterio', { criterio: undefined }], ['criterio de outro tipo', { criterio: { tipo: 'outro', referencia: 'x' } }],
    ['criterio vazio', { criterio: { tipo: 'ledger', referencia: '' } }], ['criterio com quebra', { criterio: { tipo: 'ledger', referencia: 'a\nb' } }],
    ['criterio longo', { criterio: { tipo: 'ledger', referencia: 'x'.repeat(400) } }], ['campo de gate', { irreversivel: true }],
    ['alternativas', { alternativas: [] }], ['pergunta', { pergunta: 'x' }], ['recomendada', { recomendada: 'a' }],
    ['alvo', { alvo: { tipo: 'gate' } }], ['expiracao', { expiraEm: 'x' }],
  ];
  for (const [nome, v] of variantes) {
    const pedido: Record<string, unknown> = { ...BASE_DECIDIDO, ...v };
    for (const k of Object.keys(v)) if (v[k] === undefined) delete pedido[k];
    const recusa = erro(() => validarPedidoHitlV2(pedido));
    casos[`decisao hitl: ${nome}`] = recusa;
    casos[`decisao hitl no CLI: ${nome}`] = recusaNaSuperficie(recusa, CAMPOS_DA_DECISAO_NO_CLI);
    casos[`decisao hitl no MCP: ${nome}`] = recusaNaSuperficie(recusa, CAMPOS_DA_DECISAO_NO_MCP);
  }
  casos['decisao rastro: sem nada'] = erro(() => exigirRastroDeDecisaoAutonoma({}));
  casos['decisao rastro: evidencia longa'] = erro(() => exigirRastroDeDecisaoAutonoma({ quemDecidiu: 'a', evidencia: 'x'.repeat(1001), razao: 'b' }));
  // O criterio contra um projeto temporario, com a thread de id fixo.
  const raiz = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-f3c-casos-')));
  try {
    exec('git', ['init', '-q', '-b', 'main'], raiz);
    init(raiz, { nome: 'orkastery', abbrev: 'ork' });
    const { thread } = novaThread(exigirManifesto(raiz), { nome: 'criterio', modo: 'auto', criarWorktree: false } as never);
    const criterios: [string, { tipo: string; referencia: string }][] = [
      ['medicao', { tipo: 'medicao', referencia: 'npm test' }], ['manifesto existente', { tipo: 'manifesto', referencia: 'project.name' }],
      ['manifesto ausente', { tipo: 'manifesto', referencia: 'nao.existe' }], ['ledger do primeiro evento', { tipo: 'ledger', referencia: `${thread.id}#evento:1` }],
      ['ledger sem o evento', { tipo: 'ledger', referencia: `${thread.id}#evento:999` }], ['ledger sem forma', { tipo: 'ledger', referencia: 'nao-e-evento' }],
      ['ledger de outra thread', { tipo: 'ledger', referencia: 'ork-zz9#evento:1' }],
    ];
    for (const [nome, criterio] of criterios) {
      const r = resolverCriterio(raiz, { ...BASE_DECIDIDO, thread: thread.id, criterio } as never);
      casos[`decisao criterio: ${nome}`] = JSON.stringify(r).split(raiz).join('<RAIZ>');
    }
    const arquivo = path.join(raiz, '.orkastery', '.gitignore');
    casos['init: gitignore do estado'] = fs.readFileSync(arquivo, 'utf8');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
}

function casosDoPanorama(casos: Record<string, string>): void {
  const quando = '2026-10-12T15:30:00.000Z', antes = '2026-10-12T12:00:00.000Z';
  const thread = (extra: object) => ({ id: 'ork-a1', nome: 'a', modo: '#Auto', fase: 'GO', status: 'aberta', roadmap: 'RM-061', branch: 'ork/a',
    atualizadaEm: antes, entregue: null, esperaVoce: false, pergunta: null, ...extra });
  const maquina = (extra: object) => ({ maquina: 'pc-b', por: 'p', publicadoEm: antes, idadeMin: 210, semBatida: false, estaMaquina: false,
    origem: 'retrato', versaoOrk: '0.6.0', ativas: [], entreguesSemMaster: 0, threadsLidas: true, ...extra });
  const fonte = (extra: object) => ({ parte: 'roadmap', origem: 'clone', onde: 'origin/main', ref: 'main', commit: 'abcdef1234567', dataDoCommit: antes,
    lidoEm: quando, atualizado: true, existe: true, ...extra });
  const lacuna = (tipo: string, parte: string, alvo: string | undefined, detalhe: string, correcao: string) =>
    ({ tipo, parte, ...(alvo ? { alvo } : {}), detalhe, correcao });
  const lacunas = [lacuna('rede.sem-projeto', 'rede', undefined, 'nenhum projeto conhecido', 'peça o projeto'),
    lacuna('reservas.sem-leitura', 'reservas', 'loja', 'gh falhou: 404', 'confira o login'),
    lacuna('fabrica.sem-branch', 'fabrica', 'loja', 'ork/fabrica-estado não existe', 'rode ork fabrica entrar'),
    lacuna('maquina.sem-batida', 'fabrica', 'pc-b', 'sem batida há 3 h', 'confira a máquina'),
    lacuna('maquina.sem-fabrica', 'rede', 'pc-c', 'na rede sem fábrica', 'rode ork fabrica entrar'),
    lacuna('roadmap.pagina-invalida', 'roadmap', 'RM-001', 'cabeçalho ilegível', 'corrija a página'),
    lacuna('forja.leitura-parcial', 'forja', 'loja', 'parcial', 'confira'), lacuna('registro.invalido', 'registro', undefined, 'json ruim', 'refaça')];
  const projeto = (extra: object) => ({ projeto: { nome: 'loja', forja: 'github.com/p/loja', clone: '/srv/loja', base: 'main', origem: 'cwd', fuso: SP },
    roadmap: null, reservas: [], maquinas: [], fontes: [], lacunas: [], ...extra });
  const base = { contrato: CONTRATO_PANORAMA_DA_REDE, consultadoEm: quando, maquina: 'pc-a', pedido: null, limiarSemBatidaMin: 30, fuso: SP };
  const panoramas: [string, object][] = [
    ['vazio', { ...base, projetos: [], rede: null, naoConsultado: [], lacunas: [] }],
    ['completo', { ...base, pedido: 'loja', lacunas,
      naoConsultado: ['registro de projetos desta máquina (RM-052): /h/.orkastery/projetos.json ausente', 'projeto outro: fora do pedido (--projeto)',
        'rede por pessoa (RM-053, ork.rede-status/v1): sem login; as máquinas vêm da branch ork/fabrica-estado de cada projeto'],
      rede: { casa: 'github.com/p/orkastery-network', ponta: 'abcdef1234', atualizado: true, lidoEm: quando, membros: [
        { maquina: 'pc-a', estaMaquina: true, publicadoEm: antes, idadeMin: 5, semBatida: false, versaoOrk: '0.6.0', projetos: ['loja', 'b'] },
        { maquina: 'pc-b', estaMaquina: false, publicadoEm: antes, idadeMin: null, semBatida: true, versaoOrk: null, projetos: [] }] },
      projetos: [projeto({ maquinas: null, reservas: null, fontes: [], lacunas }),
        projeto({ projeto: { nome: 'b', forja: null, clone: null, base: null, origem: 'rede', fuso: 'Europe/Lisbon' },
          maquinas: [maquina({ estaMaquina: true, origem: 'estado-local', ativas: [thread({}),
            thread({ roadmap: null, runtime: 'claude-bg', modelo: 'opus', esperaVoce: true, pergunta: null }), thread({ esperaVoce: true, pergunta: 'objetivo' })],
          entreguesSemMaster: 2 }), maquina({ origem: 'rede', semBatida: true }), maquina({ semBatida: true })],
          reservas: [{ contrato: 'ork.roadmap-reserva/v1', item: 'RM-061', por: 'p', maquina: 'pc-b', thread: null, nota: null, desdeEm: antes, atualizadaEm: antes },
            { contrato: 'ork.roadmap-reserva/v1', item: 'RM-062', por: 'p', maquina: 'pc-a', thread: 'ork-a1', nota: null, desdeEm: antes, atualizadaEm: antes }],
          fontes: [fonte({}), fonte({ parte: 'reservas', origem: 'forja', onde: 'github.com/p/b@ork/roadmap-reservas', atualizado: false }),
            fonte({ parte: 'fabrica', existe: false, lidoEm: antes }), fonte({ parte: 'estado-local', origem: 'estado-local', onde: '/srv/b/.orkastery' })] })] }],
    ['casa sem ponta', { ...base, projetos: [projeto({})], rede: { casa: null, ponta: null, atualizado: null, lidoEm: quando, membros: [] },
      naoConsultado: [], lacunas: [] }],
    ['casa nao lida', { ...base, projetos: [], rede: { casa: 'g/c', ponta: null, atualizado: null, lidoEm: quando, membros: [] }, naoConsultado: [], lacunas: [] }],
    ['casa sem leitura nova', { ...base, projetos: [], rede: { casa: 'g/c', ponta: null, atualizado: false, lidoEm: antes, membros: [] }, naoConsultado: [], lacunas: [] }],
  ];
  for (const [nome, p] of panoramas) casos[`network roadmap: ${nome}`] = textoDoPanoramaDaRede(p as PanoramaDaRede);
  casos['network roadmap: contrato invalido'] = erro(() => textoDoPanoramaDaRede({ contrato: 'x' } as never));
  for (const [codigo, candidatos] of [['projeto.ambiguo', ['a (clone em /a)', 'b']], ['projeto.desconhecido', []], ['projeto.sem-manifesto', []]] as const) {
    casos[`network roadmap recusa: ${codigo}`] = new ErroDoPedidoDeProjeto(codigo as never, 'detalhe d', [...candidatos], 'correcao c').texto;
  }
}

function casosDoAchado(casos: Record<string, string>): void {
  const achado = (extra: object) => ({ id: 'F1', severidade: 'maior', pack: 'reuse', regra: 'RU1', titulo: 'helper duplicado', arquivo: 'src/a.ts', linha: 2,
    descricao: 'duas vezes', rodada: 'audit-1', produto: 'p', estagio: 'nascente', postura: 'advisory', estado: 'aberto', thread: null,
    claim: { id: 'C1', estado: 'verificado', alegacao: 'existe', verificar: ['grep x src/a.ts'] },
    proposta: { impacto: 'duas fontes', fix: 'manter uma', passoIrreversivel: 'nenhum', estimativa: '1h', destino: 'roadmap', regime: 'proposta' }, ...extra });
  const variantes: [string, object][] = [['aberto', {}], ['virou thread', { linha: null, descricao: '', thread: 'ork-x1', estado: 'virou-thread' }],
    ['claim pendente', { claim: { id: 'C2', estado: 'pendente', alegacao: 'a', verificar: [] } }]];
  for (const [nome, extra] of variantes) {
    casos[`from-finding ficha: ${nome}`] = textoDoAchado(achado(extra) as never);
    casos[`from-finding pedido: ${nome}`] = pedidoDoAchado(achado(extra) as never);
  }
}

/** Gera todos os casos, no fuso fixo de Sao Paulo, sem depender do locale do processo (o padrao, pt-BR). */
export function gerarCasos(): Record<string, string> {
  definirFusoDoDono(SP);
  const casos: Record<string, string> = {};
  try {
    casosDePrompt(casos);
    casosDeDecisao(casos);
    casosDoPanorama(casos);
    casosDoAchado(casos);
  } finally {
    definirFusoDoDono(undefined);
  }
  return casos;
}
