/**
 * RM-072 (D3 a D8 da ork-check5x): o motor do Agile Check no verify.
 *
 * O Agile roda a mesma cobertura do Classic com menos repeticao e menos serie:
 *
 *   - o preparo do Agile (`check.agile.preparo`, como o `tsgo` deste projeto) e, se ele falhar ou nao existir, o
 *     `verify.preparo`, com a peca `preparo` em fallback;
 *   - quando ha lanes, elas rodam antes das claims; `node --test` dos mesmos arquivos, HEAD e ambiente usa o resultado
 *     nominal da lane, enquanto comando aberto ou evidencia divergente roda inteiro; se uma claim posterior mudar o
 *     produto, preparo e grupo rodam outra vez sobre o produto final;
 *   - as demais claims, uma por vez, contra o produto do preparo: a claim que comeca pelos passos do `verify.preparo` roda sem
 *     eles quando a guarda vale (o preparo passou, a arvore e a mesma do fim do preparo e o hash dos caminhos de
 *     `check.agile.produto` tambem); qualquer divergencia roda o comando inteiro, e o motivo vai ao ledger. Passo no meio
 *     da cadeia so sai quando tudo antes dele e uma leitura `grep -q` fechada; qualquer outro elo pode mudar a entrada do
 *     build (como o mutante que edita o fonte e compila), entao a cadeia fica inteira. Quando
 *     so o produto mudou (a claim anterior compilou de novo no meio da cadeia), o preparo roda de novo antes da proxima
 *     claim que o reaproveitaria, ate `MAXIMO_DE_PREPAROS_REFEITOS` vezes, e uma vez depois das claims se elas mudarem o produto, com a peca
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
import { planejarCpuDoGrupo } from './agendador-cpu';
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
  /** Papel usado pelo agendador de CPU do auxiliar. */
  papelCpu?: 'hermetica' | 'integracao' | 'varredura' | 'outro';
}

/** Quantas ferramentas cabem na fatia de duas CPUs reservada pelo plano paralelo. */
export function paralelismoDaVarreduraNoGrupo(cpus = os.availableParallelism()): number {
  return planejarCpuDoGrupo(cpus, { carga1: 0, stealPct: 0 }).ferramentasDaVarredura;
}

/** Roda os comandos do grupo e devolve os resultados na mesma ordem. */
export interface ExecutorDeGrupo {
  (itens: ItemDoGrupo[], cwd: string): ResultadoDeComando[];
  /** Pecas descobertas pelo auxiliar depois da sonda de CPU. */
  pecas?: PecaDoAgile[];
}

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

/** Palavras de um comando simples, sem operadores ou expansoes do shell. */
function palavrasDoComando(comando: string): string[] | null {
  const palavras: string[] = [];
  let atual = '', aspas: "'" | '"' | null = null, escape = false;
  const fechar = (): void => { if (atual !== '') palavras.push(atual); atual = ''; };
  for (const c of comando) {
    if (escape) { atual += c; escape = false; continue; }
    if (c === '\\' && aspas !== "'") { escape = true; continue; }
    if (aspas) { if (c === aspas) aspas = null; else if (aspas === '"' && (c === '$' || c === '`')) return null; else atual += c; continue; }
    if (c === "'" || c === '"') { aspas = c; continue; }
    if (/\s/.test(c)) { fechar(); continue; }
    if (';&|<>$`(){}'.includes(c)) return null;
    atual += c;
  }
  if (escape || aspas) return null;
  fechar();
  return palavras;
}

/** Uma leitura sem efeito colateral aceita antes do preparo unico. */
function comandoGrepQ(comando: string): boolean {
  const palavras = palavrasDoComando(comando);
  if (!palavras || palavras[0] !== 'grep' || palavras[1] !== '-q') return false;
  const argumentos = palavras[2] === '--' ? palavras.slice(3) : palavras.slice(2);
  return argumentos.length === 2 && argumentos[0] !== '' && argumentos[1] !== '' && !argumentos[1].startsWith('-');
}

/**
 * Tira passos exatos do preparo que aparecem depois apenas de `grep -q`. A leitura nao altera a entrada do build;
 * qualquer outro elo antes do preparo conserva a regra antiga e faz a cadeia rodar inteira.
 */
export function tirarPassosDoPreparoAposLeituras(comando: string, passosDoPreparo: readonly string[]):
  { passos: string[]; resto: string } {
  const elos = elosDoComando(comando);
  if (!elos) return { passos: [], resto: comando.trim() };
  const passos: string[] = [];
  const resto: string[] = [];
  let somenteLeiturasAntes = true;
  for (const elo of elos) {
    if (somenteLeiturasAntes && passosDoPreparo.includes(elo)) { passos.push(elo); continue; }
    resto.push(elo);
    if (!comandoGrepQ(elo)) somenteLeiturasAntes = false;
  }
  return passos.length > 0 ? { passos, resto: resto.join(SEPARADOR) } : { passos: [], resto: comando.trim() };
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
    const daFrente = tirarPassosDoPreparo(comando, passosDoPreparo);
    const { passos, resto } = daFrente.passos.length > 0 ? daFrente : tirarPassosDoPreparoAposLeituras(comando, passosDoPreparo);
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
 * O relogio sob steal so vale quando toda lane que caiu caiu so nele, e a pior causa so vale sem falha de verdade.
 *
 * RM-074 (F4): a lane que nao terminou sozinha fora do tempo (sinal, comando ausente, o codigo de quem nao a deixou
 * terminar, de 124 em diante antes do prazo de fora) da ao `test` o codigo dela, e o `test` segue com veredito, como o
 * comando unico do Classic que terminasse assim: no verify ele e comparado com a baseline (regressao, ja falhava ou falha
 * sem baseline), e na baseline ele e `sem-veredito`, porque o codigo nao e da propria lane, em qualquer ordem das lanes;
 * com falha de verdade junto, a causa, os testes e o trecho continuam os dela. So a lane que nao rodou (`executado`
 * falso, como o comando que o Classic nao lancou) deixa o `test` sem veredito inteiro. O caso por tempo segue o de antes
 * (N1 do CHECK 2 e N6 do CHECK 4): o estouro ou o relogio de uma lane junto de falha de verdade de outra tambem deixa o
 * `test` sem veredito inteiro, e as caidas so por tempo dao o agregado por tempo.
 */
export function testDasLanes(lanes: Array<{ lane: string; resultado: ResultadoDeComando }>): ResultadoDeComando {
  const caidas = lanes.filter((l) => !l.resultado.ok);
  const deVerdade = caidas.filter((l) => caiuDeVerdade(l.resultado));
  const semVeredito = caidas.filter((l) => !caiuDeVerdade(l.resultado));
  const porTempo = (r: ResultadoDeComando): boolean => r.causa === 'timeout' || (r.relogioSobSteal?.length ?? 0) > 0;
  // RM-074 (F4): a lane sem veredito fora do tempo da o codigo ao `test`, que o verify compara com a baseline.
  const foraDoTempo = semVeredito.filter((l) => !porTempo(l.resultado));
  const tempoComFalha = deVerdade.length > 0 && semVeredito.some((l) => porTempo(l.resultado));
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
    code: (foraDoTempo[0] ?? deVerdade[0] ?? caidas[0])?.resultado.code ?? 0,
    resumo: (caidas.length ? caidas : lanes).map((l) => `[${l.lane}] ${l.resultado.resumo}`).join('\n').slice(-800),
    ...(causa ? { causa } : {}),
    prazoMs: Math.max(...lanes.map((l) => l.resultado.prazoMs ?? 0)),
    duracaoMs: Math.max(...lanes.map((l) => l.resultado.duracaoMs ?? 0)),
    executado: !tempoComFalha && lanes.every((l) => l.resultado.executado !== false),
    ...(testes.length ? { testeQueCaiu: testes } : {}),
    ...(falhas.length ? { falhasDeTeste: falhas } : {}),
    ...(trechos.length ? { trecho: trechos.join('\n').slice(0, 1024) } : {}),
    ...(lanes.some((l) => l.resultado.stealPct !== undefined) ? { stealPct: lanes.find((l) => l.resultado.stealPct !== undefined)!.resultado.stealPct } : {}),
    ...(relogio.length ? { relogioSobSteal: relogio } : {}),
    lanes: lanes.map((l) => ({ lane: l.lane, comando: l.resultado.comando, ok: l.resultado.ok, code: l.resultado.code,
      ...(l.resultado.causa ? { causa: l.resultado.causa } : {}), duracaoMs: l.resultado.duracaoMs ?? 0,
      ...(l.resultado.testeQueCaiu?.length ? { testeQueCaiu: l.resultado.testeQueCaiu } : {}) })),
  };
}

/**
 * RM-074 (F4): por que cada lane caida do `test` ficou como ficou, para o texto do gate dizer qual lane ficou sem veredito
 * e por que. Le so o que o ledger grava da lane (codigo e causa); o relogio sob steal vem do agregado, que so o traz quando
 * toda lane caida caiu so nele. Vazio fora do Agile (sem lanes) e com todas as lanes ok.
 */
export function porQueDasLanes(c: ResultadoDeComando): string {
  const caidas = (c.lanes ?? []).filter((l) => !l.ok);
  const porque = (l: NonNullable<ResultadoDeComando['lanes']>[number]): string => {
    if (l.causa === 'timeout') return 'estourou o prazo';
    if (l.causa === 'nao-encontrado') return `comando nao encontrado (codigo ${l.code})`;
    if (l.code === -1) return 'sem codigo de saida: nao rodou, ou o auxiliar do grupo morreu antes de gravar o resultado';
    if (l.causa === 'sinal') return `morta por sinal (codigo ${l.code})`;
    if (c.relogioSobSteal?.length) return `caiu so em teste com relogio sob steal (${c.relogioSobSteal.join(', ')})`;
    if (Number.isInteger(l.code) && l.code >= 1 && l.code <= MAIOR_CODIGO_DA_LANE) return `caiu com o codigo ${l.code}`;
    return `saiu com ${l.code}, o codigo de quem nao a deixou terminar`;
  };
  return caidas.map((l) => `lane ${l.lane}: ${porque(l)}`).join('; ');
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
        if (depoisDaVarredura.has(lane)) encadeados.push({ nome: `test:${lane}`, comando, apos: ['security_scan'], papelCpu: 'integracao' });
        else itens.push({ nome: `test:${lane}`, comando, papelCpu: lane === 'hermetica' ? 'hermetica' : 'outro' });
      }
    } else itens.push({ nome: c.nome, comando: c.comando, papelCpu: c.nome === 'security_scan' ? 'varredura' : 'outro' });
  }
  itens.push(...encadeados);
  const resultados = itens.length > 1 ? grupo(itens, cwd) : itens.map((i) => executor(i.nome, i.comando, cwd));
  pecas.push(...(grupo.pecas ?? []));
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

export interface ResultadoNominalDaLane {
  lane: string;
  head: string;
  ambiente: string;
  testes: Array<{ arquivo: string; nome: string; nesting: number; estado: 'pass' | 'fail' | 'skip' | 'todo' }>;
}

/** Evidencia nominal produzida pelo reporter, sem confiar em campos abertos do JSONL. */
export function resultadosDasLanes(linhas: Array<Record<string, unknown>>): ResultadoNominalDaLane[] {
  return linhas.filter((l) => l.tipo === 'resultados' && typeof l.lane === 'string' && typeof l.head === 'string'
      && typeof l.ambiente === 'string' && Array.isArray(l.testes))
    .map((l) => ({ lane: l.lane as string, head: l.head as string, ambiente: l.ambiente as string,
      testes: (l.testes as unknown[]).flatMap((t) => {
        if (!t || typeof t !== 'object' || Array.isArray(t)) return [];
        const x = t as Record<string, unknown>;
        if (typeof x.arquivo !== 'string' || typeof x.nome !== 'string' || !Number.isInteger(x.nesting)
          || !['pass', 'fail', 'skip', 'todo'].includes(String(x.estado))) return [];
        return [{ arquivo: x.arquivo, nome: x.nome, nesting: x.nesting as number,
          estado: x.estado as 'pass' | 'fail' | 'skip' | 'todo' }];
      }) }));
}

/** Hash do ambiente funcional; transporte do CHECK, npm e bookkeeping do shell nao mudam o teste. */
export function assinaturaDoAmbiente(env: NodeJS.ProcessEnv): string {
  const ignorada = (nome: string): boolean => nome.startsWith('npm_') || nome.startsWith('NPM_')
    || ['ORK_CHECK_RELATORIO', 'ORK_CHECK_CPUS_DA_LANE', 'ORK_CHECK_CPUS_DA_LANE_APOS_RESERVA', 'ORK_CHECK_RESERVA_DEVOLVIDA',
      'ORK_CHECK_CPUS_DOCKER',
      'NODE_TEST_CONTEXT', 'NODE_COMPILE_CACHE', 'PWD', 'OLDPWD', 'SHLVL', '_', 'INIT_CWD'].includes(nome);
  const pares = Object.entries(env).filter(([nome, valor]) => valor !== undefined && !ignorada(nome))
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(pares)).digest('hex');
}

interface ComandoNodeTest { arquivos: string[]; padrao?: string }

/** Le somente a gramatica aceita para reaproveitar: `node --test [--test-name-pattern P] arquivo...`. */
function comandoNodeTest(comando: string, cwd: string): ComandoNodeTest | null {
  const palavras = palavrasDoComando(comando);
  if (!palavras) return null;
  if (palavras[0] !== 'node' || palavras[1] !== '--test') return null;
  let padrao: string | undefined;
  const arquivos: string[] = [];
  for (let i = 2; i < palavras.length; i++) {
    const p = palavras[i];
    if (p === '--test-name-pattern') { if (padrao !== undefined || !palavras[++i]) return null; padrao = palavras[i]; continue; }
    if (p.startsWith('--test-name-pattern=')) { if (padrao !== undefined) return null; padrao = p.slice('--test-name-pattern='.length); continue; }
    if (p.startsWith('-') || /[*?\[]/.test(p)) return null;
    const absoluto = path.resolve(cwd, p);
    const relativo = path.relative(path.join(cwd, 'core', 'dist-test', 'test'), absoluto);
    if (!relativo || relativo.startsWith('..') || path.isAbsolute(relativo) || relativo !== path.basename(relativo)
      || !relativo.endsWith('.test.js')) return null;
    arquivos.push(path.basename(absoluto));
  }
  if (padrao !== undefined) {
    try { void new RegExp(padrao); } catch { return null; }
  }
  return arquivos.length > 0 ? { arquivos: [...new Set(arquivos)], ...(padrao !== undefined ? { padrao } : {}) } : null;
}

interface AuditoriaTap { pedido: ComandoNodeTest; prefixo: string; minimo: number }

/** A forma fechada usada pelas claims para provar contagem, zero falhas e zero skips no TAP. */
function auditoriaTap(comando: string, cwd: string): AuditoriaTap | null {
  const divisor = ' | ';
  const i = comando.indexOf(divisor);
  if (i < 0 || comando.indexOf(divisor, i + divisor.length) >= 0) return null;
  const node = comando.slice(0, i).trim();
  const awk = comando.slice(i + divisor.length).trim();
  const pedido = comandoNodeTest(node.replace(/^node --test-reporter=tap\b/, 'node --test'), cwd);
  if (!pedido || pedido.arquivos.length !== 1 || pedido.padrao !== undefined) return null;
  const m = /^awk '\/\^ \*not ok\/{f\+\+} \/# SKIP\/{s\+\+} \/\^ \*ok \[0-9\]\+ - ([A-Z][A-Z0-9_-]*)\[0-9\]\+:\/{p\+\+} END\{exit !\(p>=([1-9][0-9]*) && f==0 && s==0\)\}'$/.exec(awk);
  return m ? { pedido, prefixo: m[1], minimo: Number(m[2]) } : null;
}

function resultadoReaproveitado(nome: string, comando: string, pedido: ComandoNodeTest, usadas: ResultadoNominalDaLane[],
  esperado: { head: string; ambiente: string }, nomes?: string[]): ResultadoDeComando {
  const lanes = [...new Set(usadas.filter((e) => e.testes.some((t) => pedido.arquivos.includes(t.arquivo))).map((e) => e.lane))];
  return { nome, comando, ok: true, code: 0, causa: 'exit', duracaoMs: 0, executado: true,
    resumo: `reaproveitado das lanes ${lanes.join(', ')} desta rodada`,
    lane: { reaproveitada: true, lanes, arquivos: pedido.arquivos,
      nomes: nomes ?? (pedido.padrao === undefined ? pedido.arquivos.map((a) => `${a}:todos`) : pedido.arquivos.map((a) => `${a}:/${pedido.padrao}/`)),
      head: esperado.head, ambiente: esperado.ambiente } };
}

/**
 * Reaproveita uma claim somente quando a lane terminou todos os arquivos pedidos no mesmo HEAD e ambiente. Um arquivo
 * inteiro verde e evidencia mais forte que `--test-name-pattern`: o padrao fica registrado em `nomes`.
 */
export function executorDaClaimPelasLanes(base: ExecutorUnico, evidencias: ResultadoNominalDaLane[], esperado: {
  head: string; ambiente: NodeJS.ProcessEnv; podeReaproveitar?: () => boolean; executorEquivalente?: ExecutorUnico;
}): ExecutorUnico {
  const assinatura = assinaturaDoAmbiente(esperado.ambiente);
  return (nome, comando, cwd) => {
    const executar = esperado.executorEquivalente ?? base;
    if (esperado.podeReaproveitar?.() === false) return executar(nome, comando, cwd);
    const elos = elosDoComando(comando);
    if (!elos) return base(nome, comando, cwd);
    const planejados: Array<{ tipo: 'grep'; comando: string } | { tipo: 'lane'; resultado: ResultadoDeComando }> = [];
    for (const elo of elos) {
      if (comandoGrepQ(elo)) { planejados.push({ tipo: 'grep', comando: elo }); continue; }
      const tap = auditoriaTap(elo, cwd);
      const pedido = tap?.pedido ?? comandoNodeTest(elo, cwd);
      if (!pedido) return base(nome, comando, cwd);
      const usadas = evidencias.filter((e) => e.head === esperado.head && e.ambiente === assinatura
        && e.testes.some((t) => pedido.arquivos.includes(t.arquivo)));
      const cobertos = pedido.arquivos.every((arquivo) => {
        const vistos = usadas.flatMap((e) => e.testes.filter((t) => t.arquivo === arquivo));
        if (vistos.length === 0 || vistos.some((t) => t.estado === 'fail')) return false;
        if (vistos.some((t) => t.estado === 'skip' || t.estado === 'todo')) return false;
        if (!tap) return true;
        const doArquivo = vistos.filter((t) => t.nesting === 0);
        return doArquivo.filter((t) => t.estado === 'pass' && new RegExp(`^${tap.prefixo}[0-9]+:`).test(t.nome)).length >= tap.minimo;
      });
      if (!cobertos) return executar(nome, comando, cwd);
      const nomes = tap ? pedido.arquivos.map((a) => `${a}:${tap.prefixo}>=${tap.minimo};sem-falha;sem-skip`) : undefined;
      planejados.push({ tipo: 'lane', resultado: resultadoReaproveitado(nome, elo, pedido, usadas,
        { head: esperado.head, ambiente: assinatura }, nomes) });
    }
    let duracaoMs = 0;
    const resumos: string[] = [];
    let ultimo: ResultadoDeComando | null = null;
    const lanes = new Set<string>(), arquivos = new Set<string>(), nomes = new Set<string>();
    for (const item of planejados) {
      const r = item.tipo === 'grep' ? base(nome, item.comando, cwd) : item.resultado;
      duracaoMs += r.duracaoMs ?? 0;
      resumos.push(r.resumo);
      ultimo = r;
      if (!r.ok) return { ...r, comando, comandoExecutado: item.tipo === 'grep' ? item.comando : r.comando, duracaoMs };
      for (const lane of r.lane?.lanes ?? []) lanes.add(lane);
      for (const arquivo of r.lane?.arquivos ?? []) arquivos.add(arquivo);
      for (const n of r.lane?.nomes ?? []) nomes.add(n);
    }
    if (!ultimo || lanes.size === 0) return base(nome, comando, cwd);
    return { ...ultimo, nome, comando, duracaoMs, resumo: resumos.filter(Boolean).join('\n'),
      lane: { reaproveitada: true, lanes: [...lanes], arquivos: [...arquivos], nomes: [...nomes], head: esperado.head, ambiente: assinatura } };
  };
}
