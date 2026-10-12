/**
 * RM-061, fatia F3a: os casos do snapshot pt-BR dos arquivos que o CLI gera. Cada caso produz o texto de um
 * arquivo gerado (o `orkastery.yaml` e o bloco do `AGENTS.md` do `ork init`, o bloco da experiencia do
 * `CLAUDE.md` e do `AGENTS.md`, os sete arquivos do `ork docs init`) ou o texto que `ork init` e `ork docs init`
 * imprimem. As funcoes sao chamadas com as assinaturas da base, e o CLI roda num repositorio temporario com HOME
 * proprio e PATH controlado, em pt-BR.
 *
 * A fixture `fixtures/locale-f3a-pt-BR.json` foi gerada UMA vez por estes casos sobre o codigo da base (a F2b na
 * `main`, antes da F3a); o teste `locale-f3a-snapshot` so compara e nunca regrava. As pastas temporarias viram
 * marcadores, iguais na geracao e na comparacao.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Deteccao, manifestoYaml } from '../src/init';
import { atualizarAgentsMd, blocoAgentsMd } from '../src/agents-md';
import { aplicarExperiencia, HostComBloco, planejarExperiencia } from '../src/experiencia-instalacao';
import { Manifesto } from '../src/types';
import { cenario, ork, PT, Saida } from './locale-apoio';

/** Os sete arquivos que o `ork docs init` cria, pelo caminho no projeto. */
export const ARQUIVOS_DO_DOCS_INIT = [
  'docs/padroes/documentacao-de-produto.md',
  'docs/padroes/roadmap-de-produto.md',
  'docs/produto/_modelo-feature.md',
  'docs/produto/README.md',
  'docs/roadmap/_modelo-item.md',
  'docs/roadmap/README.md',
  '.markdownlint-cli2.jsonc',
] as const;

/** As tres deteccoes do snapshot: todos os scripts de verify, nenhum e so o de teste. */
export const DETECCOES: Readonly<Record<string, Deteccao>> = {
  completa: {
    raiz: '/projeto', nome: 'loja', abbrev: 'loj', baseBranch: 'main', gerenciador: 'npm',
    verify: { build: 'npm run build', test: 'npm test', typecheck: 'npm run typecheck' },
  },
  vazia: { raiz: '/projeto', nome: 'site', abbrev: 'sit', baseBranch: 'master', gerenciador: 'pnpm', verify: {} },
  parcial: { raiz: '/projeto', nome: 'api', abbrev: 'api', baseBranch: 'trunk', gerenciador: 'yarn', verify: { test: 'yarn --prefix core test' } },
};

/** O diretorio das skills que o bloco da experiencia aponta, por host. */
export const DIRETORIO_DAS_SKILLS: Readonly<Record<HostComBloco, string>> = {
  'claude-code': '.claude/orkastery/skills/core',
  codex: '.agents/orkastery/skills/core',
};

/** O que ja havia no arquivo de instrucoes antes da instalacao do bloco. */
export const ANTES_DO_BLOCO: ReadonlyArray<readonly [string, string | null]> = [
  ['arquivo novo', null],
  ['arquivo com LF', '# Projeto\n\nTexto humano.\n'],
  ['arquivo com CRLF', '# Projeto\r\n\r\nTexto humano.\r\n'],
  ['arquivo sem quebra final', '# Projeto'],
];

/** Manifesto minimo do bloco do `AGENTS.md`: so o que o bloco le. */
export function manifestoDoBloco(verify: Record<string, string>): Manifesto {
  return {
    project: { name: 'loja', abbrev: 'loj' },
    worktree: { base_branch: 'main' },
    conduction: { allowed_modes: ['classic', 'maestro', 'auto', 'fast'] },
    verify,
  } as unknown as Manifesto;
}

/** Pastas temporarias deste lote de casos, trocadas por marcadores na normalizacao. */
const marcadores: Array<[string, string]> = [];
const limpezas: Array<() => void> = [];

function dirTemp(nome: string, marcador: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ork-locale-f3a-${nome}-`)));
  marcadores.push([dir, marcador]);
  limpezas.push(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

/** As pastas temporarias viram marcadores; o resto fica byte a byte. */
export function normalizar(texto: string): string {
  let t = texto;
  for (const [dir, marcador] of [...marcadores].sort((a, b) => b[0].length - a[0].length)) t = t.split(dir).join(marcador);
  return t;
}

/** Cada mudanca do plano: o caminho relativo ao projeto e o conteudo que fica (ou a remocao). */
export function textoDoPlano(projeto: string, plano: ReturnType<typeof planejarExperiencia>): string {
  return plano.mudancas.map((m) => `${path.relative(projeto, m.arquivo)}\n${m.depois === null ? '<removido>' : m.depois.toString('utf8')}`)
    .join('\n---\n');
}

function saida(r: Saida): string {
  return `status ${r.status}\n--- stdout\n${normalizar(r.stdout)}--- stderr\n${normalizar(r.stderr)}`;
}

function casosDoYaml(casos: Record<string, string>): void {
  for (const [nome, d] of Object.entries(DETECCOES)) casos[`yaml: deteccao ${nome}`] = manifestoYaml(d);
}

function casosDoAgentsMd(casos: Record<string, string>): void {
  casos['agents.md: bloco com verificacoes'] = blocoAgentsMd(manifestoDoBloco({ build: 'npm run build', test: 'npm test' }));
  casos['agents.md: bloco sem verificacoes'] = blocoAgentsMd(manifestoDoBloco({}));
  const raiz = dirTemp('agents', '<RAIZ>');
  const m = manifestoDoBloco({ test: 'npm test' });
  const criado = atualizarAgentsMd(raiz, m);
  casos['agents.md: criado'] = `${criado.estado}\n${fs.readFileSync(criado.caminho, 'utf8')}`;
  fs.writeFileSync(criado.caminho, '# Instrucoes do time\n\nTexto humano.\n\n<!-- orkastery:begin -->\nbloco antigo\n<!-- orkastery:end -->\n\nRodape humano.\n');
  const atualizado = atualizarAgentsMd(raiz, m);
  casos['agents.md: atualizado no meio do texto humano'] = `${atualizado.estado}\n${fs.readFileSync(atualizado.caminho, 'utf8')}`;
  casos['agents.md: inalterado'] = atualizarAgentsMd(raiz, m).estado;
}

function casosDaExperiencia(casos: Record<string, string>): void {
  for (const host of ['claude-code', 'codex'] as const) {
    const arquivo = host === 'codex' ? 'AGENTS.md' : 'CLAUDE.md';
    for (const [nome, antes] of ANTES_DO_BLOCO) {
      const projeto = dirTemp(`experiencia-${host}`, '<PROJETO>');
      if (antes !== null) fs.writeFileSync(path.join(projeto, arquivo), antes);
      const plano = planejarExperiencia(projeto, host, DIRETORIO_DAS_SKILLS[host]);
      casos[`experiencia ${host}: ${nome}`] = textoDoPlano(projeto, plano);
      // Instalado, a remocao devolve o arquivo de antes (ou o apaga, quando foi o pacote que o criou).
      aplicarExperiencia(plano);
      casos[`experiencia ${host}: ${nome}, remocao`] = textoDoPlano(projeto, planejarExperiencia(projeto, host, null));
    }
  }
}

function casosDoCli(casos: Record<string, string>): void {
  const c = cenario('f3a-cli', false);
  limpezas.push(c.limpar);
  marcadores.push([c.dir, '<REPO>'], [c.casa, '<CASA>']);
  casos['cli: ork init'] = saida(ork(c, PT, false, 'init', '--name', 'loja', '--abbrev', 'loj'));
  casos['cli: ork init, orkastery.yaml'] = fs.readFileSync(path.join(c.dir, 'orkastery.yaml'), 'utf8');
  casos['cli: ork init, AGENTS.md'] = fs.readFileSync(path.join(c.dir, 'AGENTS.md'), 'utf8');
  casos['cli: ork init de novo'] = saida(ork(c, PT, false, 'init'));
  casos['cli: ork docs init'] = saida(ork(c, PT, false, 'docs', 'init'));
  for (const arquivo of ARQUIVOS_DO_DOCS_INIT) casos[`cli: ork docs init, ${arquivo}`] = fs.readFileSync(path.join(c.dir, arquivo), 'utf8');
  casos['cli: ork docs init de novo'] = saida(ork(c, PT, false, 'docs', 'init'));
  // Marcadores repetidos no AGENTS.md: o init recusa sem escrever.
  fs.writeFileSync(path.join(c.dir, 'AGENTS.md'), '<!-- orkastery:begin -->\n<!-- orkastery:begin -->\n<!-- orkastery:end -->\n');
  casos['cli: ork init com marcadores ambiguos no AGENTS.md'] = saida(ork(c, PT, false, 'init'));
}

export function gerarCasos(): Record<string, string> {
  const casos: Record<string, string> = {};
  const umask = process.umask(0o022);
  try {
    casosDoYaml(casos);
    casosDoAgentsMd(casos);
    casosDaExperiencia(casos);
    casosDoCli(casos);
  } finally {
    process.umask(umask);
    for (const limpar of limpezas.splice(0)) limpar();
    marcadores.splice(0);
  }
  return casos;
}
