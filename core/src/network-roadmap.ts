/**
 * RM-054 (fatia 1): o roadmap da rede, de qualquer diretorio.
 *
 * Em 29/09/2026 o dono pediu pelo Telegram o status do roadmap do orkastery e recebeu o panorama
 * do cwd do gateway (projeto `workspace`, 0 threads), lido como "roadmap vazio". O roadmap real
 * tinha 13 itens reservados e 10 threads na `vps`. Este modulo junta, para cada projeto pedido:
 *
 *  - o status report do RM-048 (`ork.roadmap-status/v1`), com as threads de TODAS as maquinas;
 *  - as reservas (`ork/roadmap-reservas`);
 *  - as threads de cada maquina (`ork/fabrica-estado`), com a idade da ultima batida;
 *  - a fonte e o horario de cada parte, e o que ficou sem ler como lacuna tipada.
 *
 * Com clone nesta maquina, o roadmap vem de `docs/roadmap` da BASE REMOTA (D1 do PLAN): toda
 * maquina ve o mesmo roadmap, qualquer que seja a branch do checkout. As branches de estado vem
 * pelo fetch de sempre, e esta maquina entra pelo estado local fresco, no lugar do retrato
 * publicado dela (D6). Sem clone, tudo vem da forja, so com consulta (`forja.ts`).
 *
 * As lacunas usam o vocabulario da rede (RM-053) e nunca viram "vazio": o que nao foi lido e dito
 * com o tipo e o que fazer. `naoConsultado` diz o que esta leitura nao olhou. Leitura pura: nada e
 * gravado no estado do `ork` nem na forja; o unico efeito e o `git fetch` de sempre nas refs
 * remotas do clone, e `semRemoto` o desliga.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buscarBranch, git, pontaLocal } from './branch-de-estado';
import { DIR_ROADMAP, Documento, documentoDeTexto, ehPaginaDeDocs } from './docs';
import { estadoValido, BRANCH_DA_FABRICA, DIR_DA_FABRICA, EstadoDaMaquina, retratoDaMaquina, ThreadNaFabrica } from './fabrica-estado';
import { ArquivoDaForja, CommitDaBase, detalheSeguro, ErroDaForja, ExecutorDaForja, forjaDoArgumento, IdentidadeDaForja,
  identidadeDaForja, lerDaForja, mesmaForja, rotuloDaForja } from './forja';
import { dataLocal, duracaoCurta, formatarDataHora, fusoDoDono, legendaDoFuso, normalizarFuso, partesLocais } from './horario';
import { raizDoEstado } from './estado-thread';
import { carregarManifesto, ManifestoCarregado, NOME_MANIFESTO } from './manifest';
import { nomeDaMaquina, pastaDoUsuario } from './maquina';
import { BRANCH_DE_RESERVAS, DIR_DE_RESERVAS, ReservaDeItem, reservaValida } from './roadmap-reservas';
import { FatoDeThread, fatosLocais, montarStatusDeFatos, StatusDoRoadmap, textoDoStatusDoRoadmap } from './roadmap-status';
import { lerYaml, ValorYaml } from './yaml';

export const CONTRATO_PANORAMA_DA_REDE = 'ork.network-roadmap/v1' as const;
/** O registro de projetos da RM-052, lido como ela o grava. */
export const CONTRATO_REGISTRO_DE_PROJETOS = 'ork.projetos/v1' as const;
/** Maquina sem retrato novo ha mais disto esta sem batida: o mesmo limiar da rede (RM-053, `SEM_BATIDA_MS`). */
export const LIMIAR_SEM_BATIDA_MS = 3 * 60 * 60 * 1000;
/** A recusa de projeto sai com o mesmo codigo da RM-052. */
export const SAIDA_DO_PEDIDO = 4;

export type ParteDaRede = 'projeto' | 'roadmap' | 'reservas' | 'fabrica' | 'estado-local' | 'forja' | 'registro' | 'rede';

export type TipoDeLacunaDaRede =
  | 'projeto.sem-clone' | 'projeto.sem-fonte' | 'projeto.sem-leitura' | 'projeto.remoto-invalido' | 'estado-local.sem-leitura'
  | 'roadmap.sem-base' | 'roadmap.sem-itens' | 'roadmap.pagina-invalida' | 'roadmap.entregas-parciais' | 'roadmap.sem-leitura'
  | 'reservas.sem-branch' | 'reservas.sem-leitura' | 'reserva.invalida'
  | 'fabrica.sem-branch' | 'fabrica.sem-leitura' | 'retrato.invalido' | 'maquina.sem-batida'
  | ErroDaForja['codigo'] | 'forja.nao-consultada' | 'forja.leitura-parcial'
  | 'registro.invalido' | 'rede.sem-projeto';

/** O que ficou sem ler, com o tipo e o que fazer. Lacuna nunca vira lista vazia. */
export interface LacunaDaRede { tipo: TipoDeLacunaDaRede; parte: ParteDaRede; alvo?: string; detalhe: string; correcao: string }

export interface FonteLida {
  parte: 'roadmap' | 'reservas' | 'fabrica' | 'estado-local';
  origem: 'clone' | 'forja' | 'estado-local';
  /** `origin/main` no clone, `github.com/dono/repo@main` na forja, a pasta de estado desta maquina. */
  onde: string;
  ref: string | null;
  commit: string | null;
  dataDoCommit: string | null;
  lidoEm: string;
  /** Leitura nova agora (true) ou a ultima copia desta maquina (false). */
  atualizado: boolean;
  /** false: a branch nao existe no remoto. */
  existe: boolean;
}

export interface MaquinaNoPanorama {
  maquina: string;
  por: string;
  /** A batida: quando o retrato foi publicado; para o estado local, o instante da leitura. */
  publicadoEm: string;
  idadeMin: number;
  semBatida: boolean;
  estaMaquina: boolean;
  origem: 'retrato' | 'estado-local';
  versaoOrk: string | null;
  /** As threads ainda nao entregues, no formato do retrato (`ork.fabrica-maquina/v1`). */
  ativas: ThreadNaFabrica[];
  entreguesSemMaster: number;
}

export type OrigemNoPanorama = 'cwd' | 'registro' | 'argumento';

export interface ProjetoNoPanorama {
  /** `fuso`: o `owner.timezone` do projeto (clone ou forja), senao o do dono deste processo. */
  projeto: { nome: string; forja: string | null; clone: string | null; base: string | null; origem: OrigemNoPanorama; fuso: string };
  /** null: o roadmap nao foi lido (a lacuna diz por que). */
  roadmap: StatusDoRoadmap | null;
  reservas: ReservaDeItem[] | null;
  maquinas: MaquinaNoPanorama[] | null;
  fontes: FonteLida[];
  lacunas: LacunaDaRede[];
}

export interface PanoramaDaRede {
  contrato: typeof CONTRATO_PANORAMA_DA_REDE;
  consultadoEm: string;
  /** De que maquina a leitura foi feita. */
  maquina: string;
  /** O `--projeto`, quando houve. */
  pedido: string | null;
  limiarSemBatidaMin: number;
  /** O fuso dos horarios do texto: o do primeiro projeto consultado (achado 5 do CHECK). */
  fuso: string;
  projetos: ProjetoNoPanorama[];
  /** O que esta leitura NAO olhou: nada daqui pode virar "vazio". */
  naoConsultado: string[];
  lacunas: LacunaDaRede[];
}

/** Um projeto que esta maquina conhece: pelo clone (`raiz`) ou so pela forja. */
export interface ProjetoDaRede {
  nome: string;
  forja: IdentidadeDaForja | null;
  raiz: string | null;
  base: string | null;
  remoto: string;
  origem: OrigemNoPanorama;
}

export type CodigoDoPedido = 'projeto.desconhecido' | 'projeto.ambiguo' | 'projeto.sem-manifesto';

/** A recusa do `--projeto`, com os mesmos codigos da RM-052: o nucleo nunca chuta. */
export class ErroDoPedidoDeProjeto extends Error {
  constructor(readonly codigo: CodigoDoPedido, readonly detalhe: string, readonly candidatos: string[], readonly correcao: string) {
    super(`${codigo}: ${detalhe}`);
    this.name = 'ErroDoPedidoDeProjeto';
  }

  get recusa(): { erro: CodigoDoPedido; detalhe: string; candidatos: string[]; correcao: string } {
    return { erro: this.codigo, detalhe: this.detalhe, candidatos: this.candidatos, correcao: this.correcao };
  }

  get texto(): string {
    return [`${this.codigo}: ${this.detalhe}`, ...(this.candidatos.length ? ['Candidatos:', ...this.candidatos.map((c) => `  • ${c}`)] : []),
      this.correcao].join('\n');
  }
}

export interface OpcoesDoPanorama {
  /** De onde o projeto do cwd e o `--projeto` relativo sao lidos; padrao: `process.cwd()`. */
  cwd?: string;
  /** `--projeto`: caminho com manifesto, `github:dono/repo`, `gitlab:grupo/repo`, URL ou nome conhecido. */
  pedido?: string;
  quando?: string;
  /** Sem rede: so as ultimas copias do clone, e a forja nao e consultada. */
  semRemoto?: boolean;
  /** Os testes trocam a CLI da forja por respostas gravadas. */
  executor?: ExecutorDaForja;
  /** O nome desta maquina; padrao: `nomeDaMaquina()`. */
  maquina?: string;
  /** O arquivo do registro da RM-052; padrao: `~/.orkastery/projetos.json`. */
  registro?: string;
}

/** `fuso`: o do projeto em leitura; no panorama, o do dono deste processo ate um projeto dizer o seu. */
interface Contexto { quando: string; maquina: string; semRemoto: boolean; executor?: ExecutorDaForja; fuso: string }

const lacuna = (tipo: TipoDeLacunaDaRede, parte: ParteDaRede, alvo: string | undefined, detalhe: string, correcao: string): LacunaDaRede =>
  ({ tipo, parte, ...(alvo ? { alvo } : {}), detalhe, correcao });

// ---------------------------------------------------------------------------
// Os projetos: o do cwd, o do registro da RM-052 e o do pedido.
// ---------------------------------------------------------------------------

/**
 * Nome de remoto do git, como `origin`. O valor vem do manifesto versionado (`fabrica.remoto`), e um
 * valor que comece com `-` viraria opcao do `git fetch` (`--upload-pack=...`): so este formato chega
 * ao git (achado 4 do CHECK).
 */
const REMOTO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function projetoDoClone(c: ManifestoCarregado, origem: OrigemNoPanorama): ProjetoDaRede {
  const remoto = c.manifesto.fabrica.remoto;
  const url = REMOTO.test(remoto) ? git(c.raiz, ['remote', 'get-url', remoto]) : null;
  return { nome: c.manifesto.project.name, forja: url?.ok ? identidadeDaForja(url.stdout.trim()) : null, raiz: c.raiz,
    base: c.manifesto.worktree.base_branch, remoto, origem };
}

function mesmoProjeto(a: ProjetoDaRede, b: ProjetoDaRede): boolean {
  if (mesmaForja(a.forja, b.forja)) return true;
  if (!a.raiz || !b.raiz) return false;
  try { return raizDoEstado(a.raiz) === raizDoEstado(b.raiz); } catch { return false; }
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * O registro da RM-052 (`~/.orkastery/projetos.json`, `ork.projetos/v1`): `projetos` como lista ou
 * mapa por nome; de cada um, `nome`, `raiz` ou `caminho`, e `remoto`. Entrada que nao se le vira
 * lacuna; arquivo ausente vai para o nao consultado.
 */
function projetosDoRegistro(arquivo: string): { projetos: ProjetoDaRede[]; lacunas: LacunaDaRede[]; lido: boolean } {
  const lacunas: LacunaDaRede[] = [];
  const invalido = (detalhe: string) => lacuna('registro.invalido', 'registro', arquivo, detalhe,
    'confira o registro com `ork projetos` (RM-052) ou peça o projeto com --projeto');
  let bruto: unknown;
  try { bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { projetos: [], lacunas, lido: false };
    return { projetos: [], lacunas: [invalido('o registro de projetos não é um JSON legível')], lido: true };
  }
  if (!obj(bruto) || (bruto.contrato !== undefined && bruto.contrato !== CONTRATO_REGISTRO_DE_PROJETOS)) {
    return { projetos: [], lacunas: [invalido(`o registro não está no contrato ${CONTRATO_REGISTRO_DE_PROJETOS}`)], lido: true };
  }
  const lista: unknown[] | null = Array.isArray(bruto.projetos) ? bruto.projetos
    : obj(bruto.projetos) ? Object.entries(bruto.projetos).map(([nome, v]) => (obj(v) ? { nome, ...v } : v)) : null;
  if (!lista) return { projetos: [], lacunas: [invalido('o registro não traz a lista de projetos')], lido: true };
  const projetos: ProjetoDaRede[] = [];
  for (const e of lista) {
    const nome = obj(e) && typeof e.nome === 'string' ? e.nome.trim() : '';
    const raiz = obj(e) ? [e.raiz, e.caminho].find((v): v is string => typeof v === 'string' && path.isAbsolute(v)) : undefined;
    const remoto = obj(e) && typeof e.remoto === 'string' ? e.remoto : null;
    let c: ManifestoCarregado | null = null;
    try { c = raiz && fs.existsSync(raiz) ? carregarManifesto(raiz) : null; } catch { c = null; }
    const forja = remoto ? identidadeDaForja(remoto) : null;
    if (c) projetos.push(projetoDoClone(c, 'registro'));
    else if (nome && forja) projetos.push({ nome, forja, raiz: null, base: null, remoto: 'origin', origem: 'registro' });
    else lacunas.push(invalido(`entrada ${nome || '(sem nome)'} sem clone nesta máquina e sem remoto de forja reconhecido`));
  }
  return { projetos, lacunas, lido: true };
}

/** Os projetos que esta maquina conhece, sem repetir: o do cwd primeiro, depois o registro. */
export function projetosConhecidos(opcoes: Pick<OpcoesDoPanorama, 'cwd' | 'registro'> = {}):
  { projetos: ProjetoDaRede[]; lacunas: LacunaDaRede[]; naoConsultado: string[] } {
  const cwd = opcoes.cwd ?? process.cwd();
  const candidatos: ProjetoDaRede[] = [];
  const doCwd = carregarManifesto(cwd);
  if (doCwd) candidatos.push(projetoDoClone(doCwd, 'cwd'));
  const arquivo = opcoes.registro ?? path.join(pastaDoUsuario(), 'projetos.json');
  const registro = projetosDoRegistro(arquivo);
  candidatos.push(...registro.projetos);
  const projetos: ProjetoDaRede[] = [];
  for (const p of candidatos) {
    const i = projetos.findIndex((q) => mesmoProjeto(q, p));
    if (i < 0) projetos.push(p);
    else if (!projetos[i].raiz && p.raiz) projetos[i] = p;
  }
  return { projetos, lacunas: registro.lacunas,
    naoConsultado: registro.lido ? [] : [`registro de projetos desta máquina (RM-052): ${arquivo} ausente`] };
}

const rotuloDoProjeto = (p: ProjetoDaRede): string =>
  [p.nome, p.forja ? rotuloDaForja(p.forja) : null, p.raiz ? raizParaExibir(p.raiz) : null].filter(Boolean).join(' · ');

function raizParaExibir(raiz: string): string {
  try { return raizDoEstado(raiz); } catch { return raiz; }
}

/** Caminho explicito: absoluto, `./`, `../` ou `~/`. Nome sozinho e sempre nome (achado 2 do CHECK). */
const ehCaminho = (t: string): boolean => path.isAbsolute(t) || /^(?:\.{1,2}|~)(?:\/|$)/.test(t);

/**
 * D9: o `--projeto`. `github:`/`gitlab:`/URL, caminho explicito com manifesto, ou o nome (ou
 * `dono/repo`) de um projeto conhecido. Uma pasta do cwd com o mesmo nome nao toma o pedido: o nome
 * so vira caminho escrito como caminho. Ambiguo ou desconhecido recusa com os candidatos.
 */
export function resolverProjeto(pedido: string, conhecidos: readonly ProjetoDaRede[], cwd: string = process.cwd()): ProjetoDaRede {
  const candidatos = conhecidos.map(rotuloDoProjeto);
  const forja = forjaDoArgumento(pedido);
  if (forja) {
    const conhecido = conhecidos.find((p) => mesmaForja(p.forja, forja));
    return conhecido ? { ...conhecido, origem: 'argumento' }
      : { nome: forja.repo.split('/').pop() as string, forja, raiz: null, base: null, remoto: 'origin', origem: 'argumento' };
  }
  const texto = pedido.trim();
  if (ehCaminho(texto)) {
    const caminho = path.resolve(cwd, texto.replace(/^~(?=$|\/)/, os.homedir()));
    if (!fs.existsSync(caminho) || !fs.statSync(caminho).isDirectory()) {
      throw new ErroDoPedidoDeProjeto('projeto.desconhecido', `${caminho} não existe nesta máquina`, candidatos,
        'confira o caminho do clone, ou peça pela forja: --projeto github:dono/repo');
    }
    const c = carregarManifesto(caminho);
    if (!c) {
      throw new ErroDoPedidoDeProjeto('projeto.sem-manifesto', `${caminho} não tem ${NOME_MANIFESTO}`, candidatos,
        'rode `ork init` nesse clone, ou peça pela forja: --projeto github:dono/repo');
    }
    return projetoDoClone(c, 'argumento');
  }
  const alvo = texto.toLowerCase();
  const achados = conhecidos.filter((p) => p.nome.toLowerCase() === alvo ||
    (p.forja && (p.forja.repo.toLowerCase() === alvo || p.forja.repo.split('/').pop()!.toLowerCase() === alvo)));
  if (achados.length === 1) return { ...achados[0], origem: 'argumento' };
  if (achados.length > 1) {
    throw new ErroDoPedidoDeProjeto('projeto.ambiguo', `"${pedido}" casa ${achados.length} projetos conhecidos`, achados.map(rotuloDoProjeto),
      'peça pelo caminho do clone ou por github:dono/repo');
  }
  throw new ErroDoPedidoDeProjeto('projeto.desconhecido', `"${pedido}" não é um projeto conhecido nesta máquina`, candidatos,
    'peça por github:dono/repo, por gitlab:grupo/repo ou pelo caminho do clone escrito como caminho (./pasta ou absoluto)');
}

// ---------------------------------------------------------------------------
// Leitura: fatos comuns ao clone e a forja.
// ---------------------------------------------------------------------------

/** O inicio do dia do dono, com uma hora de folga para a virada do horario de verao. */
function inicioDoDia(quando: string, fuso: string): string {
  const p = partesLocais(quando, fuso);
  const decorrido = ((Number(p.hora) * 60 + Number(p.minuto)) * 60 + Number(p.segundo)) * 1000;
  return new Date(Date.parse(quando) - decorrido - 60 * 60 * 1000).toISOString();
}

/** D8: as threads entregues hoje, pelo merge `ship(<thread>)` na base com a data de hoje no fuso do dono. */
function entreguesHoje(commits: readonly CommitDaBase[], quando: string, fuso: string): Set<string> {
  const hoje = dataLocal(quando, fuso), ids = new Set<string>();
  for (const c of commits) {
    const m = /^ship\(([A-Za-z0-9._-]+)\)/.exec(c.assunto);
    if (m && Number.isFinite(Date.parse(c.data)) && dataLocal(c.data, fuso) === hoje) ids.add(m[1]);
  }
  return ids;
}

function docsDosArquivos(arquivos: readonly ArquivoDaForja[], lacunas: LacunaDaRede[]): Documento[] {
  const docs: Documento[] = [];
  for (const a of arquivos) {
    if (!ehPaginaDeDocs(path.posix.basename(a.caminho))) continue;
    if (a.texto === null) {
      lacunas.push(lacuna('roadmap.pagina-invalida', 'roadmap', a.caminho, 'página binária ou grande demais para ler: ficou de fora',
        'confira o arquivo na base do projeto'));
      continue;
    }
    const lido = documentoDeTexto(a.caminho, a.texto);
    if ('doc' in lido) docs.push(lido.doc);
    else lacunas.push(lacuna('roadmap.pagina-invalida', 'roadmap', a.caminho, `${lido.achado.mensagem}: ficou de fora`,
      'rode `ork docs verificar` no projeto'));
  }
  return docs;
}

function jsonsDosArquivos<T>(arquivos: readonly ArquivoDaForja[], valido: (v: unknown) => v is T, invalido: (caminho: string) => LacunaDaRede,
  lacunas: LacunaDaRede[]): T[] {
  const saida: T[] = [];
  for (const a of arquivos) {
    if (!a.caminho.endsWith('.json')) continue;
    let v: unknown;
    try { v = a.texto === null ? undefined : JSON.parse(a.texto); } catch { v = undefined; }
    if (valido(v)) saida.push(v);
    else lacunas.push(invalido(a.caminho));
  }
  return saida;
}

const reservasDosArquivos = (arquivos: readonly ArquivoDaForja[], lacunas: LacunaDaRede[]): ReservaDeItem[] =>
  jsonsDosArquivos(arquivos, reservaValida, (c) => lacuna('reserva.invalida', 'reservas', c,
    'reserva ilegível ou de outro contrato: ficou de fora', 'confira a branch ork/roadmap-reservas'), lacunas)
    .sort((a, b) => a.item.localeCompare(b.item));

const retratosDosArquivos = (arquivos: readonly ArquivoDaForja[], lacunas: LacunaDaRede[]): EstadoDaMaquina[] =>
  jsonsDosArquivos(arquivos, retratoLegivel, (c) => lacuna('retrato.invalido', 'fabrica', c,
    'retrato ilegível ou de outro contrato: a máquina ficou de fora', 'a máquina republica com `ork fabrica publicar --forcar`'), lacunas)
    .sort((a, b) => a.maquina.localeCompare(b.maquina));

/** Um campo de texto do manifesto lido da base pela forja (`secao.chave`), ou null. */
function campoDoManifesto(texto: string | null | undefined, secao: string, chave: string): string | null {
  if (!texto) return null;
  try {
    const dados = lerYaml(texto) as { [k: string]: ValorYaml };
    const mapa = dados && typeof dados === 'object' && !Array.isArray(dados) ? dados[secao] : undefined;
    const valor = mapa && typeof mapa === 'object' && !Array.isArray(mapa) ? (mapa as { [k: string]: ValorYaml })[chave] : undefined;
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
  } catch { return null; }
}

/** O nome do projeto no manifesto lido, para o titulo dizer o nome certo. */
const nomeDoManifesto = (texto: string | null | undefined): string | null => campoDoManifesto(texto, 'project', 'name');

/** A branch base do manifesto lido (achado 7 do CHECK), so com formato de nome de branch. */
function baseDoManifesto(texto: string | null | undefined): string | null {
  const base = campoDoManifesto(texto, 'worktree', 'base_branch');
  return base && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(base) && !base.includes('..') ? base : null;
}

const pontuar = (texto: string): string => {
  const limpo = String(texto).trim();
  return /[.?!]$/.test(limpo) ? limpo : `${limpo}.`;
};

/**
 * O retrato lido de fora so vale inteiro: alem do contrato, os tipos que o panorama usa e uma batida
 * legivel. Pergunta que nao e texto derrubava o comando, e `publicadoEm` ilegivel nunca virava
 * "sem batida" (achado 6 do CHECK).
 */
function retratoLegivel(v: unknown): v is EstadoDaMaquina {
  if (!estadoValido(v)) return false;
  const textoOuNulo = (x: unknown): boolean => x === null || x === undefined || typeof x === 'string';
  return typeof v.por === 'string' && Number.isFinite(Date.parse(v.publicadoEm)) && v.threads.every((t) =>
    typeof t.status === 'string' && typeof t.modo === 'string' && typeof t.esperaVoce === 'boolean' &&
    textoOuNulo(t.roadmap) && textoOuNulo(t.pergunta) && textoOuNulo(t.entregue) && textoOuNulo(t.paradaDesde));
}

function fatosDoRetrato(m: EstadoDaMaquina, entregues: Set<string>, itemDaReserva: Map<string, string>): FatoDeThread[] {
  return m.threads.map((t) => ({
    id: t.id, roadmap: t.roadmap ?? itemDaReserva.get(t.id) ?? null, aberta: t.status !== 'fechada', fase: t.fase,
    entregueHoje: () => entregues.has(t.id),
    espera: () => t.esperaVoce ? { thread: t.id, pergunta: pontuar(t.pergunta ?? 'o veredito da pausa'), maquina: m.maquina } : undefined,
    maquina: m.maquina,
  }));
}

function fatosDaMaquinaLocal(raiz: string, quando: string, fuso: string, maquina: string, entregues: Set<string>,
  itemDaReserva: Map<string, string>): FatoDeThread[] {
  return fatosLocais(raiz, quando, fuso).map((f) => ({
    ...f, roadmap: f.roadmap ?? itemDaReserva.get(f.id) ?? null, maquina,
    entregueHoje: () => entregues.has(f.id) || f.entregueHoje(),
    espera: () => { const e = f.espera(); return e ? { ...e, maquina } : undefined; },
  }));
}

function maquinasDoPanorama(retratos: readonly EstadoDaMaquina[], local: EstadoDaMaquina | null, ctx: Contexto,
  lacunas: LacunaDaRede[]): MaquinaNoPanorama[] {
  const agora = Date.parse(ctx.quando);
  const saida: MaquinaNoPanorama[] = [];
  for (const m of retratos) {
    if (local && m.maquina === local.maquina) continue;
    const idadeMs = Math.max(0, agora - Date.parse(m.publicadoEm));
    const semBatida = idadeMs > LIMIAR_SEM_BATIDA_MS;
    if (semBatida) {
      lacunas.push(lacuna('maquina.sem-batida', 'fabrica', m.maquina,
        `${m.maquina} sem retrato novo há ${duracaoCurta(Math.floor(idadeMs / 60000))} (último em ${formatarDataHora(m.publicadoEm, { fuso: ctx.fuso })}): ` +
        'as threads dela podem ter andado', `confira a ${m.maquina}: ela publica ao criar thread, despachar fase, entregar e a cada batida do pulse`));
    }
    saida.push({ maquina: m.maquina, por: m.por, publicadoEm: m.publicadoEm, idadeMin: Math.floor(idadeMs / 60000), semBatida,
      estaMaquina: m.maquina === ctx.maquina, origem: 'retrato', versaoOrk: m.versaoOrk ?? null,
      ativas: m.threads.filter((t) => !t.entregue), entreguesSemMaster: m.threads.filter((t) => t.entregue).length });
  }
  if (local) {
    saida.push({ maquina: local.maquina, por: local.por, publicadoEm: local.publicadoEm, idadeMin: 0, semBatida: false, estaMaquina: true,
      origem: 'estado-local', versaoOrk: local.versaoOrk, ativas: local.threads.filter((t) => !t.entregue),
      entreguesSemMaster: local.threads.filter((t) => t.entregue).length });
  }
  return saida.sort((a, b) => a.maquina.localeCompare(b.maquina));
}

interface DadosDoProjeto {
  nome: string;
  docs: Documento[] | null;
  reservas: ReservaDeItem[] | null;
  retratos: EstadoDaMaquina[] | null;
  local: { raiz: string; retrato: EstadoDaMaquina } | null;
  commits: CommitDaBase[];
}

function montarProjeto(p: ProjetoDaRede, d: DadosDoProjeto, ctx: Contexto, fontes: FonteLida[], lacunas: LacunaDaRede[]): ProjetoNoPanorama {
  const itemDaReserva = new Map((d.reservas ?? []).filter((r) => r.thread).map((r) => [r.thread as string, r.item]));
  const entregues = entreguesHoje(d.commits, ctx.quando, ctx.fuso);
  const fatos: FatoDeThread[] = [], ids = new Set<string>();
  const somar = (f: FatoDeThread): void => { if (!ids.has(f.id)) { ids.add(f.id); fatos.push(f); } };
  if (d.local) fatosDaMaquinaLocal(d.local.raiz, ctx.quando, ctx.fuso, d.local.retrato.maquina, entregues, itemDaReserva).forEach(somar);
  for (const m of d.retratos ?? []) if (!d.local || m.maquina !== d.local.retrato.maquina) fatosDoRetrato(m, entregues, itemDaReserva).forEach(somar);
  // Entregue hoje e ja fechada: nao esta em retrato nenhum, mas o merge na base e o fato do dia.
  for (const id of entregues) somar({ id, roadmap: itemDaReserva.get(id) ?? null, aberta: false, fase: 'SHIP', entregueHoje: () => true,
    espera: () => undefined });
  const maquinas = d.retratos || d.local ? maquinasDoPanorama(d.retratos ?? [], d.local?.retrato ?? null, ctx, lacunas) : null;
  return {
    projeto: { nome: d.nome, forja: p.forja ? rotuloDaForja(p.forja) : null, clone: p.raiz ? raizParaExibir(p.raiz) : null,
      base: p.base, origem: p.origem, fuso: ctx.fuso },
    roadmap: d.docs ? montarStatusDeFatos(d.docs, fatos, { quando: ctx.quando, projeto: d.nome }) : null,
    reservas: d.reservas, maquinas, fontes, lacunas,
  };
}

// ---------------------------------------------------------------------------
// Leitura pelo clone.
// ---------------------------------------------------------------------------

/**
 * Os blobs de um diretorio da ponta, lidos de uma vez: `ls-tree -z` (o caminho vem cru, e nome
 * nao-ASCII nao ganha aspas, achado 3 do CHECK) e um `cat-file --batch` para todos (achado 9).
 * null: o diretorio nao existe na ponta.
 */
function arquivosDaPonta(raiz: string, ponta: string, dir: string): ArquivoDaForja[] | null {
  const ls = spawnSync('git', ['ls-tree', '-z', ponta, '--', `${dir}/`], { cwd: raiz, encoding: 'utf8', timeout: 60000,
    maxBuffer: 16 * 1024 * 1024 });
  if (ls.status !== 0 || !ls.stdout) return null;
  const blobs = ls.stdout.split('\0').map((l) => /^\d+ blob ([0-9a-f]+)\t([\s\S]+)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m).map((m) => ({ sha: m[1], caminho: m[2] }));
  if (!blobs.length) return [];
  const cat = spawnSync('git', ['cat-file', '--batch'], { cwd: raiz, input: blobs.map((b) => b.sha).join('\n') + '\n', timeout: 60000,
    maxBuffer: 64 * 1024 * 1024 });
  const textos = new Map<string, string>();
  if (cat.status === 0 && Buffer.isBuffer(cat.stdout)) {
    const saida = cat.stdout;
    for (let pos = 0; pos < saida.length;) {
      const fim = saida.indexOf(0x0a, pos);
      if (fim < 0) break;
      const cabeca = /^([0-9a-f]+) blob (\d+)$/.exec(saida.subarray(pos, fim).toString('utf8'));
      if (!cabeca) { pos = fim + 1; continue; }
      const tamanho = Number(cabeca[2]);
      textos.set(cabeca[1], saida.subarray(fim + 1, fim + 1 + tamanho).toString('utf8'));
      pos = fim + 1 + tamanho + 1;
    }
  }
  return blobs.map((b) => ({ caminho: b.caminho, texto: textos.get(b.sha) ?? null }));
}

function commitsDoClone(raiz: string, ponta: string, desde: string): CommitDaBase[] {
  const r = git(raiz, ['log', ponta, `--since=${desde}`, '--format=%H%x09%cI%x09%s']);
  if (!r.ok) return [];
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const [commit, data, ...assunto] = l.split('\t');
    return { commit, data, assunto: assunto.join('\t') };
  });
}

function lerProjetoDoClone(p: ProjetoDaRede, geral: Contexto): ProjetoNoPanorama {
  const raiz = p.raiz as string, remoto = p.remoto, base = p.base ?? 'main';
  const fontes: FonteLida[] = [], lacunas: LacunaDaRede[] = [];
  const carregado = carregarManifesto(raiz);
  // O fuso do dono deste projeto vale para o dia e os horarios dele (achado 5 do CHECK).
  const ctx: Contexto = { ...geral, fuso: carregado?.manifesto.owner?.timezone ?? geral.fuso };
  if (!REMOTO.test(remoto)) {
    lacunas.push(lacuna('projeto.remoto-invalido', 'projeto', raizParaExibir(raiz),
      `fabrica.remoto do manifesto (${JSON.stringify(remoto).slice(0, 60)}) não é nome de remoto do git: nada foi lido pelo git`,
      'corrija fabrica.remoto no orkastery.yaml (padrão: origin)'));
    return montarProjeto(p, { nome: p.nome, docs: null, reservas: null, retratos: null, local: null, commits: [] }, ctx, fontes, lacunas);
  }
  // Uma tentativa de rede por projeto: remoto que nao respondeu nao segura as outras partes (achado 9 do CHECK).
  let semRede: 'opcao' | 'falhou' | null = ctx.semRemoto ? 'opcao' : null;
  const ler = (nome: string, prefixo: string, prazo: number): { ponta: string | null; atualizado: boolean; tentou: boolean } => {
    if (semRede) return { ponta: pontaLocal(raiz, remoto, nome), atualizado: false, tentou: false };
    const r = buscarBranch(raiz, remoto, nome, prefixo, prazo);
    if (!r.atualizado) semRede = 'falhou';
    return { ...r, tentou: true };
  };
  const porque = (tentou: boolean): string => semRede === 'opcao' ? ' (--sem-remoto)'
    : tentou ? ': o remoto não respondeu' : ': o remoto não respondeu antes, e não houve nova tentativa';
  const correcao = (): string => semRede === 'opcao' ? 'rode sem --sem-remoto para ler o remoto' : `confira a rede e o acesso a ${remoto} (git fetch)`;
  const dataDe = (sha: string): string | null => git(raiz, ['show', '-s', '--format=%cI', sha]).stdout.trim() || null;
  /** Uma branch lida do clone: a fonte citada, e a lacuna quando a leitura nao e nova ou nao houve. */
  const branch = (parte: 'roadmap' | 'reservas' | 'fabrica', nome: string, prefixo: string, prazo: number): string | null => {
    const r = ler(nome, prefixo, prazo), onde = `${remoto}/${nome}`;
    if (r.ponta) {
      const dataDoCommit = dataDe(r.ponta);
      fontes.push({ parte, origem: 'clone', onde, ref: nome, commit: r.ponta, dataDoCommit, lidoEm: ctx.quando, atualizado: r.atualizado, existe: true });
      if (!r.atualizado) {
        lacunas.push(lacuna(`${parte}.sem-leitura`, parte, onde, `sem leitura nova de ${onde}${porque(r.tentou)}; ` +
          `vale a última cópia desta máquina, commit ${r.ponta.slice(0, 7)} de ${formatarDataHora(dataDoCommit, { fuso: ctx.fuso })}`, correcao()));
      }
      return r.ponta;
    }
    if (r.atualizado) {
      fontes.push({ parte, origem: 'clone', onde, ref: nome, commit: null, dataDoCommit: null, lidoEm: ctx.quando, atualizado: true, existe: false });
      if (parte === 'roadmap') {
        lacunas.push(lacuna('roadmap.sem-base', 'roadmap', onde, `a branch base ${nome} não existe em ${remoto}`,
          'confira worktree.base_branch no orkastery.yaml'));
      } else if (parte === 'reservas') {
        lacunas.push(lacuna('reservas.sem-branch', 'reservas', onde, `nenhuma reserva feita ainda: a branch ${nome} não existe em ${remoto}`,
          'a primeira reserva a cria: `ork roadmap pegar RM-NNN`'));
      } else {
        lacunas.push(lacuna('fabrica.sem-branch', 'fabrica', onde, `nenhuma máquina publicou ainda: a branch ${nome} não existe em ${remoto}`,
          'cada máquina entra com `ork fabrica entrar`'));
      }
      return null;
    }
    lacunas.push(lacuna(`${parte}.sem-leitura`, parte, onde, `sem leitura de ${onde}${porque(r.tentou)}; esta máquina não tem cópia dela`,
      correcao()));
    return null;
  };

  let docs: Documento[] | null = null, commits: CommitDaBase[] = [];
  const pontaBase = branch('roadmap', base, 'rede', 30000);
  if (pontaBase) {
    docs = docsDosArquivos(arquivosDaPonta(raiz, pontaBase, DIR_ROADMAP) ?? [], lacunas);
    if (!docs.some((d) => d.tipo === 'roadmap')) {
      lacunas.push(lacuna('roadmap.sem-itens', 'roadmap', `${remoto}/${base}`, `nenhuma página de item em ${DIR_ROADMAP} na base ${base}`,
        'o projeto ainda não tem roadmap como código: `ork docs init` e o modelo docs/roadmap/_modelo-item.md'));
    }
    commits = commitsDoClone(raiz, pontaBase, inicioDoDia(ctx.quando, ctx.fuso));
  }
  const pontaReservas = branch('reservas', BRANCH_DE_RESERVAS, 'roadmap', 15000);
  const reservas = pontaReservas ? reservasDosArquivos(arquivosDaPonta(raiz, pontaReservas, DIR_DE_RESERVAS) ?? [], lacunas)
    : fontes.some((f) => f.parte === 'reservas' && !f.existe) ? [] : null;
  const pontaFabrica = branch('fabrica', BRANCH_DA_FABRICA, 'fabrica', 15000);
  const retratos = pontaFabrica ? retratosDosArquivos(arquivosDaPonta(raiz, pontaFabrica, DIR_DA_FABRICA) ?? [], lacunas)
    : fontes.some((f) => f.parte === 'fabrica' && !f.existe) ? [] : null;

  // D6: esta maquina pelo estado local, lido agora. Estado que nao se le (thread.json corrompido) vira
  // lacuna, e vale o retrato publicado dela, quando ha (achado 1 do CHECK).
  let local: DadosDoProjeto['local'] = null;
  if (carregado) {
    try {
      local = { raiz, retrato: retratoDaMaquina(carregado, { agora: ctx.quando, maquina: ctx.maquina, remoto }) };
      fontes.push({ parte: 'estado-local', origem: 'estado-local', onde: path.join(raizParaExibir(raiz), '.orkastery'), ref: null, commit: null,
        dataDoCommit: null, lidoEm: ctx.quando, atualizado: true, existe: true });
    } catch (e) {
      lacunas.push(lacuna('estado-local.sem-leitura', 'estado-local', path.join(raizParaExibir(raiz), '.orkastery'),
        `o estado local de ${ctx.maquina} não se leu (${detalheSeguro((e as Error)?.message ?? String(e))}): vale o retrato publicado dela, quando há`,
        'confira as threads desta máquina com `ork thread list` e o thread.json que não abre'));
    }
  }
  return montarProjeto(p, { nome: p.nome, docs, reservas, retratos, local, commits }, ctx, fontes, lacunas);
}

// ---------------------------------------------------------------------------
// Leitura pela forja, sem clone.
// ---------------------------------------------------------------------------

const CORRECAO_DA_FORJA: Record<ErroDaForja['codigo'], (cli: string) => string> = {
  'forja.ausente': (cli) => `instale ${cli} e faça login (${cli} auth login); gateway e cron têm PATH curto`,
  'forja.sem-login': (cli) => `rode ${cli} auth login nesta máquina; o ork nunca lê nem copia token`,
  'forja.nao-encontrado': () => 'confira o nome (github:dono/repo) e se o login da forja enxerga o repositório',
  'forja.tempo-esgotado': () => 'tente de novo: a forja não respondeu a tempo',
  'forja.inacessivel': () => 'confira a rede e o status da forja',
  'forja.resposta-invalida': () => 'a forja respondeu fora do formato esperado: registre o caso no RM-054',
};

function lerProjetoDaForja(p: ProjetoDaRede, geral: Contexto): ProjetoNoPanorama {
  const forja = p.forja as IdentidadeDaForja, rotulo = rotuloDaForja(forja), cli = forja.tipo === 'github' ? 'gh' : 'glab';
  const fontes: FonteLida[] = [];
  const lacunas: LacunaDaRede[] = [lacuna('projeto.sem-clone', 'projeto', rotulo, `sem clone de ${p.nome} nesta máquina: lido da forja, só consulta`,
    'para somar as threads desta máquina, trabalhe num clone do projeto')];
  const semLeitura = (d: Partial<DadosDoProjeto> = {}) => montarProjeto(p, { nome: p.nome, docs: null, reservas: null, retratos: null,
    local: null, commits: [], ...d }, geral, fontes, lacunas);
  if (geral.semRemoto) {
    lacunas.push(lacuna('forja.nao-consultada', 'forja', rotulo, '--sem-remoto: a forja não foi consultada e não há clone nesta máquina',
      'rode sem --sem-remoto'));
    return semLeitura();
  }
  const desde = inicioDoDia(geral.quando, geral.fuso);
  const ler = (base: string | null) => lerDaForja(forja, { base, desde, dirRoadmap: DIR_ROADMAP, manifesto: NOME_MANIFESTO,
    reservas: { branch: BRANCH_DE_RESERVAS, dir: DIR_DE_RESERVAS }, fabrica: { branch: BRANCH_DA_FABRICA, dir: DIR_DA_FABRICA },
    lidoEm: geral.quando }, geral.executor);
  let r = ler(p.base);
  // Sem clone, a base e a do manifesto lido: se ele aponta outra branch, a leitura e refeita por ela.
  const baseDoProjeto = r.ok && !p.base ? baseDoManifesto(r.leitura.base?.manifesto) : null;
  if (r.ok && baseDoProjeto && r.leitura.base && baseDoProjeto !== r.leitura.base.ref) r = ler(baseDoProjeto);
  if (!r.ok) {
    lacunas.push(lacuna(r.erro.codigo, 'forja', rotulo, r.erro.detalhe, CORRECAO_DA_FORJA[r.erro.codigo](cli)));
    return semLeitura();
  }
  const l = r.leitura;
  const nome = nomeDoManifesto(l.base?.manifesto) ?? p.nome;
  // O fuso do dono deste projeto vale para o dia e os horarios dele (achado 5 do CHECK).
  const ctx: Contexto = { ...geral, fuso: normalizarFuso(campoDoManifesto(l.base?.manifesto, 'owner', 'timezone')) ?? geral.fuso };
  if (Date.parse(inicioDoDia(ctx.quando, ctx.fuso)) < Date.parse(desde)) {
    lacunas.push(lacuna('roadmap.entregas-parciais', 'roadmap', rotulo, `os commits do dia foram pedidos desde ${formatarDataHora(desde, { fuso: ctx.fuso })}, ` +
      `depois do começo do dia no fuso do projeto (${ctx.fuso}): "Entregue hoje" pode ter ficado incompleto`, 'confira as entregas do dia no clone'));
  }
  for (const [parte, ponta] of [['roadmap', l.base], ['reservas', l.reservas], ['fabrica', l.fabrica]] as const) {
    if (ponta?.parcial) {
      lacunas.push(lacuna('forja.leitura-parcial', parte, `${rotulo}@${ponta.ref}`, 'a forja cortou a listagem em 100 arquivos: o resto não foi lido',
        'leia pelo clone do projeto, que não tem esse corte'));
    }
  }
  const fonte = (parte: FonteLida['parte'], ponta: { ref: string; commit: string; dataDoCommit: string | null } | null, ref: string): void => {
    fontes.push({ parte, origem: 'forja', onde: `${rotulo}@${ponta?.ref ?? ref}`, ref: ponta?.ref ?? ref, commit: ponta?.commit ?? null,
      dataDoCommit: ponta?.dataDoCommit ?? null, lidoEm: l.lidoEm, atualizado: true, existe: !!ponta });
  };
  let docs: Documento[] | null = null;
  fonte('roadmap', l.base, p.base ?? 'branch padrão');
  if (l.base) {
    docs = docsDosArquivos(l.base.arquivos ?? [], lacunas);
    if (!docs.some((d) => d.tipo === 'roadmap')) {
      lacunas.push(lacuna('roadmap.sem-itens', 'roadmap', `${rotulo}@${l.base.ref}`, `nenhuma página de item em ${DIR_ROADMAP} na base ${l.base.ref}`,
        'o projeto ainda não tem roadmap como código: `ork docs init` e o modelo docs/roadmap/_modelo-item.md'));
    }
    if (l.base.commitsParciais) {
      lacunas.push(lacuna('roadmap.entregas-parciais', 'roadmap', `${rotulo}@${l.base.ref}`,
        'a base teve mais de 100 commits hoje: "Entregue hoje" pode ter ficado incompleto', 'confira as entregas do dia no clone'));
    }
  } else {
    lacunas.push(lacuna('roadmap.sem-base', 'roadmap', rotulo, `${rotulo} não tem a branch ${p.base ?? 'padrão'}`,
      'confira worktree.base_branch no orkastery.yaml do projeto'));
  }
  fonte('reservas', l.reservas, BRANCH_DE_RESERVAS);
  if (!l.reservas) {
    lacunas.push(lacuna('reservas.sem-branch', 'reservas', `${rotulo}@${BRANCH_DE_RESERVAS}`,
      `nenhuma reserva feita ainda: a branch ${BRANCH_DE_RESERVAS} não existe em ${rotulo}`, 'a primeira reserva a cria: `ork roadmap pegar RM-NNN`'));
  }
  fonte('fabrica', l.fabrica, BRANCH_DA_FABRICA);
  if (!l.fabrica) {
    lacunas.push(lacuna('fabrica.sem-branch', 'fabrica', `${rotulo}@${BRANCH_DA_FABRICA}`,
      `nenhuma máquina publicou ainda: a branch ${BRANCH_DA_FABRICA} não existe em ${rotulo}`, 'cada máquina entra com `ork fabrica entrar`'));
  }
  return montarProjeto(p, { nome, docs,
    reservas: l.reservas ? reservasDosArquivos(l.reservas.arquivos ?? [], lacunas) : [],
    retratos: l.fabrica ? retratosDosArquivos(l.fabrica.arquivos ?? [], lacunas) : [],
    local: null, commits: l.base?.commits ?? [] }, ctx, fontes, lacunas);
}

// ---------------------------------------------------------------------------
// O panorama.
// ---------------------------------------------------------------------------

/**
 * Um projeto, isolado dos outros: o que o derruba vira lacuna dele, e os outros seguem (achado 1 do
 * CHECK). O detalhe passa pela mesma redacao do erro da forja.
 */
function lerProjeto(p: ProjetoDaRede, ctx: Contexto): ProjetoNoPanorama {
  const vazio = (l: LacunaDaRede): ProjetoNoPanorama => ({
    projeto: { nome: p.nome, forja: p.forja ? rotuloDaForja(p.forja) : null, clone: p.raiz ? raizParaExibir(p.raiz) : null, base: p.base,
      origem: p.origem, fuso: ctx.fuso },
    roadmap: null, reservas: null, maquinas: null, fontes: [], lacunas: [l] });
  try {
    if (p.raiz) return lerProjetoDoClone(p, ctx);
    if (p.forja) return lerProjetoDaForja(p, ctx);
    return vazio(lacuna('projeto.sem-fonte', 'projeto', p.nome, 'sem clone nesta máquina e sem remoto de forja reconhecido',
      'peça por github:dono/repo'));
  } catch (e) {
    return vazio(lacuna('projeto.sem-leitura', 'projeto', p.raiz ? raizParaExibir(p.raiz) : p.nome,
      `a leitura de ${p.nome} parou: ${detalheSeguro((e as Error)?.message ?? String(e))}`,
      'confira o clone e o estado dele no próprio projeto; os outros projetos seguiram'));
  }
}

/**
 * `ork network roadmap`: os projetos pedidos (ou todos os conhecidos), cada um com roadmap, reservas,
 * threads por maquina, fontes e lacunas. Recusa o `--projeto` ambiguo ou desconhecido.
 */
export function montarPanoramaDaRede(opcoes: OpcoesDoPanorama = {}): PanoramaDaRede {
  const quando = opcoes.quando ?? new Date().toISOString();
  const cwd = opcoes.cwd ?? process.cwd();
  const ctx: Contexto = { quando, maquina: nomeDaMaquina(opcoes.maquina), semRemoto: opcoes.semRemoto === true, executor: opcoes.executor,
    fuso: fusoDoDono().fuso };
  const conhecidos = projetosConhecidos({ cwd, registro: opcoes.registro });
  const naoConsultado = [
    'rede por pessoa (RM-053, ork.rede-status/v1): não lida nesta versão; as máquinas vêm da branch ork/fabrica-estado de cada projeto',
    ...conhecidos.naoConsultado,
  ];
  const lacunas = [...conhecidos.lacunas];
  let alvos: ProjetoDaRede[];
  if (opcoes.pedido !== undefined) {
    const alvo = resolverProjeto(opcoes.pedido, conhecidos.projetos, cwd);
    alvos = [alvo];
    for (const p of conhecidos.projetos) if (!mesmoProjeto(p, alvo)) naoConsultado.push(`projeto ${p.nome}: fora do pedido (--projeto)`);
  } else {
    alvos = conhecidos.projetos;
  }
  if (alvos.length === 0) {
    lacunas.push(lacuna('rede.sem-projeto', 'rede', undefined, 'nenhum projeto conhecido nesta máquina: sem manifesto no diretório atual e sem registro',
      'peça o projeto: --projeto <caminho do clone> ou --projeto github:dono/repo'));
  }
  const projetos = alvos.map((p) => lerProjeto(p, ctx));
  return { contrato: CONTRATO_PANORAMA_DA_REDE, consultadoEm: quando, maquina: ctx.maquina, pedido: opcoes.pedido ?? null,
    limiarSemBatidaMin: LIMIAR_SEM_BATIDA_MS / 60000, fuso: projetos[0]?.projeto.fuso ?? ctx.fuso, projetos, naoConsultado, lacunas };
}

// ---------------------------------------------------------------------------
// O texto.
// ---------------------------------------------------------------------------

function descreverProjeto(x: ProjetoNoPanorama['projeto']): string {
  return `${x.nome} (${[x.forja, x.clone ? `clone em ${x.clone}` : 'sem clone nesta máquina'].filter(Boolean).join(', ')})`;
}

function linhaDaFonte(f: FonteLida, quando: string, fuso: string): string {
  const parte = { roadmap: 'roadmap', reservas: 'reservas', fabrica: 'fábrica', 'estado-local': 'esta máquina' }[f.parte];
  const lido = f.lidoEm === quando ? 'lido agora' : `lido ${formatarDataHora(f.lidoEm, { fuso })}`;
  if (f.origem === 'estado-local') return `• ${parte}: estado local em ${f.onde}, ${lido}`;
  if (!f.existe) return `• ${parte}: ${f.onde} não existe, ${lido}`;
  const alvo = f.parte === 'roadmap' ? `${DIR_ROADMAP} em ${f.onde}` : f.onde;
  return `• ${parte}: ${alvo} @ ${(f.commit ?? '').slice(0, 7)} (commit de ${formatarDataHora(f.dataDoCommit, { fuso })}), ` +
    (f.atualizado ? lido : 'última cópia desta máquina, sem leitura nova');
}

function linhasDasMaquinas(x: ProjetoNoPanorama, fuso: string): string[] {
  if (x.maquinas === null) return ['• não lidas: veja as lacunas'];
  if (x.maquinas.length === 0) return ['• nenhuma máquina publicou em ork/fabrica-estado'];
  return x.maquinas.flatMap((m) => {
    const quem = `${m.maquina}${m.estaMaquina ? ' (esta máquina)' : ''}`;
    const batida = m.origem === 'estado-local' ? 'estado local lido agora'
      : `retrato de ${formatarDataHora(m.publicadoEm, { fuso })} (há ${duracaoCurta(m.idadeMin)})${m.semBatida ? ', SEM BATIDA' : ''}`;
    const cabeca = `• ${quem}: ${m.ativas.length} ativa(s)${m.entreguesSemMaster ? `, ${m.entreguesSemMaster} entregue(s) sem MASTER` : ''}, ${batida}`;
    return [cabeca, ...m.ativas.map((t) => `  ${t.id} · ${t.modo} · ${t.fase} · ${t.roadmap ?? 'sem item'}` +
      (t.esperaVoce ? ` · espera você: ${t.pergunta ?? 'veredito'}` : ''))];
  });
}

function linhasDasReservas(x: ProjetoNoPanorama, fuso: string): string[] {
  if (x.reservas === null) return ['• não lidas: veja as lacunas'];
  if (x.reservas.length === 0) return ['• nenhuma reserva em ork/roadmap-reservas'];
  return x.reservas.map((r) => `  ${r.item} · ${r.maquina} · ${r.thread ?? 'sem thread'} · desde ${formatarDataHora(r.desdeEm, { fuso })}`);
}

const linhaDaLacuna = (l: LacunaDaRede): string => `• ${l.tipo}${l.alvo ? ` (${l.alvo})` : ''}: ${l.detalhe}. O que fazer: ${l.correcao}.`;

/** O texto de `ork network roadmap`: o consultado e o nao consultado no alto, e cada parte com a fonte e a hora. */
export function textoDoPanoramaDaRede(p: PanoramaDaRede): string {
  if (p.contrato !== CONTRATO_PANORAMA_DA_REDE) throw new Error('panorama da rede: contrato inválido');
  const h = partesLocais(p.consultadoEm, p.fuso);
  const linhas = [
    `Panorama da rede lido de ${p.maquina} (${h.dia}/${h.mes}, ${h.hora}:${h.minuto})`,
    p.projetos.length ? `Consultado: ${p.projetos.map((x) => descreverProjeto(x.projeto)).join('; ')}` : 'Consultado: nenhum projeto.',
    'Não consultado:', ...(p.naoConsultado.length ? p.naoConsultado.map((n) => `• ${n}`) : ['• nada fora do pedido']),
  ];
  if (p.lacunas.length) linhas.push('', 'Lacunas da consulta', ...p.lacunas.map(linhaDaLacuna));
  for (const x of p.projetos) {
    linhas.push('', '────────', '');
    linhas.push(x.roadmap ? textoDoStatusDoRoadmap(x.roadmap, p.fuso)
      : `Roadmap do ${x.projeto.nome}: não lido (${x.lacunas.map((l) => l.tipo).filter((t) => t !== 'projeto.sem-clone').join(', ') || 'sem fonte'}).`);
    linhas.push('', 'Threads por máquina', ...linhasDasMaquinas(x, p.fuso));
    linhas.push('', 'Reservas', ...linhasDasReservas(x, p.fuso));
    linhas.push('', 'Fontes', ...(x.fontes.length ? x.fontes.map((f) => linhaDaFonte(f, p.consultadoEm, p.fuso)) : ['• nenhuma fonte lida']));
    linhas.push('', 'Lacunas', ...(x.lacunas.length ? x.lacunas.map(linhaDaLacuna) : ['• nenhuma: todas as fontes foram lidas agora']));
  }
  linhas.push('', legendaDoFuso(p.fuso));
  return linhas.join('\n');
}
