/**
 * RM-037: regra unica do CHANGELOG para o script do CI, `docs verificar --pr` e `ork verify`.
 * O diff decide quais linhas a thread acrescentou; o texto do HEAD decide em que secao e grupo
 * cada linha caiu; uma tag local `v<versao>` prova que a secao ja foi publicada.
 */
import { spawnSync } from 'node:child_process';

export const CHANGELOG = 'CHANGELOG.md';
export const SECAO_NAO_PUBLICADO = 'Não publicado';
export const GRUPOS_NAO_PUBLICADOS = ['Adicionado', 'Alterado', 'Corrigido', 'Segurança'] as const;

const PASTAS_DE_PRODUTO = ['core/', 'adapters/', 'marketplaces/'];
const DE_CI = [/^\.github\//, /^\.ork-ci\//, /^core\/scripts\/test-ci\.js$/, /^core\/scripts\/checar-[a-z0-9-]+\.cjs$/];
const CORRECAO = 'acrescente em "## Não publicado" do CHANGELOG.md uma linha que diga o que muda para quem usa, ' +
  'sob "### Adicionado", "### Alterado", "### Corrigido" ou "### Segurança" ' +
  '(PR só de testes ou só de CI fica de fora: docs/guias/contribuir/pull-request.md)';

export type MotivoDoChangelog = 'changelog.base-indisponivel' | 'changelog.secao-publicada'
  | 'changelog.grupo-ausente' | 'changelog.grupo-invalido'
  | 'changelog.linha-ausente' | 'changelog.secao-ausente';

export interface ResultadoDoChangelog {
  ok: boolean;
  motivo: MotivoDoChangelog | null;
  detalhe: string;
  correcao?: string;
  arquivos: string[];
  linhas: string[];
  secao?: string;
  grupo?: string | null;
}

function git(raiz: string, args: string[]): { ok: boolean; saida: string } {
  const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, saida: r.stdout ?? '' };
}

/** Arquivo de teste: pasta `test`, `tests` ou `__tests__`, ou nome `*.test.*`/`*.spec.*`. */
export function ehTeste(arquivo: string): boolean {
  const partes = arquivo.split('/');
  return partes.slice(0, -1).some((p) => p === 'test' || p === 'tests' || p === '__tests__')
    || /\.(test|spec)\.[A-Za-z0-9]+$/.test(partes[partes.length - 1]);
}

/** Arquivo de produto que exige uma entrada no CHANGELOG. */
export function pedeLinha(arquivo: string): boolean {
  return PASTAS_DE_PRODUTO.some((p) => arquivo.startsWith(p)) && !ehTeste(arquivo) && !DE_CI.some((re) => re.test(arquivo));
}

/** Linhas de texto de `## Não publicado`, mantida para consumidores e testes legados. */
export function linhasDaSecao(texto: string): string[] | null {
  const linhas = texto.replace(/\r\n/g, '\n').split('\n');
  const inicio = linhas.findIndex((linha) => linha.trim() === `## ${SECAO_NAO_PUBLICADO}`);
  if (inicio < 0) return null;
  const corpo: string[] = [];
  for (const linha of linhas.slice(inicio + 1)) {
    if (/^## /.test(linha)) break;
    if (linha.trim() && !/^#/.test(linha.trim())) corpo.push(linha.trimEnd());
  }
  return corpo;
}

/** Versoes nos dois formatos historicos do arquivo. */
export function versoes(texto: string): Set<string> {
  return new Set([...texto.replace(/\r\n/g, '\n').matchAll(/^## \[?(\d+\.\d+\.\d+[0-9A-Za-z.+-]*)\]?(?=\s|$)/gm)]
    .map((m) => m[1]));
}

function changelogEm(raiz: string, ref: string): string {
  const r = git(raiz, ['show', `${ref}:${CHANGELOG}`]);
  return r.ok ? r.saida : '';
}

/**
 * A regra protege um histórico publicado. Repositórios ainda sem versão `v*` ou sem
 * CHANGELOG no HEAD não têm esse contrato para comparar e ficam fora do verificador.
 */
export function changelogAplicavel(raiz: string, head = 'HEAD'): boolean {
  const arquivo = git(raiz, ['cat-file', '-e', `${head}:${CHANGELOG}`]);
  if (!arquivo.ok) return false;
  const tags = git(raiz, ['tag', '--merged', head, '--list', 'v*']);
  return tags.ok && tags.saida.split('\n').some((tag) => tag.trim().length > 1);
}

interface LinhaNova { numero: number; texto: string }

/** Linhas acrescentadas no arquivo, com o numero que ocupam no HEAD. */
function linhasAcrescentadas(raiz: string, base: string, head: string): LinhaNova[] {
  const d = git(raiz, ['diff', '--no-color', '--unified=0', '--no-renames', base, head, '--', CHANGELOG]);
  if (!d.ok) return [];
  const novas: LinhaNova[] = [];
  let numero = 0, emTrecho = false;
  for (const linha of d.saida.replace(/\r\n/g, '\n').split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(linha);
    if (hunk) { numero = Number(hunk[1]); emTrecho = true; continue; }
    if (!emTrecho || linha.startsWith('\\ No newline')) continue;
    if (linha.startsWith('+')) { novas.push({ numero, texto: linha.slice(1) }); numero++; }
    else if (!linha.startsWith('-')) numero++;
  }
  return novas;
}

interface ContextoDaLinha { secao: string | null; grupo: string | null; versao: string | null }

function contextos(texto: string): ContextoDaLinha[] {
  const porLinha: ContextoDaLinha[] = [{ secao: null, grupo: null, versao: null }];
  let secao: string | null = null, grupo: string | null = null, versao: string | null = null;
  for (const linha of texto.replace(/\r\n/g, '\n').split('\n')) {
    const h2 = /^## (.+?)\s*$/.exec(linha);
    if (h2) {
      secao = h2[1]; grupo = null;
      versao = /^\[?(\d+\.\d+\.\d+[0-9A-Za-z.+-]*)\]?(?:\s|$)/.exec(secao)?.[1] ?? null;
    } else {
      const h3 = /^### (.+?)\s*$/.exec(linha);
      if (h3) grupo = h3[1];
    }
    porLinha.push({ secao, grupo, versao });
  }
  return porLinha;
}

function tagPublicada(raiz: string, versao: string): boolean {
  return git(raiz, ['rev-parse', '--verify', '--quiet', `refs/tags/v${versao}^{commit}`]).ok;
}

/**
 * Confere o diff da thread ate `head`.
 *
 * A referencia local da branch alvo pode estar atrasada em relacao ao commit que abriu a
 * worktree. Quando a base carimbada tambem e ancestral do HEAD e vem depois da merge-base,
 * ela delimita o que a thread de fato acrescentou. Se a branch alvo avancou para alem dela,
 * a merge-base mais nova continua vencendo.
 */
export function checarChangelog(raiz: string, opcoes: { base?: string; head?: string; baseCarimbada?: string | null } = {}): ResultadoDoChangelog {
  const head = opcoes.head ?? 'HEAD', base = opcoes.base;
  const indisponivel = (detalhe: string): ResultadoDoChangelog => ({ ok: false, motivo: 'changelog.base-indisponivel', detalhe,
    correcao: 'rode com o histórico completo do git (fetch-depth: 0 no CI) ou passe --base <ref>', arquivos: [], linhas: [] });
  if (!git(raiz, ['rev-parse', '--verify', '--quiet', `${head}^{commit}`]).ok) return indisponivel(`o head ${head} não existe neste repositório`);
  if (!changelogAplicavel(raiz, head)) {
    const temArquivo = git(raiz, ['cat-file', '-e', `${head}:${CHANGELOG}`]).ok;
    return { ok: true, motivo: null, arquivos: [], linhas: [], detalhe: temArquivo
      ? 'regra do CHANGELOG não aplicável: o repositório ainda não tem versão publicada em tag v*'
      : `regra do CHANGELOG não aplicável: ${CHANGELOG} não existe em ${head}` };
  }
  if (!base) return indisponivel('nenhuma base para comparar');
  if (!git(raiz, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).ok) return indisponivel(`a base ${base} não existe neste repositório`);
  const mb = git(raiz, ['merge-base', base, head]);
  let ancestral = mb.saida.trim();
  if (!mb.ok || !ancestral) return indisponivel(`${base} e ${head} não têm ancestral comum`);
  const carimbada = opcoes.baseCarimbada?.trim();
  if (carimbada
    && git(raiz, ['rev-parse', '--verify', '--quiet', `${carimbada}^{commit}`]).ok
    && git(raiz, ['merge-base', '--is-ancestor', carimbada, head]).ok
    && git(raiz, ['merge-base', '--is-ancestor', ancestral, carimbada]).ok) {
    ancestral = carimbada;
  }

  const mudados = git(raiz, ['diff', '--name-only', '--no-renames', '-z', ancestral, head]);
  const arquivos = (mudados.ok ? mudados.saida.split('\0') : []).filter(Boolean);
  const pedem = arquivos.filter(pedeLinha);
  const antes = changelogEm(raiz, ancestral), depois = changelogEm(raiz, head);
  const novas = linhasAcrescentadas(raiz, ancestral, head);
  const porLinha = contextos(depois);

  // D4: uma entrada correta em Nao publicado nunca esconde uma edicao retrospectiva.
  for (const linha of novas) {
    if (!linha.texto.trim()) continue;
    const contexto = porLinha[linha.numero] ?? { secao: null, grupo: null, versao: null };
    if (contexto.versao && tagPublicada(raiz, contexto.versao)) {
      return { ok: false, motivo: 'changelog.secao-publicada', arquivos: pedem, linhas: [linha.texto], secao: contexto.secao ?? undefined,
        detalhe: `a linha nova ${linha.numero} caiu em "## ${contexto.secao}", versão já publicada pela tag v${contexto.versao}`,
        correcao: `mova a linha para "## ${SECAO_NAO_PUBLICADO}", sob um dos grupos permitidos` };
    }
  }

  const entradasNaoPublicadas = novas.filter((linha) => {
    const t = linha.texto.trim(), contexto = porLinha[linha.numero];
    return !!t && !/^#{2,3} /.test(t) && contexto?.secao === SECAO_NAO_PUBLICADO;
  });
  for (const linha of entradasNaoPublicadas) {
    const grupo = porLinha[linha.numero]?.grupo ?? null;
    if (!grupo) return { ok: false, motivo: 'changelog.grupo-ausente', arquivos: pedem, linhas: [linha.texto], grupo,
      detalhe: `a linha nova ${linha.numero} de "## ${SECAO_NAO_PUBLICADO}" não está sob um título ###`,
      correcao: `ponha a linha sob ${GRUPOS_NAO_PUBLICADOS.map((g) => `"### ${g}"`).join(', ')}` };
    if (!(GRUPOS_NAO_PUBLICADOS as readonly string[]).includes(grupo)) {
      return { ok: false, motivo: 'changelog.grupo-invalido', arquivos: pedem, linhas: [linha.texto], grupo,
        detalhe: `a linha nova ${linha.numero} está sob "### ${grupo}", grupo que não vale em "## ${SECAO_NAO_PUBLICADO}"`,
        correcao: `use ${GRUPOS_NAO_PUBLICADOS.map((g) => `"### ${g}"`).join(', ')}` };
    }
  }

  if (pedem.length === 0) return { ok: true, motivo: null, arquivos: [], linhas: [],
    detalhe: arquivos.length === 0 ? `nada a conferir: ${head} não muda nada desde ${base}`
      : 'nada pede linha: o PR não muda core/, adapters/ nem marketplaces/ fora de teste e de CI' };

  const versaoNova = [...versoes(depois)].filter((v) => !versoes(antes).has(v));
  if (versaoNova.length > 0) return { ok: true, motivo: null, arquivos: pedem, linhas: [],
    detalhe: `versão nova no ${CHANGELOG}: ${versaoNova.join(', ')} (o PR de versão leva as linhas para ela)` };

  if (linhasDaSecao(depois) === null) return { ok: false, motivo: 'changelog.secao-ausente', arquivos: pedem, linhas: [],
    detalhe: `o ${CHANGELOG} de ${head} não tem a seção "## ${SECAO_NAO_PUBLICADO}"`,
    correcao: `abra a seção "## ${SECAO_NAO_PUBLICADO}" no alto do ${CHANGELOG} e acrescente a linha da mudança` };

  if (entradasNaoPublicadas.length > 0) return { ok: true, motivo: null, arquivos: pedem,
    linhas: entradasNaoPublicadas.map((linha) => linha.texto),
    detalhe: `${entradasNaoPublicadas.length} linha(s) nova(s) em "## ${SECAO_NAO_PUBLICADO}" sob grupo permitido` };

  return { ok: false, motivo: 'changelog.linha-ausente', arquivos: pedem, linhas: [],
    detalhe: `o PR muda ${pedem.length} arquivo(s) de core/, adapters/ ou marketplaces/ (${pedem.slice(0, 3).join(', ')}${pedem.length > 3 ? ', ...' : ''}) e não acrescenta linha válida em "## ${SECAO_NAO_PUBLICADO}" do ${CHANGELOG}`,
    correcao: CORRECAO };
}

/** Base padrao do CI: alvo do PR, main remota, main local. */
export function basePadrao(raiz: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.GITHUB_BASE_REF) return `origin/${env.GITHUB_BASE_REF}`;
  for (const ref of ['origin/main', 'main']) if (git(raiz, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) return ref;
  return null;
}
