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

export const HOSTS: Readonly<Record<Host, DefinicaoDeHost>> = {
  'claude-code': {
    host: 'claude-code',
    descricao:
      'Plugin com as skills do catalogo, subagentes de fase, entrada /orkastery:ork e hooks do Orkastery',
    destinoPadrao: '.claude',
    subdir: path.join('plugins', 'orkastery'),
    levaCatalogo: true,
    pitfalls: [
      {
        titulo: 'manifesto sem os caminhos das skills instala limpo e nao expoe nada',
        detalhe:
          'o plugin auto-descobre skills/<nome>/SKILL.md e para ai: ele nao desce nos buckets (core/, phases/, reviewers/, ...) que este catalogo usa, entao o plugin.json declara cada caminho de skill, um a um',
        prova: 'claude plugin details orkastery   # Skills (N) soma as skills do plugin.json e os comandos de commands/',
      },
      {
        titulo: 'duas copias do catalogo divergem',
        detalhe:
          'a fonte unica e skills/ na raiz do produto; o INSTALADO.json guarda a origem e o sha256 de cada arquivo, e reinstalar CLASSIFICA cada divergencia por ele: o que so mudou no catalogo ressincroniza sozinho, o que voce editou barra e pede decisao por arquivo (--aceitar-catalogo ou --manter-copia). Editar a copia instalada e bandeira vermelha',
        prova: 'ork adapter install claude-code --dry-run   # mostra o que divergiu do catalogo',
      },
      {
        titulo: 'hook com caminho relativo nao roda, e o guard vira decoracao',
        detalhe:
          'o hooks.json chama node "${CLAUDE_PLUGIN_ROOT}/hooks/ork-guard.js", nunca um caminho relativo ao diretorio de trabalho, que muda a cada worktree de thread',
        prova:
          'echo \'{"tool_name":"Bash","tool_input":{"command":"git add -A"}}\' | node <destino>/hooks/ork-guard.js ; echo "codigo: $?"   # 2 = guard vivo',
      },
    ],
  },
  codex: {
    host: 'codex',
    descricao: 'Entrada $ork e catalogo de conducao em skills locais do projeto, sem configuracao global',
    destinoPadrao: '.agents',
    subdir: path.join('skills', 'orkastery'),
    levaCatalogo: true,
    pitfalls: [
      {
        titulo: 'skills instaladas fora do projeto da sessao',
        detalhe: 'Codex descobre .agents/skills a partir do diretorio da sessao ate a raiz do repositorio; outra worktree precisa da sua propria instalacao e comprovacao de descoberta',
        prova: 'No Codex aberto no projeto instalado: $ork',
      },
      {
        titulo: 'copia instalada diferente do catalogo',
        detalhe: 'o recibo INSTALADO.json registra os arquivos e hashes dentro da pasta propria orkastery; uma edicao divergente barra a reinstalacao sem substituir arquivos de outras skills',
        prova: 'ork adapter install codex --dry-run',
      },
      {
        titulo: 'skill confundida com autorizacao de runtime',
        detalhe: 'instalar instrucoes nao habilita permissoes, hooks ou sandbox; em projeto configurado, AGENTS.md recebe apenas o bloco reversível da experiência. Gates e preflight continuam no nucleo, e descoberta nao prova a jornada conversacional',
        prova: 'ork doctor',
      },
    ],
  },
  hermes: {
    host: 'hermes',
    descricao: 'Skill roteadora fina, plugin que a declara e script de abertura de thread',
    destinoPadrao: '.hermes',
    subdir: '',
    levaCatalogo: false,
    pitfalls: [
      {
        titulo: 'ork fora do PATH do host',
        detalhe:
          'o host roda com ambiente mais enxuto que o terminal do builder e ~/.local/bin pode nao estar la; o plugin grava o caminho absoluto e o script honra ORK_BIN',
        prova: 'ORK_BIN=$(command -v ork) ; "$ORK_BIN" doctor',
      },
      {
        titulo: 'reimplementar o parse da #TAG no host',
        detalhe:
          'duas implementacoes divergem na primeira tag nova, e a divergencia aparece como thread aberta no modo errado, o que ninguem percebe ate a pausa que nao veio',
        prova: 'ork modos --do-pedido "teste #Maestro"   # a unica fonte do modo',
      },
      {
        titulo: 'validar allowed_modes no host',
        detalhe:
          'um host que recusa o modo antes de chamar o ork recusa com a regra que ele tem em cache, nao com a do manifesto do projeto; deixe o ork thread new recusar, com erro tipado',
        prova: 'ork thread new "teste" --mode look --dry-run',
      },
    ],
  },
  openclaw: {
    host: 'openclaw',
    descricao:
      'extensao do OpenClaw 2026.7.1 (package.json + dist/index.js) com as tools ork_*, cada uma uma chamada de CLI',
    destinoPadrao: '.openclaw',
    subdir: 'extensions/orkastery',
    levaCatalogo: false,
    pitfalls: [
      {
        titulo: 'placeholder {{ork_bin}} que fica no arquivo',
        detalhe:
          'o entry executa o binario como ele esta: um placeholder nao renderizado cai no fallback (ORK_BIN ou o ork do PATH), e sem o fallback vira "comando nao encontrado" em toda tool, que a sessao so descobre depois de ja ter aberto thread na cabeca do agente',
        prova: 'grep -c "{{" <destino>/extensions/orkastery/dist/index.js   # precisa devolver 0',
      },
      {
        titulo: 'argumento com espaco quebrado em varios argumentos',
        detalhe:
          'cada tool monta o comando como VETOR de argv, nunca como string de shell, para o pedido do builder chegar inteiro em --prompt; string de shell aqui vira injecao de comando com o texto do builder dentro',
        prova: 'ork_phase_run com um prompt de varias linhas, conferido em ork phase list <thread>',
      },
      {
        titulo: 'tool que reimplementa regra do nucleo',
        detalhe:
          'toda tool deste plugin e uma chamada de CLI e nada mais; tool nova que precisa de logica e sinal de que a logica pertence ao ork, com teste',
        prova: 'ork eval   # o corpus reprova host com regra de negocio duplicada',
      },
    ],
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
  pitfalls: Pitfall[];
  experiencia?: { ativa: boolean; arquivos: string[]; skill: string; aviso?: string };
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
  /** Caminho do `ork` gravado nos manifestos (padrao: o que estiver no PATH). */
  orkBin?: string;
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
  const orkBin = opcoes.orkBin ?? noPath('ork') ?? cliDoCatalogo(catalogo);
  const versao = opcoes.versao ?? VERSAO_DO_ORK;

  const dirDoHost = path.join(catalogo, 'adapters', host);
  if (!fs.existsSync(dirDoHost)) {
    throw new Error(`adaptador do host ${host} nao existe em ${dirDoHost}`);
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

  // A experiência é opcional: manifesto com erro, bloco alheio ou caminho inadequado pulam só a
  // ativação, com aviso, e o adaptador segue instalado como antes da RM-051.
  const segue = 'O restante da instalação do adaptador segue normalmente.';
  const carregado = carregarManifesto(projeto);
  let avisoExperiencia: string | undefined;
  if (carregado?.raiz === projeto && carregado.erros.length) {
    avisoExperiencia = `Pacote de experiência pulado: o manifesto tem erros (${carregado.erros[0]}). ${segue}`;
  }
  // Preferência inválida (ex.: experience: "false") não ativa nem remove nada: quem escreveu pode ter
  // tentado desligar o pacote. Corrigir com ork onboarding set maestro volta a instalar.
  const invalida = carregado?.raiz === projeto ? carregado.avisos.find(a => a.startsWith('experiencia.config.invalid')) : undefined;
  if (!avisoExperiencia && invalida) avisoExperiencia = `Pacote de experiência pulado: ${invalida}. ${segue}`;
  const preferencias = carregado?.raiz === projeto && !avisoExperiencia ? resolverExperiencia(carregado.manifesto.owner) : null;
  const hostComBloco = host === 'codex' || host === 'claude-code';
  // O bloco aponta o diretório relativo ao projeto: CLAUDE.md e AGENTS.md costumam ir ao repositório.
  const diretorioExperiencia = path.relative(caminhoReal(projeto), caminhoReal(path.join(destino, 'skills', 'core')))
    .split(path.sep).join('/');
  if (preferencias?.experience && host !== 'openclaw') {
    const skillRelativa = host === 'hermes' ? `skills/${preferencias.skill}/SKILL.md`
      : `skills/core/${preferencias.skill}/SKILL.md`;
    if (!fontes.some(f => f.relativo === skillRelativa)) {
      avisoExperiencia = `Pacote de experiência pulado: a skill ${preferencias.skill} não está no catálogo. ${segue}`;
    } else if (hostComBloco && (diretorioExperiencia.startsWith('../') || path.isAbsolute(diretorioExperiencia))) {
      avisoExperiencia = `Pacote de experiência pulado: o adaptador fica fora do projeto e o bloco de instruções só aponta caminhos do projeto. ${segue}`;
    } else if (hostComBloco && /[\r\n`]/.test(diretorioExperiencia)) {
      avisoExperiencia = `Pacote de experiência pulado: o caminho das skills contém quebra de linha ou crase, incompatível com o bloco de instruções. ${segue}`;
    }
  }
  let planoExperiencia: ReturnType<typeof planejarExperiencia> | null = null;
  if (preferencias && hostComBloco && !avisoExperiencia) {
    try {
      planoExperiencia = planejarExperiencia(projeto, host, preferencias.experience ? diretorioExperiencia : null);
    } catch (e) {
      const motivo = (e as Error).message;
      if (!/^experiencia\.(bloco\.conflict|path\.unsafe)/.test(motivo)) throw e;
      avisoExperiencia = `Pacote de experiência pulado: ${motivo.startsWith('experiencia.path') ? 'o arquivo de instruções é link ou não é arquivo comum' : `o bloco de instruções ou o recibo .orkastery/experiencia/${host}.json foi editado ou está duplicado`}; nada foi escrito. Revise os dois à mão. ${segue}`;
    }
  }

  // O preflight cobre o destino e os arquivos do próprio adaptador antes de copiar o primeiro. Links
  // acima do destino (.agents/skills compartilhado, diretório do usuário) são escolha de quem instala.
  for (const alvo of [...fontes.map(f => path.join(destino, f.relativo)), path.join(destino, 'INSTALADO.json')]) {
    for (let atual = alvo; atual !== path.dirname(destino) && atual !== path.dirname(atual); atual = path.dirname(atual)) {
      const stat = fs.lstatSync(atual, { throwIfNoEntry: false });
      if (stat && (stat.isSymbolicLink() || (atual === alvo ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()))) {
        throw Error('experiencia.path.unsafe: destino do adaptador');
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
    pitfalls: def.pitfalls,
    ...(preferencias || avisoExperiencia ? { experiencia: { ativa: host !== 'openclaw' && !!preferencias?.experience && !avisoExperiencia,
      arquivos: planoExperiencia?.mudancas.map(m => path.relative(planoExperiencia!.projeto, m.arquivo)) ?? [], skill: preferencias?.skill ?? '',
      ...(avisoExperiencia ? { aviso: avisoExperiencia } : {}) } } : {}),
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

/** Texto de `ork adapter list`. */
export function tabelaDeHosts(): string {
  const linhas: string[] = ['Adaptadores de host (Camada 1, o podio)', ''];
  for (const host of ORDEM_DOS_HOSTS) {
    const def = HOSTS[host];
    linhas.push(`  ${host.padEnd(13)} ${def.descricao}`);
    linhas.push(`  ${' '.repeat(13)} destino padrao: <projeto>/${def.destinoPadrao}${def.subdir ? '/' + def.subdir : ''}`);
    linhas.push(`  ${' '.repeat(13)} catalogo de skills junto: ${def.levaCatalogo ? 'sim' : 'nao'}`);
  }
  linhas.push('');
  linhas.push('Instale com: ork adapter install <host> [--dir DIR] [--dry-run] [--force]');
  linhas.push('Zero regra de negocio no host: a #TAG vira `--mode` e a validacao e do nucleo.');
  return linhas.join('\n');
}

/** Texto dos pitfalls de um host, impresso no fim de toda instalacao. */
export function textoDosPitfalls(host: Host): string {
  const def = HOSTS[host];
  const linhas: string[] = [`Os 3 pitfalls de instalacao do ${host} (confira, nao suponha):`, ''];
  def.pitfalls.forEach((p, i) => {
    linhas.push(`  ${i + 1}. ${p.titulo}`);
    linhas.push(`     ${p.detalhe}`);
    linhas.push(`     prova: ${p.prova}`);
    linhas.push('');
  });
  return linhas.join('\n').replace(/\n$/, '');
}

/** Texto de `ork adapter install`. */
export function textoDaInstalacao(r: ResultadoInstalacao): string {
  const linhas: string[] = [];
  // Ensaio da 0.5.0: com o pacote ativo e pulado por aviso (catalogo fora do projeto), a linha dizia
  // "desativada"; o aviso logo abaixo diz o motivo.
  if (r.experiencia) linhas.push(`Experiência: ${r.experiencia.ativa ? 'ativação preparada'
    : r.experiencia.aviso ? 'pacote pulado nesta instalação (motivo no aviso abaixo)' : 'desativada ou sem integração de skills'}` +
    `${r.experiencia.skill ? ` (${r.experiencia.skill})` : ''}.`);
  if (r.experiencia?.aviso) linhas.push(`Aviso: ${r.experiencia.aviso}`);
  linhas.push(
    r.dryRun
      ? `Simulacao (--dry-run) da instalacao do adaptador ${r.host}: nada foi escrito.`
      : r.ok
        ? `Arquivos do adaptador ${r.host} preparados.`
        : `Instalacao do adaptador ${r.host} BARRADA: ha arquivo diferente no destino.`
  );
  if (r.ok && !r.dryRun && r.host === 'claude-code') {
    const destino = "'" + r.destino.replace(/'/g, "'\"'\"'") + "'";
    linhas.push('Uso no Claude Code ainda nao verificado por esta copia.');
    linhas.push('No diretorio deste projeto, valide e ative o plugin:');
    linhas.push(`  claude plugin validate ${destino}`);
    linhas.push(`  claude plugin marketplace add ${destino} --scope project`);
    linhas.push('  claude plugin install orkastery@orkastery --scope project');
    linhas.push('  claude plugin list --json');
    linhas.push('Depois, na sessao deste projeto: /orkastery:ork');
  } else if (r.ok && !r.dryRun && r.host === 'codex') {
    linhas.push('Abra o Codex neste projeto e use $ork.');
    linhas.push('Descoberta e uso nativo ainda nao verificados por esta copia.');
  }
  if(r.ok && !r.dryRun && (r.host==='codex' || r.host==='claude-code')) {
    const projeto="'"+r.projeto.replace(/'/g,"'\"'\"'")+"'";
    linhas.push(`Prepare tambem as ferramentas do projeto: ork mcp install --project ${projeto} --host ${r.host}`);
    linhas.push('A configuracao MCP exige descoberta e consentimento no cliente; a copia nao concede aprovacoes.');
  }
  linhas.push(`  catalogo: ${r.catalogo}`);
  linhas.push(`  destino:  ${r.destino}`);
  linhas.push(`  ork:      ${r.orkBin}`);
  linhas.push('');
  const novos = r.arquivos.filter((a) => a.estado === 'novo').length;
  const iguais = r.arquivos.filter((a) => a.estado === 'igual').length;
  const catalogoAndou = r.conflitos.filter((a) => a.divergencia === 'catalogo-andou').length;
  linhas.push(
    `  arquivos: ${r.arquivos.length} (${novos} novo(s), ${iguais} ja identico(s), ${r.conflitos.length} divergente(s))`
  );
  for (const a of r.arquivos) {
    const marca = a.estado === 'novo' ? '+' : a.estado === 'igual' ? '=' : '!';
    const porque = a.divergencia ? `  (${a.divergencia})` : '';
    linhas.push(`    ${marca} ${a.relativo}${porque}`);
  }

  // I-43 (D5): o `--dir` na raiz avisa, em vez de reportar "tudo novo" com saida 0.
  if (r.reciboVizinho) {
    linhas.push('');
    linhas.push(`  ATENCAO: nao ha recibo em ${r.destino}, mas ha um em`);
    linhas.push(`    ${r.reciboVizinho}`);
    linhas.push('  `--dir` e o destino COMPLETO, nao a raiz do projeto. Do jeito que esta, esta');
    linhas.push('  instalacao criaria uma copia nova ao lado da que ja existe, e a que existe');
    linhas.push('  ficaria sem conferencia nenhuma.');
  }

  // I-43 (D5): o que o recibo garante seguro se resolve sozinho, e sai como uma linha
  // de resumo em vez de virar decisao do operador.
  if (catalogoAndou > 0) {
    linhas.push('');
    linhas.push(`  ${catalogoAndou} divergente(s) sao "catalogo-andou": a copia esta como foi instalada`);
    linhas.push('  e quem mudou foi o catalogo. Sobrescrever nao perde trabalho de ninguem.');
  }

  if (!r.ok) {
    // A pergunta de UMA linha, com o arquivo NOMEADO e as duas saidas reais. O `--dir`
    // em uso e repetido de proposito: a linha antiga mandava rodar sem ele, e rodar o
    // que estava na tela instalaria em `<catalogo>/<destinoPadrao>`, nao na copia real.
    const dirEmUso = r.destino.startsWith(r.projeto + '/')
      ? r.destino.slice(r.projeto.length + 1)
      : r.destino;
    linhas.push('');
    linhas.push(`  ${r.precisamDeDecisao.length} arquivo(s) precisam de uma decisao sua:`);
    for (const a of r.precisamDeDecisao) {
      linhas.push(`    ${a.relativo}  (${a.divergencia})`);
      linhas.push(`      $ diff -u ${a.origem} ${a.destino}`);
    }
    linhas.push('');
    linhas.push('  Resolva em UM comando, por arquivo:');
    const exemplo = r.precisamDeDecisao[0]?.relativo ?? '<arquivo>';
    linhas.push(`    ork adapter install ${r.host} --dir ${dirEmUso} --aceitar-catalogo ${exemplo}`);
    linhas.push(`    ork adapter install ${r.host} --dir ${dirEmUso} --manter-copia ${exemplo}`);
  }
  linhas.push('');
  linhas.push(textoDosPitfalls(r.host));
  return linhas.join('\n');
}
