/**
 * RM-072 (D3 a D8 da ork-check5x): o motor do Agile Check no verify.
 *
 * O Agile roda a mesma cobertura do Classic com menos repeticao e menos serie:
 *
 *   - o preparo do Agile (`check.agile.preparo`, como o `tsgo` deste projeto) e, se ele falhar ou nao existir, o
 *     `verify.preparo`, com a peca `preparo` em fallback;
 *   - as claims, uma por vez, contra o produto do preparo: a claim que comeca pelos passos do `verify.preparo` roda sem
 *     eles quando a guarda vale (o preparo passou, a arvore e a mesma do fim do preparo e o hash dos caminhos de
 *     `check.agile.produto` tambem); qualquer divergencia roda o comando inteiro, e o motivo vai ao ledger. Passo no meio
 *     da cadeia fica: o que vem antes dele pode mudar a entrada do build (o mutante que edita o fonte e compila). Quando
 *     so o produto mudou (a claim anterior compilou de novo no meio da cadeia), o preparo roda de novo antes da proxima
 *     claim que o reaproveitaria, ate `MAXIMO_DE_PREPAROS_REFEITOS` vezes, e uma vez antes do grupo, com a peca
 *     `preparo-refeito`;
 *   - o `build` que e so passos do preparo, com a guarda valendo, sai do preparo desta rodada sem rodar de novo;
 *   - `typecheck`, as lanes de `test` (`check.agile.test`, ou o `verify.test`) e o `security_scan` num grupo paralelo, so
 *     com a guarda valendo; sem ela, em serie, como o Classic, com a peca `grupo` em fallback. O grupo nao passa da CPU
 *     da maquina: a lane de `check.agile.apos_a_varredura` so comeca quando o `security_scan` termina (as duas sobem
 *     containers), e a varredura roda ate `paralelismoDaVarreduraNoGrupo()` ferramentas ao mesmo tempo.
 *
 * O resultado volta na ordem canonica dos comandos do manifesto, com as lanes dentro do `test` (que fica ok so com todas
 * ok e e o nome que a baseline compara). Nada aqui decide veredito: a classificacao e a do verify.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ENV_RELATORIO_DO_CHECK } from './check-modo';
import { redigirCredenciaisUrl } from './redacao-url';
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
  /** Os itens do grupo (pelo nome, antes deste na lista) que precisam terminar antes de este comecar. */
  apos?: string[];
}

/**
 * Quantas ferramentas a varredura roda ao mesmo tempo dentro do grupo, ao lado das lanes: um terco das CPUs que sobram
 * de uma, e no minimo duas. Numa maquina de 7 CPUs, duas.
 */
export function paralelismoDaVarreduraNoGrupo(cpus = os.availableParallelism()): number {
  return Math.max(2, Math.floor((cpus - 1) / 3));
}

/** Roda os comandos do grupo e devolve os resultados na mesma ordem. */
export type ExecutorDeGrupo = (itens: ItemDoGrupo[], cwd: string) => ResultadoDeComando[];

/** Roda um comando (o executor da rodada, com prazo, steal e conducao). */
export type ExecutorUnico = (nome: string, comando: string, cwd: string) => ResultadoDeComando;

const SEPARADOR = ' && ';

/** Os passos de um comando encadeado por `&&` no nivel do texto (o preparo e escrito assim no manifesto). */
export function passosDoComando(comando: string): string[] {
  // O leitor de aspas quando ele le o comando (`&&` dentro de aspas nao separa); senao, o texto cru.
  return (elosDoComando(comando) ?? comando.split(SEPARADOR)).map((p) => p.trim()).filter(Boolean);
}

/**
 * Os elos de nivel de topo de um comando encadeado por `&&`, ou `null` quando o comando tem o que este leitor nao acompanha
 * com seguranca: subshell, chave, crase, substituicao, heredoc, comentario, quebra de linha, `$'...'` ou aspas abertas.
 * Aspas simples, aspas duplas e a barra invertida sao respeitadas: `&&` dentro delas nao separa.
 */
export function elosDoComando(comando: string): string[] | null {
  const elos: string[] = [];
  let atual = '';
  let aspas: '"' | "'" | null = null;
  for (let i = 0; i < comando.length; i++) {
    const c = comando[i];
    const proximo = comando[i + 1] ?? '';
    if (aspas === "'") { atual += c; if (c === "'") aspas = null; continue; }
    if (c === '\\') { atual += c + proximo; i++; continue; }
    if (aspas === '"') {
      if (c === '`' || (c === '$' && (proximo === '(' || proximo === '{'))) return null;
      atual += c;
      if (c === '"') aspas = null;
      continue;
    }
    if (c === "'" || c === '"') { aspas = c; atual += c; continue; }
    if ('(){}`\n\r'.includes(c) || (c === '<' && proximo === '<') || (c === '$' && proximo === "'")) return null;
    if (c === '#' && (atual === '' || /\s$/.test(atual))) return null;
    if (c === '&' && proximo === '&') { elos.push(atual.trim()); atual = ''; i++; continue; }
    atual += c;
  }
  if (aspas) return null;
  elos.push(atual.trim());
  return elos;
}

/**
 * Tira da frente do comando os passos que sao passos do preparo, na forma `passo && resto`. So o texto exato conta: um
 * passo escrito de outro jeito (outra opcao, outro espaco) fica, e o comando roda inteiro. So a frente: no meio da cadeia
 * (`antes && passo && depois`), o `antes` pode mudar a entrada do build, e a guarda so confere a arvore antes do comando.
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
  const motivo = `${r.causa === 'timeout' ? 'estourou o prazo' : `saiu com codigo ${r.code}`}: ${redigirCredenciaisUrl(r.comando)}`;
  if (!doVerify) return { resultado: r, pecas: [{ peca: 'preparo', estado: 'fallback', motivo, fallback: 'nenhum (sem verify.preparo)' }] };
  return { resultado: executor('preparo', doVerify, cwd), pecas: [{ peca: 'preparo', estado: 'fallback', motivo, fallback: 'verify.preparo' }] };
}

/**
 * O resultado de um comando que e so passos do preparo desta rodada (D4, D5): o veredito e o do preparo. O resumo diz o
 * preparo que rodou de fato (o do Agile, como o `tsgo`, ou o `verify.preparo` do fallback), nao so os passos tirados.
 */
function doPreparo(nome: string, comando: string, preparo: ResultadoDeComando, passos: string[]): ResultadoDeComando {
  return { nome, comando, ok: preparo.ok, code: preparo.code, resumo: `reaproveitado do preparo desta rodada (${redigirCredenciaisUrl(preparo.comando)})`,
    causa: preparo.causa, prazoMs: preparo.prazoMs, duracaoMs: 0, executado: true, preparo: { reaproveitado: true, passos } };
}

/** O preparo que vale agora na rodada e a guarda tomada no fim dele; o preparo refeito troca os dois (A1 e S-d do CHECK). */
export interface PreparoVigente {
  guarda: GuardaDoProduto;
  preparo: ResultadoDeComando | null;
}

/** Refaz o preparo antes da claim `nome` (como C2.1) quando so o produto mudou (a arvore e a mesma): devolve se refez. */
export type RefazerPreparo = (nome: string) => boolean;

/**
 * O executor das claims no Agile (D5): tira os passos do `verify.preparo` da frente do comando quando a guarda vale. O
 * comando gravado continua o inteiro, e o que rodou de fato fica em `comandoExecutado`. S-d do CHECK: quando so o
 * produto mudou (a claim anterior compilou de novo no meio da cadeia), o preparo roda de novo antes desta claim e a guarda
 * nova decide; sem isso, toda claim seguinte rodaria inteira.
 */
export function executorDaClaimNoAgile(manifesto: Manifesto, executor: ExecutorUnico, vigente: PreparoVigente,
  refazer?: RefazerPreparo): ExecutorUnico {
  const passosDoPreparo = manifesto.verify.preparo ? passosDoComando(manifesto.verify.preparo) : [];
  return (nome, comando, cwd) => {
    const { passos, resto } = tirarPassosDoPreparo(comando, passosDoPreparo);
    if (passos.length === 0) return executor(nome, comando, cwd);
    let motivo = vigente.guarda.conferir();
    if (motivo === 'produto-mudou' && refazer?.(nome)) motivo = vigente.guarda.conferir();
    if (motivo) return { ...executor(nome, comando, cwd), preparo: { reaproveitado: false, motivo } };
    if (resto === '') return doPreparo(nome, comando, vigente.preparo!, passos);
    return { ...executor(nome, resto, cwd), comando, comandoExecutado: resto, preparo: { reaproveitado: true, passos } };
  };
}

/**
 * Quantas vezes as claims de uma rodada refazem o preparo; depois disso, a claim roda inteira, como sem a guarda. O grupo
 * tem uma vaga a mais, so dele (S-h do CHECK 3).
 */
export const MAXIMO_DE_PREPAROS_REFEITOS = 3;

/**
 * O preparo refeito (A1, S-a e S-d do CHECK): roda o preparo do Agile de novo, toma a guarda nova e devolve a peca com o
 * estado real. Falhou, a guarda nova nasce `preparo-falhou` e o resto da rodada roda inteiro, em serie.
 */
export function refazerPreparo(manifesto: Manifesto, cwd: string, executor: ExecutorUnico, vigente: PreparoVigente,
  novaGuarda: (preparo: ResultadoDeComando | null) => GuardaDoProduto, quando: string): PecaDoAgile[] {
  const deNovo = prepararNoAgile(manifesto, cwd, executor);
  vigente.preparo = deNovo.resultado;
  vigente.guarda = novaGuarda(deNovo.resultado);
  const r = deNovo.resultado;
  const oQue = `o produto mudou sem mudar a arvore; o preparo rodou de novo ${quando}`;
  const peca: PecaDoAgile = r?.ok
    ? { peca: 'preparo-refeito', estado: 'agile', motivo: `${oQue} (${Math.round((r.duracaoMs ?? 0) / 1000)} s)` }
    : { peca: 'preparo-refeito', estado: 'fallback',
      motivo: `${oQue} e ${!r ? 'nao havia preparo' : r.causa === 'timeout' ? 'estourou o prazo' : `saiu com codigo ${r.code}`}`
        + (r ? `: ${redigirCredenciaisUrl(r.comando)}` : ''),
      fallback: 'os comandos inteiros, em serie' };
  return [peca, ...deNovo.pecas.filter((x) => x.estado === 'fallback')];
}

const PIOR_CAUSA: CausaDoComando[] = ['timeout', 'sinal', 'nao-encontrado', 'exit'];

/**
 * O maior codigo de saida que e da propria lane: o mesmo `MAIOR_CODIGO_DO_COMANDO` da baseline (verify.ts). De 124 em
 * diante fala quem nao a deixou terminar (o `timeout` de dentro, o shell, o comando que nao existe, o sinal).
 */
const MAIOR_CODIGO_DA_LANE = 123;

/**
 * A lane caiu de verdade: terminou sozinha com o codigo dela (de 1 a 123, com causa `exit` ou nenhuma), rodou e nao caiu
 * so em teste de relogio sob steal. N4 do CHECK 3: e o mesmo criterio do "ja falhava" da baseline, para a juncao nao
 * depender da ordem das lanes.
 */
function caiuDeVerdade(r: ResultadoDeComando): boolean {
  return !r.ok && r.executado !== false && (r.causa === undefined || r.causa === 'exit') && Number.isInteger(r.code)
    && r.code >= 1 && r.code <= MAIOR_CODIGO_DA_LANE && !(r.relogioSobSteal?.length);
}

/**
 * O `test` das lanes (D4): ok so com todas ok; a evidencia de quem caiu; a parede e a da lane mais longa. A falha de
 * verdade de uma lane manda, como num comando so do Classic: o estouro ou o relogio sob steal de outra lane nao a esconde.
 * O relogio sob steal so vale quando toda lane que caiu caiu so nele, e a pior causa so vale sem falha de verdade. N1 do
 * CHECK 2 e N6 do CHECK 4: com uma lane caida sem veredito (fora o caso em que todas as caidas estouraram ou cairam so
 * no relogio, que o agregado ja diz por tempo), o `test` nao tem veredito inteiro (`executado` falso): no verify ele
 * bloqueia como sem veredito, mesmo com a baseline `ja-falhava`, e na baseline ele e `sem-veredito`, em qualquer ordem das
 * lanes; com falha de verdade junto, a causa, os testes e o trecho continuam os dela. A lane sozinha que sai com 124 antes
 * do prazo de fora fica sem veredito, mais estrita que o comando unico do Classic, que a compara com a baseline.
 */
export function testDasLanes(lanes: Array<{ lane: string; resultado: ResultadoDeComando }>): ResultadoDeComando {
  const caidas = lanes.filter((l) => !l.resultado.ok);
  const deVerdade = caidas.filter((l) => caiuDeVerdade(l.resultado));
  const semVeredito = caidas.filter((l) => !caiuDeVerdade(l.resultado));
  // N6 do CHECK 4: so o estouro e o relogio sob steal ja dizem "sem veredito" pelo agregado (a causa ou o relogio dele);
  // qualquer outra lane sem veredito deixa o `test` sem veredito inteiro, em qualquer ordem das lanes.
  const soPorTempo = deVerdade.length === 0 && semVeredito.length > 0
    && semVeredito.every((l) => l.resultado.causa === 'timeout' || (l.resultado.relogioSobSteal?.length ?? 0) > 0);
  const juntar = <T>(f: (r: ResultadoDeComando) => T[] | undefined): T[] => lanes.flatMap((l) => f(l.resultado) ?? []);
  const causas = lanes.map((l) => l.resultado.causa).filter((c): c is CausaDoComando => !!c);
  const causa = deVerdade.length ? deVerdade[0].resultado.causa ?? 'exit' : PIOR_CAUSA.find((c) => causas.includes(c));
  const soRelogio = caidas.length > 0 && caidas.every((l) => (l.resultado.relogioSobSteal?.length ?? 0) > 0);
  const testes = juntar((r) => r.testeQueCaiu).slice(0, 10);
  const falhas = juntar((r) => r.falhasDeTeste);
  const relogio = soRelogio ? juntar((r) => r.relogioSobSteal) : [];
  const trechos = caidas.map((l) => l.resultado.trecho).filter((t): t is string => !!t);
  return {
    nome: 'test',
    comando: lanes.map((l) => `${l.lane}: ${l.resultado.comando}`).join('; '),
    ok: caidas.length === 0,
    code: (deVerdade[0] ?? caidas[0])?.resultado.code ?? 0,
    resumo: (caidas.length ? caidas : lanes).map((l) => `[${l.lane}] ${l.resultado.resumo}`).join('\n').slice(-800),
    ...(causa ? { causa } : {}),
    prazoMs: Math.max(...lanes.map((l) => l.resultado.prazoMs ?? 0)),
    duracaoMs: Math.max(...lanes.map((l) => l.resultado.duracaoMs ?? 0)),
    executado: semVeredito.length === 0 || soPorTempo ? lanes.every((l) => l.resultado.executado !== false) : false,
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
  // A lane que sobe containers espera a varredura, que tambem sobe: o grupo nao junta as duas cargas.
  const depoisDaVarredura = new Set<string>(resto.some((c) => c.nome === 'security_scan') ? manifesto.check?.agile?.apos_a_varredura ?? [] : []);
  const encadeados: ItemDoGrupo[] = [];
  for (const c of resto) {
    if (c.nome === 'test' && lanesDeclaradas.length > 0) {
      for (const [lane, comando] of lanesDeclaradas) {
        if (depoisDaVarredura.has(lane)) encadeados.push({ nome: `test:${lane}`, comando, apos: ['security_scan'] });
        else itens.push({ nome: `test:${lane}`, comando });
      }
    } else itens.push({ nome: c.nome, comando: c.comando });
  }
  itens.push(...encadeados);
  const resultados = itens.length > 1 ? grupo(itens, cwd) : itens.map((i) => executor(i.nome, i.comando, cwd));
  const lanes: Array<{ lane: string; resultado: ResultadoDeComando }> = [];
  itens.forEach((item, i) => {
    if (item.nome.startsWith('test:')) lanes.push({ lane: item.nome.slice('test:'.length), resultado: resultados[i] });
    else porNome.set(item.nome, resultados[i]);
  });
  // As lanes voltam na ordem do manifesto, mesmo com a encadeada no fim do grupo.
  const ordem = (lane: string): number => lanesDeclaradas.findIndex(([nome]) => nome === lane);
  lanes.sort((a, b) => ordem(a.lane) - ordem(b.lane));
  if (lanes.length > 0) {
    porNome.set('test', testDasLanes(lanes));
    pecas.push({ peca: 'lanes', estado: 'agile' });
  }
  if (itens.length > 1) pecas.push({ peca: 'grupo', estado: 'agile' });
  return { comandos: lista.map((c) => porNome.get(c.nome)!), pecas, paralelo: itens.length > 1, lanes: lanes.map((l) => l.lane) };
}

/** O teto da leitura do relatorio da rodada. */
export const TETO_DO_RELATORIO_BYTES = 4 * 1024 * 1024;

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
    // Teto de tamanho: qualquer comando da rodada pode escrever no arquivo; a linha cortada no teto nao abre e fica de fora.
    let bruto = '';
    let tamanho = 0;
    try {
      const fd = fs.openSync(this.arquivo, 'r');
      try {
        tamanho = fs.fstatSync(fd).size;
        const buf = Buffer.alloc(Math.min(tamanho, TETO_DO_RELATORIO_BYTES));
        fs.readSync(fd, buf, 0, buf.length, 0);
        bruto = buf.toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch { return []; }
    const linhas = bruto.split('\n').filter(Boolean).flatMap((l) => {
      try { const v = JSON.parse(l) as unknown; return v && typeof v === 'object' && !Array.isArray(v) ? [v as Record<string, unknown>] : []; }
      catch { return []; }
    });
    // S-g do CHECK 2: o corte no teto vai ao ledger, nao some calado.
    if (tamanho > TETO_DO_RELATORIO_BYTES) {
      linhas.push({ tipo: 'peca', peca: 'relatorio', estado: 'fallback',
        motivo: `o relatorio da rodada passou do teto de ${TETO_DO_RELATORIO_BYTES} bytes (${tamanho} bytes)`, fallback: 'so as linhas ate o teto' });
    }
    return linhas;
  }

  fechar(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

/**
 * As pecas que os comandos da rodada contaram no relatorio (D8), cada uma uma vez (dois processos que relatam o mesmo).
 * Linha que nao e peca, ou peca com estado desconhecido, fica de fora: o relatorio e evidencia, nao veredito.
 */
export function pecasDoRelatorio(linhas: Array<Record<string, unknown>>): PecaDoAgile[] {
  const vistas = new Set<string>();
  return linhas.filter((l) => l.tipo === 'peca' && typeof l.peca === 'string' && (l.estado === 'agile' || l.estado === 'fallback'))
    .map((l) => ({ peca: l.peca as string, estado: l.estado as 'agile' | 'fallback',
      ...(typeof l.motivo === 'string' ? { motivo: l.motivo } : {}), ...(typeof l.fallback === 'string' ? { fallback: l.fallback } : {}) }))
    .filter((p) => { const chave = JSON.stringify(p); if (vistas.has(chave)) return false; vistas.add(chave); return true; });
}

/** A peca de quem roda com executor injetado (MCP, testes): o ambiente da rodada nao chega aos comandos (A6 do CHECK). */
export const PECA_SEM_RELATORIO: PecaDoAgile = { peca: 'relatorio', estado: 'fallback',
  motivo: 'executor injetado (MCP ou teste): o ambiente da rodada nao chega aos comandos',
  fallback: 'sem as pecas do preparo e da varredura e sem as listas das lanes no ledger' };

/** A lista de arquivos de cada lane, como o relatorio contou (D8): contagem e sha256 da lista ordenada. */
export function listasDasLanes(linhas: Array<Record<string, unknown>>): Array<{ lane: string; arquivos: string[]; sha256: string }> {
  return linhas.filter((l) => l.tipo === 'lista' && typeof l.lane === 'string' && Array.isArray(l.arquivos))
    .map((l) => {
      const arquivos = (l.arquivos as unknown[]).filter((a): a is string => typeof a === 'string').sort();
      return { lane: l.lane as string, arquivos, sha256: createHash('sha256').update(arquivos.join('\n')).digest('hex') };
    });
}
