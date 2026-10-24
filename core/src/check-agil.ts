/**
 * RM-072 (D3 a D8 da ork-check5x): o motor do Agile Check no verify.
 *
 * O Agile roda a mesma cobertura do Classic com menos repeticao e menos serie:
 *
 *   - o preparo do Agile (`check.agile.preparo`, como o `tsgo` deste projeto) e, se ele falhar ou nao existir, o
 *     `verify.preparo`, com a peca `preparo` em fallback;
 *   - as claims, uma por vez, contra o produto do preparo: a claim que comeca pelos passos do `verify.preparo` roda sem
 *     eles quando a guarda vale (o preparo passou, a arvore e a mesma do fim do preparo e o hash dos caminhos de
 *     `check.agile.produto` tambem); qualquer divergencia roda o comando inteiro, e o motivo vai ao ledger;
 *   - o `build` que e so passos do preparo, com a guarda valendo, sai do preparo desta rodada sem rodar de novo;
 *   - `typecheck`, as lanes de `test` (`check.agile.test`, ou o `verify.test`) e o `security_scan` num grupo paralelo, so
 *     com a guarda valendo; sem ela, em serie, como o Classic, com a peca `grupo` em fallback.
 *
 * O resultado volta na ordem canonica dos comandos do manifesto, com as lanes dentro do `test` (que fica ok so com todas
 * ok e e o nome que a baseline compara). Nada aqui decide veredito: a classificacao e a do verify.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ENV_RELATORIO_DO_CHECK } from './check-modo';
import { CausaDoComando, Manifesto, ResultadoDeComando } from './types';

/** Uma peca do Agile e o que aconteceu com ela; `fallback` diz o equivalente do Classic que rodou no lugar. */
export interface PecaDoAgile {
  peca: string;
  estado: 'agile' | 'fallback';
  motivo?: string;
  fallback?: string;
}

/** Por que a guarda do produto nao vale (a claim, o `build` e as lanes rodam como no Classic). */
export type MotivoDaGuarda = 'sem-preparo' | 'preparo-falhou' | 'produto-nao-declarado' | 'arvore-mudou' | 'produto-mudou';

/** O que o reaproveitamento fez com um comando. */
export interface UsoDoPreparo {
  reaproveitado: boolean;
  /** Os passos do preparo tirados da frente do comando. */
  passos?: string[];
  motivo?: MotivoDaGuarda;
}

/** Um comando do grupo paralelo, antes de virar resultado. */
export interface ItemDoGrupo {
  nome: string;
  comando: string;
  /** Prioridade menor (nice) no processo auxiliar. */
  nice?: number;
}

/** Roda os comandos do grupo e devolve os resultados na mesma ordem. */
export type ExecutorDeGrupo = (itens: ItemDoGrupo[], cwd: string) => ResultadoDeComando[];

/** Roda um comando (o executor da rodada, com prazo, steal e conducao). */
export type ExecutorUnico = (nome: string, comando: string, cwd: string) => ResultadoDeComando;

const SEPARADOR = ' && ';

/** Os passos de um comando encadeado por `&&` no nivel do texto (o preparo e escrito assim no manifesto). */
export function passosDoComando(comando: string): string[] {
  return comando.split(SEPARADOR).map((p) => p.trim()).filter(Boolean);
}

/**
 * Tira da frente do comando os passos que sao passos do preparo, na forma `passo && resto`. So o texto exato conta: um
 * passo escrito de outro jeito (outra opcao, outro espaco) fica, e o comando roda inteiro.
 */
export function tirarPassosDoPreparo(comando: string, passosDoPreparo: readonly string[]): { passos: string[]; resto: string } {
  let resto = comando.trim();
  const passos: string[] = [];
  for (;;) {
    const passo = passosDoPreparo.find((p) => resto === p || resto.startsWith(p + SEPARADOR));
    if (!passo) break;
    passos.push(passo);
    resto = resto === passo ? '' : resto.slice(passo.length + SEPARADOR.length).trim();
  }
  return { passos, resto };
}

/**
 * O sha256 do conteudo dos caminhos do produto (arquivos em ordem, com o caminho relativo). Caminho ausente entra como
 * ausente, para o produto que some nao passar por igual; link simbolico entra pelo destino que ele aponta, sem segui-lo.
 */
export function hashDoProduto(cwd: string, caminhos: readonly string[]): string {
  const h = createHash('sha256');
  const visitar = (relativo: string): void => {
    const absoluto = path.join(cwd, relativo);
    const st = fs.lstatSync(absoluto, { throwIfNoEntry: false });
    if (!st) { h.update(`<ausente>${relativo}\0`); return; }
    if (st.isSymbolicLink()) { h.update(`<link>${relativo}\0${fs.readlinkSync(absoluto)}\0`); return; }
    if (st.isDirectory()) {
      for (const nome of fs.readdirSync(absoluto).sort()) visitar(path.join(relativo, nome));
      return;
    }
    if (!st.isFile()) return;
    h.update(`${relativo}\0${st.mode & 0o111 ? 'x' : '-'}\0`);
    h.update(fs.readFileSync(absoluto));
  };
  for (const c of [...caminhos].sort()) visitar(c);
  return h.digest('hex');
}

/**
 * A guarda do produto (D5): o que o fim do preparo deixou, e a conferencia antes de cada uso. `identidade` e a da arvore
 * (a de sempre do verify); `produto` e o hash dos caminhos declarados.
 */
export class GuardaDoProduto {
  private readonly identidade: string | null;
  private readonly produto: string | null;
  constructor(private readonly cwd: string, private readonly caminhos: readonly string[] | undefined,
    private readonly identidadeAgora: (cwd: string) => string, private readonly motivoBase: MotivoDaGuarda | null) {
    this.identidade = motivoBase ? null : identidadeAgora(cwd);
    this.produto = motivoBase || !caminhos?.length ? null : hashDoProduto(cwd, caminhos);
  }

  /** `null` quando a guarda vale; senao, o motivo. */
  conferir(): MotivoDaGuarda | null {
    if (this.motivoBase) return this.motivoBase;
    if (!this.caminhos?.length) return 'produto-nao-declarado';
    if (this.identidadeAgora(this.cwd) !== this.identidade) return 'arvore-mudou';
    if (hashDoProduto(this.cwd, this.caminhos) !== this.produto) return 'produto-mudou';
    return null;
  }

  /** O hash do produto no fim do preparo, curto, para o ledger. */
  hashCurto(): string | null {
    return this.produto ? this.produto.slice(0, 16) : null;
  }
}

/** O preparo do Agile, com o fallback para o `verify.preparo` (D4). */
export function prepararNoAgile(manifesto: Manifesto, cwd: string, executor: ExecutorUnico):
  { resultado: ResultadoDeComando | null; pecas: PecaDoAgile[] } {
  const doAgile = manifesto.check?.agile?.preparo;
  const doVerify = manifesto.verify.preparo;
  if (!doAgile) return { resultado: doVerify ? executor('preparo', doVerify, cwd) : null, pecas: [] };
  const r = executor('preparo', doAgile, cwd);
  if (r.ok) return { resultado: r, pecas: [{ peca: 'preparo', estado: 'agile' }] };
  const motivo = `${r.causa === 'timeout' ? 'estourou o prazo' : `saiu com codigo ${r.code}`}: ${r.comando}`;
  if (!doVerify) return { resultado: r, pecas: [{ peca: 'preparo', estado: 'fallback', motivo, fallback: 'nenhum (sem verify.preparo)' }] };
  return { resultado: executor('preparo', doVerify, cwd), pecas: [{ peca: 'preparo', estado: 'fallback', motivo, fallback: 'verify.preparo' }] };
}

/** O resultado de um comando que e so passos do preparo desta rodada (D4, D5): o veredito e o do preparo. */
function doPreparo(nome: string, comando: string, preparo: ResultadoDeComando, passos: string[]): ResultadoDeComando {
  return { nome, comando, ok: preparo.ok, code: preparo.code, resumo: `reaproveitado do preparo desta rodada (${passos.join(SEPARADOR)})`,
    causa: preparo.causa, prazoMs: preparo.prazoMs, duracaoMs: 0, executado: true, preparo: { reaproveitado: true, passos } };
}

/**
 * O executor das claims no Agile (D5): tira os passos do `verify.preparo` da frente do comando quando a guarda vale. O
 * comando gravado continua o inteiro, e o que rodou de fato fica em `comandoExecutado`.
 */
export function executorDaClaimNoAgile(manifesto: Manifesto, executor: ExecutorUnico, guarda: GuardaDoProduto,
  preparo: ResultadoDeComando | null): ExecutorUnico {
  const passosDoPreparo = manifesto.verify.preparo ? passosDoComando(manifesto.verify.preparo) : [];
  return (nome, comando, cwd) => {
    const { passos, resto } = tirarPassosDoPreparo(comando, passosDoPreparo);
    if (passos.length === 0) return executor(nome, comando, cwd);
    const motivo = guarda.conferir();
    if (motivo) return { ...executor(nome, comando, cwd), preparo: { reaproveitado: false, motivo } };
    if (resto === '') return doPreparo(nome, comando, preparo!, passos);
    return { ...executor(nome, resto, cwd), comando, comandoExecutado: resto, preparo: { reaproveitado: true, passos } };
  };
}

const PIOR_CAUSA: CausaDoComando[] = ['timeout', 'sinal', 'nao-encontrado', 'exit'];

/** O `test` das lanes (D4): ok so com todas ok; a evidencia de quem caiu; a parede e a da lane mais longa. */
export function testDasLanes(lanes: Array<{ lane: string; resultado: ResultadoDeComando }>): ResultadoDeComando {
  const caidas = lanes.filter((l) => !l.resultado.ok);
  const juntar = <T>(f: (r: ResultadoDeComando) => T[] | undefined): T[] => lanes.flatMap((l) => f(l.resultado) ?? []);
  const causas = lanes.map((l) => l.resultado.causa).filter((c): c is CausaDoComando => !!c);
  const testes = juntar((r) => r.testeQueCaiu).slice(0, 10);
  const falhas = juntar((r) => r.falhasDeTeste);
  const relogio = juntar((r) => r.relogioSobSteal);
  const trechos = caidas.map((l) => l.resultado.trecho).filter((t): t is string => !!t);
  return {
    nome: 'test',
    comando: lanes.map((l) => `${l.lane}: ${l.resultado.comando}`).join('; '),
    ok: caidas.length === 0,
    code: caidas[0]?.resultado.code ?? 0,
    resumo: (caidas.length ? caidas : lanes).map((l) => `[${l.lane}] ${l.resultado.resumo}`).join('\n').slice(-800),
    ...(causas.length ? { causa: PIOR_CAUSA.find((c) => causas.includes(c)) } : {}),
    prazoMs: Math.max(...lanes.map((l) => l.resultado.prazoMs ?? 0)),
    duracaoMs: Math.max(...lanes.map((l) => l.resultado.duracaoMs ?? 0)),
    executado: lanes.every((l) => l.resultado.executado !== false),
    ...(testes.length ? { testeQueCaiu: testes } : {}),
    ...(falhas.length ? { falhasDeTeste: falhas } : {}),
    ...(trechos.length ? { trecho: trechos.join('\n').slice(0, 1024) } : {}),
    ...(lanes.some((l) => l.resultado.stealPct !== undefined) ? { stealPct: lanes.find((l) => l.resultado.stealPct !== undefined)!.resultado.stealPct } : {}),
    ...(relogio.length ? { relogioSobSteal: relogio } : {}),
    lanes: lanes.map((l) => ({ lane: l.lane, comando: l.resultado.comando, ok: l.resultado.ok, code: l.resultado.code,
      ...(l.resultado.causa ? { causa: l.resultado.causa } : {}), duracaoMs: l.resultado.duracaoMs ?? 0 })),
  };
}

/** O que o grupo do Agile entrega ao verify. */
export interface ComandosDoAgile {
  comandos: ResultadoDeComando[];
  pecas: PecaDoAgile[];
  /** O grupo rodou em paralelo (com a guarda valendo e mais de um comando). */
  paralelo: boolean;
  /** As lanes que rodaram e o comando de cada uma. */
  lanes: string[];
}

/**
 * Os comandos do manifesto no Agile (D4): `build` reaproveitado do preparo com a guarda valendo; o resto num grupo
 * paralelo, com as lanes no lugar do `verify.test`, so com a guarda valendo; sem ela, tudo em serie (o Classic).
 */
export function comandosNoAgile(manifesto: Manifesto, cwd: string, lista: { nome: string; comando: string }[], executor: ExecutorUnico,
  grupo: ExecutorDeGrupo, guarda: GuardaDoProduto, preparo: ResultadoDeComando | null): ComandosDoAgile {
  const pecas: PecaDoAgile[] = [];
  const passosDoPreparo = manifesto.verify.preparo ? passosDoComando(manifesto.verify.preparo) : [];
  const lanesDeclaradas = Object.entries(manifesto.check?.agile?.test ?? {});
  const motivo = guarda.conferir();
  const porNome = new Map<string, ResultadoDeComando>();

  if (motivo) {
    // Sem a guarda, o Agile nao arrisca: tudo roda em serie, na ordem e com os comandos do Classic, e o motivo vai ao
    // ledger quando havia o que paralelizar.
    const resto = lista.filter((c) => c.nome !== 'build');
    if (resto.length > 1 || lanesDeclaradas.length > 0) pecas.push({ peca: 'grupo', estado: 'fallback', motivo, fallback: 'comandos em serie' });
    if (lanesDeclaradas.length > 0) pecas.push({ peca: 'lanes', estado: 'fallback', motivo, fallback: 'verify.test' });
    return { comandos: lista.map((c) => executor(c.nome, c.comando, cwd)), pecas, paralelo: false, lanes: [] };
  }
  // Com a guarda: o build primeiro (do preparo, quando e so passos dele), e o resto junto.
  const build = lista.find((c) => c.nome === 'build');
  if (build) {
    const { passos, resto } = tirarPassosDoPreparo(build.comando, passosDoPreparo);
    if (passos.length > 0 && resto === '') porNome.set('build', doPreparo('build', build.comando, preparo!, passos));
    else porNome.set('build', executor('build', build.comando, cwd));
  }
  const resto = lista.filter((c) => c.nome !== 'build');
  const itens: ItemDoGrupo[] = [];
  for (const c of resto) {
    if (c.nome === 'test' && lanesDeclaradas.length > 0) {
      for (const [lane, comando] of lanesDeclaradas) itens.push({ nome: `test:${lane}`, comando });
    } else itens.push({ nome: c.nome, comando: c.comando });
  }
  const resultados = itens.length > 1 ? grupo(itens, cwd) : itens.map((i) => executor(i.nome, i.comando, cwd));
  const lanes: Array<{ lane: string; resultado: ResultadoDeComando }> = [];
  itens.forEach((item, i) => {
    if (item.nome.startsWith('test:')) lanes.push({ lane: item.nome.slice('test:'.length), resultado: resultados[i] });
    else porNome.set(item.nome, resultados[i]);
  });
  if (lanes.length > 0) {
    porNome.set('test', testDasLanes(lanes));
    pecas.push({ peca: 'lanes', estado: 'agile' });
  }
  if (itens.length > 1) pecas.push({ peca: 'grupo', estado: 'agile' });
  return { comandos: lista.map((c) => porNome.get(c.nome)!), pecas, paralelo: itens.length > 1, lanes: lanes.map((l) => l.lane) };
}

/** O arquivo do relatorio das pecas de uma rodada (D8), e a leitura dele no fim. */
export class RelatorioDoCheck {
  readonly arquivo: string;
  private readonly dir: string;
  constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-check-relatorio-'));
    this.arquivo = path.join(this.dir, 'pecas.jsonl');
    fs.writeFileSync(this.arquivo, '', { mode: 0o600 });
  }

  ambiente(): Record<string, string> {
    return { [ENV_RELATORIO_DO_CHECK]: this.arquivo };
  }

  /** As linhas que as pecas escreveram; linha que nao abre fica de fora (o relatorio e evidencia, nao veredito). */
  ler(): Array<Record<string, unknown>> {
    let bruto = '';
    try { bruto = fs.readFileSync(this.arquivo, 'utf8'); } catch { return []; }
    return bruto.split('\n').filter(Boolean).flatMap((l) => {
      try { const v = JSON.parse(l) as unknown; return v && typeof v === 'object' && !Array.isArray(v) ? [v as Record<string, unknown>] : []; }
      catch { return []; }
    });
  }

  fechar(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

/** A lista de arquivos de cada lane, como o relatorio contou (D8): contagem e sha256 da lista ordenada. */
export function listasDasLanes(linhas: Array<Record<string, unknown>>): Array<{ lane: string; arquivos: string[]; sha256: string }> {
  return linhas.filter((l) => l.tipo === 'lista' && typeof l.lane === 'string' && Array.isArray(l.arquivos))
    .map((l) => {
      const arquivos = (l.arquivos as unknown[]).filter((a): a is string => typeof a === 'string').sort();
      return { lane: l.lane as string, arquivos, sha256: createHash('sha256').update(arquivos.join('\n')).digest('hex') };
    });
}
