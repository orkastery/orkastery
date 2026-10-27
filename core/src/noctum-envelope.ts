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
 *
 * RM-058, fatia N2 (D1 da ork-rm058n2): a `v2` acrescenta o que a `v1` deixou para uma versão nova, a lista
 * fechada de trabalhos do arco e os limites de concorrência. A `v1` segue valendo como estava, byte a byte, e
 * um arco autorizado nela não despacha nada.
 *
 * RM-058, fatia N3 (D2 da ork-rm058n3): a `v3` acrescenta as máquinas do arco, cada uma com a chave pública que assina
 * no ramo de coordenação, o limite de sessões por conta somando as máquinas e a máquina presa de um trabalho. É o que
 * o dono autoriza que faz uma máquina confiar na outra: o retrato da rede é descoberta, nunca autorização.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { FUSO_DE_BRASILIA, normalizarFuso } from './horario';
import { RUNTIMES_COM_INVENTARIO } from './runtime-profiles';

export const CONTRATO_ENVELOPE = 'ork.noctum-envelope/v1' as const;
export const CONTRATO_ENVELOPE_V2 = 'ork.noctum-envelope/v2' as const;
export const CONTRATO_ENVELOPE_V3 = 'ork.noctum-envelope/v3' as const;
export type ContratoDoEnvelope = typeof CONTRATO_ENVELOPE | typeof CONTRATO_ENVELOPE_V2 | typeof CONTRATO_ENVELOPE_V3;

/** D2 da ork-rm058n3: as máquinas de um arco são poucas e todas do dono. */
export const MAXIMO_DE_MAQUINAS = 8;

/**
 * D1 da ork-rm058n2: a lista do arco é fechada e curta. O dono lê cada pedido inteiro no resumo que autoriza (A7 do
 * CHECK), então o pedido é texto curto: cada um e a soma deles cabem numa leitura.
 */
export const MAXIMO_DE_TRABALHOS = 30;
export const TETO_DO_PEDIDO_DO_TRABALHO = 4 * 1024;
export const TETO_DOS_PEDIDOS_DO_ARCO = 16 * 1024;
/** Mais sessões que isto numa máquina não limita nada: é a ausência do limite escrita como número. */
export const MAXIMO_DE_SESSOES_DA_MAQUINA = 64;

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
  // RM-058 N2 (D11 e D12 da ork-rm058n2): o despacho fora da lista, conta ou runtime do envelope, e o orçamento.
  'noctum.despacho.fora-do-envelope', 'noctum.orcamento.esgotado', 'noctum.orcamento.sem-medicao',
  // RM-058 N3 (ork-rm058n3): a coordenação entre máquinas, a reserva do item e a vez de integrar.
  'noctum.coordenacao.sem-remoto', 'noctum.coordenacao.adulterado', 'noctum.coordenacao.fora-do-envelope',
  'noctum.coordenacao.autoridade-ativa', 'noctum.coordenacao.geracao-vencida', 'noctum.coordenacao.ordem-viva',
  'noctum.coordenacao.ordem-vencida', 'noctum.coordenacao.maquina-sem-batida', 'noctum.coordenacao.vaga-global',
  'noctum.coordenacao.concorrencia', 'noctum.coordenacao.exige-passo-da-maquina', 'noctum.reserva.de-outra-maquina',
  'noctum.integracao.ocupada', 'noctum.integracao.base-mudou', 'noctum.integracao.fonte-mudou',
  'noctum.integracao.ja-entregue', 'noctum.integracao.nao-provada',
  // GO-FIX da revisão da ork-rm058n3: a emenda ainda não autorizada aqui, a máquina revogada, a dependência e a recusa
  // da ordem com motivo próprio, e o item que o roadmap não reconhece.
  'noctum.coordenacao.versao-nao-autorizada', 'noctum.coordenacao.revogada', 'noctum.coordenacao.dependencia-pendente',
  'noctum.coordenacao.maquina-recusou', 'noctum.reserva.item-invalido',
  // Rodada 2 da revisão da ork-rm058n3: a fonte que chegou à base por um merge fora da base provada.
  'noctum.integracao.base-nao-provada',
  // RM-058 N6 (D1 e D2 da ork-rm058n6): o arco encerrado e o #Noctum pedido sem envelope vigente ou como modo de thread.
  'noctum.efeito.encerrado', 'noctum.modo.sem-envelope', 'noctum.modo.lista-fechada',
  // RM-057 (resposta curta, ork-rm057respost): a resposta curta a uma pergunta que o arco não tem, que outra substituiu ou
  // que venceu. Nenhuma delas autoriza nem revoga nada.
  'noctum.pergunta.desconhecida', 'noctum.pergunta.substituida', 'noctum.pergunta.vencida',
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

/**
 * D2 da ork-rm058n2: um trabalho do arco é uma thread. A que já existe vem pelo `thread`; a que o arco abre vem
 * pelo `pedido` do dono, e o vínculo dela é o item mais o sha256 desse pedido, o mesmo que a criação guarda.
 */
export interface Trabalho {
  id: string;
  item: string;
  /** 1 vem primeiro. É do dono: a página diz que a prioridade final é dele. */
  prioridade: number;
  /** Ids de trabalhos deste mesmo arco que precisam estar entregues antes. */
  dependeDe: string[];
  thread?: string;
  pedido?: string;
  /** Só na `v3`: a máquina que conduz o trabalho. Obrigatória com `thread`, que mora na raiz de estado de uma máquina. */
  maquina?: string;
}

/** Uma máquina do arco `v3`: o nome dela e a chave pública Ed25519 (SPKI DER em base64) com que assina. */
export interface MaquinaDoArco { nome: string; chave: string }

/** O limite de sessões ao mesmo tempo por conta, somando todas as máquinas do arco. */
export interface CapacidadeGlobal { porConta: Array<{ conta: string; sessoes: number }> }

/** Limites de sessões ao mesmo tempo. `revisao` são os slots da máquina que só o CHECK usa. */
export interface Capacidade {
  maquina: number;
  porConta: Array<{ conta: string; sessoes: number }>;
  porRuntime: Array<{ runtime: string; sessoes: number }>;
  revisao: number;
}

/** O pedido de abertura. Todo valor dele é do dono; o núcleo não preenche nenhum. */
export interface PedidoDeAbertura {
  contrato: ContratoDoEnvelope;
  arco: string;
  janela: Janela;
  destinos: Destino[];
  orcamento: Orcamento;
  relatorio: Relatorio;
  /** Na `v2` e na `v3`. */
  trabalhos?: Trabalho[];
  /** Na `v2` e na `v3`: os limites de cada máquina. */
  capacidade?: Capacidade;
  /** Só na `v3`. */
  maquinas?: MaquinaDoArco[];
  /** Só na `v3`. */
  capacidadeGlobal?: CapacidadeGlobal;
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
export const ID_DO_TRABALHO = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ITEM_DO_ROADMAP = /^RM-\d{3}$/;
const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
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
    x => (RUNTIMES_COM_INVENTARIO as readonly string[]).includes(x), `runtime de assinatura: ${RUNTIMES_COM_INVENTARIO.join(', ')}`, p);
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

/** O sha256 do pedido de um trabalho, o mesmo que a criação da thread guarda (`prepararPedido`). */
export function shaDoPedido(texto: string): string {
  return sha256(texto.trim());
}

/**
 * Os caracteres de formato (marcas de direção, largura zero, BOM, hífen suave e as tags do Unicode, que carregam texto
 * que a tela não mostra e o modelo lê) e os de uso privado.
 */
const FORMATO_OU_PRIVADO = /[\p{Cf}\p{Co}]/u;
/** Letras e marcas que não desenham nada: os preenchedores do Hangul, o juntador de grafemas e as vogais mudas do khmer. */
const SEM_DESENHO: ReadonlySet<number> = new Set([0x115f, 0x1160, 0x3164, 0xffa0, 0x34f, 0x17b4, 0x17b5]);
const seletorDeVariacao = (cp: number): boolean => cp >= 0xfe00 && cp <= 0xfe0f;
/** O que pode levar o seletor de texto ou de emoji: o pictograma e a base da tecla (dígito, `#` e `*`). */
const BASE_DE_EMOJI = /^[\p{Extended_Pictographic}0-9#*]$/u;

/**
 * A7 do CHECK da ork-rm058n2, e o resto que a rodada 2 achou: o caractere que esconde ou reordena texto na tela de quem
 * autoriza. Os controles (fora o tab e a quebra de linha), os separadores de linha do Unicode, os de formato e de uso
 * privado, os que não desenham nada, os seletores de variação suplementares e o seletor fora do emoji: só o de texto ou de
 * emoji (U+FE0E, U+FE0F), um só, logo depois de um pictograma ou da base da tecla. Seletores em série carregariam texto
 * escondido, 4 bits por seletor (S2 da rodada 3). Pelo código e pela categoria, sem escapes no fonte.
 */
function caractereQueEsconde(texto: string): number | null {
  let anterior = '';
  for (const c of texto) {
    const cp = c.codePointAt(0)!;
    if ((cp < 0x20 && cp !== 0x09 && cp !== 0x0a) || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029 ||
        FORMATO_OU_PRIVADO.test(c) || SEM_DESENHO.has(cp) || (cp >= 0xe0100 && cp <= 0xe01ef) ||
        (seletorDeVariacao(cp) && !((cp === 0xfe0e || cp === 0xfe0f) && BASE_DE_EMOJI.test(anterior)))) return cp;
    anterior = c;
  }
  return null;
}

const codigoDoCaractere = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/** O nome de uma máquina, a mesma regra do `maquina.json` (`gravarConfigDaMaquina`). */
const NOME_DE_MAQUINA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BASE64 = /^[A-Za-z0-9+/]{1,200}={0,2}$/;

/**
 * D2 da ork-rm058n3: a chave pública Ed25519 em SPKI DER base64, só na forma canônica que o Node exporta, ou nada. Duas
 * escritas da mesma chave dariam dois hashes para o mesmo envelope e driblariam a regra da chave repetida.
 */
export function chavePublicaValida(v: unknown): string | undefined {
  if (typeof v !== 'string' || !BASE64.test(v)) return undefined;
  try {
    const k = createPublicKey({ key: Buffer.from(v, 'base64'), format: 'der', type: 'spki' });
    if (k.asymmetricKeyType !== 'ed25519') return undefined;
    return k.export({ format: 'der', type: 'spki' }).toString('base64') === v ? v : undefined;
  } catch { return undefined; }
}

/** O que o resumo mostra da chave de uma máquina: o começo do sha256 dos bytes dela, para o dono conferir. */
export function impressaoDaChave(chave: string): string {
  return createHash('sha256').update(Buffer.from(chave, 'base64')).digest('hex').slice(0, 16);
}

/** D2 da ork-rm058n3: as máquinas do arco, na ordem do dono (desempata a distribuição), sem nome nem chave repetidos. */
function lerMaquinas(v: unknown, p: Problemas): MaquinaDoArco[] | undefined {
  if (ausente(v) || (Array.isArray(v) && v.length === 0)) {
    p.faltas.push('maquinas (cada máquina do arco: nome e chave pública)');
    return undefined;
  }
  if (!Array.isArray(v)) { p.invalidos.push('maquinas: precisa ser lista'); return undefined; }
  if (v.length > MAXIMO_DE_MAQUINAS) { p.invalidos.push(`maquinas: até ${MAXIMO_DE_MAQUINAS} por arco`); return undefined; }
  const lidas: MaquinaDoArco[] = [];
  const nomes = new Set<string>(), chaves = new Set<string>();
  v.forEach((m, i) => {
    const onde = `maquinas[${i}]`;
    if (!objeto(m)) { p.invalidos.push(`${onde}: precisa ser { nome, chave }`); return; }
    chavesConhecidas(m, ['nome', 'chave'], onde, p);
    let ok = true;
    if (ausente(m.nome)) { p.faltas.push(`${onde}.nome`); ok = false; }
    else if (typeof m.nome !== 'string' || !NOME_DE_MAQUINA.test(m.nome)) {
      p.invalidos.push(`${onde}.nome: letras, dígitos, ponto, _ ou -, até 64`); ok = false;
    } else if (nomes.has(m.nome.toLowerCase())) { p.invalidos.push(`${onde}.nome: repetido`); ok = false; }
    else nomes.add(m.nome.toLowerCase());
    if (ausente(m.chave)) { p.faltas.push(`${onde}.chave (a chave pública da máquina)`); ok = false; }
    else if (chavePublicaValida(m.chave) === undefined) {
      p.invalidos.push(`${onde}.chave: chave pública Ed25519 em SPKI DER base64, na forma canônica`); ok = false;
    } else if (chaves.has(m.chave as string)) { p.invalidos.push(`${onde}.chave: a mesma chave em duas máquinas`); ok = false; }
    else chaves.add(m.chave as string);
    if (ok) lidas.push({ nome: m.nome as string, chave: m.chave as string });
  });
  return lidas.length === v.length ? lidas : undefined;
}

/**
 * D2 da ork-rm058n3: o limite de cada conta somando as máquinas. Toda conta do orçamento tem o seu e nenhuma outra entra;
 * acima da soma dos limites locais ele não limita nada, como o subteto acima do teto.
 */
function lerCapacidadeGlobal(v: unknown, orcamento: Orcamento | undefined, capacidade: Capacidade | undefined,
  quantasMaquinas: number | undefined, p: Problemas): CapacidadeGlobal | undefined {
  const falta = 'capacidadeGlobal.porConta (sessões ao mesmo tempo por conta, somando as máquinas)';
  if (ausente(v)) { p.faltas.push(falta); return undefined; }
  if (!objeto(v)) { p.invalidos.push('capacidadeGlobal: precisa ser { porConta }'); return undefined; }
  chavesConhecidas(v, ['porConta'], 'capacidadeGlobal', p);
  const bruto = v.porConta;
  if (ausente(bruto) || (Array.isArray(bruto) && bruto.length === 0)) { p.faltas.push(falta); return undefined; }
  if (!Array.isArray(bruto)) { p.invalidos.push('capacidadeGlobal.porConta: precisa ser lista'); return undefined; }
  const doOrcamento = orcamento?.porConta.map(s => s.conta);
  const itens: Array<{ conta: string; sessoes: number }> = [];
  const vistos = new Set<string>();
  bruto.forEach((s, i) => {
    const aqui = `capacidadeGlobal.porConta[${i}]`;
    if (!objeto(s)) { p.invalidos.push(`${aqui}: precisa ser { conta, sessoes }`); return; }
    chavesConhecidas(s, ['conta', 'sessoes'], aqui, p);
    let ok = true;
    if (ausente(s.conta)) { p.faltas.push(`${aqui}.conta`); ok = false; }
    else if (typeof s.conta !== 'string') { p.invalidos.push(`${aqui}.conta: texto`); ok = false; }
    else if (vistos.has(s.conta.toLowerCase())) { p.invalidos.push(`${aqui}.conta: repetida`); ok = false; }
    else if (doOrcamento && !doOrcamento.includes(s.conta)) {
      p.invalidos.push(`${aqui}.conta: ${s.conta} não está no orçamento, e só entra aqui quem tem teto`); ok = false;
    } else vistos.add(s.conta.toLowerCase());
    const local = typeof s.conta === 'string' ? capacidade?.porConta.find(x => x.conta === s.conta)?.sessoes : undefined;
    const soma = local !== undefined && quantasMaquinas !== undefined ? local * quantasMaquinas : MAXIMO_DE_SESSOES_DA_MAQUINA * MAXIMO_DE_MAQUINAS;
    if (ausente(s.sessoes)) { p.faltas.push(`${aqui}.sessoes`); ok = false; }
    else if (typeof s.sessoes !== 'number' || !Number.isSafeInteger(s.sessoes) || s.sessoes < 1) {
      p.invalidos.push(`${aqui}.sessoes: inteiro a partir de 1`); ok = false;
    } else if (s.sessoes > soma) {
      p.invalidos.push(`${aqui}.sessoes: passa da soma dos limites locais da conta (${soma}) e não limita nada`); ok = false;
    }
    if (ok) itens.push({ conta: s.conta as string, sessoes: s.sessoes as number });
  });
  for (const conta of (doOrcamento ?? []).filter(n => !vistos.has(n.toLowerCase()))) {
    p.faltas.push(`capacidadeGlobal.porConta (${conta}, que está no orçamento)`);
  }
  return itens.length === bruto.length ? { porConta: itens.sort((a, b) => a.conta.localeCompare(b.conta, 'en')) } : undefined;
}

/**
 * D1 e D2 da ork-rm058n2: a lista fechada de trabalhos. A ordem da lista é do dono e entra no hash, porque a
 * posição desempata a fila (D3); a ordem dentro de `dependeDe` não muda nada e é normalizada.
 *
 * D2 da ork-rm058n3: na `v3`, `v3.maquinas` traz os nomes do envelope (ou `null`, quando eles não se leram) e o trabalho
 * pode prender uma máquina; o de `thread` precisa dela, e o mesmo item preso a duas máquinas é recusado.
 */
function lerTrabalhos(v: unknown, p: Problemas, v3: { maquinas: ReadonlySet<string> | null } | null = null): Trabalho[] | undefined {
  if (ausente(v) || (Array.isArray(v) && v.length === 0)) {
    p.faltas.push('trabalhos (a lista fechada do arco: id, item, prioridade, dependeDe e thread ou pedido)');
    return undefined;
  }
  if (!Array.isArray(v)) { p.invalidos.push('trabalhos: precisa ser lista'); return undefined; }
  if (v.length > MAXIMO_DE_TRABALHOS) { p.invalidos.push(`trabalhos: até ${MAXIMO_DE_TRABALHOS} por arco`); return undefined; }
  const lidos: Trabalho[] = [];
  const ids = new Set<string>(), threads = new Set<string>(), pedidos = new Set<string>();
  v.forEach((t, i) => {
    const onde = `trabalhos[${i}]`;
    if (!objeto(t)) { p.invalidos.push(`${onde}: precisa ser { id, item, prioridade, dependeDe, thread ou pedido }`); return; }
    chavesConhecidas(t, ['id', 'item', 'prioridade', 'dependeDe', 'thread', 'pedido', ...(v3 ? ['maquina'] : [])], onde, p);
    let ok = true;
    if (ausente(t.id)) { p.faltas.push(`${onde}.id`); ok = false; }
    else if (typeof t.id !== 'string' || !ID_DO_TRABALHO.test(t.id)) { p.invalidos.push(`${onde}.id: letras minúsculas, dígitos e hífen, até 32`); ok = false; }
    else if (ids.has(t.id)) { p.invalidos.push(`${onde}.id: repetido`); ok = false; }
    else ids.add(t.id);
    if (ausente(t.item)) { p.faltas.push(`${onde}.item`); ok = false; }
    else if (typeof t.item !== 'string' || !ITEM_DO_ROADMAP.test(t.item)) { p.invalidos.push(`${onde}.item: item do roadmap, como RM-058`); ok = false; }
    if (ausente(t.prioridade)) { p.faltas.push(`${onde}.prioridade`); ok = false; }
    else if (typeof t.prioridade !== 'number' || !Number.isSafeInteger(t.prioridade) || t.prioridade < 1) {
      p.invalidos.push(`${onde}.prioridade: inteiro a partir de 1 (o 1 vem primeiro)`); ok = false;
    }
    // Nem a lista vazia é presumida: o dono diz que o trabalho não depende de nada.
    if (t.dependeDe === undefined || t.dependeDe === null) { p.faltas.push(`${onde}.dependeDe (lista, vazia quando não depende de nada)`); ok = false; }
    else if (!Array.isArray(t.dependeDe) || t.dependeDe.some(d => typeof d !== 'string' || !ID_DO_TRABALHO.test(d))) {
      p.invalidos.push(`${onde}.dependeDe: lista de ids de trabalhos deste arco`); ok = false;
    } else if (new Set(t.dependeDe).size !== t.dependeDe.length) { p.invalidos.push(`${onde}.dependeDe: id repetido`); ok = false; }
    const comThread = !ausente(t.thread), comPedido = !ausente(t.pedido);
    if (!comThread && !comPedido) { p.faltas.push(`${onde}.thread ou ${onde}.pedido`); ok = false; }
    else if (comThread && comPedido) { p.invalidos.push(`${onde}: thread ou pedido, nunca os dois`); ok = false; }
    else if (comThread) {
      if (typeof t.thread !== 'string' || !ID_DE_THREAD.test(t.thread)) { p.invalidos.push(`${onde}.thread: id de uma thread que já existe`); ok = false; }
      else if (threads.has(t.thread)) { p.invalidos.push(`${onde}.thread: a mesma thread em dois trabalhos`); ok = false; }
      else threads.add(t.thread);
    } else if (typeof t.pedido !== 'string' || !t.pedido.trim()) { p.invalidos.push(`${onde}.pedido: o texto do dono para a thread nova`); ok = false; }
    else if (Buffer.byteLength(t.pedido.trim(), 'utf8') > TETO_DO_PEDIDO_DO_TRABALHO) {
      p.invalidos.push(`${onde}.pedido: até ${TETO_DO_PEDIDO_DO_TRABALHO} bytes`); ok = false;
    } else if (caractereQueEsconde(t.pedido) !== null) {
      p.invalidos.push(`${onde}.pedido: o caractere ${codigoDoCaractere(caractereQueEsconde(t.pedido)!)} esconde ou reordena texto na tela; ` +
        'o pedido é texto, com tab e quebra de linha'); ok = false;
    } else if (typeof t.item === 'string' && pedidos.has(`${t.item}|${shaDoPedido(t.pedido)}`)) {
      // O vínculo da thread aberta é o item mais o sha256 do pedido: dois trabalhos iguais seriam a mesma thread.
      p.invalidos.push(`${onde}.pedido: o mesmo item e o mesmo pedido em dois trabalhos`); ok = false;
    } else if (typeof t.item === 'string') pedidos.add(`${t.item}|${shaDoPedido(t.pedido)}`);
    let maquina: string | undefined;
    if (v3) {
      if (ausente(t.maquina)) {
        if (comThread) { p.faltas.push(`${onde}.maquina (a máquina em que a thread mora)`); ok = false; }
      } else if (typeof t.maquina !== 'string' || !NOME_DE_MAQUINA.test(t.maquina)) {
        p.invalidos.push(`${onde}.maquina: nome de uma das máquinas do arco`); ok = false;
      } else if (v3.maquinas && !v3.maquinas.has(t.maquina)) {
        p.invalidos.push(`${onde}.maquina: ${t.maquina} não está em maquinas`); ok = false;
      } else maquina = t.maquina;
    }
    if (ok) {
      lidos.push({ id: t.id as string, item: t.item as string, prioridade: t.prioridade as number,
        dependeDe: [...(t.dependeDe as string[])].sort(),
        ...(comThread ? { thread: t.thread as string } : { pedido: (t.pedido as string).trim() }),
        ...(maquina ? { maquina } : {}) });
    }
  });
  if (lidos.length !== v.length) return undefined;
  if (v3) {
    // A reserva da RM-047 é do item numa máquina só: o mesmo item preso a duas máquinas nunca andaria nas duas.
    const presas = new Map<string, Set<string>>();
    for (const t of lidos) if (t.maquina) presas.set(t.item, (presas.get(t.item) ?? new Set<string>()).add(t.maquina));
    for (const [item, maquinas] of presas) {
      if (maquinas.size > 1) p.invalidos.push(`trabalhos: o item ${item} está preso a ${[...maquinas].join(' e ')}; a reserva do item é de uma máquina só`);
    }
  }
  const somaDosPedidos = lidos.reduce((n, t) => n + (t.pedido ? Buffer.byteLength(t.pedido, 'utf8') : 0), 0);
  if (somaDosPedidos > TETO_DOS_PEDIDOS_DO_ARCO) {
    p.invalidos.push(`trabalhos: os pedidos somam ${somaDosPedidos} bytes; até ${TETO_DOS_PEDIDOS_DO_ARCO} por arco`);
    return undefined;
  }
  for (const t of lidos) {
    for (const d of t.dependeDe) {
      if (d === t.id) p.invalidos.push(`trabalho ${t.id}: depende de si mesmo`);
      else if (!ids.has(d)) p.invalidos.push(`trabalho ${t.id}: depende de ${d}, que não está na lista do arco`);
    }
  }
  // Ciclo: nenhum trabalho do ciclo chegaria a ser entregue, e a fila ficaria bloqueada até o fim da janela.
  const porId = new Map(lidos.map(t => [t.id, t]));
  const estado = new Map<string, 'visitando' | 'feito'>();
  const ciclos = new Set<string>();
  const visitar = (id: string, caminho: string[]): void => {
    if (estado.get(id) === 'feito') return;
    if (estado.get(id) === 'visitando') { ciclos.add([...caminho.slice(caminho.indexOf(id)), id].join(' -> ')); return; }
    estado.set(id, 'visitando');
    for (const d of porId.get(id)?.dependeDe ?? []) if (porId.has(d) && d !== id) visitar(d, [...caminho, id]);
    estado.set(id, 'feito');
  };
  for (const t of lidos) visitar(t.id, []);
  for (const c of ciclos) p.invalidos.push(`trabalhos: dependência em ciclo (${c})`);
  return lidos;
}

const inteiroDeSessoes = (v: unknown, minimo: number): boolean =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= minimo && v <= MAXIMO_DE_SESSOES_DA_MAQUINA;

/**
 * D7 da ork-rm058n2: os limites de sessões ao mesmo tempo. Cada conta e cada runtime do orçamento tem o seu, e
 * nenhum outro entra: a conta e o runtime que o arco pode usar são os que o dono pôs no envelope.
 */
function lerCapacidade(v: unknown, orcamento: Orcamento | undefined, p: Problemas): Capacidade | undefined {
  if (ausente(v)) {
    p.faltas.push('capacidade.maquina (sessões ao mesmo tempo nesta máquina)', 'capacidade.porConta (sessões por conta)',
      'capacidade.porRuntime (sessões por runtime)', 'capacidade.revisao (slots que só o CHECK usa)');
    return undefined;
  }
  if (!objeto(v)) { p.invalidos.push('capacidade: precisa ser { maquina, porConta, porRuntime, revisao }'); return undefined; }
  chavesConhecidas(v, ['maquina', 'porConta', 'porRuntime', 'revisao'], 'capacidade', p);
  let maquina: number | undefined, revisao: number | undefined;
  if (ausente(v.maquina)) p.faltas.push('capacidade.maquina (sessões ao mesmo tempo nesta máquina)');
  else if (!inteiroDeSessoes(v.maquina, 1)) p.invalidos.push(`capacidade.maquina: inteiro de 1 a ${MAXIMO_DE_SESSOES_DA_MAQUINA}`);
  else maquina = v.maquina as number;
  if (v.revisao === undefined || v.revisao === null) p.faltas.push('capacidade.revisao (slots que só o CHECK usa; 0 é um valor)');
  else if (!inteiroDeSessoes(v.revisao, 0)) p.invalidos.push('capacidade.revisao: inteiro a partir de 0');
  else if (maquina !== undefined && (v.revisao as number) >= maquina) {
    p.invalidos.push('capacidade.revisao: precisa deixar ao menos um slot da máquina para a execução');
  } else revisao = v.revisao as number;
  const lerLimites = <K extends 'conta' | 'runtime'>(bruto: unknown, chave: K, onde: string, doOrcamento: string[] | undefined):
    Array<Record<K, string> & { sessoes: number }> | undefined => {
    if (ausente(bruto) || (Array.isArray(bruto) && bruto.length === 0)) { p.faltas.push(`${onde} (sessões por ${chave})`); return undefined; }
    if (!Array.isArray(bruto)) { p.invalidos.push(`${onde}: precisa ser lista`); return undefined; }
    const itens: Array<Record<K, string> & { sessoes: number }> = [];
    const vistos = new Set<string>();
    bruto.forEach((s, i) => {
      const aqui = `${onde}[${i}]`;
      if (!objeto(s)) { p.invalidos.push(`${aqui}: precisa ser { ${chave}, sessoes }`); return; }
      chavesConhecidas(s, [chave, 'sessoes'], aqui, p);
      const nome = s[chave];
      let ok = true;
      if (ausente(nome)) { p.faltas.push(`${aqui}.${chave}`); ok = false; }
      else if (typeof nome !== 'string') { p.invalidos.push(`${aqui}.${chave}: texto`); ok = false; }
      else if (vistos.has(nome.toLowerCase())) { p.invalidos.push(`${aqui}.${chave}: repetido`); ok = false; }
      else if (doOrcamento && !doOrcamento.includes(nome)) {
        p.invalidos.push(`${aqui}.${chave}: ${nome} não está no orçamento, e só entra aqui quem tem teto`); ok = false;
      } else vistos.add(nome.toLowerCase());
      if (ausente(s.sessoes)) { p.faltas.push(`${aqui}.sessoes`); ok = false; }
      else if (!inteiroDeSessoes(s.sessoes, 1)) { p.invalidos.push(`${aqui}.sessoes: inteiro de 1 a ${MAXIMO_DE_SESSOES_DA_MAQUINA}`); ok = false; }
      else if (maquina !== undefined && (s.sessoes as number) > maquina) {
        // Limite acima da máquina não limita nada: é o limite da máquina disfarçado, como o subteto acima do teto.
        p.invalidos.push(`${aqui}.sessoes: passa do limite da máquina`); ok = false;
      }
      if (ok) itens.push({ [chave]: nome, sessoes: s.sessoes } as Record<K, string> & { sessoes: number });
    });
    for (const falta of (doOrcamento ?? []).filter(n => !vistos.has(n.toLowerCase()))) p.faltas.push(`${onde} (${falta}, que está no orçamento)`);
    return itens.length === bruto.length ? itens.sort((a, b) => a[chave].localeCompare(b[chave], 'en')) : undefined;
  };
  const porConta = lerLimites(v.porConta, 'conta', 'capacidade.porConta', orcamento?.porConta.map(s => s.conta));
  const porRuntime = lerLimites(v.porRuntime, 'runtime', 'capacidade.porRuntime', orcamento?.porRuntime.map(s => s.runtime));
  return maquina !== undefined && revisao !== undefined && porConta && porRuntime ? { maquina, porConta, porRuntime, revisao } : undefined;
}

/** O conteúdo traz a lista e os limites da `v2` (ou da `v3`, que os mantém)? Só ele despacha (D1 da ork-rm058n2). */
export function envelopeComTrabalhos(c: ConteudoDoEnvelope): c is ConteudoDoEnvelope & { trabalhos: Trabalho[]; capacidade: Capacidade } {
  return (c.contrato === CONTRATO_ENVELOPE_V2 || c.contrato === CONTRATO_ENVELOPE_V3) && Array.isArray(c.trabalhos) && !!c.capacidade;
}

/** RM-058 N3: o conteúdo é de um arco entre máquinas (`v3`, com as máquinas e o limite global)? */
export function envelopeMultimaquina(c: ConteudoDoEnvelope): c is ConteudoDoEnvelope & { trabalhos: Trabalho[]; capacidade: Capacidade;
  maquinas: MaquinaDoArco[]; capacidadeGlobal: CapacidadeGlobal } {
  return c.contrato === CONTRATO_ENVELOPE_V3 && envelopeComTrabalhos(c) && Array.isArray(c.maquinas) && !!c.capacidadeGlobal;
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
  // Na `v1`, `trabalhos` e `capacidade` continuam campo desconhecido, como antes da N2; fora da `v3`, as máquinas também.
  const v3 = v.contrato === CONTRATO_ENVELOPE_V3;
  const v2 = v.contrato === CONTRATO_ENVELOPE_V2 || v3;
  chavesConhecidas(v, ['contrato', 'arco', 'janela', 'destinos', 'orcamento', 'relatorio', ...(v2 ? ['trabalhos', 'capacidade'] : []),
    ...(v3 ? ['maquinas', 'capacidadeGlobal'] : [])], 'pedido', p);
  if (v.contrato !== CONTRATO_ENVELOPE && !v2) {
    p.invalidos.push(`contrato: precisa ser ${CONTRATO_ENVELOPE}, ${CONTRATO_ENVELOPE_V2} ou ${CONTRATO_ENVELOPE_V3}`);
  }
  let arco: string | undefined;
  if (ausente(v.arco)) p.faltas.push('arco (identificador do arco)');
  else if (typeof v.arco !== 'string' || !ID_DO_ARCO.test(v.arco)) p.invalidos.push('arco: letras minúsculas, dígitos e hífen, até 63');
  else arco = v.arco;
  const janela = lerJanela(v.janela, p);
  const destinos = lerDestinos(v.destinos, p);
  const orcamento = lerOrcamento(v.orcamento, p);
  const relatorio = lerRelatorio(v.relatorio, p);
  const maquinas = v3 ? lerMaquinas(v.maquinas, p) : undefined;
  const trabalhos = v2 ? lerTrabalhos(v.trabalhos, p, v3 ? { maquinas: maquinas ? new Set(maquinas.map(m => m.nome)) : null } : null) : undefined;
  const capacidade = v2 ? lerCapacidade(v.capacidade, orcamento, p) : undefined;
  const capacidadeGlobal = v3 ? lerCapacidadeGlobal(v.capacidadeGlobal, orcamento, capacidade, maquinas?.length, p) : undefined;
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
  return { contrato: v3 ? CONTRATO_ENVELOPE_V3 : v2 ? CONTRATO_ENVELOPE_V2 : CONTRATO_ENVELOPE, arco: arco!, janela: janela!,
    destinos: destinos!, orcamento: orcamento!, relatorio: relatorio!, exclusoes: [...EXCLUSOES_FIXAS],
    ...(v2 ? { trabalhos: trabalhos!, capacidade: capacidade! } : {}),
    ...(v3 ? { maquinas: maquinas!, capacidadeGlobal: capacidadeGlobal! } : {}) };
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
  avaliarJanela(conteudo, quando);
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

/** Só a janela: o instante precisa estar entre o início e o fim, e nada renova o fim. Lança a recusa tipada. */
export function avaliarJanela(conteudo: ConteudoDoEnvelope, quando: string): void {
  const agora = Date.parse(quando);
  if (!Number.isFinite(agora)) throw new RecusaDoArco('noctum.efeito.fora-da-janela', 'instante da conferência inválido');
  if (agora < Date.parse(conteudo.janela.inicio)) {
    throw new RecusaDoArco('noctum.efeito.fora-da-janela', `a janela só começa em ${conteudo.janela.inicio}`);
  }
  if (agora >= Date.parse(conteudo.janela.fim)) {
    throw new RecusaDoArco('noctum.efeito.expirado', `a janela terminou em ${conteudo.janela.fim}; nada a renova`);
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
    ...(envelopeComTrabalhos(conteudo) ? linhasDaV2(conteudo) : []),
    ...(envelopeMultimaquina(conteudo) ? linhasDaV3(conteudo) : []),
    `Nunca entram: ${conteudo.exclusoes.join(', ')}`,
    `Hash do envelope: ${envelopeSha256}`,
  ];
}

/**
 * O que a `v2` acrescenta ao resumo: cada trabalho, na ordem do dono, e os limites. O pedido vai inteiro, uma linha do
 * resumo por linha dele (A7 do CHECK): o dono autoriza só o que leu.
 */
function linhasDaV2(c: ConteudoDoEnvelope & { trabalhos: Trabalho[]; capacidade: Capacidade }): string[] {
  return [
    ...c.trabalhos.flatMap(t => {
      const cabeca = `Trabalho ${t.id} (${t.item}), prioridade ${t.prioridade}` +
        `${t.dependeDe.length ? `, depois de ${t.dependeDe.join(', ')}` : ''}${t.maquina ? `, na máquina ${t.maquina}` : ''}: `;
      if (t.thread) return [`${cabeca}thread ${t.thread}`];
      const linhas = t.pedido!.split('\n');
      return [`${cabeca}abre uma thread com o pedido abaixo (${linhas.length} linha(s), sha256 ${shaDoPedido(t.pedido!).slice(0, 12)})`,
        ...linhas.map(l => `  | ${l}`)];
    }),
    `Sessões ao mesmo tempo: ${c.capacidade.maquina} na máquina, ${c.capacidade.revisao} delas só para revisão`,
    ...c.capacidade.porConta.map(s => `Sessões ao mesmo tempo na conta ${s.conta}: ${s.sessoes}`),
    ...c.capacidade.porRuntime.map(s => `Sessões ao mesmo tempo no runtime ${s.runtime}: ${s.sessoes}`),
  ];
}

/** O que a `v3` acrescenta: cada máquina com a impressão da chave, para o dono conferir, e o limite global de cada conta. */
function linhasDaV3(c: ConteudoDoEnvelope & { maquinas: MaquinaDoArco[]; capacidadeGlobal: CapacidadeGlobal }): string[] {
  return [
    ...c.maquinas.map(m => `Máquina ${m.nome}: chave ${impressaoDaChave(m.chave)}`),
    ...c.capacidadeGlobal.porConta.map(s => `Sessões ao mesmo tempo na conta ${s.conta}, somando as máquinas: ${s.sessoes}`),
  ];
}
