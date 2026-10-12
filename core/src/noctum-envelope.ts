/**
 * RM-058, fatia N1: o contrato do envelope de autorização de um arco #Noctum.
 *
 * O envelope é o que o dono autoriza ANTES do arco: a janela, os destinos e o que pode em cada
 * um, o orçamento com unidade, o horário e o canal do relatório da manhã. As exclusões não são
 * dele: são fixas, ficam guardadas no envelope para o registro e nenhum pedido as amplia.
 *
 * Nada aqui inventa valor do dono. Campo ausente vira recusa que lista tudo o que falta, de uma
 * vez, e teto ilimitado é recusado sempre (D3 da ork-rm058n1). O módulo é puro: não lê disco nem
 * relógio. Quem persiste, autentica a origem e confere antes do efeito é `noctum-arco.ts`.
 *
 * Nada aqui liga o modo: `#Noctum` continua fora de `MODOS_LEGADOS`.
 */
import { createHash } from 'node:crypto';
import { FUSO_DE_BRASILIA, normalizarFuso } from './horario';
import { RUNTIMES_COM_PERFIL } from './runtime-profiles';

export const CONTRATO_ENVELOPE = 'ork.noctum-envelope/v1' as const;

/** D3 do dono (12/10/2026): a janela do arco fica entre 6 e 12 horas. */
export const JANELA_MINIMA_H = 6;
export const JANELA_MAXIMA_H = 12;

/** D1 do dono: push, PR e merge, este só com todas as provas no SHA exato (N5). */
export const PERMISSOES = ['push', 'pr', 'merge'] as const;
export type Permissao = typeof PERMISSOES[number];

/** Nunca entram em envelope nenhum, e por isso não são configuráveis (D6 da ork-rm058n1). */
export const EXCLUSOES_FIXAS = ['tag-e-publicacao', 'producao', 'segredos', 'acao-destrutiva', 'repositorio-publico-novo'] as const;
export type Exclusao = typeof EXCLUSOES_FIXAS[number];

/**
 * Os nomes com que uma ação excluída pode chegar, num pedido de abertura ou antes de um efeito.
 * Ação fora de `PERMISSOES` que não está aqui também é recusada; este mapa só dá o motivo certo.
 */
const EXCLUSAO_POR_NOME: Readonly<Record<string, Exclusao>> = Object.freeze({
  'tag-e-publicacao': 'tag-e-publicacao', tag: 'tag-e-publicacao', publicacao: 'tag-e-publicacao',
  publicar: 'tag-e-publicacao', release: 'tag-e-publicacao', 'publicar-pacote': 'tag-e-publicacao',
  'publicar-site': 'tag-e-publicacao',
  producao: 'producao', deploy: 'producao', 'deploy-producao': 'producao', 'atualizar-producao': 'producao',
  segredos: 'segredos', segredo: 'segredos', 'ler-segredo': 'segredos', credencial: 'segredos',
  'acao-destrutiva': 'acao-destrutiva', destrutiva: 'acao-destrutiva', 'force-push': 'acao-destrutiva',
  apagar: 'acao-destrutiva', 'apagar-branch': 'acao-destrutiva', 'reescrever-historico': 'acao-destrutiva',
  'repositorio-publico-novo': 'repositorio-publico-novo', 'criar-repositorio': 'repositorio-publico-novo',
  'criar-repositorio-publico': 'repositorio-publico-novo',
});

/** Por que cada exclusão fica fora, na frase que a recusa mostra. */
const RAZAO_DA_EXCLUSAO: Readonly<Record<Exclusao, string>> = Object.freeze({
  'tag-e-publicacao': 'tag e publicação de versão, pacote ou site nunca entram em envelope',
  producao: 'produção exige autorização explícita própria e fluxo próprio, que não são o envelope',
  segredos: 'acesso ou circulação de segredos nunca entram em envelope',
  'acao-destrutiva': 'ação destrutiva nunca entra em envelope',
  'repositorio-publico-novo': 'criar repositório público nunca entra em envelope',
});

/** D3 da ork-rm058n1: lista fechada. Assinatura não é uso ilimitado, e unidade sem nome não mede nada. */
export const UNIDADES = ['sessoes', 'minutos-de-sessao', 'tokens', 'percentual-da-cota'] as const;
export type Unidade = typeof UNIDADES[number];

/** Contadas em inteiros. Acima do inteiro seguro do JavaScript, o teto deixa de limitar e vira ilimitado na prática. */
const UNIDADES_INTEIRAS: readonly Unidade[] = ['sessoes', 'minutos-de-sessao', 'tokens'];

/** Os destinos do relatório da manhã que a página da RM-058 nomeia. */
export const CANAIS_DO_RELATORIO = ['terminal', 'telegram', 'openclaw'] as const;
export type CanalDoRelatorio = typeof CANAIS_DO_RELATORIO[number];

/** D2 da ork-rm058n1: tipo fechado próprio, fora de `MotivoGate`, porque a N1 não abre gate. */
export const MOTIVOS_DE_RECUSA = [
  'noctum.envelope.valores-ausentes', 'noctum.envelope.teto-ilimitado', 'noctum.envelope.acao-excluida',
  'noctum.envelope.invalido', 'noctum.origem.sem-prova', 'noctum.efeito.acao-excluida',
  'noctum.efeito.sem-autorizacao', 'noctum.efeito.hash-antigo', 'noctum.efeito.revogado',
  'noctum.efeito.expirado', 'noctum.efeito.fora-da-janela', 'noctum.efeito.fora-do-destino',
  'noctum.estado.adulterado',
] as const;
export type MotivoDeRecusaDoArco = typeof MOTIVOS_DE_RECUSA[number];

export class RecusaDoArco extends Error {
  constructor(readonly motivo: MotivoDeRecusaDoArco, detalhe: string) {
    super(`${motivo}: ${detalhe}`);
    this.name = 'RecusaDoArco';
  }
}

export interface Teto { valor: number; unidade: Unidade }
export interface Janela { inicio: string; fim: string; fuso: string }
export interface Destino { repositorio: string; base: string; permissoes: Permissao[] }
export interface Orcamento {
  arco: Teto;
  porConta: Array<{ conta: string; teto: Teto }>;
  porRuntime: Array<{ runtime: string; teto: Teto }>;
}
export interface Relatorio { horario: string; canal: CanalDoRelatorio }

/** O pedido de abertura. Todo valor dele é do dono; o núcleo não preenche nenhum. */
export interface PedidoDeAbertura {
  contrato: typeof CONTRATO_ENVELOPE;
  arco: string;
  janela: Janela;
  destinos: Destino[];
  orcamento: Orcamento;
  relatorio: Relatorio;
}

/** O que o dono autoriza: o pedido normalizado mais as exclusões fixas, guardadas para o registro. */
export interface ConteudoDoEnvelope extends PedidoDeAbertura {
  exclusoes: Exclusao[];
}

/** O efeito que um executor pede para conferir, imediatamente antes de executá-lo. */
export interface PedidoDeEfeito {
  arco: string;
  /** O hash que o executor recebeu no despacho. Diferente do vigente é hash antigo. */
  envelopeSha256: string;
  acao: string;
  repositorio: string;
  /** No `push`, a branch de trabalho; no `pr` e no `merge`, a base de destino. */
  branch: string;
}

export const ID_DO_ARCO = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ID_DE_CONTA = /^[a-z0-9][a-z0-9._-]{0,62}$/i;
const REPOSITORIO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const DATA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const HORARIO = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const PALAVRAS_DE_ILIMITADO = /ilimitad|unlimited|infinit|sem[ -]?(?:teto|limite)/i;

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * O nome curto de uma branch, nas regras de `git check-ref-format --branch`, ou nada. Ref completa
 * (`refs/heads/main`), forma curta de outra ref (`heads/`, `tags/`, `remotes/`) e `HEAD` nunca são
 * destino: com o texto cru, um push em `refs/heads/main` passaria pela recusa do push direto na base
 * e `refs/tags/v1` criaria tag, que é exclusão fixa.
 */
export function nomeDaBranch(v: unknown): string | undefined {
  if (typeof v !== 'string' || !BRANCH.test(v)) return undefined;
  const minusculo = v.toLowerCase();
  if (/^(?:refs|heads|tags|remotes)\//.test(minusculo) || minusculo === 'head' || v.includes('..') || v.includes('//') ||
      /(?:^|\/)\./.test(v) || /\.lock(?:\/|$)/.test(v) || v.endsWith('/') || v.endsWith('.')) return undefined;
  return v;
}
const ausente = (v: unknown): boolean => v === undefined || v === null || v === '';
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** A exclusão que um nome de ação representa, quando representa. */
export function exclusaoDaAcao(acao: unknown): Exclusao | undefined {
  if (typeof acao !== 'string') return undefined;
  const nome = acao.trim().toLowerCase();
  // `constructor` e `__proto__` não são exclusão: a busca é só nas chaves próprias do mapa.
  return Object.hasOwn(EXCLUSAO_POR_NOME, nome) ? EXCLUSAO_POR_NOME[nome] : undefined;
}

/** O que uma conferência acumula antes de recusar, para dizer tudo de uma vez. */
interface Problemas { faltas: string[]; ilimitados: string[]; excluidas: string[]; invalidos: string[] }

function chavesConhecidas(v: Record<string, unknown>, aceitas: readonly string[], onde: string, p: Problemas): void {
  for (const k of Object.keys(v)) {
    if (k === 'exclusoes' && onde === 'pedido') p.invalidos.push('exclusoes: são fixas do núcleo, o pedido não as declara');
    else if (!aceitas.includes(k)) p.invalidos.push(`${onde}.${k}: campo desconhecido`);
  }
}

function lerTeto(v: unknown, onde: string, p: Problemas): Teto | undefined {
  if (ausente(v)) { p.faltas.push(`${onde} (valor e unidade)`); return undefined; }
  if (!objeto(v)) { p.invalidos.push(`${onde}: precisa ser { valor, unidade }`); return undefined; }
  chavesConhecidas(v, ['valor', 'unidade'], onde, p);
  let valor: number | undefined;
  if (ausente(v.valor)) p.faltas.push(`${onde}.valor`);
  else if (typeof v.valor === 'number') {
    // Zero e negativo viram "sem limite" em muita configuração; aqui eles não viram nada.
    if (!Number.isFinite(v.valor) || v.valor <= 0) p.ilimitados.push(`${onde}.valor (${String(v.valor)})`);
    else valor = v.valor;
  } else if (typeof v.valor === 'string' && PALAVRAS_DE_ILIMITADO.test(v.valor)) p.ilimitados.push(`${onde}.valor ("${v.valor}")`);
  else p.invalidos.push(`${onde}.valor: precisa ser número finito maior que zero`);
  let unidade: Unidade | undefined;
  if (ausente(v.unidade)) p.faltas.push(`${onde}.unidade`);
  else if (!(UNIDADES as readonly unknown[]).includes(v.unidade)) p.invalidos.push(`${onde}.unidade: use ${UNIDADES.join(', ')}`);
  else unidade = v.unidade as Unidade;
  if (unidade === 'percentual-da-cota' && valor !== undefined && valor > 100) {
    p.invalidos.push(`${onde}.valor: percentual da cota vai até 100`);
    valor = undefined;
  }
  if (unidade !== undefined && UNIDADES_INTEIRAS.includes(unidade) && valor !== undefined) {
    if (valor > Number.MAX_SAFE_INTEGER) p.ilimitados.push(`${onde}.valor (${String(valor)}, acima do inteiro seguro)`);
    else if (!Number.isInteger(valor)) p.invalidos.push(`${onde}.valor: ${unidade} se conta em inteiros`);
    if (!Number.isSafeInteger(valor)) valor = undefined;
  }
  return valor !== undefined && unidade !== undefined ? { valor, unidade } : undefined;
}

function lerJanela(v: unknown, p: Problemas): Janela | undefined {
  if (ausente(v)) { p.faltas.push('janela.inicio', 'janela.fim', 'janela.fuso'); return undefined; }
  if (!objeto(v)) { p.invalidos.push('janela: precisa ser { inicio, fim, fuso }'); return undefined; }
  chavesConhecidas(v, ['inicio', 'fim', 'fuso'], 'janela', p);
  const instante = (campo: 'inicio' | 'fim'): string | undefined => {
    const x = v[campo];
    if (ausente(x)) { p.faltas.push(`janela.${campo}`); return undefined; }
    if (typeof x !== 'string' || !DATA_HORA.test(x) || !Number.isFinite(Date.parse(x))) {
      p.invalidos.push(`janela.${campo}: data e hora com deslocamento explícito, como 2026-10-12T22:00:00-03:00`);
      return undefined;
    }
    return x;
  };
  const inicio = instante('inicio'), fim = instante('fim');
  let fuso: string | undefined;
  if (ausente(v.fuso)) p.faltas.push('janela.fuso');
  else if (!(fuso = normalizarFuso(v.fuso)) || !(fuso === 'UTC' || /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(fuso))) {
    p.invalidos.push(`janela.fuso: fuso IANA, como ${FUSO_DE_BRASILIA}`);
    fuso = undefined;
  }
  if (inicio && fim) {
    const horas = (Date.parse(fim) - Date.parse(inicio)) / 3600000;
    if (!(horas >= JANELA_MINIMA_H && horas <= JANELA_MAXIMA_H)) {
      p.invalidos.push(`janela: o arco dura de ${JANELA_MINIMA_H} a ${JANELA_MAXIMA_H} h (D3 do dono); este pedido dá ${Math.round(horas * 100) / 100} h`);
    }
  }
  return inicio && fim && fuso ? { inicio, fim, fuso } : undefined;
}

function lerDestinos(v: unknown, p: Problemas): Destino[] | undefined {
  if (ausente(v) || (Array.isArray(v) && v.length === 0)) {
    p.faltas.push('destinos (ao menos um repositório, a base e as permissões)');
    return undefined;
  }
  if (!Array.isArray(v)) { p.invalidos.push('destinos: precisa ser lista'); return undefined; }
  const destinos: Destino[] = [];
  const vistos = new Set<string>();
  v.forEach((d, i) => {
    const onde = `destinos[${i}]`;
    if (!objeto(d)) { p.invalidos.push(`${onde}: precisa ser { repositorio, base, permissoes }`); return; }
    chavesConhecidas(d, ['repositorio', 'base', 'permissoes'], onde, p);
    let ok = true;
    if (ausente(d.repositorio)) { p.faltas.push(`${onde}.repositorio`); ok = false; }
    else if (typeof d.repositorio !== 'string' || !REPOSITORIO.test(d.repositorio) || d.repositorio.includes('..')) {
      p.invalidos.push(`${onde}.repositorio: dono/nome de um repositório que já existe`); ok = false;
    } else if (vistos.has(d.repositorio.toLowerCase())) { p.invalidos.push(`${onde}.repositorio: repetido`); ok = false; }
    else vistos.add(d.repositorio.toLowerCase());
    const base = nomeDaBranch(d.base);
    if (ausente(d.base)) { p.faltas.push(`${onde}.base`); ok = false; }
    else if (base === undefined) { p.invalidos.push(`${onde}.base: nome curto de branch, sem refs/, heads/, tags/ ou HEAD`); ok = false; }
    const permissoes: Permissao[] = [];
    if (ausente(d.permissoes) || (Array.isArray(d.permissoes) && d.permissoes.length === 0)) { p.faltas.push(`${onde}.permissoes`); ok = false; }
    else if (!Array.isArray(d.permissoes)) { p.invalidos.push(`${onde}.permissoes: precisa ser lista`); ok = false; }
    else {
      for (const x of d.permissoes) {
        const exclusao = exclusaoDaAcao(x);
        if (exclusao) { p.excluidas.push(`${onde}.permissoes: ${String(x)} (${RAZAO_DA_EXCLUSAO[exclusao]})`); ok = false; }
        else if (!(PERMISSOES as readonly unknown[]).includes(x)) { p.invalidos.push(`${onde}.permissoes: ${String(x)} fora de ${PERMISSOES.join(', ')}`); ok = false; }
        else if (!permissoes.includes(x as Permissao)) permissoes.push(x as Permissao);
      }
    }
    if (ok) destinos.push({ repositorio: d.repositorio as string, base: base!,
      permissoes: PERMISSOES.filter(x => permissoes.includes(x)) });
  });
  return destinos.length === v.length ? destinos.sort((a, b) => a.repositorio.localeCompare(b.repositorio, 'en')) : undefined;
}

function lerSubtetos<K extends 'conta' | 'runtime'>(v: unknown, chave: K, onde: string, aceito: (x: string) => boolean,
  explicacao: string, p: Problemas): Array<Record<K, string> & { teto: Teto }> | undefined {
  if (ausente(v) || (Array.isArray(v) && v.length === 0)) { p.faltas.push(`${onde} (ao menos um subteto por ${chave})`); return undefined; }
  if (!Array.isArray(v)) { p.invalidos.push(`${onde}: precisa ser lista`); return undefined; }
  const itens: Array<Record<K, string> & { teto: Teto }> = [];
  const vistos = new Set<string>();
  v.forEach((s, i) => {
    const aqui = `${onde}[${i}]`;
    if (!objeto(s)) { p.invalidos.push(`${aqui}: precisa ser { ${chave}, teto }`); return; }
    chavesConhecidas(s, [chave, 'teto'], aqui, p);
    const nome = s[chave];
    let ok = true;
    if (ausente(nome)) { p.faltas.push(`${aqui}.${chave}`); ok = false; }
    else if (typeof nome !== 'string' || !aceito(nome)) { p.invalidos.push(`${aqui}.${chave}: ${explicacao}`); ok = false; }
    else if (vistos.has(nome.toLowerCase())) { p.invalidos.push(`${aqui}.${chave}: repetido`); ok = false; }
    else vistos.add(nome.toLowerCase());
    const teto = lerTeto(s.teto, `${aqui}.teto`, p);
    if (ok && teto) itens.push({ [chave]: nome, teto } as Record<K, string> & { teto: Teto });
  });
  return itens.length === v.length ? itens.sort((a, b) => a[chave].localeCompare(b[chave], 'en')) : undefined;
}

function lerOrcamento(v: unknown, p: Problemas): Orcamento | undefined {
  if (ausente(v)) {
    p.faltas.push('orcamento.arco (teto do arco: valor e unidade)', 'orcamento.porConta (subteto por conta)',
      'orcamento.porRuntime (subteto por runtime)');
    return undefined;
  }
  if (!objeto(v)) { p.invalidos.push('orcamento: precisa ser { arco, porConta, porRuntime }'); return undefined; }
  chavesConhecidas(v, ['arco', 'porConta', 'porRuntime'], 'orcamento', p);
  const arco = lerTeto(v.arco, 'orcamento.arco', p);
  const porConta = lerSubtetos(v.porConta, 'conta', 'orcamento.porConta', x => ID_DE_CONTA.test(x),
    'id de perfil de conta já autenticado', p);
  const porRuntime = lerSubtetos(v.porRuntime, 'runtime', 'orcamento.porRuntime',
    x => (RUNTIMES_COM_PERFIL as readonly string[]).includes(x), `runtime de assinatura: ${RUNTIMES_COM_PERFIL.join(', ')}`, p);
  // Subteto acima do teto do arco, na mesma unidade, não limita nada: é teto do arco disfarçado.
  for (const [nome, teto] of [...(porConta ?? []).map(s => [`conta ${s.conta}`, s.teto] as const),
    ...(porRuntime ?? []).map(s => [`runtime ${s.runtime}`, s.teto] as const)]) {
    if (arco && teto.unidade === arco.unidade && teto.valor > arco.valor) {
      p.invalidos.push(`orcamento: o subteto da ${nome} passa do teto do arco na mesma unidade`);
    }
  }
  return arco && porConta && porRuntime ? { arco, porConta, porRuntime } : undefined;
}

function lerRelatorio(v: unknown, p: Problemas): Relatorio | undefined {
  if (ausente(v)) { p.faltas.push('relatorio.horario (HH:MM da manhã)', 'relatorio.canal'); return undefined; }
  if (!objeto(v)) { p.invalidos.push('relatorio: precisa ser { horario, canal }'); return undefined; }
  chavesConhecidas(v, ['horario', 'canal'], 'relatorio', p);
  let horario: string | undefined, canal: CanalDoRelatorio | undefined;
  if (ausente(v.horario)) p.faltas.push('relatorio.horario (HH:MM da manhã)');
  else if (typeof v.horario !== 'string' || !HORARIO.test(v.horario)) p.invalidos.push('relatorio.horario: HH:MM, no fuso da janela');
  else horario = v.horario;
  if (ausente(v.canal)) p.faltas.push('relatorio.canal');
  else if (!(CANAIS_DO_RELATORIO as readonly unknown[]).includes(v.canal)) p.invalidos.push(`relatorio.canal: use ${CANAIS_DO_RELATORIO.join(', ')}`);
  else canal = v.canal as CanalDoRelatorio;
  return horario && canal ? { horario, canal } : undefined;
}

/**
 * Valida o pedido de abertura e devolve o conteúdo normalizado que o dono autoriza.
 *
 * Junta todos os problemas antes de recusar, para o erro dizer de uma vez o que falta. O motivo
 * tipado segue a gravidade: ação excluída, depois teto ilimitado, depois valor ausente, depois
 * forma inválida. A mensagem leva todos, não só o do motivo.
 */
export function validarPedidoDeAbertura(v: unknown): ConteudoDoEnvelope {
  const p: Problemas = { faltas: [], ilimitados: [], excluidas: [], invalidos: [] };
  if (!objeto(v)) throw new RecusaDoArco('noctum.envelope.invalido', 'o pedido de abertura precisa ser um objeto');
  chavesConhecidas(v, ['contrato', 'arco', 'janela', 'destinos', 'orcamento', 'relatorio'], 'pedido', p);
  if (v.contrato !== CONTRATO_ENVELOPE) p.invalidos.push(`contrato: precisa ser ${CONTRATO_ENVELOPE}`);
  let arco: string | undefined;
  if (ausente(v.arco)) p.faltas.push('arco (identificador do arco)');
  else if (typeof v.arco !== 'string' || !ID_DO_ARCO.test(v.arco)) p.invalidos.push('arco: letras minúsculas, dígitos e hífen, até 63');
  else arco = v.arco;
  const janela = lerJanela(v.janela, p);
  const destinos = lerDestinos(v.destinos, p);
  const orcamento = lerOrcamento(v.orcamento, p);
  const relatorio = lerRelatorio(v.relatorio, p);
  const partes = [
    p.excluidas.length ? `ação excluída: ${p.excluidas.join('; ')}` : '',
    p.ilimitados.length ? `teto ilimitado não é aceito: ${p.ilimitados.join('; ')}` : '',
    p.faltas.length ? `o pedido precisa trazer, do dono: ${p.faltas.join('; ')}` : '',
    p.invalidos.length ? `inválido: ${p.invalidos.join('; ')}` : '',
  ].filter(Boolean);
  if (partes.length) {
    const motivo: MotivoDeRecusaDoArco = p.excluidas.length ? 'noctum.envelope.acao-excluida'
      : p.ilimitados.length ? 'noctum.envelope.teto-ilimitado'
        : p.faltas.length ? 'noctum.envelope.valores-ausentes' : 'noctum.envelope.invalido';
    throw new RecusaDoArco(motivo, `${partes.join(' | ')}. Nenhum valor do dono é presumido.`);
  }
  return { contrato: CONTRATO_ENVELOPE, arco: arco!, janela: janela!, destinos: destinos!, orcamento: orcamento!,
    relatorio: relatorio!, exclusoes: [...EXCLUSOES_FIXAS] };
}

/** JSON com as chaves em ordem: o mesmo conteúdo dá o mesmo hash, qualquer que seja a ordem de entrada. */
export function canonico(v: unknown): string {
  const ordenar = (x: unknown): unknown => Array.isArray(x) ? x.map(ordenar)
    : objeto(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, ordenar(x[k])])) : x;
  return JSON.stringify(ordenar(v));
}

export function hashDoEnvelope(conteudo: ConteudoDoEnvelope): string {
  return sha256(canonico(conteudo));
}

/** A recusa de uma ação excluída, antes de olhar estado nenhum. */
export function recusaDeExclusao(acao: unknown): RecusaDoArco | undefined {
  const exclusao = exclusaoDaAcao(acao);
  return exclusao ? new RecusaDoArco('noctum.efeito.acao-excluida', `${String(acao)}: ${RAZAO_DA_EXCLUSAO[exclusao]}`) : undefined;
}

/**
 * Janela e destino de um efeito contra o conteúdo autorizado, no instante dado.
 *
 * Lança a recusa tipada; não devolve nada quando o efeito cabe. O `merge` que passa aqui ainda
 * depende das provas no SHA exato, que são da N5: este contrato é necessário, não suficiente.
 */
export function avaliarEfeito(conteudo: ConteudoDoEnvelope, efeito: PedidoDeEfeito, quando: string): void {
  const excluida = recusaDeExclusao(efeito.acao);
  if (excluida) throw excluida;
  const agora = Date.parse(quando);
  if (!Number.isFinite(agora)) throw new RecusaDoArco('noctum.efeito.fora-da-janela', 'instante da conferência inválido');
  if (agora < Date.parse(conteudo.janela.inicio)) {
    throw new RecusaDoArco('noctum.efeito.fora-da-janela', `a janela só começa em ${conteudo.janela.inicio}`);
  }
  if (agora >= Date.parse(conteudo.janela.fim)) {
    throw new RecusaDoArco('noctum.efeito.expirado', `a janela terminou em ${conteudo.janela.fim}; nada a renova`);
  }
  if (!(PERMISSOES as readonly string[]).includes(efeito.acao)) {
    throw new RecusaDoArco('noctum.efeito.fora-do-destino', `ação ${String(efeito.acao)} fora de ${PERMISSOES.join(', ')}`);
  }
  const destino = conteudo.destinos.find(d => d.repositorio.toLowerCase() === String(efeito.repositorio).toLowerCase());
  if (!destino) throw new RecusaDoArco('noctum.efeito.fora-do-destino', `repositório ${String(efeito.repositorio)} fora do envelope`);
  if (!destino.permissoes.includes(efeito.acao as Permissao)) {
    throw new RecusaDoArco('noctum.efeito.fora-do-destino', `${efeito.acao} não autorizado em ${destino.repositorio}`);
  }
  const branch = nomeDaBranch(efeito.branch);
  if (branch === undefined) {
    throw new RecusaDoArco('noctum.efeito.fora-do-destino', 'branch inválida: nome curto de branch, nunca ref completa, tag ou HEAD');
  }
  // Sem caixa: `MAIN` e `main` colidem em sistema de arquivos sem caixa, e o push direto na base fica fora de qualquer forma.
  if (efeito.acao === 'push' && branch.toLowerCase() === destino.base.toLowerCase()) {
    throw new RecusaDoArco('noctum.efeito.fora-do-destino', `push direto na base ${destino.base} fica fora do envelope`);
  }
  if (efeito.acao !== 'push' && branch !== destino.base) {
    throw new RecusaDoArco('noctum.efeito.fora-do-destino', `${efeito.acao} só para a base ${destino.base}`);
  }
}

/** O que o dono lê antes de autorizar: uma linha por item, com o hash inteiro no fim. */
export function resumoDoEnvelope(conteudo: ConteudoDoEnvelope, envelopeSha256: string): string[] {
  const teto = (t: Teto) => `${t.valor} ${t.unidade}`;
  return [
    `Arco ${conteudo.arco}: de ${conteudo.janela.inicio} a ${conteudo.janela.fim} (${conteudo.janela.fuso})`,
    ...conteudo.destinos.map(d => `Destino ${d.repositorio}, base ${d.base}: ${d.permissoes.join(', ')}`),
    `Teto do arco: ${teto(conteudo.orcamento.arco)}`,
    ...conteudo.orcamento.porConta.map(s => `Subteto da conta ${s.conta}: ${teto(s.teto)}`),
    ...conteudo.orcamento.porRuntime.map(s => `Subteto do runtime ${s.runtime}: ${teto(s.teto)}`),
    `Relatório da manhã: ${conteudo.relatorio.horario} (${conteudo.janela.fuso}) por ${conteudo.relatorio.canal}`,
    `Nunca entram: ${conteudo.exclusoes.join(', ')}`,
    `Hash do envelope: ${envelopeSha256}`,
  ];
}
