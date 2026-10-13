/**
 * `ork adapter list|show|install <host>`: instalacao dos adaptadores de Camada 1 (bloco B4).
 *
 * O que este modulo faz e deliberadamente pouco: ele COPIA arquivos do produto para onde o
 * host os procura, renderiza tres placeholders e escreve um recibo. Nenhuma regra de negocio
 * do Orkastery mora aqui, e nenhum adaptador ganha comportamento na instalacao que ele nao
 * tenha em disco: o que o builder le em `adapters/<host>/` e o que roda.
 *
 * Duas decisoes que carregam peso:
 *
 *  - **Uma copia so do catalogo.** O instalador copia de `skills/` e `references/`, sempre da
 *    mesma raiz, e grava a origem e o sha256 de cada arquivo em `INSTALADO.json`. Duas copias
 *    do catalogo divergem, e a divergencia so aparece quando ja custou uma entrega.
 *  - **Sobrescrever e decisao, nao efeito colateral.** Arquivo que ja existe diferente do
 *    que seria escrito e CLASSIFICADO pelo recibo (I-43, D5): o que so mudou no catalogo a
 *    instalacao resolve sozinha, porque sobrescrever copia intacta nao perde trabalho de
 *    ninguem; o que a pessoa editou barra, com o diff na tela e as duas saidas por arquivo
 *    (`--aceitar-catalogo`, `--manter-copia`). Instalador que apaga edicao alheia em
 *    silencio e o mesmo defeito que o guard `git add -A` bloqueia.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
export const BRAIN_HOST_SURFACES = {
  hermes: 'cli', openclaw: 'cli', 'claude-code': 'mcp', codex: 'mcp',
} as const;
/** Superfícies instaladas; a presença do arquivo não comprova ativação live. */
export const MAESTRO_HOST_SURFACES = {
  codex: { entry: 'skills/ork/SKILL.md', transport: 'mcp', operation: 'ork_maestro' },
  'claude-code': { entry: 'commands/ork.md', transport: 'mcp', operation: 'ork_maestro' },
  hermes: { entry: 'bin/ork-maestro.sh', transport: 'argv', operation: 'maestro' },
  openclaw: { entry: 'dist/index.js', transport: 'argv', operation: 'maestro' },
} as const;
import * as path from 'node:path';
import { cliDoCatalogo, exigirCatalogo, referenciasDoCatalogo, skillsDoCatalogo } from './catalogo';
import { noPath } from './util';
import { VERSAO_DO_ORK } from './versao';
import { carregarManifesto } from './manifest';
import { resolverExperiencia } from './experiencia';
import { aplicarExperiencia, planejarExperiencia, HostComBloco } from './experiencia-instalacao';
import { ErroDoCatalogo, Mensagens, msg, remontar, textoDoCatalogo } from './locale';
import type { Locale } from './locale';
import { ADAPTER_PT_BR } from './locale-adapter';

export type Host = 'claude-code' | 'codex' | 'hermes' | 'openclaw';

/** Um jeito conhecido de a instalacao "dar certo" e nao funcionar. */
export interface Pitfall {
  titulo: string;
  detalhe: string;
  /** O comando que prova, depois de instalar, que o pitfall nao aconteceu. */
  prova: string;
}

export interface DefinicaoDeHost {
  host: Host;
  descricao: string;
  /** Diretorio de destino relativo a raiz do projeto, quando o builder nao passa `--dir`. */
  destinoPadrao: string;
  /** Subdiretorio dentro do destino onde o adaptador vive. */
  subdir: string;
  /** Este host recebe uma copia do catalogo de skills e das checklists? */
  levaCatalogo: boolean;
  pitfalls: Pitfall[];
}

/** RM-061 (F3b): a descricao e os pitfalls de cada host moram no catalogo (`locale-adapter.ts`), com o pt-BR como fonte. */
const DO_CATALOGO = ADAPTER_PT_BR.hosts;

export const HOSTS: Readonly<Record<Host, DefinicaoDeHost>> = {
  'claude-code': {
    host: 'claude-code',
    descricao: DO_CATALOGO['claude-code'].descricao,
    destinoPadrao: '.claude',
    subdir: path.join('plugins', 'orkastery'),
    levaCatalogo: true,
    pitfalls: DO_CATALOGO['claude-code'].pitfalls,
  },
  codex: {
    host: 'codex',
    descricao: DO_CATALOGO.codex.descricao,
    destinoPadrao: '.agents',
    subdir: path.join('skills', 'orkastery'),
    levaCatalogo: true,
    pitfalls: DO_CATALOGO.codex.pitfalls,
  },
  hermes: {
    host: 'hermes',
    descricao: DO_CATALOGO.hermes.descricao,
    destinoPadrao: '.hermes',
    subdir: '',
    levaCatalogo: false,
    pitfalls: DO_CATALOGO.hermes.pitfalls,
  },
  openclaw: {
    host: 'openclaw',
    descricao: DO_CATALOGO.openclaw.descricao,
    destinoPadrao: '.openclaw',
    subdir: 'extensions/orkastery',
    levaCatalogo: false,
    pitfalls: DO_CATALOGO.openclaw.pitfalls,
  },
};

export const ORDEM_DOS_HOSTS: readonly Host[] = ['claude-code', 'codex', 'hermes', 'openclaw'];

/** Reconhece o nome do host, com os apelidos que o builder costuma digitar. */
export function parseHost(bruto: string | undefined | null): Host | null {
  const limpo = (bruto ?? '').trim().toLowerCase();
  if (limpo === 'claude-code' || limpo === 'claude' || limpo === 'claudecode') return 'claude-code';
  if (limpo === 'codex') return 'codex';
  if (limpo === 'hermes') return 'hermes';
  if (limpo === 'openclaw' || limpo === 'open-claw') return 'openclaw';
  return null;
}

/** Extensoes cujo conteudo passa pela renderizacao de placeholders. */
const RENDERIZAVEIS = new Set(['.md', '.json', '.sh', '.js', '.yaml', '.yml', '.txt']);
/** Extensoes que sao instaladas com bit de execucao. */
const EXECUTAVEIS = new Set(['.sh', '.js']);

export interface ArquivoInstalado {
  origem: string;
  destino: string;
  /** Caminho do destino relativo a raiz da instalacao, o que aparece na saida do CLI. */
  relativo: string;
  sha256: string;
  bytes: number;
  executavel: boolean;
  /** `novo`, `igual` (ja instalado e identico) ou `sobrescrito`. */
  estado: 'novo' | 'igual' | 'sobrescrito';
  /**
   * I-43 (D5): POR QUE o arquivo diverge, quando o recibo permite saber.
   *
   * O recibo `INSTALADO.json` grava o sha de cada arquivo NO MOMENTO da instalacao, e
   * esse dado responde a pergunta que o texto antigo apenas enunciava e nao resolvia
   * ("ou a copia foi editada, ou o catalogo andou"):
   *
   *   `catalogo-andou`  a copia bate com o recibo; quem mudou foi o catalogo.
   *                     Seguro, e resolve sozinho.
   *   `copia-editada`   o catalogo bate com o recibo; quem mudou foi a copia. E o
   *                     defeito que nenhum teste da suite alcanca, porque a suite roda
   *                     sobre o CATALOGO e nao sobre a copia.
   *   `ambos-andaram`   os dois sairam do recibo. Nao se resolve sozinho: descartar a
   *                     edicao manual sem ninguem ver seria o defeito silencioso de R1
   *                     com outro nome.
   *   `sem-recibo`      nao ha recibo para comparar (instalacao anterior a I-43, ou
   *                     destino sem `INSTALADO.json`). Pergunta, nao adivinha.
   *
   * O que motivou a classificacao: o regime antigo barrava TODO arquivo divergente e
   * mandava o operador descobrir sozinho qual importava, inclusive aquele em que a copia
   * estava intacta e quem tinha andado era o catalogo. A distribuicao de hoje, em
   * qualquer destino, sai do proprio comando e nao de um numero escrito aqui:
   *
   *   ork adapter install <host> --dir <destino> --dry-run
   *
   * Numero medido em instalacao viva envelhece sozinho: muda a cada edicao no destino, e
   * o comentario nao acompanha. Medicao que nao reproduz e pior que nenhuma.
   */
  divergencia?: 'catalogo-andou' | 'copia-editada' | 'ambos-andaram' | 'sem-recibo';
}

/** O recibo `ork.adapter-install/v1` lido do destino, com o sha por arquivo. */
export interface ReciboDeInstalacao {
  contrato: string;
  host: string;
  versao: string;
  instaladoEm?: string;
  /** A chave e `arquivo`, como o recibo ja gravado em disco a escreve desde 19/09. */
  arquivos: { arquivo: string; sha256: string }[];
}

/** Le o recibo do destino. Ausente ou ilegivel devolve null: nao se adivinha recibo. */
export function lerRecibo(destino: string): ReciboDeInstalacao | null {
  const caminho = path.join(destino, 'INSTALADO.json');
  if (!fs.existsSync(caminho)) return null;
  try {
    const bruto = JSON.parse(fs.readFileSync(caminho, 'utf8')) as ReciboDeInstalacao;
    return Array.isArray(bruto?.arquivos) ? bruto : null;
  } catch { return null; }
}

/**
 * Classifica UMA divergencia usando o recibo (I-43, D5).
 *
 * As tres comparacoes sao entre tres shas: o do catalogo AGORA, o da copia AGORA, e o
 * que o recibo gravou QUANDO instalou. Sem o terceiro nao ha classificacao possivel, e
 * e por isso que `sem-recibo` pergunta em vez de chutar.
 */
export function classificarDivergencia(
  shaDoCatalogo: string,
  shaDaCopia: string,
  shaDoRecibo: string | undefined
): NonNullable<ArquivoInstalado['divergencia']> {
  if (!shaDoRecibo) return 'sem-recibo';
  const copiaIntacta = shaDaCopia === shaDoRecibo;
  const catalogoIntacto = shaDoCatalogo === shaDoRecibo;
  if (copiaIntacta && !catalogoIntacto) return 'catalogo-andou';
  if (catalogoIntacto && !copiaIntacta) return 'copia-editada';
  return 'ambos-andaram';
}

export interface ResultadoInstalacao {
  host: Host;
  projeto: string;
  catalogo: string;
  destino: string;
  dryRun: boolean;
  arquivos: ArquivoInstalado[];
  /**
   * Arquivos que existem e sao diferentes do catalogo.
   *
   * I-43 (D5): a DETECCAO nao encolheu, continua listando todos. O que encolheu foi o
   * que BARRA, e isso esta em `precisamDeDecisao`.
   */
  conflitos: ArquivoInstalado[];
  /**
   * O subconjunto dos conflitos que o recibo NAO garante seguro (I-43, D5).
   *
   * `catalogo-andou` fica de fora: a copia esta como foi instalada e quem mudou foi o
   * catalogo, entao sobrescrever nao perde trabalho de ninguem. O resto pede decisao.
   */
  precisamDeDecisao: ArquivoInstalado[];
  /*
   * I-43 (D5): o recibo nao esta em `destino`, mas esta um nivel abaixo, no destino
   * padrao do host. Sinal de que o `--dir` apontou para a raiz em vez do destino
   * completo, que era o erro natural e silencioso medido em M3.
   */
  reciboVizinho?: string;
  ok: boolean;
  orkBin: string;
  /** Ensaio de 03/10: o `ork` do PATH é outro binário que o que roda o install; diz as duas versões. */
  avisoOrk?: string;
  pitfalls: Pitfall[];
  experiencia?: { ativa: boolean; arquivos: string[]; skill: string; aviso?: string };
  /**
   * RM-059 (T0.7, A1 do CHECK): arquivos de `mods/` que o recibo anterior instalou, ninguem editou e sairam
   * do catalogo. Saem da copia (no `--dry-run`, so a lista): fora do recibo novo, o despacho recusaria o mod.
   */
  removidos?: string[];
}

export interface OpcoesInstalacao {
  /** Raiz do projeto onde instalar (padrao: o cwd). */
  projeto?: string;
  /** Destino explicito (`--dir`), absoluto ou relativo ao projeto. */
  dir?: string;
  dryRun?: boolean;
  force?: boolean;
  /** Raiz do catalogo (padrao: descoberta a partir do cwd e do proprio codigo). */
  catalogo?: string;
  /** Caminho do `ork` gravado nos manifestos (`--ork`, o override explícito: vence tudo). */
  orkBin?: string;
  /**
   * O `ork` que roda este install (caminho real do CLI). Sem `--ork`, é ele que a extensão chama, e não o
   * primeiro `ork` do PATH: pelo tarball, a extensão 0.5.2 ficava chamando o `ork` 0.4.3 global (ensaio de 03/10).
   * Sem ele (função chamada por outro código), vale a ordem antiga: o PATH e depois o catálogo.
   */
  orkEmExecucao?: string;
  versao?: string;
  /**
   * I-43 (D5): a decisao do operador sobre UM arquivo, por caminho relativo.
   *
   * `aceitarCatalogo` sobrescreve a copia com o catalogo; `manterCopia` deixa a copia
   * como esta e a tira do caminho do bloqueio. As duas sao as saidas REAIS que a
   * pergunta de uma linha oferece, e existem para `--force` deixar de ser o unico
   * caminho: ele ressincronizava tudo sem mostrar o que mudava.
   */
  aceitarCatalogo?: string[];
  manterCopia?: string[];
  /**
   * RM-061 (F3a, D1 e D2): a língua do bloco da experiência no `CLAUDE.md` ou no `AGENTS.md`. Sem ela, pt-BR; o
   * `ork adapter install` passa a língua do dono (`owner.language`, senão o locale do ambiente). Na F3b (D4), também a
   * língua das skills, das checklists, dos comandos e dos subagentes que têm variante inglesa (`varianteEmIngles`).
   */
  locale?: Locale;
}

/** RM-061 (F3b, D4): as pastas das variantes inglesas, ao lado do catálogo (`core/assets` no repositório, `assets` no pacote). */
const PASTAS_DAS_VARIANTES: Readonly<Record<string, string>> = { skills: 'skills-en', references: 'references-en', adapters: 'adapters-en' };

/**
 * RM-061 (F3b, D4): a variante inglesa de um arquivo `.md` do catálogo (`skills/<bucket>/<nome>/SKILL.md`,
 * `references/<arquivo>.md`, `adapters/<host>/<relativo>.md`), quando existe; sem ela, `null` e o arquivo sai em pt-BR.
 * A variante mora com o catálogo de onde o arquivo sai, nunca no pacote de outro: um catálogo sem `assets` instala em pt-BR.
 * O par `orchestration-experience` e `orchestration-experience-pt-br` já é bilíngue e não tem variante.
 */
export function varianteEmIngles(catalogo: string, origem: string): string | null {
  const m = /^(skills|references|adapters)\/(.+\.md)$/.exec(path.relative(catalogo, origem).split(path.sep).join('/'));
  if (!m) return null;
  for (const assets of [path.join(catalogo, 'core', 'assets'), path.join(catalogo, 'assets')]) {
    const candidato = path.join(assets, PASTAS_DAS_VARIANTES[m[1]], ...m[2].split('/'));
    if (fs.existsSync(candidato)) return candidato;
  }
  return null;
}

function sha256(conteudo: Buffer | string): string {
  return createHash('sha256').update(conteudo).digest('hex');
}

function listarArquivos(dir: string, prefixo = ''): { origem: string; relativo: string }[] {
  const achados: { origem: string; relativo: string }[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const origem = path.join(dir, entrada.name);
    const relativo = path.posix.join(prefixo, entrada.name);
    if (entrada.isDirectory()) {
      achados.push(...listarArquivos(origem, relativo));
    } else if (entrada.isFile()) {
      achados.push({ origem, relativo });
    }
  }
  return achados;
}

function mesmoArquivo(a: string, b: string): boolean {
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return path.resolve(a) === path.resolve(b); }
}

/**
 * Ensaio de 03/10: com outro `ork` primeiro no PATH, a extensão segue apontando para o binário que roda o
 * install, e o aviso diz as duas versões para ninguém descobrir a diferença pela extensão chamando o velho.
 */
export function avisoDoOrkNoPath(emExecucao: string, versao: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const doPath = noPath('ork', env);
  if (!doPath || mesmoArquivo(doPath, emExecucao)) return undefined;
  let outra: string | undefined;
  try {
    const saida = execFileSync(doPath, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env });
    outra = saida.trim().split('\n')[0]?.trim() || undefined;
  } catch { /* o aviso sai mesmo sem a versão */ }
  // RM-061 (F3b): o aviso nasce pelo catalogo e o texto da instalacao o remonta no locale do comando.
  return textoDoCatalogo((m) => m.adapter.orkNoPath(doPath, outra ?? m.adapter.versaoDesconhecida, emExecucao, versao));
}

/** Substitui os tres placeholders. Nao ha template engine aqui de proposito. */
export function renderizarArquivo(
  conteudo: string,
  valores: { orkBin: string; catalogo: string; versao: string }
): string {
  return conteudo
    .replace(/\{\{ork_bin\}\}/g, valores.orkBin)
    .replace(/\{\{catalogo\}\}/g, valores.catalogo)
    .replace(/\{\{versao\}\}/g, valores.versao);
}

/**
 * Instala o adaptador do host. Com `dryRun`, nada e escrito e o resultado diz o que seria.
 *
 * O retorno e tipado de proposito: o teste do bloco instala em diretorio temporario e confere
 * o que foi escrito, em vez de conferir o que a funcao disse que escreveu.
 */
export function instalarAdaptador(host: Host, opcoes: OpcoesInstalacao = {}): ResultadoInstalacao {
  const def = HOSTS[host];
  const projeto = path.resolve(opcoes.projeto ?? process.cwd());
  const catalogo = opcoes.catalogo ? path.resolve(opcoes.catalogo) : exigirCatalogo(projeto);
  const base = opcoes.dir
    ? path.resolve(projeto, opcoes.dir)
    : path.join(projeto, def.destinoPadrao);
  const destino = def.subdir ? path.join(base, def.subdir) : base;
  const orkBin = opcoes.orkBin ?? opcoes.orkEmExecucao ?? noPath('ork') ?? cliDoCatalogo(catalogo);
  const versao = opcoes.versao ?? VERSAO_DO_ORK;
  const avisoOrk = opcoes.orkBin === undefined && opcoes.orkEmExecucao
    ? avisoDoOrkNoPath(opcoes.orkEmExecucao, versao) : undefined;

  const dirDoHost = path.join(catalogo, 'adapters', host);
  if (!fs.existsSync(dirDoHost)) {
    throw new ErroDoCatalogo((m) => m.adapter.adaptadorNaoExiste(host, dirDoHost));
  }

  const fontes = listarArquivos(dirDoHost).map(fonte => host === 'hermes' && fonte.relativo.startsWith('hitl-ingress/')
    ? { ...fonte, relativo: fonte.relativo.replace(/^hitl-ingress\//, 'plugins/orkastery-hitl/') } : fonte);
  if (def.levaCatalogo) {
    for (const skill of skillsDoCatalogo(catalogo)) {
      fontes.push({
        origem: skill.caminho,
        relativo: path.posix.join('skills', skill.bucket, skill.nome, 'SKILL.md'),
      });
    }
    for (const ref of referenciasDoCatalogo(catalogo)) {
      fontes.push({ origem: ref, relativo: path.posix.join('references', path.basename(ref)) });
    }
  }
  if (host === 'hermes') {
    for (const skill of skillsDoCatalogo(catalogo).filter(s => ['orchestration-experience', 'orchestration-experience-pt-br'].includes(s.nome))) {
      fontes.push({ origem: skill.caminho, relativo: path.posix.join('skills', skill.nome, 'SKILL.md') });
    }
  }
  // RM-061 (F3b, D4): com o dono em inglês, o arquivo com variante sai dela, no mesmo destino; o recibo guarda a origem
  // real, e reinstalar na outra língua troca no lugar a cópia intacta (`catalogo-andou`).
  if (opcoes.locale === 'en') {
    for (const fonte of fontes) fonte.origem = varianteEmIngles(catalogo, fonte.origem) ?? fonte.origem;
  }

  // A experiência é opcional: manifesto com erro, bloco alheio ou caminho inadequado pulam só a
  // ativação, com aviso, e o adaptador segue instalado como antes da RM-051. RM-061 (F3b): o aviso nasce
  // pelo catalogo e o texto da instalacao o remonta.
  const pulado = (montar: (m: Mensagens['adapter'], segue: string) => string) => textoDoCatalogo((m) => montar(m.adapter, m.adapter.segue));
  const carregado = carregarManifesto(projeto);
  let avisoExperiencia: string | undefined;
  if (carregado?.raiz === projeto && carregado.erros.length) {
    const erro = carregado.erros[0];
    avisoExperiencia = pulado((a, segue) => a.puladoManifesto(erro, segue));
  }
  // Preferência inválida (ex.: experience: "false") não ativa nem remove nada: quem escreveu pode ter
  // tentado desligar o pacote. Corrigir com ork onboarding set maestro volta a instalar.
  const invalida = carregado?.raiz === projeto ? carregado.avisos.find(a => a.startsWith('experiencia.config.invalid')) : undefined;
  if (!avisoExperiencia && invalida) {
    avisoExperiencia = textoDoCatalogo((m) => m.adapter.puladoInvalida(m.onboarding.avisoDaPreferencia(invalida), m.adapter.segue));
  }
  const preferencias = carregado?.raiz === projeto && !avisoExperiencia ? resolverExperiencia(carregado.manifesto.owner) : null;
  const hostComBloco = host === 'codex' || host === 'claude-code';
  // O bloco aponta o diretório relativo ao projeto: CLAUDE.md e AGENTS.md costumam ir ao repositório.
  const diretorioExperiencia = path.relative(caminhoReal(projeto), caminhoReal(path.join(destino, 'skills', 'core')))
    .split(path.sep).join('/');
  if (preferencias?.experience && host !== 'openclaw') {
    const skillRelativa = host === 'hermes' ? `skills/${preferencias.skill}/SKILL.md`
      : `skills/core/${preferencias.skill}/SKILL.md`;
    const skill = preferencias.skill;
    if (!fontes.some(f => f.relativo === skillRelativa)) {
      avisoExperiencia = pulado((a, segue) => a.puladoSemSkill(skill, segue));
    } else if (hostComBloco && (diretorioExperiencia.startsWith('../') || path.isAbsolute(diretorioExperiencia))) {
      avisoExperiencia = pulado((a, segue) => a.puladoForaDoProjeto(segue));
    } else if (hostComBloco && /[\r\n`]/.test(diretorioExperiencia)) {
      avisoExperiencia = pulado((a, segue) => a.puladoCaminho(segue));
    }
  }
  let planoExperiencia: ReturnType<typeof planejarExperiencia> | null = null;
  if (preferencias && hostComBloco && !avisoExperiencia) {
    try {
      planoExperiencia = planejarExperiencia(projeto, host, preferencias.experience ? diretorioExperiencia : null, opcoes.locale);
    } catch (e) {
      const motivo = (e as Error).message;
      if (!/^experiencia\.(bloco\.conflict|path\.unsafe)/.test(motivo)) throw e;
      avisoExperiencia = pulado((a, segue) => a.puladoBloco(motivo.startsWith('experiencia.path'), host, segue));
    }
  }

  // O preflight cobre o destino e os arquivos do próprio adaptador antes de copiar o primeiro. Links
  // acima do destino (.agents/skills compartilhado, diretório do usuário) são escolha de quem instala.
  for (const alvo of [...fontes.map(f => path.join(destino, f.relativo)), path.join(destino, 'INSTALADO.json')]) {
    for (let atual = alvo; atual !== path.dirname(destino) && atual !== path.dirname(atual); atual = path.dirname(atual)) {
      const stat = fs.lstatSync(atual, { throwIfNoEntry: false });
      if (stat && (stat.isSymbolicLink() || (atual === alvo ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()))) {
        throw new ErroDoCatalogo((m) => m.adapter.destinoInseguro);
      }
    }
  }

  // I-43 (D5): o recibo e lido UMA vez, antes de classificar, e e ele que transforma
  // "divergente" em um dos quatro motivos.
  const recibo = lerRecibo(destino);

  /*
   * I-43 (D5), segundo defeito medido em M3: a DETECCAO falhava em silencio quando o
   * `--dir` apontava para a raiz.
   *
   * `--dir` e o destino COMPLETO, nao a raiz do projeto. Como o destino padrao do
   * hermes e `.hermes`, passar `--dir $HOME` e o erro natural, e ele devolvia
   * "22 novos, 0 divergentes" com saida 0: a copia editada passava despercebida, e a
   * unica coisa que o recibo existe para pegar nao era pega.
   *
   * Agora o comando DIZ que encontrou o recibo um nivel abaixo, em vez de reportar
   * tudo novo. Ele nao corrige sozinho: adivinhar o destino do operador seria trocar
   * um silencio por outro.
   */
  const caminhoVizinho = def.destinoPadrao ? path.join(destino, def.destinoPadrao) : null;
  const reciboVizinho = !recibo && caminhoVizinho && lerRecibo(caminhoVizinho) ? caminhoVizinho : null;

  const arquivos: ArquivoInstalado[] = [];
  for (const fonte of fontes) {
    const ext = path.extname(fonte.origem);
    const bruto = fs.readFileSync(fonte.origem);
    const conteudo = RENDERIZAVEIS.has(ext)
      ? Buffer.from(renderizarArquivo(bruto.toString('utf8'), { orkBin, catalogo, versao }), 'utf8')
      : bruto;
    const alvo = path.join(destino, fonte.relativo);
    let estado: ArquivoInstalado['estado'] = 'novo';
    let divergencia: ArquivoInstalado['divergencia'];
    if (fs.existsSync(alvo)) {
      const shaDaCopia = sha256(fs.readFileSync(alvo));
      const shaDoCatalogo = sha256(conteudo);
      estado = shaDaCopia === shaDoCatalogo ? 'igual' : 'sobrescrito';
      if (estado === 'sobrescrito') {
        // I-43 (D5): o recibo responde POR QUE divergiu, em vez de so dizer que divergiu.
        divergencia = classificarDivergencia(
          shaDoCatalogo, shaDaCopia,
          recibo?.arquivos.find((x) => x.arquivo === fonte.relativo)?.sha256
        );
      }
    }
    arquivos.push({
      origem: fonte.origem,
      destino: alvo,
      relativo: fonte.relativo,
      ...(divergencia ? { divergencia } : {}),
      sha256: sha256(conteudo),
      bytes: conteudo.length,
      executavel: EXECUTAVEIS.has(ext),
      estado,
    });
  }

  const removidos = sobrasDeMods(destino, recibo, arquivos);

  const conflitos = arquivos.filter((a) => a.estado === 'sobrescrito');
  /**
   * I-43 (D5): a divergencia continua sendo DETECTADA; ela deixa de BARRAR quando e
   * segura.
   *
   * `catalogo-andou` significa que a copia esta exatamente como foi instalada e quem
   * mudou foi o catalogo. Sobrescrever isso nao perde trabalho de ninguem, e e a maior
   * parte do que aparece num destino real: o regime antigo barrava esses junto com os
   * demais e mandava o operador descobrir sozinho qual importava, que e a arqueologia de
   * madrugada que o GOAL mediu.
   *
   * O resto PERGUNTA, e e o que R1 exige: resolver `ambos-andaram` sozinho descartaria
   * a edicao manual sem ninguem ver, que e o defeito silencioso com outro nome.
   */
  // I-43 (D5): a decisao do operador por ARQUIVO, que e o que faz `--force` deixar de
  // ser o unico caminho. `--force` continua existindo como instrumento cego.
  const decididos = new Set([...(opcoes.aceitarCatalogo ?? []), ...(opcoes.manterCopia ?? [])]);
  const manter = new Set(opcoes.manterCopia ?? []);
  const precisamDeDecisao = conflitos.filter(
    (a) => a.divergencia !== 'catalogo-andou' && !decididos.has(a.relativo)
  );
  const barrado = precisamDeDecisao.length > 0 && opcoes.force !== true;
  const resultado: ResultadoInstalacao = {
    host,
    projeto,
    catalogo,
    destino,
    dryRun: opcoes.dryRun === true,
    arquivos,
    conflitos,
    precisamDeDecisao,
    ...(reciboVizinho ? { reciboVizinho } : {}),
    ok: !barrado,
    orkBin,
    ...(avisoOrk ? { avisoOrk } : {}),
    pitfalls: def.pitfalls,
    ...(preferencias || avisoExperiencia ? { experiencia: { ativa: host !== 'openclaw' && !!preferencias?.experience && !avisoExperiencia,
      arquivos: planoExperiencia?.mudancas.map(m => path.relative(planoExperiencia!.projeto, m.arquivo)) ?? [], skill: preferencias?.skill ?? '',
      ...(avisoExperiencia ? { aviso: avisoExperiencia } : {}) } } : {}),
    ...(removidos.length ? { removidos } : {}),
  };
  if (opcoes.dryRun === true || barrado) return resultado;

  for (const arquivo of arquivos) {
    // `--manter-copia`: a copia local fica como esta. Ela permanece DETECTADA como
    // divergente na proxima rodada, porque esconder a divergencia seria o defeito
    // silencioso de R1 voltando por outra porta.
    if (manter.has(arquivo.relativo)) continue;
    const ext = path.extname(arquivo.origem);
    const bruto = fs.readFileSync(arquivo.origem);
    const conteudo = RENDERIZAVEIS.has(ext)
      ? Buffer.from(renderizarArquivo(bruto.toString('utf8'), { orkBin, catalogo, versao }), 'utf8')
      : bruto;
    fs.mkdirSync(path.dirname(arquivo.destino), { recursive: true });
    fs.writeFileSync(arquivo.destino, conteudo);
    if (arquivo.executavel) fs.chmodSync(arquivo.destino, 0o755);
  }

  // RM-059 (T0.7, A1 do CHECK): o que saiu do catalogo em `mods/` sai da copia, com a pasta que ficar vazia.
  for (const relativo of removidos) {
    const alvo = path.join(destino, relativo);
    fs.unlinkSync(alvo);
    const raizDoMod = path.join(destino, ...relativo.split('/').slice(0, 2));
    for (let dir = path.dirname(alvo); dir.startsWith(raizDoMod); dir = path.dirname(dir)) {
      if (fs.readdirSync(dir).length) break;
      fs.rmdirSync(dir);
    }
  }

  // O recibo: com ele da para saber, depois, se alguem editou a copia instalada em vez do
  // catalogo. Sem ele a instalacao e um monte de arquivo sem procedencia.
  fs.writeFileSync(
    path.join(destino, 'INSTALADO.json'),
    JSON.stringify(
      {
        contrato: 'ork.adapter-install/v1',
        host,
        versao,
        catalogo,
        orkBin,
        instaladoEm: new Date().toISOString(),
        arquivos: arquivos.map((a) => ({
          arquivo: a.relativo,
          origem: path.relative(catalogo, a.origem),
          sha256: a.sha256,
          bytes: a.bytes,
        })),
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  if (planoExperiencia) aplicarExperiencia(planoExperiencia);
  return resultado;
}

/**
 * RM-059 (T0.7, A1 do CHECK): os arquivos de `mods/` do recibo anterior que nao estao mais no catalogo e que a
 * copia guarda como foram instalados (sha256 do recibo), os de cada mod e os comuns da raiz de `mods/` (N2 da
 * rodada 2). Arquivo editado, link ou caminho fora do destino fica: o despacho continua recusando com o motivo,
 * e a decisao e de quem editou.
 */
function sobrasDeMods(destino: string, recibo: ReciboDeInstalacao | null, arquivos: ArquivoInstalado[]): string[] {
  if (!recibo) return [];
  const novos = new Set(arquivos.map((a) => a.relativo));
  let base: string;
  try { base = fs.realpathSync(destino); } catch { return []; }
  return recibo.arquivos.flatMap((a) => {
    const rel = typeof a.arquivo === 'string' ? a.arquivo : '';
    if (!/^mods\/[^/]+(?:$|\/.)/.test(rel) || novos.has(rel) || path.isAbsolute(rel) || rel.split('/').includes('..')) return [];
    const alvo = path.join(destino, rel);
    const st = fs.lstatSync(alvo, { throwIfNoEntry: false });
    if (!st || !st.isFile() || st.nlink !== 1) return [];
    try { if (!fs.realpathSync(path.dirname(alvo)).startsWith(base + path.sep)) return []; } catch { return []; }
    return sha256(fs.readFileSync(alvo)) === a.sha256 ? [rel] : [];
  });
}

/** Caminho real do maior ancestral existente, com o resto como está: o destino pode não existir ainda. */
function caminhoReal(alvo: string): string {
  let existente = path.resolve(alvo);
  while (!fs.existsSync(existente) && existente !== path.dirname(existente)) existente = path.dirname(existente);
  return path.join(fs.realpathSync(existente), path.relative(existente, path.resolve(alvo)));
}

/** Remove somente o bloco do pacote; o adaptador e as demais instruções permanecem. */
export function desinstalarExperiencia(projeto: string, host: HostComBloco, dryRun = false) {
  const plano = planejarExperiencia(projeto, host, null);
  if (!dryRun) aplicarExperiencia(plano);
  return { host, dryRun, arquivos: plano.mudancas.map(m => path.relative(plano.projeto, m.arquivo)) };
}

/** O destino padrao de um host, relativo a raiz do projeto (`.claude/plugins/orkastery`). */
export function destinoPadraoDe(host: Host): string {
  const def = HOSTS[host];
  return `${def.destinoPadrao}${def.subdir ? '/' + def.subdir : ''}`;
}

/** Texto de `ork adapter list`, no locale ativo; a descricao de cada host vem do catalogo. */
export function tabelaDeHosts(): string {
  const m = msg().adapter;
  const linhas: string[] = [m.titulo, ''];
  for (const host of ORDEM_DOS_HOSTS) {
    linhas.push(`  ${host.padEnd(13)} ${m.hosts[host].descricao}`);
    linhas.push(`  ${' '.repeat(13)} ${m.destinoPadrao(destinoPadraoDe(host))}`);
    linhas.push(`  ${' '.repeat(13)} ${m.catalogoJunto(HOSTS[host].levaCatalogo)}`);
  }
  linhas.push('');
  linhas.push(m.instaleCom);
  linhas.push(m.zeroRegra);
  return linhas.join('\n');
}

/** Texto dos pitfalls de um host, impresso no fim de toda instalacao, no locale ativo. */
export function textoDosPitfalls(host: Host): string {
  const m = msg().adapter;
  const linhas: string[] = [m.tituloDosPitfalls(host), ''];
  m.hosts[host].pitfalls.forEach((p, i) => {
    linhas.push(`  ${i + 1}. ${p.titulo}`);
    linhas.push(`     ${p.detalhe}`);
    linhas.push(`     ${m.prova(p.prova)}`);
    linhas.push('');
  });
  return linhas.join('\n').replace(/\n$/, '');
}

/** Texto de `ork adapter install`, no locale ativo; os avisos que a instalacao montou sao remontados. */
export function textoDaInstalacao(r: ResultadoInstalacao): string {
  const m = msg().adapter;
  const linhas: string[] = [];
  // Ensaio da 0.5.0: com o pacote ativo e pulado por aviso (catalogo fora do projeto), a linha dizia
  // "desativada"; o aviso logo abaixo diz o motivo.
  if (r.experiencia) {
    linhas.push(m.experiencia(r.experiencia.ativa ? 'ativa' : r.experiencia.aviso ? 'pulada' : 'desativada', r.experiencia.skill));
  }
  if (r.experiencia?.aviso) linhas.push(m.aviso(remontar(r.experiencia.aviso)));
  linhas.push(r.dryRun ? m.simulacao(r.host) : r.ok ? m.preparados(r.host) : m.barrada(r.host));
  // Ensaio de 03/10 (R6): a ativacao sai no comeco e de novo no fim, depois da lista de arquivos e dos
  // pitfalls, para que o fim da saida diga o proximo passo.
  const ativacao: string[] = [];
  if (r.ok && !r.dryRun && r.host === 'claude-code') {
    const destino = "'" + r.destino.replace(/'/g, "'\"'\"'") + "'";
    linhas.push(m.claudeNaoVerificado);
    linhas.push(m.claudeValide);
    ativacao.push(`  claude plugin validate ${destino}`);
    ativacao.push(`  claude plugin marketplace add ${destino} --scope project`);
    ativacao.push('  claude plugin install orkastery@orkastery --scope project');
    ativacao.push('  claude plugin list --json');
    ativacao.push(m.claudeDepois);
  } else if (r.ok && !r.dryRun && r.host === 'codex') {
    ativacao.push(m.codexAbra);
    ativacao.push(m.codexNaoVerificado);
  }
  if(r.ok && !r.dryRun && (r.host==='codex' || r.host==='claude-code')) {
    const projeto="'"+r.projeto.replace(/'/g,"'\"'\"'")+"'";
    ativacao.push(m.prepareMcp(projeto, r.host));
  }
  linhas.push(...ativacao);
  if (ativacao.length) linhas.push(m.consentimento);
  linhas.push(m.catalogo(r.catalogo));
  linhas.push(m.destino(r.destino));
  linhas.push(m.ork(r.orkBin));
  if (r.avisoOrk) linhas.push(m.avisoOrk(remontar(r.avisoOrk)));
  linhas.push('');
  const novos = r.arquivos.filter((a) => a.estado === 'novo').length;
  const iguais = r.arquivos.filter((a) => a.estado === 'igual').length;
  const catalogoAndou = r.conflitos.filter((a) => a.divergencia === 'catalogo-andou').length;
  linhas.push(m.arquivos(r.arquivos.length, novos, iguais, r.conflitos.length));
  for (const a of r.arquivos) {
    const marca = a.estado === 'novo' ? '+' : a.estado === 'igual' ? '=' : '!';
    const porque = a.divergencia ? `  (${a.divergencia})` : '';
    linhas.push(`    ${marca} ${a.relativo}${porque}`);
  }
  // RM-059 (T0.7): arquivo de mod que saiu do catalogo sai da copia, para o despacho nao recusar o mod.
  for (const rel of r.removidos ?? []) linhas.push(m.removido(rel, r.dryRun));

  // I-43 (D5): o `--dir` na raiz avisa, em vez de reportar "tudo novo" com saida 0.
  if (r.reciboVizinho) {
    linhas.push('');
    linhas.push(...m.reciboVizinho(r.destino, r.reciboVizinho));
  }

  // I-43 (D5): o que o recibo garante seguro se resolve sozinho, e sai como uma linha
  // de resumo em vez de virar decisao do operador.
  if (catalogoAndou > 0) {
    linhas.push('');
    linhas.push(...m.catalogoAndou(catalogoAndou));
  }

  if (!r.ok) {
    // A pergunta de UMA linha, com o arquivo NOMEADO e as duas saidas reais. O `--dir`
    // em uso e repetido de proposito: a linha antiga mandava rodar sem ele, e rodar o
    // que estava na tela instalaria em `<catalogo>/<destinoPadrao>`, nao na copia real.
    const dirEmUso = r.destino.startsWith(r.projeto + '/')
      ? r.destino.slice(r.projeto.length + 1)
      : r.destino;
    linhas.push('');
    linhas.push(m.precisamDeDecisao(r.precisamDeDecisao.length));
    for (const a of r.precisamDeDecisao) {
      linhas.push(`    ${a.relativo}  (${a.divergencia})`);
      linhas.push(`      $ diff -u ${a.origem} ${a.destino}`);
    }
    linhas.push('');
    linhas.push(m.resolva);
    const exemplo = r.precisamDeDecisao[0]?.relativo ?? '<arquivo>';
    linhas.push(`    ork adapter install ${r.host} --dir ${dirEmUso} --aceitar-catalogo ${exemplo}`);
    linhas.push(`    ork adapter install ${r.host} --dir ${dirEmUso} --manter-copia ${exemplo}`);
  }
  linhas.push('');
  linhas.push(textoDosPitfalls(r.host));
  if (ativacao.length) {
    linhas.push('');
    linhas.push(r.host === 'claude-code' ? m.proximoPassoClaude : m.proximoPasso);
    linhas.push(...ativacao);
  }
  return linhas.join('\n');
}
