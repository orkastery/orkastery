/**
 * RM-063 (F5): a autorizacao duravel do dono para a varredura agir sozinha nesta maquina.
 *
 * Incidente de 03 a 12/10/2026 (P4 e P5 da pagina da RM-063): o PR #112 foi mesclado e ficou dois dias sem
 * `ork ship registrar-pr`, e as sessoes fantasmas de threads fechadas ficaram registradas, porque nada roda esses
 * comandos sem um condutor. Agora a batida da varredura (`pulse-delivery`) faz isso sozinha, mas SO com a autorizacao
 * do dono gravada nesta maquina, com prazo e com a lista do que ela pode. Sem autorizacao (ou com ela vencida,
 * ilegivel, de outra maquina ou de outro projeto), cada acao vira um item da fila do pulse com o comando pronto.
 *
 * O arquivo e desta maquina e fica fora do git, como o `pulse-host.json` (RM-047):
 * `.orkastery/monitor/autorizacao.json` no checkout canonico. O contrato e `ork.autorizacao-duravel/v1`; a referencia
 * esta em `docs/referencia/contratos/autorizacao-duravel-rm063.md`. A leitura (`lerAutorizacao`) nunca grava; a F7
 * grava pelo `ork conducao autorizar` (`gravarAutorizacao`), ato do dono, na mesma forma que a leitura confere.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { raizDoEstado } from './estado-thread';
import { formatarDataHoraRotulada, instanteNoFuso, isoComFuso, normalizarFuso } from './horario';
import { registrar, TIPOS_DE_EVENTO } from './ledger';
import { autoriaHumana } from './master';
import { marcaDeHost } from './master-nota';
import { nomeDaMaquina } from './maquina';
import { rastreadoPeloGit } from './procedencia';
import { ENV_IDENTIDADE_DE_DESPACHO, ENV_THREAD_DO_DESPACHO } from './runtime-ambiente';
import { exec } from './util';

export const CONTRATO_DA_AUTORIZACAO = 'ork.autorizacao-duravel/v1' as const;
export const ARQUIVO_DA_AUTORIZACAO = 'autorizacao.json';
/** Um arquivo de autorizacao tem poucas linhas; acima disto, nao e o que o dono gravou. */
const TETO_DO_ARQUIVO = 64 * 1024;

/**
 * As acoes do contrato. A varredura da F5 faz `limpar` (sessoes fantasmas), `registrar` (a entrega de PR ja mesclado)
 * e `master` (o MASTER por omissao); a batida da conducao da F7 (`ork conducao batida`) faz tambem `merge` (o PR verde de
 * branch `ork/*`) e `despachar` (a fase seguinte com o prompt gravado). Tag e publicacao nunca entram.
 */
export const ACOES_DA_AUTORIZACAO = ['limpar', 'registrar', 'master', 'merge', 'despachar'] as const;
export type AcaoAutorizavel = typeof ACOES_DA_AUTORIZACAO[number];

export interface AutorizacaoDuravel {
  contrato: typeof CONTRATO_DA_AUTORIZACAO;
  /** A maquina onde ela vale (`ork fabrica entrar --maquina`, `ORK_MAQUINA` ou o hostname). */
  maquina: string;
  /** O `project.name` do manifesto do checkout onde ela vale. */
  projeto: string;
  /** Quem autorizou: o dono. */
  por: string;
  concedidaEm: string;
  /** O prazo, em ISO com fuso: depois dele, nada e feito sozinho. */
  ate: string;
  pode: AcaoAutorizavel[];
  /** Uma referencia livre (a decisao do dono, por exemplo "X1.a"). */
  nota?: string;
}

/** Por que a autorizacao nao vale, tipado. `autorizacao.ausente` e o estado de quem nunca autorizou. */
export type MotivoDaAutorizacao = 'autorizacao.ausente' | 'autorizacao.rastreada' | 'autorizacao.ilegivel' |
  'autorizacao.contrato' | 'autorizacao.campo' | 'autorizacao.acao-desconhecida' | 'autorizacao.outra-maquina' |
  'autorizacao.outro-projeto' | 'autorizacao.expirada';

export type LeituraDaAutorizacao =
  | { valida: true; arquivo: string; autorizacao: AutorizacaoDuravel; sha256: string }
  | { valida: false; arquivo: string; motivo: MotivoDaAutorizacao; detalhe: string; autorizacao?: AutorizacaoDuravel };

/** O arquivo da autorizacao desta maquina, no checkout canonico (de dentro de uma worktree, o da raiz). */
export function caminhoDaAutorizacao(raiz: string): string {
  return path.join(raizDoEstado(raiz), '.orkastery', 'monitor', ARQUIVO_DA_AUTORIZACAO);
}

/** A data e a hora existem no calendario (o `Date.parse` aceitaria 30/02 e o levaria a marco, calado). */
const noCalendario = (v: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return false;
  const [ano, mes, dia, hora, minuto] = m.slice(1).map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia && hora <= 23 && minuto <= 59;
};
/** O instante com o fuso explicito (`Z` ou `-03:00`): sem ele, o prazo dependeria do fuso de quem le. */
const instante = (v: unknown): boolean => typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && noCalendario(v) &&
  Number.isFinite(Date.parse(v));
const textoCurto = (v: unknown, teto: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= teto &&
  !/\p{Cc}/u.test(v);

/**
 * Le e confere a autorizacao desta maquina. Cada recusa tem motivo tipado e detalhe; so a valida, no prazo, desta
 * maquina e deste projeto, autoriza alguma coisa.
 */
export function lerAutorizacao(raiz: string, opcoes: { projeto: string; agora?: Date; maquina?: string }): LeituraDaAutorizacao {
  const arquivo = caminhoDaAutorizacao(raiz);
  const recusa = (motivo: MotivoDaAutorizacao, detalhe: string, autorizacao?: AutorizacaoDuravel): LeituraDaAutorizacao =>
    ({ valida: false, arquivo, motivo, detalhe, ...(autorizacao ? { autorizacao } : {}) });
  const st = fs.lstatSync(arquivo, { throwIfNoEntry: false });
  if (!st) return recusa('autorizacao.ausente', 'nenhuma autorizacao duravel gravada nesta maquina');
  // RM-047: como o transporte do pulse, a autorizacao so vale do arquivo local desta maquina.
  if (!st.isFile()) return recusa('autorizacao.rastreada', 'a autorizacao precisa ser um arquivo comum desta maquina, nao link nem diretorio');
  if (rastreadoPeloGit(raiz, arquivo)) return recusa('autorizacao.rastreada', 'a autorizacao esta versionada no git; ela so vale do arquivo local desta maquina');
  if (st.size > TETO_DO_ARQUIVO) return recusa('autorizacao.ilegivel', `o arquivo passa de ${TETO_DO_ARQUIVO} bytes`);
  let bruto: string, dado: Record<string, unknown>;
  try {
    bruto = fs.readFileSync(arquivo, 'utf8');
    const lido = JSON.parse(bruto) as unknown;
    if (!lido || typeof lido !== 'object' || Array.isArray(lido)) throw new Error('nao e um objeto JSON');
    dado = lido as Record<string, unknown>;
  } catch (e) { return recusa('autorizacao.ilegivel', `o arquivo nao e JSON valido (${(e as Error).message.slice(0, 120)})`); }
  if (dado.contrato !== CONTRATO_DA_AUTORIZACAO) return recusa('autorizacao.contrato', `o contrato precisa ser ${CONTRATO_DA_AUTORIZACAO}`);
  for (const [campo, teto] of [['maquina', 80], ['projeto', 80], ['por', 120]] as const) {
    if (!textoCurto(dado[campo], teto)) return recusa('autorizacao.campo', `o campo ${campo} precisa ser texto de ate ${teto} caracteres`);
  }
  // A autoria e a mesma regra da nota do MASTER: nome de agente, de runtime ou generico nao autoriza nada.
  if (!autoriaHumana(dado.por)) {
    return recusa('autorizacao.campo', 'o campo por precisa nomear a pessoa que autorizou; agente, runtime ou nome generico nao autoriza');
  }
  for (const campo of ['concedidaEm', 'ate'] as const) {
    if (!instante(dado[campo])) {
      return recusa('autorizacao.campo', `o campo ${campo} precisa ser um instante ISO com fuso (Z ou -03:00), como 2026-10-18T23:59:00-03:00`);
    }
  }
  if (dado.nota !== undefined && !textoCurto(dado.nota, 300)) return recusa('autorizacao.campo', 'a nota precisa ser texto de ate 300 caracteres');
  const pode = dado.pode;
  if (!Array.isArray(pode) || pode.length === 0 || pode.some((a) => typeof a !== 'string') || new Set(pode).size !== pode.length) {
    return recusa('autorizacao.campo', 'o campo pode precisa ser uma lista de acoes, sem repeticao');
  }
  const desconhecida = pode.find((a) => !(ACOES_DA_AUTORIZACAO as readonly string[]).includes(a as string));
  if (desconhecida !== undefined) {
    return recusa('autorizacao.acao-desconhecida', `a acao ${JSON.stringify(desconhecida)} nao e do contrato (${ACOES_DA_AUTORIZACAO.join(', ')})`);
  }
  const autorizacao: AutorizacaoDuravel = {
    contrato: CONTRATO_DA_AUTORIZACAO, maquina: dado.maquina as string, projeto: dado.projeto as string, por: dado.por as string,
    concedidaEm: dado.concedidaEm as string, ate: dado.ate as string, pode: pode as AcaoAutorizavel[],
    ...(typeof dado.nota === 'string' ? { nota: dado.nota } : {}),
  };
  const maquina = opcoes.maquina ?? nomeDaMaquina();
  if (autorizacao.maquina !== maquina) {
    return recusa('autorizacao.outra-maquina', `a autorizacao e da maquina ${autorizacao.maquina}, e esta e ${maquina}`, autorizacao);
  }
  if (autorizacao.projeto !== opcoes.projeto) {
    return recusa('autorizacao.outro-projeto', `a autorizacao e do projeto ${autorizacao.projeto}, e este e ${opcoes.projeto}`, autorizacao);
  }
  const agora = opcoes.agora ?? new Date();
  if (Date.parse(autorizacao.ate) <= agora.getTime()) {
    return recusa('autorizacao.expirada', `o prazo acabou em ${formatarDataHoraRotulada(autorizacao.ate, { agora: agora.toISOString() })}`,
      autorizacao);
  }
  return { valida: true, arquivo, autorizacao, sha256: createHash('sha256').update(bruto, 'utf8').digest('hex') };
}

/** A acao esta autorizada agora? */
export function autorizada(leitura: LeituraDaAutorizacao, acao: AcaoAutorizavel): boolean {
  return leitura.valida && leitura.autorizacao.pode.includes(acao);
}

/** A referencia que vai ao ledger com cada acao feita: quem autorizou, ate quando e qual arquivo. */
export function referenciaDaAutorizacao(leitura: LeituraDaAutorizacao): Record<string, unknown> | null {
  if (!leitura.valida) return null;
  const a = leitura.autorizacao;
  return { contrato: a.contrato, por: a.por, ate: a.ate, pode: a.pode, sha256: leitura.sha256, ...(a.nota ? { nota: a.nota } : {}) };
}

/** Uma linha para o `ork fabrica batida status` e para o pulse. */
export function linhaDaAutorizacao(leitura: LeituraDaAutorizacao, agora: string = new Date().toISOString()): string {
  if (leitura.valida) {
    const a = leitura.autorizacao;
    return `autorização durável de ${a.por} até ${formatarDataHoraRotulada(a.ate, { agora })}: a varredura pode ${a.pode.join(', ')}`;
  }
  if (leitura.motivo === 'autorizacao.ausente') {
    return 'sem autorização durável: as ações da varredura viram itens da fila do pulse, com o comando pronto';
  }
  return `autorização durável sem valor (${leitura.motivo}: ${leitura.detalhe}); as ações da varredura viram itens da fila do pulse`;
}

// ---------------------------------------------------------------------------
// RM-063 (F7): a gravacao, pelo `ork conducao autorizar`.
// ---------------------------------------------------------------------------

/** O que nunca entra na autorizacao duravel, nem com o nome que o dono der: fica sempre com ele. */
const ACOES_PROIBIDAS = ['tag', 'tags', 'publicar', 'publicacao', 'publicação', 'release', 'publish', 'npm', 'versao', 'versão'];

/**
 * O prazo mais longo que uma autorizacao pode ter: o dono renova quando quiser, e a permissao esquecida nao vale para
 * sempre.
 */
export const PRAZO_MAXIMO_DIAS = 31;

/** Por que o pedido de autorizacao foi recusado antes de gravar qualquer coisa. */
export type MotivoDaGravacao = 'autorizacao.sessao-despachada' | 'autorizacao.host' | 'autorizacao.ate-invalido' |
  'autorizacao.ate-passado' | 'autorizacao.ate-longe' |
  'autorizacao.pode-vazio' | 'autorizacao.pode-repetido' | 'autorizacao.acao-desconhecida' | 'autorizacao.acao-proibida' |
  'autorizacao.por' | 'autorizacao.nota' | 'autorizacao.rastreada';

export interface PedidoDeAutorizacao {
  /** `--ate`: instante ISO com fuso, `AAAA-MM-DD` (23:59 no fuso do dono) ou `AAAA-MM-DDTHH:MM` (no fuso do dono). */
  ate: string;
  /** `--pode`: a lista separada por virgula. */
  pode: string;
  /** `--por`: quem autoriza; sem ele, o `user.name` do git deste checkout. */
  por?: string | null;
  nota?: string | null;
  projeto: string;
  /** O fuso do dono (`owner.timezone`), para o `--ate` sem fuso. */
  fuso: string;
  agora?: Date;
  maquina?: string;
  /** O canal de quem pediu, so para o registro. */
  canal?: string;
  ambiente?: NodeJS.ProcessEnv;
}

export type GravacaoDaAutorizacao =
  | { ok: true; leitura: Extract<LeituraDaAutorizacao, { valida: true }>; anterior: AutorizacaoDuravel | null }
  | { ok: false; motivo: MotivoDaGravacao; detalhe: string };

/**
 * O prazo do `--ate`, sempre com o fuso escrito. Instante com fuso vale como veio; so a data vale ate 23:59 dela no fuso
 * do dono; data e hora sem fuso, no fuso do dono. O resto e recusado: o prazo nao e adivinhado.
 */
export function prazoDoPedido(bruto: string, fuso: string): string | null {
  const v = bruto.trim();
  if (instante(v)) return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(v);
  const nome = normalizarFuso(fuso);
  if (!m || !nome) return null;
  const hora = m[4] ? Number(m[4]) : 23, minuto = m[5] ? Number(m[5]) : 59;
  if (hora > 23 || minuto > 59) return null;
  const ms = instanteNoFuso(Number(m[1]), Number(m[2]), Number(m[3]), hora, minuto, nome);
  return Number.isFinite(ms) ? isoComFuso(ms, nome) : null;
}

/** O `user.name` do git do checkout, quando nomeia uma pessoa. */
function autorDoGit(raiz: string): string | null {
  const r = exec('git', ['config', 'user.name'], raizDoEstado(raiz), 10000);
  const nome = r.ok ? r.stdout.trim() : '';
  return nome && textoCurto(nome, 120) && autoriaHumana(nome) ? nome : null;
}

/**
 * RM-063 (F7): grava a autorizacao duravel do dono nesta maquina, na forma que `lerAutorizacao` confere. E ato do dono:
 * a sessao despachada pelo `ork` (com a identidade de despacho no ambiente) nunca concede autorizacao a si mesma. O
 * arquivo novo substitui o anterior inteiro, e cada concessao vai ao ledger do projeto (`autorizacao_concedida`), com a
 * que ela substituiu. Tag e publicacao nunca entram, nem com outro nome.
 */
export function gravarAutorizacao(raiz: string, pedido: PedidoDeAutorizacao): GravacaoDaAutorizacao {
  const recusa = (motivo: MotivoDaGravacao, detalhe: string): GravacaoDaAutorizacao => ({ ok: false, motivo, detalhe });
  const ambiente = pedido.ambiente ?? process.env;
  if ((ambiente[ENV_IDENTIDADE_DE_DESPACHO] ?? '').trim() || (ambiente[ENV_THREAD_DO_DESPACHO] ?? '').trim()) {
    return recusa('autorizacao.sessao-despachada', 'a autorização durável é ato do dono: uma sessão despachada pelo ork não a concede ' +
      '(rode no terminal do dono, fora da sessão da fase)');
  }
  // A mesma regra da nota do MASTER em nome de pessoa (D8): de dentro de um host de agente (Claude Code, Codex, Hermes,
  // OpenClaw), quem escreve o --por e o agente. O dono autoriza no proprio terminal.
  const host = marcaDeHost(ambiente);
  if (host) {
    return recusa('autorizacao.host', `a autorização durável é ato do dono no terminal dele: vinda de ${host}, ela não vale ` +
      '(o agente não autoriza a si mesmo)');
  }
  const agora = pedido.agora ?? new Date();
  const ate = prazoDoPedido(pedido.ate, pedido.fuso);
  if (!ate) {
    return recusa('autorizacao.ate-invalido', `--ate ${JSON.stringify(pedido.ate)} não é um prazo: use 2026-10-18 (até 23:59 no fuso ` +
      `${pedido.fuso}), 2026-10-18T18:00 ou um instante com fuso, como 2026-10-18T23:59:00-03:00`);
  }
  if (Date.parse(ate) <= agora.getTime()) {
    return recusa('autorizacao.ate-passado', `o prazo ${formatarDataHoraRotulada(ate, { agora: agora.toISOString() })} já passou`);
  }
  if (Date.parse(ate) - agora.getTime() > PRAZO_MAXIMO_DIAS * 24 * 60 * 60 * 1000) {
    return recusa('autorizacao.ate-longe', `o prazo vai além de ${PRAZO_MAXIMO_DIAS} dias: autorize por menos e renove quando quiser`);
  }
  const pode = pedido.pode.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (!pode.length) return recusa('autorizacao.pode-vazio', `--pode precisa de pelo menos uma ação (${ACOES_DA_AUTORIZACAO.join(', ')})`);
  if (new Set(pode).size !== pode.length) return recusa('autorizacao.pode-repetido', '--pode repete uma ação');
  const proibida = pode.find((a) => ACOES_PROIBIDAS.includes(a));
  if (proibida) {
    return recusa('autorizacao.acao-proibida', `${JSON.stringify(proibida)}: tag e publicação nunca entram na autorização durável; ` +
      'ficam sempre com o dono');
  }
  const desconhecida = pode.find((a) => !(ACOES_DA_AUTORIZACAO as readonly string[]).includes(a));
  if (desconhecida !== undefined) {
    return recusa('autorizacao.acao-desconhecida', `a ação ${JSON.stringify(desconhecida)} não é do contrato (${ACOES_DA_AUTORIZACAO.join(', ')})`);
  }
  const por = (pedido.por ?? '').trim() || autorDoGit(raiz);
  if (!por || !textoCurto(por, 120) || !autoriaHumana(por)) {
    return recusa('autorizacao.por', por ? `--por ${JSON.stringify(por)} não nomeia uma pessoa (agente, runtime ou nome genérico não autoriza)`
      : 'informe --por <seu nome>: o git deste checkout não tem user.name de uma pessoa');
  }
  const nota = (pedido.nota ?? '').trim();
  if (nota && !textoCurto(nota, 300)) return recusa('autorizacao.nota', 'a nota precisa ser texto de até 300 caracteres, sem controle');
  const arquivo = caminhoDaAutorizacao(raiz);
  const st = fs.lstatSync(arquivo, { throwIfNoEntry: false });
  if ((st && !st.isFile()) || rastreadoPeloGit(raiz, arquivo)) {
    return recusa('autorizacao.rastreada', `${arquivo} está no git, ou é link ou diretório: a autorização só vale do arquivo local desta máquina`);
  }
  const lida = lerAutorizacao(raiz, { projeto: pedido.projeto, agora, maquina: pedido.maquina });
  const anterior = lida.valida ? lida.autorizacao : null;
  const autorizacao: AutorizacaoDuravel = {
    contrato: CONTRATO_DA_AUTORIZACAO, maquina: pedido.maquina ?? nomeDaMaquina(), projeto: pedido.projeto, por,
    concedidaEm: isoComFuso(agora.getTime(), normalizarFuso(pedido.fuso) ?? 'UTC'), ate, pode: pode as AcaoAutorizavel[],
    ...(nota ? { nota } : {}),
  };
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    fs.writeFileSync(temporario, JSON.stringify(autorizacao, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporario, arquivo);
  } finally { fs.rmSync(temporario, { force: true }); }
  const leitura = lerAutorizacao(raiz, { projeto: pedido.projeto, agora, maquina: pedido.maquina });
  if (!leitura.valida) throw new Error(`a autorização gravada não foi aceita na releitura (${leitura.motivo}: ${leitura.detalhe})`);
  try {
    registrar(path.join(raizDoEstado(raiz), '.orkastery'), 'projeto', TIPOS_DE_EVENTO.autorizacaoConcedida, {
      maquina: autorizacao.maquina, por, concedidaEm: autorizacao.concedidaEm, ate, pode, ...(nota ? { nota } : {}),
      sha256: leitura.sha256, canal: pedido.canal ?? null,
      substituiu: anterior ? { por: anterior.por, ate: anterior.ate, pode: anterior.pode } : null,
    });
  } catch { /* o arquivo e a autorizacao; o ledger do projeto e o rastro, e a releitura ja provou o arquivo */ }
  return { ok: true, leitura, anterior };
}

/** O texto do `ork conducao autorizacao`: a vigente, ou por que nao ha, e o que isso quer dizer para a batida. */
export function textoDaAutorizacao(leitura: LeituraDaAutorizacao, agora: string = new Date().toISOString()): string {
  if (!leitura.valida) {
    return [`Sem autorização durável válida nesta máquina (${leitura.motivo}): ${leitura.detalhe}.`,
      '  A batida da condução não age sozinha: cada ação vira item da fila do pulse, com o comando pronto.',
      '  Para autorizar: ork conducao autorizar --ate <data> --pode merge,registrar,master,despachar [--por <seu nome>]'].join('\n');
  }
  const a = leitura.autorizacao;
  return [`Autorização durável de ${a.por} até ${formatarDataHoraRotulada(a.ate, { agora })}: a condução pode ${a.pode.join(', ')}.`,
    `  concedida em ${formatarDataHoraRotulada(a.concedidaEm, { agora })} na máquina ${a.maquina}, projeto ${a.projeto}` +
      (a.nota ? `; nota: ${a.nota}` : ''),
    `  arquivo ${leitura.arquivo} (sha256 ${leitura.sha256.slice(0, 12)})`,
    '  Tag e publicação nunca entram. O prazo é do dono: depois dele, nada é feito sozinho.'].join('\n');
}
