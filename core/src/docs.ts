/**
 * I-44: documentacao como codigo, com paridade entre doc, roadmap e repositorio.
 *
 * Dois padroes do dono vivem no repositorio de cada produto (`docs/padroes/`): documentacao
 * de produto (plataforma > sistema > modulo > feature) e roadmap (itens RM). Cada pagina tem
 * TRES leitores ao mesmo tempo, e este modulo cobra os tres:
 *
 *  - humano com TDAH: resposta primeiro ("Em uma frase"), secoes previsiveis, paragrafo curto;
 *  - verificador de paridade: o que a pagina afirma sobre codigo, testes e merge e conferido
 *    contra o repositorio e o git; divergencia vira erro de lint, nao opiniao;
 *  - modelos e agentes: frontmatter YAML com chaves e valores fixos e IDs estaveis.
 *
 * A pagina carrega fatos de SDLC do metodo Orkastery ligados ao PRODUTO (thread, fase, CHECK,
 * merge). Micro-decisoes de conducao ficam no ledger, nunca na doc.
 *
 * `verificarDocs` so le docs e git, entao roda no CI. `sincronizarDocs` le tambem o estado das
 * threads (que nao e versionado) e por isso roda na maquina do projeto.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lerYaml, ValorYaml } from './yaml';
import { dirThread, lerThread, listarIds } from './thread';
import { lerLedger } from './ledger';
import { branchValida, shaValido } from './branch-de-estado';
import { Locale, LOCALE_PADRAO, Mensagens, msg, remontar, textoDoCatalogo } from './locale';
import { branchRegistradaDaEntrega, mergesDasEntregasNaBase } from './merge-da-entrega';
import { CHANGELOG, checarChangelog } from './changelog-check';

export type TipoDoc = 'plataforma' | 'sistema' | 'modulo' | 'feature' | 'roadmap';

export interface Documento {
  /** Caminho relativo a raiz do repositorio, com `/`. */
  arquivo: string;
  tipo: TipoDoc;
  id: string;
  dados: Record<string, ValorYaml>;
  corpo: string;
}

export interface Achado {
  arquivo: string;
  id?: string;
  /** Regra tipada, estavel para agente: `docs.<familia>.<detalhe>`. */
  regra: string;
  gravidade: 'erro' | 'aviso';
  /** Uma frase curta: o que esta errado. */
  mensagem: string;
  /** Uma frase curta: o que fazer. */
  correcao?: string;
}

export const DIR_PRODUTO = 'docs/produto';
export const DIR_ROADMAP = 'docs/roadmap';
export const DIR_PADROES = 'docs/padroes';

const TIPOS: readonly TipoDoc[] = ['plataforma', 'sistema', 'modulo', 'feature', 'roadmap'];

const PADRAO_ID: Record<TipoDoc, RegExp> = {
  plataforma: /^PLAT-\d{2}$/,
  sistema: /^SYS-\d{2}$/,
  modulo: /^MOD-\d{2}$/,
  feature: /^FEAT-\d{3}$/,
  roadmap: /^RM-\d{3}$/,
};

/** Hierarquia do padrao de produto; o roadmap pode ter item pai do proprio roadmap. */
const PAI: Partial<Record<TipoDoc, RegExp>> = {
  sistema: PADRAO_ID.plataforma,
  modulo: PADRAO_ID.sistema,
  feature: PADRAO_ID.modulo,
  roadmap: PADRAO_ID.roadmap,
};

export const ESTADOS_DA_ESPECIFICACAO = ['vigente', 'em desenvolvimento', 'proposto', 'descontinuado'] as const;

/** Estados independentes do padrao de roadmap (secao 3.6), com os valores exatos do padrao. */
export const DIMENSOES: Readonly<Record<string, readonly string[]>> = {
  ciclo: ['Discovery', 'Backlog', 'Refinamento', 'Pronto para desenvolvimento', 'Em desenvolvimento',
    'Em validação', 'Piloto', 'Disponível', 'Concluído', 'Bloqueado', 'Cancelado', 'Descontinuado'],
  documentacao: ['Rascunho', 'Em revisão', 'Aprovada', 'Desatualizada'],
  codigo: ['Não iniciado', 'Branch criada', 'PR aberto', 'Mesclado'],
  testes: ['Não iniciados', 'Em execução', 'Aprovados', 'Falhando'],
  deploy: ['Não implantado', 'Dev', 'Staging', 'Produção'],
  exposicao: ['Flag desligada', 'Piloto/Canary', 'Parcial', 'Geral'],
  habilitacao: ['Pendente', 'Em andamento', 'Concluída'],
};

export const CATEGORIAS = ['iniciativa', 'épico', 'feature', 'melhoria'] as const;

const SECOES: Record<TipoDoc, readonly string[]> = {
  plataforma: ['Contexto e limites'],
  sistema: ['Contexto e limites'],
  modulo: ['Contexto e limites'],
  feature: ['Comportamento', 'Dados e contratos', 'Operação e controle', 'Histórico'],
  roadmap: ['Problema e resultado', 'Escopo e validação', 'Plano e decisões', 'Estado com evidências',
    'Responsabilidades e histórico'],
};

const CHAVES: Record<TipoDoc, readonly string[]> = {
  plataforma: ['id', 'tipo', 'titulo', 'owner', 'estado', 'verificado_em'],
  sistema: ['id', 'tipo', 'titulo', 'owner', 'estado', 'pai', 'verificado_em'],
  modulo: ['id', 'tipo', 'titulo', 'owner', 'estado', 'pai', 'verificado_em'],
  feature: ['id', 'tipo', 'titulo', 'owner', 'aprovador', 'estado', 'pai', 'roadmap', 'verificado_em', 'versao', 'fontes'],
  roadmap: ['id', 'tipo', 'titulo', 'categoria', 'owner', 'atualizado_em', 'features', 'estado', 'evidencias'],
};

/** Limite da frase de abertura: cabe numa linha de leitura rapida. */
export const LIMITE_DA_FRASE = 240;
/** Acima disso o paragrafo pede topicos (leitura com TDAH). */
export const LIMITE_DO_PARAGRAFO = 600;

// --------------------------------------------------------------------------------------------
// Leitura

type Mapa = { [k: string]: ValorYaml };
const ehMapa = (v: ValorYaml | undefined): v is Mapa => !!v && typeof v === 'object' && !Array.isArray(v);
const lista = (v: ValorYaml | undefined): string[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v.map(String) : [String(v)];

/** Separa o frontmatter (`---` ... `---`) do corpo. `bruto` null quando a pagina nao tem. */
export function separarFrontmatter(texto: string): { bruto: string | null; corpo: string } {
  const t = texto.replace(/\r\n/g, '\n');
  if (!t.startsWith('---\n')) return { bruto: null, corpo: t };
  const fim = t.indexOf('\n---\n', 3);
  if (fim < 0) return { bruto: null, corpo: t };
  return { bruto: t.slice(4, fim + 1), corpo: t.slice(fim + 5) };
}

/** `_modelo-*.md` e `README.md` sao modelo e indice, nao paginas de entidade. */
export function ehPaginaDeDocs(nome: string): boolean {
  return nome.endsWith('.md') && !nome.startsWith('_') && nome !== 'README.md';
}

function paginas(raiz: string, dir: string): string[] {
  const abs = path.join(raiz, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs)
    .filter(ehPaginaDeDocs)
    .sort()
    .map((n) => `${dir}/${n}`);
}

/**
 * RM-054: uma pagina a partir do texto, venha ele do disco, de um blob do git ou da forja. O
 * achado e o mesmo que a leitura do disco daria.
 */
export function documentoDeTexto(arquivo: string, texto: string): { doc: Documento } | { achado: Achado } {
  const { bruto, corpo } = separarFrontmatter(texto);
  if (bruto === null) {
    return { achado: erro(arquivo, undefined, 'docs.frontmatter.ausente', (m) => m.semFrontmatter, (m) => m.semFrontmatterCorrecao) };
  }
  let dados: ValorYaml;
  try {
    dados = lerYaml(bruto);
  } catch (e) {
    const detalhe = (e as Error).message;
    return { achado: erro(arquivo, undefined, 'docs.frontmatter.invalido', (m) => m.frontmatterInvalido(detalhe)) };
  }
  if (!ehMapa(dados)) {
    return { achado: erro(arquivo, undefined, 'docs.frontmatter.invalido', (m) => m.frontmatterNaoMapa) };
  }
  return { doc: { arquivo, tipo: dados.tipo as TipoDoc, id: String(dados.id ?? ''), dados, corpo } };
}

export function carregarDocs(raiz: string): { docs: Documento[]; achados: Achado[] } {
  const docs: Documento[] = [];
  const achados: Achado[] = [];
  for (const arquivo of [...paginas(raiz, DIR_PRODUTO), ...paginas(raiz, DIR_ROADMAP)]) {
    const lido = documentoDeTexto(arquivo, fs.readFileSync(path.join(raiz, arquivo), 'utf8'));
    if ('doc' in lido) docs.push(lido.doc);
    else achados.push(lido.achado);
  }
  return { docs, achados };
}

// --------------------------------------------------------------------------------------------
// Verificacao

export interface OpcoesDeVerificacao {
  /** Branch base do produto (manifesto `worktree.base_branch`). */
  baseBranch?: string;
  /** Commit que abriu a thread, para nao atribuir a ela conteudo anterior quando a branch local esta atrasada. */
  baseCarimbada?: string | null;
  /** Linhas de ajuda do CLI do produto; quando dadas, `fontes.comandos` com `ork` e conferido. */
  ajudaDoCli?: string;
  /** Desliga as checagens que chamam git (teste de unidade sem repositorio). */
  semGit?: boolean;
  /**
   * RM-037 (fatia 3, GO-FIX 2): o verificador roda num PR. O merge de outra thread com o item fora de
   * `Mesclado` vive na `main`, nao no PR: aqui vira aviso, e quem reprova e o push da `main`. Sem isso,
   * a pagina de outra thread travava todo PR, inclusive o de fora, na janela entre o merge e o PR de
   * docs que o sincroniza. O indice, ao contrario, e derivado do proprio checkout e reprova nos dois.
   */
  pr?: boolean;
}

/**
 * RM-061 (F3b, G4): a mensagem e a correcao de um achado nascem pelo catalogo, no locale de quem verifica. O CLI verifica
 * no escopo pt-BR, entao o `--json` as leva em pt-BR, e so a impressao as remonta; a regra sai igual nas duas linguas.
 */
type TextoDeDocs = (m: Mensagens['docs']) => string;

function achado(gravidade: Achado['gravidade'], arquivo: string, id: string | undefined, regra: string, mensagem: TextoDeDocs,
  correcao?: TextoDeDocs): Achado {
  const texto = (montar: TextoDeDocs) => textoDoCatalogo((m) => montar(m.docs));
  return { arquivo, ...(id ? { id } : {}), regra, gravidade, mensagem: texto(mensagem), ...(correcao ? { correcao: texto(correcao) } : {}) };
}
function erro(arquivo: string, id: string | undefined, regra: string, mensagem: TextoDeDocs, correcao?: TextoDeDocs): Achado {
  return achado('erro', arquivo, id, regra, mensagem, correcao);
}
function aviso(arquivo: string, id: string | undefined, regra: string, mensagem: TextoDeDocs, correcao?: TextoDeDocs): Achado {
  return achado('aviso', arquivo, id, regra, mensagem, correcao);
}

function git(raiz: string, args: string[]): { ok: boolean; saida: string } {
  const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8' });
  return { ok: r.status === 0, saida: (r.stdout ?? '').trim() };
}

/** Resolve a branch base: local, depois `origin/`, porque o CI faz checkout destacado. */
export function resolverBase(raiz: string, preferida = 'main'): string | null {
  // RM-047 (fronteira de confiança): `preferida` vem do `worktree.base_branch` do clone.
  if (!branchValida(preferida)) return null;
  for (const ref of [preferida, `origin/${preferida}`]) {
    if (git(raiz, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) return ref;
  }
  return null;
}

const ISO_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Os comandos de primeiro e segundo nivel que a ajuda do CLI declara (`accounts list`, `verify`).
 * Alternativas com barra (`brain status|inventory`) viram um subcomando cada.
 */
export function comandosDaAjuda(ajuda: string): Set<string> {
  const conhecidos = new Set<string>();
  for (const linha of ajuda.split('\n')) {
    const m = /^ {2}([a-z][a-z-]*)(?: ([a-z][a-z|-]*))?/.exec(linha);
    if (!m) continue;
    conhecidos.add(m[1]);
    for (const sub of (m[2] ?? '').split('|')) if (sub) conhecidos.add(`${m[1]} ${sub}`);
  }
  return conhecidos;
}

export function verificarDocs(raiz: string, opcoes: OpcoesDeVerificacao = {}): { docs: Documento[]; achados: Achado[] } {
  const { docs, achados } = carregarDocs(raiz);
  const porId = new Map<string, Documento>();

  for (const d of docs) {
    if (!TIPOS.includes(d.tipo)) {
      achados.push(erro(d.arquivo, d.id || undefined, 'docs.tipo',
        (m) => m.tipoDesconhecido(String(d.dados.tipo)), (m) => m.useUmDe(TIPOS.join(', '))));
      continue;
    }
    if (!PADRAO_ID[d.tipo].test(d.id)) {
      achados.push(erro(d.arquivo, d.id || undefined, 'docs.id.formato',
        (m) => m.idForaDoPadrao(d.id, d.tipo), (m) => m.formatoEsperado(PADRAO_ID[d.tipo].source.replace(/[\^$\\]/g, ''))));
    }
    const nome = path.posix.basename(d.arquivo);
    if (!(nome === `${d.id}.md` || nome.startsWith(`${d.id}-`))) {
      achados.push(erro(d.arquivo, d.id, 'docs.id.arquivo', (m) => m.arquivoSemId, (m) => m.renomeie(d.id)));
    }
    const pastaCerta = d.tipo === 'roadmap' ? DIR_ROADMAP : DIR_PRODUTO;
    if (path.posix.dirname(d.arquivo) !== pastaCerta) {
      achados.push(erro(d.arquivo, d.id, 'docs.pasta', (m) => m.pastaErrada(d.tipo, pastaCerta)));
    }
    const anterior = porId.get(d.id);
    if (anterior) {
      achados.push(erro(d.arquivo, d.id, 'docs.id.duplicado', (m) => m.idRepetido(anterior.arquivo), (m) => m.idRepetidoCorrecao));
    } else {
      porId.set(d.id, d);
    }
  }

  const base = opcoes.semGit ? null : resolverBase(raiz, opcoes.baseBranch);
  if (!opcoes.semGit && !base) {
    achados.push(aviso('.', undefined, 'docs.git.base',
      (m) => m.baseAusente(opcoes.baseBranch ?? 'main'), (m) => m.baseAusenteCorrecao));
  }
  if (opcoes.pr && base) {
    const changelog = checarChangelog(raiz, { base, head: 'HEAD', baseCarimbada: opcoes.baseCarimbada });
    if (!changelog.ok) {
      achados.push(erro(CHANGELOG, undefined, changelog.motivo ?? 'changelog.invalido',
        () => changelog.detalhe, () => changelog.correcao ?? 'corrija o CHANGELOG e repita a verificação'));
    }
  }
  const comandos = opcoes.ajudaDoCli ? comandosDaAjuda(opcoes.ajudaDoCli) : null;

  for (const d of docs) {
    if (!TIPOS.includes(d.tipo)) continue;
    verificarChaves(d, achados);
    verificarReferencias(raiz, d, porId, achados);
    verificarLeitura(d, achados);
    verificarFontes(raiz, d, comandos, achados);
    if (d.tipo === 'roadmap') {
      verificarEstadoDoRoadmap(raiz, d, base, achados);
      if (base) verificarMergeDaThread(raiz, d, base, achados, opcoes.pr === true);
      verificarTabelasDeEstado(d, achados);
    }
  }
  verificarIndices(raiz, docs, achados);
  return { docs, achados };
}

function verificarChaves(d: Documento, achados: Achado[]): void {
  for (const k of CHAVES[d.tipo]) {
    if (!(k in d.dados)) {
      achados.push(erro(d.arquivo, d.id, 'docs.frontmatter.chave', (m) => m.faltaChave(k), (m) => m.faltaChaveCorrecao));
    }
  }
  if (d.tipo !== 'roadmap' && 'estado' in d.dados) {
    const e = String(d.dados.estado);
    if (!(ESTADOS_DA_ESPECIFICACAO as readonly string[]).includes(e)) {
      achados.push(erro(d.arquivo, d.id, 'docs.frontmatter.valor', (m) => m.estadoForaDoPadrao(e),
        (m) => m.useUmDe(ESTADOS_DA_ESPECIFICACAO.join(', '))));
    }
  }
  if (d.tipo === 'roadmap') {
    const cat = String(d.dados.categoria ?? '');
    if ('categoria' in d.dados && !(CATEGORIAS as readonly string[]).includes(cat)) {
      achados.push(erro(d.arquivo, d.id, 'docs.frontmatter.valor', (m) => m.categoriaForaDoPadrao(cat),
        (m) => m.useUmaDe(CATEGORIAS.join(', '))));
    }
    const estado = d.dados.estado;
    if ('estado' in d.dados && !ehMapa(estado)) {
      achados.push(erro(d.arquivo, d.id, 'docs.frontmatter.valor', (m) => m.estadoNaoMapa,
        (m) => m.dimensoes(Object.keys(DIMENSOES).join(', '))));
    } else if (ehMapa(estado)) {
      for (const [dim, valores] of Object.entries(DIMENSOES)) {
        if (!(dim in estado)) {
          achados.push(erro(d.arquivo, d.id, 'docs.frontmatter.chave', (m) => m.faltaDimensao(dim), (m) => m.faltaDimensaoCorrecao));
        } else if (!valores.includes(String(estado[dim]))) {
          const valor = String(estado[dim]);
          achados.push(erro(d.arquivo, d.id, 'docs.frontmatter.valor', (m) => m.dimensaoForaDoPadrao(dim, valor),
            (m) => m.useUmDe(valores.join(', '))));
        }
      }
      for (const dim of Object.keys(estado)) {
        if (!(dim in DIMENSOES)) {
          achados.push(erro(d.arquivo, d.id, 'docs.frontmatter.chave', (m) => m.dimensaoDesconhecida(dim)));
        }
      }
    }
  }
  for (const k of ['verificado_em', 'atualizado_em']) {
    if (k in d.dados && !ISO_COM_FUSO.test(String(d.dados[k]))) {
      const valor = String(d.dados[k]);
      achados.push(erro(d.arquivo, d.id, 'docs.data', (m) => m.dataSemFuso(k, valor), (m) => m.dataExemplo));
    }
  }
  // Valor de modelo esquecido no frontmatter: `<...>` ou ID zerado (FEAT-000, MOD-00, RM-000).
  const visitar = (v: ValorYaml | undefined, onde: string): void => {
    if (typeof v === 'string') {
      if (/^<[^>]*>$/.test(v.trim()) || /^(PLAT|SYS|MOD|FEAT|RM)-0+$/.test(v.trim()) || /@0{7}$/.test(v.trim())) {
        const valor = v;
        achados.push(erro(d.arquivo, d.id, 'docs.modelo', (m) => m.valorDoModelo(onde, valor)));
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => visitar(x, `${onde}[${i}]`));
    else if (ehMapa(v)) for (const [k, x] of Object.entries(v)) visitar(x, onde ? `${onde}.${k}` : k);
  };
  visitar(d.dados, '');
}

// Tabelas de estado do corpo do roadmap: geradas do frontmatter, nunca escritas a mao.
const RELANCE_INI = '<!-- ork-docs:relance:inicio -->';
const RELANCE_FIM = '<!-- ork-docs:relance:fim -->';
const ESTADO_INI = '<!-- ork-docs:estado:inicio -->';
const ESTADO_FIM = '<!-- ork-docs:estado:fim -->';

const ROTULO_DA_DIMENSAO: Record<string, string> = {
  ciclo: 'Ciclo do item', documentacao: 'Documentação', codigo: 'Código', testes: 'Testes',
  deploy: 'Deploy', exposicao: 'Exposição', habilitacao: 'Habilitação',
};

function evidenciaDe(ev: ValorYaml | undefined): string {
  if (ev === undefined || ev === null) return '—';
  if (!ehMapa(ev)) return celula(ev);
  const partes: string[] = [];
  if (ev.commit !== undefined && ev.commit !== null) partes.push(`commit \`${String(ev.commit)}\``);
  if (ev.pr !== undefined && ev.pr !== null) partes.push(`PR #${String(ev.pr)}`);
  for (const [k, v] of Object.entries(ev)) {
    if (k !== 'commit' && k !== 'pr' && v !== null && v !== undefined) partes.push(`${k}: ${celula(v)}`);
  }
  return partes.length ? partes.join(' · ') : '—';
}

/** Linha de relance: o estado inteiro numa tabela de uma linha, logo abaixo do "Em uma frase". */
export function renderizarRelance(d: Documento): string {
  const e = ehMapa(d.dados.estado) ? d.dados.estado : {};
  const dims = ['ciclo', 'codigo', 'testes', 'deploy', 'exposicao'];
  return [`| ${dims.map((k) => ROTULO_DA_DIMENSAO[k]).join(' | ')} |`, `| ${dims.map(() => '---').join(' | ')} |`,
    `| ${dims.map((k) => celula(e[k])).join(' | ')} |`].join('\n');
}

/** Tabela "Estado com evidências" do padrão (3.6), com a evidência que o frontmatter carrega. */
export function renderizarEstado(d: Documento): string {
  const e = ehMapa(d.dados.estado) ? d.dados.estado : {};
  const ev = ehMapa(d.dados.evidencias) ? d.dados.evidencias : {};
  const data = String(d.dados.atualizado_em ?? '').slice(0, 10) || '—';
  const L = ['| Dimensão | Estado | Evidência | Data | Responsável |', '| --- | --- | --- | --- | --- |'];
  for (const dim of Object.keys(DIMENSOES)) {
    L.push(`| ${ROTULO_DA_DIMENSAO[dim]} | ${celula(e[dim])} | ${evidenciaDe(ev[dim])} | ${data} | ${celula(d.dados.owner)} |`);
  }
  return L.join('\n');
}

function blocoEntre(corpo: string, ini: string, fim: string): string | null {
  const i = corpo.indexOf(ini);
  const f = corpo.indexOf(fim);
  if (i < 0 || f < i) return null;
  return corpo.slice(i + ini.length, f).trim();
}

/** Conteudo gerado entre marcadores, com linha em branco em volta (tabela colada em comentario reprova no MD058). */
function entreMarcadores(conteudo: string): string {
  return conteudo ? `\n\n${conteudo}\n\n` : '\n';
}

function substituirBloco(corpo: string, ini: string, fim: string, conteudo: string): string {
  const i = corpo.indexOf(ini);
  const f = corpo.indexOf(fim);
  if (i < 0 || f < i) return corpo;
  return `${corpo.slice(0, i + ini.length)}${entreMarcadores(conteudo)}${corpo.slice(f)}`;
}

function verificarTabelasDeEstado(d: Documento, achados: Achado[]): void {
  for (const [ini, fim, render, nome] of [
    [RELANCE_INI, RELANCE_FIM, renderizarRelance, (m: Mensagens['docs']) => m.nomeDaRelance],
    [ESTADO_INI, ESTADO_FIM, renderizarEstado, (m: Mensagens['docs']) => m.nomeDoEstado],
  ] as const) {
    const atual = blocoEntre(d.corpo, ini, fim);
    if (atual === null) {
      achados.push(erro(d.arquivo, d.id, 'docs.paridade.estado', (m) => m.faltaTabela(nome(m)), (m) => m.faltaTabelaCorrecao));
    } else if (atual !== render(d)) {
      achados.push(erro(d.arquivo, d.id, 'docs.paridade.estado', (m) => m.tabelaDiverge(nome(m)), (m) => m.tabelaDivergeCorrecao));
    }
  }
}

function verificarReferencias(raiz: string, d: Documento, porId: Map<string, Documento>, achados: Achado[]): void {
  const esperadoDoPai = PAI[d.tipo];
  const pai = d.dados.pai;
  if (esperadoDoPai && pai !== undefined && pai !== null) {
    const idPai = String(pai);
    if (!esperadoDoPai.test(idPai)) {
      achados.push(erro(d.arquivo, d.id, 'docs.referencia', (m) => m.paiDeOutroNivel(idPai, d.tipo)));
    } else if (!porId.has(idPai)) {
      achados.push(erro(d.arquivo, d.id, 'docs.referencia', (m) => m.paiNaoExiste(idPai), (m) => m.paiNaoExisteCorrecao));
    }
  } else if (esperadoDoPai && d.tipo !== 'roadmap' && (pai === undefined || pai === null)) {
    achados.push(erro(d.arquivo, d.id, 'docs.referencia', (m) => m.precisaDePai(d.tipo)));
  }
  const cruzadas: Array<[string, TipoDoc, string]> = d.tipo === 'feature' ? [['roadmap', 'roadmap', 'features']]
    : d.tipo === 'roadmap' ? [['features', 'feature', 'roadmap']] : [];
  for (const [chave, tipoAlvo, chaveDeVolta] of cruzadas) {
    for (const alvo of lista(d.dados[chave])) {
      const outro = porId.get(alvo);
      if (!outro || outro.tipo !== tipoAlvo) {
        achados.push(erro(d.arquivo, d.id, 'docs.referencia', (m) => m.citaInexistente(chave, alvo, tipoAlvo)));
      } else if (!lista(outro.dados[chaveDeVolta]).includes(d.id)) {
        achados.push(aviso(d.arquivo, d.id, 'docs.referencia.reciproca', (m) => m.naoCitaDeVolta(alvo, d.id),
          (m) => m.naoCitaDeVoltaCorrecao(d.id, chaveDeVolta, alvo)));
      }
    }
  }
  // Links relativos no corpo: link quebrado e paridade perdida entre paginas.
  for (const m of semCodigo(d.corpo).matchAll(/\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g)) {
    const alvo = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(alvo)) continue;
    const abs = path.resolve(path.dirname(path.join(raiz, d.arquivo)), decodeURIComponent(alvo));
    if (!fs.existsSync(abs)) {
      achados.push(erro(d.arquivo, d.id, 'docs.link', (m) => m.linkQuebrado(alvo)));
    }
  }
}

/** Tira blocos e trechos de codigo, que nao sao texto de leitura nem link. */
function semCodigo(texto: string): string {
  return texto.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function verificarLeitura(d: Documento, achados: Achado[]): void {
  const linhas = d.corpo.split('\n');
  const h1 = linhas.find((l) => l.startsWith('# '));
  if (!h1 || !h1.includes(d.id)) {
    achados.push(erro(d.arquivo, d.id, 'docs.leitura.titulo', (m) => m.tituloSemId, (m) => m.tituloSemIdCorrecao(d.id)));
  }
  const frase = linhas.find((l) => /^>\s*\*\*Em uma frase:\*\*/.test(l));
  if (!frase) {
    achados.push(erro(d.arquivo, d.id, 'docs.leitura.resumo', (m) => m.faltaFrase, (m) => m.faltaFraseCorrecao));
  } else {
    const n = frase.replace(/^>\s*\*\*Em uma frase:\*\*\s*/, '').trim().length;
    if (n === 0) achados.push(erro(d.arquivo, d.id, 'docs.leitura.resumo', (m) => m.fraseVazia));
    else if (n > LIMITE_DA_FRASE) {
      achados.push(erro(d.arquivo, d.id, 'docs.leitura.resumo', (m) => m.fraseLonga(n, LIMITE_DA_FRASE), (m) => m.fraseLongaCorrecao));
    }
  }
  const h2 = new Set(linhas.filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim()));
  for (const s of SECOES[d.tipo]) {
    if (!h2.has(s)) {
      achados.push(erro(d.arquivo, d.id, 'docs.secao', (m) => m.faltaSecao(s), (m) => m.faltaSecaoCorrecao));
    }
  }
  const texto = semCodigo(d.corpo);
  for (const [, campo] of texto.matchAll(/\[(\.\.\.|[^\]\n]{1,60})\](?!\()/g)) {
    achados.push(erro(d.arquivo, d.id, 'docs.modelo', (m) => m.campoDoModelo(campo), (m) => m.campoDoModeloCorrecao));
  }
  for (const p of texto.split(/\n\s*\n/)) {
    const bloco = p.trim();
    if (!bloco || /^(#|>|\||[-*+] |\d+\. |<!--)/.test(bloco)) continue;
    if (bloco.length > LIMITE_DO_PARAGRAFO) {
      achados.push(aviso(d.arquivo, d.id, 'docs.leitura.paragrafo', (m) => m.paragrafoLongo(bloco.length), (m) => m.paragrafoLongoCorrecao));
    }
  }
}

function verificarFontes(raiz: string, d: Documento, comandos: Set<string> | null, achados: Achado[]): void {
  const f = d.dados.fontes;
  if (f === undefined || f === null) return;
  if (!ehMapa(f)) {
    achados.push(erro(d.arquivo, d.id, 'docs.frontmatter.valor', (m) => m.fontesNaoMapa));
    return;
  }
  const existe = (p: string) => fs.existsSync(path.join(raiz, p));
  for (const chave of ['codigo', 'testes', 'docs']) {
    for (const p of lista(f[chave])) {
      if (path.isAbsolute(p) || p.split('/').includes('..')) {
        achados.push(erro(d.arquivo, d.id, 'docs.paridade.fonte', (m) => m.caminhoFora(p), (m) => m.caminhoForaCorrecao));
      } else if (!existe(p)) {
        achados.push(erro(d.arquivo, d.id, 'docs.paridade.fonte', (m) => m.caminhoNaoExiste(p), (m) => m.caminhoNaoExisteCorrecao));
      }
    }
  }
  for (const s of lista(f.simbolos)) {
    const [arq, simbolo] = s.split('#');
    if (!arq || !simbolo) {
      achados.push(erro(d.arquivo, d.id, 'docs.paridade.simbolo', (m) => m.simboloForaDoFormato(s)));
    } else if (!existe(arq)) {
      achados.push(erro(d.arquivo, d.id, 'docs.paridade.simbolo', (m) => m.arquivoDoSimbolo(arq, simbolo)));
    } else if (!new RegExp(`\\b${escapar(simbolo)}\\b`).test(fs.readFileSync(path.join(raiz, arq), 'utf8'))) {
      achados.push(erro(d.arquivo, d.id, 'docs.paridade.simbolo', (m) => m.simboloAusente(simbolo, arq), (m) => m.simboloAusenteCorrecao));
    }
  }
  const codigo = lista(f.codigo).filter(existe).map((p) => fs.readFileSync(path.join(raiz, p), 'utf8'));
  for (const c of lista(f.contratos)) {
    if (!codigo.some((t) => t.includes(c))) {
      achados.push(erro(d.arquivo, d.id, 'docs.paridade.contrato', (m) => m.contratoAusente(c)));
    }
  }
  if (comandos) {
    for (const cmd of lista(f.comandos)) {
      const [programa, topo = '', sub = ''] = cmd.trim().split(/\s+/);
      if (programa !== 'ork') continue;
      // Comando com subcomandos declarados (`accounts list`) exige o par; argumento (`<id>`) nao conta.
      const temSubcomandos = [...comandos].some((c) => c.startsWith(`${topo} `));
      const exigePar = temSubcomandos && /^[a-z][a-z-]*$/.test(sub);
      if (!comandos.has(topo) || (exigePar && !comandos.has(`${topo} ${sub}`))) {
        const comando = [programa, topo, sub].join(' ').trim();
        achados.push(erro(d.arquivo, d.id, 'docs.paridade.comando', (m) => m.comandoAusente(comando), (m) => m.comandoAusenteCorrecao));
      }
    }
  }
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function verificarEstadoDoRoadmap(raiz: string, d: Documento, base: string | null, achados: Achado[]): void {
  const e = ehMapa(d.dados.estado) ? d.dados.estado : {};
  const ev = ehMapa(d.dados.evidencias) ? d.dados.evidencias : {};
  const codigoEv = ehMapa(ev.codigo) ? ev.codigo : {};
  const commit = codigoEv.commit === undefined || codigoEv.commit === null ? '' : String(codigoEv.commit);
  const [ciclo, codigo, testes, deploy] = [e.ciclo, e.codigo, e.testes, e.deploy].map((v) => String(v ?? ''));

  // Coerencia entre dimensoes (padrao 3.6): o status nao pode esconder o que falta.
  if (ciclo === 'Concluído' && codigo !== 'Mesclado') {
    achados.push(erro(d.arquivo, d.id, 'docs.estado.coerencia', (m) => m.concluidoSemMerge));
  }
  if (ciclo === 'Concluído' && testes !== 'Aprovados') {
    achados.push(erro(d.arquivo, d.id, 'docs.estado.coerencia', (m) => m.concluidoSemTestes));
  }
  if (deploy === 'Produção' && codigo !== 'Mesclado') {
    achados.push(erro(d.arquivo, d.id, 'docs.estado.coerencia', (m) => m.producaoSemMerge));
  }
  if (ciclo === 'Bloqueado' && !ehMapa(d.dados.bloqueio)) {
    achados.push(erro(d.arquivo, d.id, 'docs.estado.bloqueio', (m) => m.bloqueadoSemMapa, (m) => m.bloqueadoSemMapaCorrecao));
  }
  if (codigo === 'Mesclado' && !commit) {
    achados.push(erro(d.arquivo, d.id, 'docs.paridade.git', (m) => m.mescladoSemCommit, (m) => m.mescladoSemCommitCorrecao));
  }
  if (commit && base) {
    // RM-047: o commit vem do frontmatter do clone; só sha hexadecimal vai ao git.
    if (!shaValido(commit) || !git(raiz, ['cat-file', '-e', `${commit}^{commit}`]).ok) {
      achados.push(erro(d.arquivo, d.id, 'docs.paridade.git', (m) => m.commitInexistente(commit)));
    } else if (codigo === 'Mesclado' && !git(raiz, ['merge-base', '--is-ancestor', commit, base]).ok) {
      const naBase = base;
      achados.push(erro(d.arquivo, d.id, 'docs.paridade.git', (m) => m.commitForaDaBase(commit, naBase), (m) => m.commitForaDaBaseCorrecao));
    }
  }
}

/**
 * RM-037 (fatia 3, defeito 1): o outro sentido da paridade com o git. Depois do merge do PR, o
 * frontmatter da RM-049 (#26) e da RM-051 (#33) seguiu em "Branch criada", e o verificador dizia OK:
 * ele so conferia que `Mesclado` tem o commit na base. O merge desta fabrica e pelo GitHub, sem o
 * `ork ship` no caminho, entao a prova mora aqui, no job que o CI obrigatorio roda. A regra usa o
 * mesmo `ship(<thread>)` do `sincronizarDocs`: tudo o que ela acusa o `sincronizar` corrige.
 */
function verificarMergeDaThread(raiz: string, d: Documento, base: string, achados: Achado[], pr = false): void {
  const pendente = pendenciaDeMerge(raiz, d, base);
  if (!pendente) return;
  const { thread, merges, codigo } = pendente;
  achados.push((pr ? aviso : erro)(d.arquivo, d.id, 'docs.paridade.merge',
    (m) => m.mergeDaThread(thread, base, merges[0].slice(0, 7), codigo, pr), (m) => m.mergeDaThreadCorrecao(base, d.id)));
}

/**
 * A regra do `docs.paridade.merge`, isolada para o `ork ship registrar-pr` (RM-044, A3): a pagina cujo
 * `sdlc.thread` ja tem merge `ship(<thread>)` na base e cujo `estado.codigo` ainda nao diz `Mesclado`.
 * `thread`, quando dada, restringe a pagina a essa thread.
 */
function pendenciaDeMerge(raiz: string, d: Documento, base: string, thread?: string):
  { thread: string; merges: string[]; codigo: string } | null {
  const sdlc = ehMapa(d.dados.sdlc) ? d.dados.sdlc : null;
  const daPagina = sdlc && typeof sdlc.thread === 'string' ? sdlc.thread.trim() : '';
  if (!daPagina || (thread !== undefined && daPagina !== thread)) return null;
  const codigo = String((ehMapa(d.dados.estado) ? d.dados.estado.codigo : null) ?? '');
  if (codigo === 'Mesclado') return null;
  const merges = mergesDaThreadNoGit(raiz, daPagina, base);
  if (merges.length === 0) return null;
  return { thread: daPagina, merges, codigo };
}

/** Uma pagina do roadmap que o push da base vai reprovar em `docs.paridade.merge`. */
export interface DocPendente {
  id: string;
  arquivo: string;
  /** O `estado.codigo` da pagina na base (vazio quando falta). */
  codigo: string;
  /** O primeiro merge `ship(<thread>)` na base. */
  merge: string;
  /** O comando que corrige, o mesmo que a correcao do `docs verificar` ensina. */
  comando: string;
}

/**
 * RM-044 (A3): as paginas do roadmap, lidas da `ref` (a base remota depois do fetch, nao a copia local,
 * que pode estar atras), que a regra `docs.paridade.merge` vai acusar por causa da `thread`. Nao grava
 * nada: so lista. Ref ilegivel ou sem `docs/roadmap` devolve lista vazia.
 */
export function docsPendentesDoMerge(raiz: string, thread: string, ref: string): DocPendente[] {
  const ls = git(raiz, ['ls-tree', '--name-only', `${ref}:${DIR_ROADMAP}`]);
  if (!ls.ok || !ls.saida) return [];
  const pendentes: DocPendente[] = [];
  for (const nome of ls.saida.split('\n').filter(ehPaginaDeDocs).sort()) {
    const arquivo = `${DIR_ROADMAP}/${nome}`;
    const blob = git(raiz, ['show', `${ref}:${arquivo}`]);
    if (!blob.ok) continue;
    const lido = documentoDeTexto(arquivo, `${blob.saida}\n`);
    if (!('doc' in lido) || lido.doc.tipo !== 'roadmap') continue;
    const p = pendenciaDeMerge(raiz, lido.doc, ref, thread);
    if (!p) continue;
    pendentes.push({ id: lido.doc.id, arquivo, codigo: p.codigo, merge: p.merges[0],
      comando: `ork docs sincronizar --escrever --so ${lido.doc.id}` });
  }
  return pendentes;
}

/** Os indices gerados (`docs/roadmap/README.md`, `docs/produto/README.md`) e o que o frontmatter diz. */
const INDICES_GERADOS: ReadonlyArray<[string, (docs: Documento[]) => string]> = [
  [`${DIR_ROADMAP}/README.md`, (docs) => tabelaDoRoadmap(docs)],
  [`${DIR_PRODUTO}/README.md`, (docs) => tabelaDoProduto(docs)],
];

/**
 * RM-037 (fatia 3, defeito 1): o indice e uma vista do frontmatter, como as tabelas do corpo, e mentia
 * do mesmo jeito: sem a RM-051 e com a RM-031 de antes. Divergente reprova; vazio (o modelo recem-copiado
 * pelo `ork docs init`) so avisa; sem os marcadores, nao ha indice gerado para conferir.
 */
function verificarIndices(raiz: string, docs: Documento[], achados: Achado[]): void {
  for (const [arquivo, gerar] of INDICES_GERADOS) {
    const abs = path.join(raiz, arquivo);
    if (!fs.existsSync(abs)) continue;
    // Checkout com CRLF (Windows com core.autocrlf) nao e divergencia: as paginas tambem normalizam.
    const atual = blocoEntre(fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'), INICIO, FIM);
    if (atual === null) continue;
    if (atual === '') {
      if (docs.length > 0) {
        achados.push(aviso(arquivo, undefined, 'docs.paridade.indice', (m) => m.indiceNaoGerado, (m) => m.indiceNaoGeradoCorrecao));
      }
    } else if (atual !== gerar(docs)) {
      achados.push(erro(arquivo, undefined, 'docs.paridade.indice',
        (m) => m.indiceDiverge(false), (m) => m.indiceDivergeCorrecao));
    }
  }
}

// --------------------------------------------------------------------------------------------
// Saida para humano (TDAH) e para agente

/** O texto da verificacao, no locale ativo; a mensagem e a correcao de cada achado sao remontadas (G4 da F3b). */
export function textoDaVerificacao(docs: Documento[], achados: Achado[]): string {
  const m = msg().docs;
  const conta = (t: TipoDoc) => docs.filter((d) => d.tipo === t).length;
  const erros = achados.filter((a) => a.gravidade === 'erro');
  const avisos = achados.filter((a) => a.gravidade === 'aviso');
  const L: string[] = [];
  L.push(m.resumo(docs.length, conta('feature'), conta('roadmap'), conta('plataforma') + conta('sistema') + conta('modulo')));
  L.push(erros.length === 0 ? m.semErro(avisos.length) : m.reprovado(erros.length, avisos.length));
  for (const [titulo, grupo] of [[m.tituloErros, erros], [m.tituloAvisos, avisos]] as const) {
    if (grupo.length === 0) continue;
    L.push('', titulo);
    for (const a of grupo) {
      L.push(`  ${(a.id ?? a.arquivo).padEnd(9)} ${remontar(a.mensagem)}`);
      if (a.correcao) L.push(`  ${''.padEnd(9)} → ${remontar(a.correcao)}`);
    }
  }
  return L.join('\n');
}

// --------------------------------------------------------------------------------------------
// Escrita de YAML (subconjunto que o `lerYaml` le de volta)

function escalarYaml(v: string | number | boolean | null): string {
  if (v === null) return 'null';
  if (typeof v !== 'string') return String(v);
  const precisaAspas = v === '' || /^[\s]|[\s]$/.test(v) || /^[-?:,[\]{}#&*!|>'"%@`]/.test(v)
    || /: |\s#|:$/.test(v) || /^(true|false|yes|no|null|~)$/i.test(v) || /^-?\d*\.?\d+$/.test(v);
  if (!precisaAspas) return v;
  // O leitor do nucleo tira as aspas sem interpretar escape: a aspa escolhida nao pode aparecer dentro.
  if (!v.includes('"')) return `"${v}"`;
  if (!v.includes("'")) return `'${v}'`;
  throw new Error(`escreverYaml: valor com aspas simples e duplas fora do subconjunto: ${v}`);
}

export function escreverYaml(v: ValorYaml, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (!ehMapa(v)) throw new Error('escreverYaml: a raiz é um mapa');
  const L: string[] = [];
  for (const [k, valor] of Object.entries(v)) {
    if (ehMapa(valor)) {
      if (Object.keys(valor).length === 0) { L.push(`${pad}${k}: {}`); continue; }
      L.push(`${pad}${k}:`);
      L.push(escreverYaml(valor, indent + 2));
    } else if (Array.isArray(valor)) {
      const escalares = valor.every((x) => !ehMapa(x) && !Array.isArray(x));
      // A lista inline do leitor separa por virgula: item com virgula ou colchete vai em bloco.
      const inlineSeguro = escalares && valor.every((x) => typeof x !== 'string' || !/[,[\]]/.test(x));
      const inline = `[${valor.map((x) => escalarYaml(x as string)).join(', ')}]`;
      if (inlineSeguro && (valor.length === 0 || inline.length <= 72)) L.push(`${pad}${k}: ${inline}`);
      else {
        L.push(`${pad}${k}:`);
        for (const x of valor) {
          if (ehMapa(x) || Array.isArray(x)) throw new Error('escreverYaml: lista de mapas fora do subconjunto');
          L.push(`${pad}  - ${escalarYaml(x)}`);
        }
      }
    } else {
      L.push(`${pad}${k}: ${escalarYaml(valor)}`);
    }
  }
  return L.join('\n');
}

// --------------------------------------------------------------------------------------------
// Sincronizacao: fatos do ledger e do git para o frontmatter, nunca por passagem de tempo

export interface MudancaDeSync {
  id: string;
  arquivo: string;
  campo: string;
  de: string;
  para: string;
  fonte: string;
}

export interface OpcoesDeSync {
  baseBranch?: string;
  escrever?: boolean;
  /**
   * RM-037 (rm037noite, defeito 5): so estes itens (`RM-NNN`) mudam; os indices seguem regerados.
   * Sem a lista, todo item de roadmap entra, como antes.
   */
  itens?: readonly string[];
  /** Relogio injetavel para teste; so marca `atualizado_em` quando algo mudou. */
  agora?: () => string;
}

function isoComFusoLocal(d: Date): string {
  const off = -d.getTimezoneOffset();
  const s = off >= 0 ? '+' : '-';
  const p = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${local}${s}${p(off / 60)}:${p(off % 60)}`;
}

/**
 * Commit de merge da thread na base: evento `ship_done` do ledger, ou mensagem `ship(<thread>)`.
 *
 * Vale o PRIMEIRO merge que esta na base, nao o ultimo. E ele que prova quando o codigo do item
 * passou a estar mesclado, e ele nao muda: com o ultimo, o PR que so atualiza a doc do item
 * (mesclado de novo como `ship(<thread>)`) viraria o novo "merge do item" a cada rodada, num
 * laco em que sincronizar a doc sempre gera outra sincronizacao para fazer.
 */
export function mergeDaThread(raiz: string, thread: string, base: string): { sha: string; fonte: string } | null {
  try {
    const eventos = lerLedger(dirThread(raiz, thread));
    const ship = eventos.filter((e) => e.tipo === 'ship_done' && typeof e.mergeSha === 'string')
      .find((e) => shaValido(e.mergeSha) && branchValida(base) && git(raiz, ['merge-base', '--is-ancestor', e.mergeSha, base]).ok);
    if (ship) return { sha: String(ship.mergeSha).slice(0, 7), fonte: 'ledger ship_done' };
  } catch { /* thread sem estado nesta maquina: cai para o git */ }
  const primeiro = mergesDaThreadNoGit(raiz, thread, base)[0];
  if (primeiro) return { sha: primeiro.slice(0, 7), fonte: `git log ${base}` };
  return null;
}

/**
 * Os merges da entrega na base, do mais velho ao mais novo, so pelo git (o CI pode nao ter ledger).
 * RM-037 (fatia 3): um lugar so para o `sincronizarDocs` e o `verificarDocs` acharem o mesmo merge.
 */
export function mergesDaThreadNoGit(raiz: string, thread: string, base: string): string[] {
  // O ref resolvido pode ser local, remoto abreviado ou remoto completo; a mensagem padrao do GitLab leva so a base.
  const destino = base.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '').replace(/^origin\//, '');
  const branch = branchRegistradaDaEntrega(raiz, thread);
  return (mergesDasEntregasNaBase(raiz, base, destino, [{ thread, branch }], true).get(thread) ?? []).map((m) => m.mergeSha);
}

function temBranch(raiz: string, thread: string): boolean {
  const r = git(raiz, ['for-each-ref', '--format=%(refname:short)', `refs/heads/ork/${thread}-*`, `refs/remotes/origin/ork/${thread}-*`]);
  return r.ok && r.saida.length > 0;
}

const ORDEM_DO_CODIGO = DIMENSOES.codigo;

/**
 * RM-037 (rm037noite, defeito 5): o escopo padrao do `ork docs sincronizar`. Na worktree de uma thread
 * com item do roadmap, so o item dela: da worktree da ork-rm037noite, o sincronizar gravava RM-025,
 * 026, 031, 038, 048, 049, 050 e 054, e cada PR conflitava com as outras. Fora de worktree de thread
 * (a raiz, onde o condutor sincroniza depois do merge), todo item, como antes.
 */
export function escopoPadraoDoSync(raiz: string): { itens: string[] | null; thread: string | null } {
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const aqui = real(raiz);
  for (const id of listarIds(raiz)) {
    let t;
    try { t = lerThread(raiz, id); } catch { continue; }
    if (t.worktree && real(t.worktree) === aqui) return { itens: t.roadmap ? [t.roadmap] : null, thread: t.id };
  }
  return { itens: null, thread: null };
}

export function sincronizarDocs(raiz: string, opcoes: OpcoesDeSync = {}): { mudancas: MudancaDeSync[]; indices: string[] } {
  const base = resolverBase(raiz, opcoes.baseBranch) ?? (opcoes.baseBranch ?? 'main');
  const agora = opcoes.agora ?? (() => isoComFusoLocal(new Date()));
  const { docs } = carregarDocs(raiz);
  const mudancas: MudancaDeSync[] = [];
  const noEscopo = (d: Documento) => !opcoes.itens || opcoes.itens.includes(d.id);

  for (const d of docs.filter((x) => x.tipo === 'roadmap' && noEscopo(x))) {
    const sdlc = ehMapa(d.dados.sdlc) ? d.dados.sdlc : null;
    const thread = sdlc && typeof sdlc.thread === 'string' ? sdlc.thread : null;
    if (!thread) continue;
    const antes = mudancas.length;
    // Grava um fato no caminho dado (`estado.codigo`), criando mapas so quando ha o que gravar.
    const definir = (caminho: string, para: string, fonte: string) => {
      const chaves = caminho.split('.');
      let alvo: Mapa = d.dados;
      for (const k of chaves.slice(0, -1)) alvo = ehMapa(alvo[k]) ? alvo[k] as Mapa : (alvo[k] = {});
      const ultima = chaves[chaves.length - 1];
      if (String(alvo[ultima] ?? '') === para) return;
      mudancas.push({ id: d.id, arquivo: d.arquivo, campo: caminho, de: String(alvo[ultima] ?? ''), para, fonte });
      alvo[ultima] = para;
    };

    const merge = mergeDaThread(raiz, thread, base);
    if (merge) {
      definir('estado.codigo', 'Mesclado', merge.fonte);
      definir('evidencias.codigo.commit', merge.sha, merge.fonte);
    } else if (temBranch(raiz, thread)) {
      // So avanca: um PR aberto registrado por humano nao volta para "Branch criada".
      const atual = String((ehMapa(d.dados.estado) ? d.dados.estado.codigo : null) ?? 'Não iniciado');
      if (ORDEM_DO_CODIGO.indexOf(atual) < ORDEM_DO_CODIGO.indexOf('Branch criada')) {
        definir('estado.codigo', 'Branch criada', 'git for-each-ref');
      }
    }
    try {
      const t = JSON.parse(fs.readFileSync(path.join(dirThread(raiz, thread), 'thread.json'), 'utf8')) as Record<string, unknown>;
      for (const [campo, valor] of [['fase', t.faseAtual], ['status', t.status]] as const) {
        if (typeof valor === 'string') definir(`sdlc.${campo}`, valor, 'thread.json');
      }
    } catch { /* estado da thread ausente nesta maquina: so o git conta */ }

    if (mudancas.length !== antes) {
      d.dados.atualizado_em = agora();
      if (opcoes.escrever) regravarFrontmatter(raiz, d);
    }
  }

  // As tabelas de estado do corpo sao vistas do frontmatter: regeradas em todo item de roadmap,
  // inclusive quando a pessoa mudou o frontmatter a mao (ciclo, deploy, exposicao...).
  for (const d of docs.filter((x) => x.tipo === 'roadmap' && noEscopo(x))) {
    const novo = substituirBloco(substituirBloco(d.corpo, RELANCE_INI, RELANCE_FIM, renderizarRelance(d)),
      ESTADO_INI, ESTADO_FIM, renderizarEstado(d));
    if (novo !== d.corpo) {
      if (!mudancas.some((m) => m.id === d.id)) {
        mudancas.push({ id: d.id, arquivo: d.arquivo, campo: 'tabelas de estado', de: 'desatualizadas', para: 'regeradas', fonte: 'frontmatter' });
      }
      d.corpo = novo;
      if (opcoes.escrever) regravarFrontmatter(raiz, d);
    }
  }

  const indices = [
    atualizarIndice(raiz, `${DIR_ROADMAP}/README.md`, tabelaDoRoadmap(docs), opcoes.escrever === true),
    atualizarIndice(raiz, `${DIR_PRODUTO}/README.md`, tabelaDoProduto(docs), opcoes.escrever === true),
  ].filter((x): x is string => x !== null);
  return { mudancas, indices };
}

/** Regrava frontmatter e corpo do documento (o corpo em memoria ja traz as tabelas regeradas). */
function regravarFrontmatter(raiz: string, d: Documento): void {
  fs.writeFileSync(path.join(raiz, d.arquivo), `---\n${escreverYaml(d.dados)}\n---\n${d.corpo}`);
}

const INICIO = '<!-- ork-docs:indice:inicio -->';
const FIM = '<!-- ork-docs:indice:fim -->';

/** Substitui o bloco entre os marcadores; devolve o arquivo quando mudou (ou mudaria). */
function atualizarIndice(raiz: string, arquivo: string, tabela: string, escrever: boolean): string | null {
  const abs = path.join(raiz, arquivo);
  if (!fs.existsSync(abs)) return null;
  const atual = fs.readFileSync(abs, 'utf8');
  const i = atual.indexOf(INICIO);
  const f = atual.indexOf(FIM);
  if (i < 0 || f < i) return null;
  const novo = `${atual.slice(0, i + INICIO.length)}${entreMarcadores(tabela)}${atual.slice(f)}`;
  if (novo === atual) return null;
  if (escrever) fs.writeFileSync(abs, novo);
  return arquivo;
}

function celula(v: ValorYaml | undefined): string {
  return String(v ?? '—').replace(/\|/g, '\\|');
}

export function tabelaDoRoadmap(docs: Documento[]): string {
  const itens = docs.filter((d) => d.tipo === 'roadmap').sort((a, b) => a.id.localeCompare(b.id));
  const L = ['| ID | Resultado | Ciclo | Código | Testes | Deploy | Atualizado |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const d of itens) {
    const e = ehMapa(d.dados.estado) ? d.dados.estado : {};
    const data = String(d.dados.atualizado_em ?? '').slice(0, 10);
    L.push(`| [${d.id}](${path.posix.basename(d.arquivo)}) | ${celula(d.dados.titulo)} | ${celula(e.ciclo)} | `
      + `${celula(e.codigo)} | ${celula(e.testes)} | ${celula(e.deploy)} | ${data || '—'} |`);
  }
  return L.join('\n');
}

export function tabelaDoProduto(docs: Documento[]): string {
  const ordem: TipoDoc[] = ['plataforma', 'sistema', 'modulo', 'feature'];
  const itens = docs.filter((d) => d.tipo !== 'roadmap')
    .sort((a, b) => ordem.indexOf(a.tipo) - ordem.indexOf(b.tipo) || a.id.localeCompare(b.id));
  const L = ['| ID | Nome | Tipo | Estado | Pai | Verificado |', '| --- | --- | --- | --- | --- | --- |'];
  for (const d of itens) {
    L.push(`| [${d.id}](${path.posix.basename(d.arquivo)}) | ${celula(d.dados.titulo)} | ${d.tipo} | ${celula(d.dados.estado)} | `
      + `${celula(d.dados.pai)} | ${String(d.dados.verificado_em ?? '').slice(0, 10) || '—'} |`);
  }
  return L.join('\n');
}

/** O texto da sincronizacao, no locale ativo; o campo e os valores de cada mudanca sao dado e so a impressao os traduz. */
export function textoDaSincronizacao(r: { mudancas: MudancaDeSync[]; indices: string[] }, escreveu: boolean): string {
  const m = msg().docs;
  const L: string[] = [];
  const ids = new Set(r.mudancas.map((x) => x.id));
  L.push(r.mudancas.length === 0 && r.indices.length === 0 ? m.sincronizado : m.aAtualizar(escreveu, ids.size, r.indices.length));
  for (const x of r.mudancas) L.push(m.linhaDaMudanca(x.id, x.campo, x.de, x.para, x.fonte));
  for (const i of r.indices) L.push(m.indice(i));
  if (!escreveu && (r.mudancas.length || r.indices.length)) L.push('', m.nadaGravado);
  return L.join('\n');
}

// --------------------------------------------------------------------------------------------
// Scaffolding: o mesmo padrao em todo produto conduzido pelo Orkastery

const ARQUIVOS_DO_PADRAO: ReadonlyArray<[string, string]> = [
  ['padroes/documentacao-de-produto.md', `${DIR_PADROES}/documentacao-de-produto.md`],
  ['padroes/roadmap-de-produto.md', `${DIR_PADROES}/roadmap-de-produto.md`],
  ['produto/_modelo-feature.md', `${DIR_PRODUTO}/_modelo-feature.md`],
  ['produto/README.md', `${DIR_PRODUTO}/README.md`],
  ['roadmap/_modelo-item.md', `${DIR_ROADMAP}/_modelo-item.md`],
  ['roadmap/README.md', `${DIR_ROADMAP}/README.md`],
  ['markdownlint-cli2.jsonc', '.markdownlint-cli2.jsonc'],
];

/**
 * A pasta dos modelos do nucleo na lingua pedida. RM-061 (F3a, D3 e D6): o ingles mora em `assets/docs-en/`, com os
 * mesmos nomes; o contrato que o `ork docs verificar` le (frontmatter, secoes, `Em uma frase`) e o mesmo nas duas.
 */
export function dirDosModelos(locale: Locale = LOCALE_PADRAO): string {
  const pasta = locale === 'en' ? 'docs-en' : 'docs';
  for (const c of [path.join(__dirname, '..', 'assets', pasta), path.join(__dirname, '..', '..', 'assets', pasta)]) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`docs.modelos: assets/${pasta} do nucleo nao encontrado`);
}

/** Cria o que falta, no `locale` pedido (pt-BR por omissao); nunca sobrescreve pagina existente. Devolve o que criou. */
export function iniciarDocs(raiz: string, locale: Locale = LOCALE_PADRAO): string[] {
  const origem = dirDosModelos(locale);
  const criados: string[] = [];
  for (const [de, para] of ARQUIVOS_DO_PADRAO) {
    const destino = path.join(raiz, para);
    if (fs.existsSync(destino)) continue;
    fs.mkdirSync(path.dirname(destino), { recursive: true, mode: 0o755 });
    fs.copyFileSync(path.join(origem, de), destino);
    criados.push(para);
  }
  return criados;
}
