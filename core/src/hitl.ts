/**
 * `ork sessions hitl`: radar de sessoes do runtime que exigem acao humana AGORA.
 *
 * O incidente que este arquivo resolve (05/09/2026): uma sessao `claude --bg` da Factory
 * ficou parada em `state: blocked` pedindo o codigo 2FA do `npm publish`, e o
 * orquestrador so descobriu quando o humano reclamou. O `ork monitor` nao pegou porque
 * ele e THREAD-centrico: ele deriva paradas de `thread.json` e `ledger.jsonl`, e aquela
 * sessao nao tinha thread. Pior: para o monitor, uma sessao que aparece no
 * `claude agents` conta como VIVA, entao uma sessao travada era lida como uma sessao
 * trabalhando -- um falso negativo que atrasa roadmap.
 *
 * Este radar cobre o outro lado: ele parte das SESSOES do runtime, e nao das threads.
 *
 * Tres regras que mandam aqui:
 *
 *   1. **Nada de estado novo.** O radar le `claude agents --json --all` e, so para as
 *      sessoes paradas, o `claude logs` daquela sessao. Nao grava nada, entao e seguro
 *      rodar em laco e funciona em sessao criada por qualquer um, dentro ou fora do ork.
 *   2. **Estado desconhecido avisa A MAIS.** Um `state` que o runtime inventar amanha cai
 *      em `desconhecida` e conta como "precisa de humano". Perder uma pausa custa
 *      roadmap; avisar de uma pausa que nao existe custa uma linha de tabela.
 *   3. **Fonte declarada.** O runtime nao diz DESDE QUANDO a sessao esta bloqueada, so
 *      quando ela comecou. Entao o campo se chama `idadeMin` e o texto diz que e idade da
 *      sessao. Chutar o instante do bloqueio seria inventar dado.
 *
 * E um `state: blocked` NAO e uma coisa so. MEDIDO na maquina em 05/09/2026, das 8
 * sessoes `blocked` apenas 2 tinham job vivo: nas outras 6 o `claude logs` respondia
 * "job not found" com codigo 1, ou seja, o estado ficou carimbado depois de o job sair.
 * Tratar as duas como a mesma coisa daria 6 alarmes falsos para 2 verdadeiros, e alarme
 * falso cronico e como o humano aprende a ignorar o radar. Por isso a sessao `blocked`
 * com job vivo e `hitl` (responda o prompt agora) e a sem job vivo e `abandonada`
 * (morreu esperando resposta, o trabalho ficou pela metade e alguem decide o que fazer).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as adapter from './adapters/claude-bg';
import { raizDoEstado } from './estado-thread';
import { controleNativo } from './hitl-sessions';
import { dirThread, listarIds, lerThread } from './thread';
import { lerLedger } from './ledger';
import {
  ClasseDeSessao,
  RadarDeSessoes,
  SessaoNoRadar,
  SessaoRuntime,
  TipoDeHitl,
  EventoLedger,
} from './types';
import { agora, tabela } from './util';
import { duracaoCurta, duracaoRelativa } from './horario';
import { carimbarSessoes } from './hitl-estado';
import { redigirCredenciaisUrl } from './redacao-url';

/** Limite de atencao padrao, em minutos, igual ao do monitor de orquestracao. */
export const ATENCAO_PADRAO_MIN = 30;

export function redigirSegredos(texto: string): string {
  return redigirCredenciaisUrl(texto
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ''))
    .replace(/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g, '[chave privada redigida]')
    .replace(/\b(?:sk-(?:ant-)?[\w-]{16,}|gh[pousr]_[\w]{20,}|AKIA[A-Z0-9]{16})\b/g, '[redigido]')
    .replace(/\b(?:\d{5,15}:[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '[redigido]')
    .replace(/(authorization\s*[:=]\s*)(?:Bearer|Basic)\s+[^\s,;]+/gi, '$1[redigido]')
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redigido]')
    .replace(/((?:token|password|senha|secret|api[_-]?key|authorization)\s*[:=]\s*)[^\s,]+/gi, '$1[redigido]');
}

export function contextoSeguro(texto: string, linhas = 20): string[] {
  return redigirSegredos(texto).split('\n').filter(l => l.trim()).slice(-linhas).map(l => l.slice(0, 400));
}

interface Regra {
  classe: ClasseDeSessao;
  precisaDeHumano: boolean;
  detalhe: string;
}

/**
 * Estados observados do `claude agents --json --all` em 05/09/2026 (versao 2.1.259).
 *
 * `stopped` NAO pede humano: a sessao foi parada por decisao de alguem. `failed` pede,
 * porque alguem precisa decidir entre retomar, corrigir ou abandonar.
 */
const REGRA_POR_ESTADO: Record<string, Regra> = {
  blocked: {
    classe: 'hitl',
    precisaDeHumano: true,
    detalhe: 'sessao parada esperando acao humana (prompt, permissao ou credencial)',
  },
  failed: {
    classe: 'falha',
    precisaDeHumano: true,
    detalhe: 'sessao terminou em erro: alguem decide entre retomar, corrigir ou abandonar',
  },
  working: { classe: 'trabalhando', precisaDeHumano: false, detalhe: 'sessao em execucao' },
  done: { classe: 'concluida', precisaDeHumano: false, detalhe: 'sessao concluiu' },
  stopped: {
    classe: 'interrompida',
    precisaDeHumano: false,
    detalhe: 'sessao parada por decisao humana (`claude stop`)',
  },
  idle: {
    classe: 'interativa',
    precisaDeHumano: false,
    detalhe: 'sessao interativa ociosa, conduzida por um humano no terminal',
  },
};

/** Estado cru da sessao: `state` manda, `status` e o fallback historico. */
export function estadoBruto(s: SessaoRuntime): string {
  const bruto = s.state ?? s.status ?? '';
  return typeof bruto === 'string' ? bruto.trim().toLowerCase() : '';
}

/** Classifica o estado cru do runtime. Estado que nao esta no mapa avisa a mais. */
export function classificarEstado(estado: string): Regra {
  const regra = REGRA_POR_ESTADO[estado];
  if (regra) return regra;
  return {
    classe: 'desconhecida',
    precisaDeHumano: true,
    detalhe: estado === ''
      ? 'runtime nao informou estado desta sessao: tratada como possivel parada'
      : `estado "${estado}" nao esta no catalogo do ork: tratado como possivel parada`,
  };
}

/** Resposta do `claude logs` quando o job da sessao ja saiu do runtime. */
const JOB_SUMIU = /job not found|may have already exited|no job matching/i;
/**
 * I-45: nesta VPS o `claude logs` de sessao morta responde `connect ENOENT .../control.sock`: o
 * daemon que controlava o job nao existe mais. So o cache usa este sinal; a confirmacao de
 * superacao continua exigindo a frase de job ausente, como antes.
 */
const SOCKET_AUSENTE = /connect ENOENT \S*control\.sock/i;

/** Linha de menu do runtime (`1. Passo o codigo agora`, `❯2.Eu mesmo publico`). */
const OPCAO = /^[^\w\d]{0,4}(\d{1,2})[.)]\s*(\S.*)$/;

/**
 * Item de menu de SELECAO (`❯ [✔] codegraph`, `[ ] outro`), sem numero nenhum.
 *
 * MEDIDO na maquina em 05/09/2026: as duas sessoes `blocked` com job vivo estavam
 * paradas exatamente neste formato -- o prompt de habilitar servidores MCP. Enxergar so
 * o menu numerado deixava a fila do humano sem pergunta e sem alternativa, que e o dado
 * pelo qual o radar existe.
 */
const OPCAO_MARCADA = /^[^\w\d]{0,4}\[([ xX✔✓*])\]\s*(\S.*)$/;

/** Casa uma linha de menu nos dois formatos e devolve o rotulo ja normalizado. */
function casarOpcao(linha: string): string | null {
  const numerada = linha.match(OPCAO);
  if (numerada) return `${numerada[1]}. ${numerada[2]}`;
  const marcada = linha.match(OPCAO_MARCADA);
  if (marcada) return `[${marcada[1].trim() === '' ? ' ' : 'x'}] ${marcada[2]}`;
  return null;
}

/** Rodapes e molduras do dump de tela que nunca sao pergunta. */
const RUIDO = /^[\s─│|>❯·]*$/;

/** Palavras que denunciam pedido de segredo. O caso 2FA do incidente cai aqui. */
const CREDENCIAL = /\b(2fa|otp|mfa|token|senha|password|credenc|autentic|authenticat|login|api[- ]?key|secret)\b/i;

/** Palavras do prompt de permissao do proprio Claude Code. */
const PERMISSAO =
  /\b(do you want to proceed|allow this|permitir|permission|grant access|trust this|requires? approval|new mcp servers?|wish to enable|to reject all)\b/i;

export interface PerguntaDaTela {
  pergunta: string;
  alternativas: string[];
  tipo: TipoDeHitl;
}

/**
 * Extrai a pergunta e as opcoes do dump de tela de uma sessao parada.
 *
 * O `claude logs` devolve uma GRAVACAO DE TERMINAL, nao um log estruturado: o menu vem
 * como as linhas que estao na tela no momento. Entao a leitura e do FIM para o comeco --
 * o menu aberto e a ultima coisa desenhada -- e o que sai daqui e declaradamente uma
 * leitura de tela, nao um contrato do runtime.
 */
interface MenuLido {
  alternativas: string[];
  /** Indice da primeira linha do menu, de onde a pergunta e procurada para cima. */
  inicio: number;
  /** Indice da ultima linha do menu, ou -1 quando nao ha menu deste formato na tela. */
  fim: number;
}

/** Ultimo bloco de opcoes NUMERADAS da tela: e o menu que esta aberto agora. */
function lerMenuNumerado(linhas: string[]): MenuLido {
  let fim = -1;
  for (let i = linhas.length - 1; i >= 0; i--) {
    if (OPCAO.test(linhas[i])) {
      fim = i;
      break;
    }
  }
  if (fim < 0) return { alternativas: [], inicio: -1, fim: -1 };

  // Sobe enquanto as linhas ainda pertencem ao menu (opcoes e as descricoes delas).
  const alternativas: string[] = [];
  let inicio = fim;
  for (let i = fim; i >= 0 && fim - i < 40; i--) {
    const rotulo = linhas[i].match(OPCAO) ? casarOpcao(linhas[i]) : null;
    if (rotulo) {
      alternativas.unshift(rotulo);
      inicio = i;
    }
  }
  return { alternativas, inicio, fim };
}

/**
 * Ultimo bloco CONTIGUO de opcoes marcadas (`[✔] codegraph`).
 *
 * A contiguidade e o que separa um menu de uma lista de tarefas: o Claude Code desenha
 * TODO com caixinha tambem, e uma varredura frouxa acabaria oferecendo tarefa concluida
 * como se fosse alternativa de resposta.
 */
function lerMenuMarcado(linhas: string[]): MenuLido {
  let fim = -1;
  for (let i = linhas.length - 1; i >= 0; i--) {
    if (OPCAO_MARCADA.test(linhas[i])) {
      fim = i;
      break;
    }
  }
  if (fim < 0) return { alternativas: [], inicio: -1, fim: -1 };

  const alternativas: string[] = [];
  let inicio = fim;
  for (let i = fim; i >= 0; i--) {
    const rotulo = OPCAO_MARCADA.test(linhas[i]) ? casarOpcao(linhas[i]) : null;
    if (!rotulo) break;
    alternativas.unshift(rotulo);
    inicio = i;
  }
  return { alternativas, inicio, fim };
}

export function lerPerguntaDaTela(textoLimpo: string): PerguntaDaTela {
  const linhas = textoLimpo.split('\n').map((l) => l.trim()).filter((l) => l !== '');

  // O menu numerado manda: e o formato mais comum e o mais inequivoco. O menu de selecao
  // so entra quando nao ha nenhum numerado na tela.
  let { alternativas, inicio, fim } = lerMenuNumerado(linhas);
  if (fim < 0) ({ alternativas, inicio, fim } = lerMenuMarcado(linhas));

  if (fim < 0) {
    const tipo = CREDENCIAL.test(textoLimpo)
      ? 'hitl.credencial'
      : PERMISSAO.test(textoLimpo)
        ? 'hitl.permissao'
        : 'hitl.desconhecido';
    return { pergunta: '', alternativas: [], tipo };
  }

  // A pergunta e a ultima linha de texto de verdade ANTES da primeira opcao.
  let pergunta = '';
  for (let i = inicio - 1; i >= 0 && inicio - i < 8; i--) {
    const l = linhas[i].replace(/^[│|>❯\s]+/, '').trim();
    if (RUIDO.test(l) || l.length < 12) continue;
    pergunta = l;
    break;
  }

  const alvo = `${pergunta}\n${alternativas.join('\n')}`;
  const tipo: TipoDeHitl = CREDENCIAL.test(alvo)
    ? 'hitl.credencial'
    : PERMISSAO.test(alvo)
      ? 'hitl.permissao'
      : 'hitl.pergunta';
  return { pergunta, alternativas, tipo };
}

/**
 * A recomendacao unica para cada tipo de parada.
 *
 * Deterministica de proposito: ela responde "o que eu faria", que e o que a regra de
 * conducao exige junto das alternativas, sem precisar de LLM nenhum no nucleo. Quando a
 * sessao ofereceu opcoes proprias, elas vao junto no campo `alternativas` -- o `ork` nao
 * inventa opcao que a sessao nao deu.
 */
export function recomendarPara(
  classe: ClasseDeSessao,
  tipo: TipoDeHitl | null,
  id: string
): string {
  if (classe === 'abandonada') {
    return (
      'nao responda: o job ja saiu. Confira o que ficou na worktree da sessao e ' +
      'redespache so o resto do trabalho.'
    );
  }
  if (classe === 'falha') {
    return `leia \`ork sessions logs ${id}\` e decida entre retomar, corrigir a causa ou abandonar a sessao.`;
  }
  if (classe === 'desconhecida') {
    return `estado fora do catalogo: confirme no \`ork sessions logs ${id}\` se a sessao esta mesmo parada.`;
  }
  switch (tipo) {
    case 'hitl.credencial':
      return (
        `entregue o segredo agora (\`claude attach ${id}\`) para nao segurar a entrega; ` +
        'se este mesmo bloqueio ja se repetiu, troque por credencial de automacao e ele nao volta.'
      );
    case 'hitl.permissao':
      return (
        `responda o prompt (\`claude attach ${id}\`); se o comando e rotineiro nesse projeto, ` +
        'coloque-o na allowlist de permissoes para nao parar de novo pelo mesmo motivo.'
      );
    case 'hitl.pergunta':
      return `abra a sessao (\`claude attach ${id}\`) e escolha entre as opcoes que ela listou.`;
    default:
      return `veja o que a sessao pede com \`ork sessions logs ${id}\` antes de responder.`;
  }
}

/** Minutos inteiros entre um epoch em ms e um carimbo ISO (nunca negativo). */
function idadeEmMinutos(inicioMs: number, ateEm: string): number {
  const fim = Date.parse(ateEm);
  if (!Number.isFinite(inicioMs) || !Number.isFinite(fim)) return 0;
  return Math.max(0, Math.floor((fim - inicioMs) / 60000));
}

/** Duracao curta para a tabela (`12min`, `3h05`, `2d 04h`): mora em `horario.ts` (I-35). */
export { duracaoCurta };

/** Mapa `sessionId -> thread/fase` das threads do projeto, quando ha projeto. */
interface RegistroSessao { id: string; fase: string; slug: string; runtime: string; controlador?: string; desdeEm?: string }
function sessoesRegistradas(raiz: string): Map<string, RegistroSessao> {
  const mapa = new Map<string, RegistroSessao>(), ambiguas = new Set<string>();
  if (raiz === '') return mapa;
  let ids: string[];
  try {
    ids = listarIds(raiz);
  } catch {
    return mapa;
  }
  for (const id of ids) {
    try {
      const t = lerThread(raiz, id);
      for (const s of t.sessoes) {
        const anterior = mapa.get(s.sessionId);
        if (ambiguas.has(s.sessionId)) continue;
        if (anterior && (anterior.id !== t.id || anterior.fase !== s.fase || anterior.runtime !== s.runtime)) {
          mapa.delete(s.sessionId); ambiguas.add(s.sessionId); continue;
        }
        mapa.set(s.sessionId, { id: t.id, fase: s.fase, slug: s.slug, runtime: s.runtime, controlador: s.controlador, desdeEm: s.despachadaEm });
      }
    } catch {
      // Thread ilegivel nao derruba o radar: o radar existe justamente para avisar.
    }
  }
  return mapa;
}

/** Recibo não sobrepõe job vivo ou falha de consulta; só resolve resíduo sem job. */
function temSuperacaoConfirmada(s: SessaoRuntime, registro: RegistroSessao | undefined, eventos: EventoLedger[]): boolean {
  if (!registro || registro.runtime !== 'claude-bg' || !s.id || !s.cwd || !Number.isFinite(s.startedAt)) return false;
  const instancia = JSON.stringify([s.id, s.startedAt]);
  const corresponde = (e: EventoLedger) => e.thread === registro.id && e.sessionId === s.sessionId &&
    e.fase === registro.fase && e.runtime === registro.runtime && e.instancia === instancia && e.cwd === s.cwd;
  const recibo = eventos.filter(e => e.tipo === 'session_superseded' && corresponde(e) &&
    ['ausente', 'stopped', 'done', 'completed', 'exited'].includes(String(e.confirmacao))).at(-1);
  if (!recibo) return false;
  const i = eventos.indexOf(recibo);
  if (eventos.slice(i + 1).some(e => e.sessionId === s.sessionId &&
      ['phase_dispatch', 'sessao_bloqueada', 'session_answer_sending', 'session_superseding'].includes(e.tipo) ||
      e.tipo === 'hitl_requested' && (e.pedido as { alvo?: { sessionId?: string } } | undefined)?.alvo?.sessionId === s.sessionId)) return false;
  const antes = eventos.slice(0, i);
  const tentativa = antes.filter(e => e.tipo === 'session_superseding' && corresponde(e) && e.superadaPor === recibo.superadaPor).at(-1);
  if (!tentativa || typeof recibo.superadaPor !== 'string' || recibo.superadaPor === s.sessionId) return false;
  const despachos = antes.slice(0, antes.indexOf(tentativa));
  const original = despachos.findIndex(e => e.tipo === 'phase_dispatch' && e.sessionId === s.sessionId &&
    e.fase === registro.fase && e.runtime === registro.runtime);
  const posterior = despachos.findIndex((e, n) => n > original && e.tipo === 'phase_dispatch' &&
    e.sessionId === recibo.superadaPor && e.fase === registro.fase);
  return original >= 0 && posterior > original && despachos.slice(posterior + 1).some(e =>
    e.tipo === 'phase_dispatch_verified' && e.sessionId === recibo.superadaPor && e.encontrada === true);
}

export interface OpcoesDoRadar {
  registrar?: boolean;
  escopo?: readonly string[];
  registrarMaquina?: boolean;
  casa?: string;
  consulta?: adapter.ConsultaDeSessoes;
  linhasLogs?: number;
  /** Raiz do projeto ork para casar sessao com thread; vazio varre sem casar. */
  raiz?: string;
  /** Limita a varredura as sessoes sob a raiz (o padrao e a maquina inteira). */
  soDaRaiz?: boolean;
  /** Deixa de fora as sessoes que nao exigem humano. */
  soParadas?: boolean;
  /** Nao le os logs das sessoes paradas (varredura mais barata, sem a pergunta). */
  semLogs?: boolean;
  /** Minutos a partir dos quais a sessao e destacada. */
  atencaoMin?: number;
  /** Instante da consulta (os testes fixam; o CLI usa o relogio). */
  agora?: string;
  /** Teto, em ms, para ler telas nesta varredura; o resto fica para a proxima (I-45). */
  orcamentoLogsMs?: number;
}

/**
 * I-45: sessao cujo job o runtime ja declarou ausente nao volta. Ler a tela dela de novo custa um
 * `claude agents logs` por varredura (7,9 s medidos nesta VPS em 25/09/2026, com a CPU roubada)
 * para descobrir o que ja se sabe. O cache guarda so esse fato negativo, por sessionId, e e gravado
 * na hora em que ele e visto: uma varredura cortada pelo teto nao perde o que ja leu.
 */
export const ORCAMENTO_LOGS_PADRAO_MS = 120_000;
const ARQUIVO_DE_ENCERRADAS = 'radar-encerradas.json';

function caminhoDeEncerradas(raiz: string): string {
  return path.join(raizDoEstado(raiz), '.orkastery', 'monitor', ARQUIVO_DE_ENCERRADAS);
}

/** `sessionId|inicio da instancia` -> instante em que o runtime confirmou o job ausente. */
export function lerSessoesEncerradas(raiz: string): Map<string, string> {
  try {
    const d = JSON.parse(fs.readFileSync(caminhoDeEncerradas(raiz), 'utf8')) as { versao?: number; sessoes?: Record<string, unknown> };
    if (d.versao === 1 && d.sessoes && typeof d.sessoes === 'object') {
      return new Map(Object.entries(d.sessoes).filter((e): e is [string, string] => typeof e[1] === 'string'));
    }
  } catch { /* sem cache: le a tela, como sempre */ }
  return new Map();
}

function gravarSessoesEncerradas(raiz: string, mapa: Map<string, string>): void {
  try {
    const arquivo = caminhoDeEncerradas(raiz);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const tmp = `${arquivo}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ versao: 1, sessoes: Object.fromEntries(mapa) }) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, arquivo);
  } catch { /* o cache e economia: falhar aqui nunca derruba o radar */ }
}

/**
 * Varre o runtime e classifica todas as sessoes.
 *
 * Custo: uma chamada a `claude agents --json --all`, mais uma chamada a `claude logs`
 * POR SESSAO PARADA (e so por essas). Na maquina do incidente, 43 sessoes e 8 paradas.
 */
export function varrerSessoes(opcoes: OpcoesDoRadar = {}): RadarDeSessoes {
  const quando = opcoes.agora ?? agora();
  const atencaoMin = opcoes.atencaoMin ?? ATENCAO_PADRAO_MIN;
  const raiz = opcoes.raiz ?? '';
  const semLogs = opcoes.semLogs === true;
  const linhasLogs = opcoes.linhasLogs ?? 20;
  if (!Number.isInteger(linhasLogs) || linhasLogs < 1 || linhasLogs > 200) throw new Error('linhasLogs deve estar entre 1 e 200');
  const registradas = sessoesRegistradas(raiz);
  const nativas = new Map<string, SessaoRuntime>();
  const detalhesNativos = new Map<string, string>();
  const fimNativas = performance.now() + 1500;
  for (const [sid, reg] of registradas) {
    if (reg.runtime !== 'codex' || !reg.controlador) continue;
    let estado = 'unknown', cwd = '';
    try {
      const restante = Math.max(0, fimNativas - performance.now());
      const r = controleNativo('codex', raiz, reg.id, sid).consultar(restante);
      const limitacao = r.sessoes[0]?.limitacao;
      if (limitacao) detalhesNativos.set(sid, `${limitacao.motivo}: ${limitacao.codigo}; pedido não respondível; interrupção nativa solicitada`);
      else if (!r.ok) detalhesNativos.set(sid, 'runtime.unavailable: consulta não confirmada no orçamento nativo de 1500 ms; alerta preservado');
      if (r.ok && r.sessoes.length === 1) { estado = r.sessoes[0].estado; cwd = r.sessoes[0].cwd; }
    } catch { /* controller incerto continua alerta, nunca vira sessão ausente */ }
    nativas.set(sid, { sessionId: sid, id: sid, kind: 'codex-controller', name: reg.slug, state: estado, cwd, startedAt: Date.parse(reg.desdeEm ?? '') });
  }
  const consultaClaude = opcoes.consulta ?? (adapter.disponivel()
    ? adapter.consultarSessoes(opcoes.soDaRaiz && raiz ? raiz : undefined, true)
    : { ok: false, sessoes: [], detalhe: 'runtime adapter indisponivel nesta maquina (`claude` fora do PATH)' });

  const consulta = { ...consultaClaude, ok: consultaClaude.ok || nativas.size > 0,
    sessoes: [...consultaClaude.sessoes, ...nativas.values()] };
  if (!consulta.ok) {
    return {
      consultadoEm: quando,
      atencaoMin,
      runtimeConsultado: false,
      runtimeDetalhe: consulta.detalhe,
      logsLidos: false,
      raiz,
      sessoes: [],
      resumo: {
        total: 0,
        precisamDeHumano: 0,
        hitl: 0,
        abandonadas: 0,
        falhas: 0,
        trabalhando: 0,
        desconhecidas: 0,
        acimaDoLimite: 0,
        foraDoOrk: 0,
      },
    };
  }

  const brutas = consulta.sessoes;
  const ledgers = new Map<string, EventoLedger[]>();
  const encerradas = raiz ? lerSessoesEncerradas(raiz) : new Map<string, string>();
  const fimDasTelas = performance.now() + (opcoes.orcamentoLogsMs ?? ORCAMENTO_LOGS_PADRAO_MS);
  let telasAdiadas = 0;
  // O cache so vale para quem ja e historia: sessao sem thread ou de thread fechada. Sessao de
  // thread aberta pode ser retomada, e ela continua sendo relida a cada varredura, como antes.
  const statusDaThread = new Map<string, string | null>();
  const threadFechada = (id: string): boolean => {
    if (!statusDaThread.has(id)) {
      try { statusDaThread.set(id, lerThread(raiz, id).status); } catch { statusDaThread.set(id, null); }
    }
    return statusDaThread.get(id) === 'fechada';
  };

  const sessoes: SessaoNoRadar[] = brutas.map((s) => {
    const estado = estadoBruto(s);
    const regra = classificarEstado(nativas.has(s.sessionId) && estado === 'completed' ? 'done' : estado);
    const id = s.id ?? (s.sessionId ?? '').slice(0, 8);
    const idadeMin = idadeEmMinutos(s.startedAt ?? NaN, quando);

    // Os logs custam uma chamada por sessao, entao so as paradas pagam esse preco. E e
    // essa leitura que separa a sessao que espera resposta da que morreu esperando.
    let pergunta = '';
    let alternativas: string[] = [];
    let tipoDeHitl: TipoDeHitl | null = null;
    let jobVivo: boolean | null = null;
    let classe = regra.classe;
    let detalhe = regra.detalhe;
    let precisaDeHumano = regra.precisaDeHumano;
    const registro = registradas.get(s.sessionId ?? '');
    let contextoLogs: string[] = [];
    if (nativas.has(s.sessionId)) {
      jobVivo = !['unknown', 'unavailable', 'stopped', 'completed', 'failed'].includes(estado);
      detalhe = detalhesNativos.get(s.sessionId) ?? 'estado confirmado pelo controller Codex vinculado ao despacho; sem attach/stop de Claude';
    } else if (regra.classe === 'hitl' && !semLogs) {
      const sid = s.sessionId ?? '';
      // A chave inclui o inicio da instancia: a mesma sessao retomada e outra instancia.
      const chaveDoCache = raiz && sid && (!registro || threadFechada(registro.id)) ? `${sid}|${s.startedAt ?? ''}` : '';
      const encerradaEm = chaveDoCache ? encerradas.get(chaveDoCache) : undefined;
      let r: { ok: boolean; texto: string } | null = null;
      let sumiu = false;
      if (encerradaEm) {
        jobVivo = false;
        sumiu = true;
      } else if (performance.now() > fimDasTelas) {
        // Sem ler a tela, a sessao continua `hitl` com job incerto: o pulse a mantem visivel.
        telasAdiadas++;
        detalhe = 'leitura da tela adiada: o orcamento de logs desta varredura acabou; a proxima continua daqui';
      } else {
        r = adapter.logsDaSessao(id, Math.max(80, linhasLogs));
        jobVivo = r.ok && !JOB_SUMIU.test(r.texto);
        sumiu = !r.ok && JOB_SUMIU.test(r.texto);
        const ausente = sumiu || (!r.ok && SOCKET_AUSENTE.test(r.texto));
        if (ausente && chaveDoCache) { encerradas.set(chaveDoCache, quando); gravarSessoesEncerradas(raiz, encerradas); }
      }
      if (jobVivo === false) {
        classe = 'abandonada';
        tipoDeHitl = 'hitl.encerrado';
        detalhe =
          'estado `blocked` carimbado, mas o job ja saiu do runtime: a sessao morreu ' +
          'esperando resposta e o trabalho dela ficou pela metade' +
          (encerradaEm ? ' (job ausente ja confirmado numa varredura anterior)' : '');
        if (sumiu && registro && raiz) {
          try {
            let eventos = ledgers.get(registro.id);
            if (!eventos) { eventos = lerLedger(dirThread(raiz, registro.id)); ledgers.set(registro.id, eventos); }
            if (temSuperacaoConfirmada(s, registro, eventos)) {
              classe = 'interrompida'; tipoDeHitl = null; precisaDeHumano = false;
              detalhe = 'resíduo da mesma instância superada: encerramento confirmado no ledger e job ausente no runtime';
            }
          } catch { /* ausência de evidência preserva o alerta */ }
        }
      } else if (jobVivo === true && r) {
        const lido = lerPerguntaDaTela(r.texto);
        pergunta = redigirSegredos(lido.pergunta);
        alternativas = lido.alternativas.map(redigirSegredos);
        tipoDeHitl = lido.tipo;
        if (lido.alternativas.length === 0) {
          contextoLogs = contextoSeguro(r.texto, linhasLogs);
          detalhe =
            'sessao parada com job vivo, mas a ultima tela nao mostra o menu: ' +
            'da para ver o que ela pede com `ork sessions logs`';
        }
      }
    }

    return {
      id,
      sessionId: s.sessionId ?? '',
      nome: s.name ?? '(sem nome)',
      cwd: s.cwd ?? '',
      kind: s.kind ?? '?',
      estadoBruto: estado,
      classe,
      tipoDeHitl,
      jobVivo,
      precisaDeHumano,
      detalhe,
      recomendacao: precisaDeHumano ? recomendarPara(classe, tipoDeHitl, id) : '',
      desdeEm: Number.isFinite(s.startedAt) ? new Date(s.startedAt as number).toISOString() : '',
      idadeMin,
      pergunta,
      alternativas,
      contextoLogs,
      thread: registro ? { id: registro.id, fase: registro.fase, slug: registro.slug } : null,
      comandos: {
        logs: nativas.has(s.sessionId) ? '' : `ork sessions logs ${id}`,
        attach: nativas.has(s.sessionId) ? '' : `claude attach ${s.sessionId ?? id}`,
        parar: nativas.has(s.sessionId) ? '' : `ork sessions stop ${id}`,
      },
      acimaDoLimite: idadeMin >= atencaoMin,
    };
  });

  carimbarSessoes(sessoes, { raiz, quando, registrar: opcoes.registrar, casa: opcoes.casa, escopo: opcoes.escopo, registrarMaquina: opcoes.registrarMaquina });
  for (const s of sessoes) s.acimaDoLimite = s.paradaHaMin !== null && s.paradaHaMin !== undefined && s.paradaHaMin >= atencaoMin;

  // Ordem: quem precisa de humano primeiro, e dentro do grupo a sessao mais VELHA no
  // topo. E a ordem em que o humano deve atacar a fila.
  const peso = (s: SessaoNoRadar): number =>
    s.classe === 'hitl' ? 0 : s.precisaDeHumano ? 1 : 2;
  sessoes.sort((a, b) => {
    if (peso(a) !== peso(b)) return peso(a) - peso(b);
    if ((b.paradaHaMin ?? -1) !== (a.paradaHaMin ?? -1)) return (b.paradaHaMin ?? -1) - (a.paradaHaMin ?? -1);
    return a.id.localeCompare(b.id);
  });

  const visiveis = opcoes.soParadas === true ? sessoes.filter((s) => s.precisaDeHumano) : sessoes;

  return {
    consultadoEm: quando,
    atencaoMin,
    runtimeConsultado: true,
    runtimeDetalhe: '',
    logsLidos: !semLogs,
    telasAdiadas,
    raiz,
    sessoes: visiveis,
    resumo: {
      total: sessoes.length,
      precisamDeHumano: sessoes.filter((s) => s.precisaDeHumano).length,
      hitl: sessoes.filter((s) => s.classe === 'hitl').length,
      abandonadas: sessoes.filter((s) => s.classe === 'abandonada').length,
      falhas: sessoes.filter((s) => s.classe === 'falha').length,
      trabalhando: sessoes.filter((s) => s.classe === 'trabalhando').length,
      desconhecidas: sessoes.filter((s) => s.classe === 'desconhecida').length,
      acimaDoLimite: sessoes.filter((s) => s.precisaDeHumano && s.acimaDoLimite).length,
      foraDoOrk: sessoes.filter((s) => s.thread === null).length,
    },
  };
}

/** Diretorio curto para a tabela: o `basename` basta para o humano se localizar. */
function dirCurto(cwd: string): string {
  const partes = cwd.replace(/\/$/, '').split('/');
  return partes.length <= 1 ? cwd : partes.slice(-2).join('/');
}

/** Texto de `ork sessions hitl`. */
export function textoDoRadar(r: RadarDeSessoes): string {
  const L: string[] = [];
  L.push(`Radar de sessoes do runtime (${r.resumo.total} sessao(oes) na maquina)`);
  L.push(
    `  precisam de humano: ${r.resumo.precisamDeHumano} (HITL vivo ${r.resumo.hitl}, ` +
      `abandonada ${r.resumo.abandonadas}, falha ${r.resumo.falhas}, ` +
      `estado desconhecido ${r.resumo.desconhecidas}) | ` +
      `trabalhando: ${r.resumo.trabalhando} | fora do ork: ${r.resumo.foraDoOrk}`
  );
  L.push(
    `  limite de atencao: ${r.atencaoMin} min (${r.resumo.acimaDoLimite} parada(s) acima, marcadas com !)`
  );
  if (!r.runtimeConsultado) {
    L.push(`  [fail] ${r.runtimeDetalhe}: NAO da para saber quem esta parado`);
    return L.join('\n');
  }
  if (!r.logsLidos) {
    L.push('  [warn] --sem-logs: o radar diz QUEM esta parado, mas nao O QUE cada sessao pergunta');
  }
  L.push('');

  if (r.sessoes.length === 0) {
    L.push('  Nenhuma sessao na varredura.');
    return L.join('\n');
  }

  L.push(
    tabela(
      ['ID', 'NOME', 'CLASSE', 'ESTADO', 'TIPO', 'DIRETORIO', 'THREAD', 'IDADE'],
      r.sessoes.map((s) => [
        s.id,
        s.nome,
        s.classe,
        s.estadoBruto || '(vazio)',
        s.tipoDeHitl ?? '-',
        dirCurto(s.cwd),
        s.thread ? `${s.thread.id}/${s.thread.fase}` : 'fora do ork',
        `${duracaoRelativa(s.idadeMin)}${s.precisaDeHumano && s.acimaDoLimite ? ' !' : ''}`,
      ])
    )
  );

  const travadas = r.sessoes.filter((s) => s.precisaDeHumano);
  if (travadas.length === 0) {
    L.push('');
    L.push('  Nenhuma sessao esperando o humano.');
    return L.join('\n');
  }

  const vivas = travadas.filter((s) => s.classe !== 'abandonada');
  if (vivas.length > 0) {
    L.push('');
    L.push('Esperando o HUMANO agora, com o job VIVO (responder destrava na hora):');
    for (const s of vivas) {
      L.push(`  ${s.id}  ${s.nome}  [${s.classe}${s.tipoDeHitl ? '/' + s.tipoDeHitl : ''}]`);
      L.push(
        `      onde     : ${s.cwd}` +
          (s.thread ? ` (thread ${s.thread.id}, fase ${s.thread.fase})` : ' (sessao fora do ork)')
      );
      L.push(`      por que  : ${s.detalhe}`);
      if (s.pergunta) L.push(`      pergunta : ${s.pergunta}`);
      for (const linha of s.contextoLogs ?? []) L.push(`      log      : ${linha}`);
      for (const a of s.alternativas) L.push(`      opcao    : ${a}`);
      L.push(`      parada ha: ${s.paradaHaMin == null ? 'desconhecido; registre com --registrar' : duracaoRelativa(s.paradaHaMin) + ' (desde a primeira observação)'}`);
      L.push(`      viva ha  : ${duracaoRelativa(s.idadeMin)} (idade da sessao)`);
      L.push(`      ver      : ${s.comandos.logs}`);
      L.push(`      responder: ${s.comandos.attach}`);
      L.push(`      recomendo: ${s.recomendacao}`);
    }
  }

  const abandonadas = travadas.filter((s) => s.classe === 'abandonada');
  if (abandonadas.length > 0) {
    L.push('');
    L.push('MORRERAM esperando resposta (job ja saiu: nao adianta responder, o trabalho parou):');
    for (const s of abandonadas) {
      L.push(`  ${s.id}  ${s.nome}`);
      L.push(
        `      onde     : ${s.cwd}` +
          (s.thread ? ` (thread ${s.thread.id}, fase ${s.thread.fase})` : ' (sessao fora do ork)')
      );
      L.push(`      por que  : ${s.detalhe}`);
      L.push(`      viva ha  : ${duracaoRelativa(s.idadeMin)} desde que a sessao comecou`);
      L.push(`      recomendo: ${s.recomendacao}`);
    }
  }
  return L.join('\n');
}
