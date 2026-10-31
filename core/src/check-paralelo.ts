/**
 * RM-072 (D6 da ork-check5x): o grupo paralelo do Agile Check sem mudar a assinatura do `verificar`.
 *
 * O `verificar` e sincrono e tem varios chamadores (CLI, MCP, ship, fix, retry, ci, noctum). Para rodar as lanes de teste
 * e a varredura ao mesmo tempo, o verify chama este modulo com `spawnSync` como processo auxiliar: ele lanca cada
 * comando ao mesmo tempo, cada um com o mesmo `timeout(1)` do `executar` (o estouro leva o grupo de processos inteiro),
 * grava a saida de cada um num arquivo e espera todos. O pai le os arquivos e monta cada resultado pela mesma funcao do
 * `executar`. O ambiente vem do pai, ja sem `ORK_HITL_*`; cada item so acrescenta variaveis sem segredo (o modo, o
 * relatorio do CHECK, o prazo interno do scan). O item que nomeia outros em `apos` so comeca quando eles terminam (a lane
 * de integracao depois da varredura), e `maxParalelo` limita quantos rodam ao mesmo tempo.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ENV_CONTAINERS_DA_LANE, ENV_CPUS_DA_LANE, ENV_CPUS_DA_LANE_APOS_RESERVA, ENV_CPUS_DA_LANE_APOS_VARREDURA,
  ENV_CPUS_DOCKER, ENV_SINAL_DA_RESERVA,
  medirCpuDoGrupo, MedicaoCpuDaIntegracao, MedicaoCpuDoGrupo, PlanoCpuDoGrupo, planejarCpuDoGrupo } from './agendador-cpu';

const TIMEOUT_BIN = '/usr/bin/timeout';
const NICE_BIN = '/usr/bin/nice';
const TIME_BIN = '/usr/bin/time';
const CONTRATO_PERFIL_INTEGRACAO = 'ork.check.cpu-integracao/v1';
const INTERVALO_CPU_MS = 100;

/** Um comando do grupo. */
export interface ItemParalelo {
  nome: string;
  comando: string;
  cwd: string;
  prazoMs: number;
  /** Variaveis acrescentadas ao ambiente do pai (nunca segredo: vao ao arquivo da especificacao). */
  ambiente?: Record<string, string>;
  /** Prioridade menor para este comando (`nice`), quando a maquina tem o binario. */
  nice?: number;
  /** Os itens (pelo nome, antes deste na lista) que precisam terminar antes de este comecar, com ou sem sucesso. */
  apos?: string[];
  /** Papel na conta de CPU do grupo do Agile. Ausente nos outros usos deste auxiliar. */
  papelCpu?: 'hermetica' | 'integracao' | 'varredura' | 'outro';
  /**
   * RM-074 (F4): o programa e os argumentos, lancados sem shell; com eles, `comando` so identifica o item. Sem eles, o
   * `comando` roda por `bash -c`, como as lanes e a varredura do manifesto.
   */
  argv?: string[];
}

/** O que o processo devolveu, na forma do `exec` de `util.ts`. */
export interface ProcessoDoGrupo {
  nome: string;
  ok: boolean;
  code: number;
  signal: string | null;
  error?: string;
  stdout: string;
  stderr: string;
  duracaoMs: number;
  comGrupo: boolean;
  /** O auxiliar morreu antes de gravar o resultado: o comando nao tem veredito (pode ter rodado pela metade). */
  semResultado?: boolean;
}

export type ProcessosDoGrupo = ProcessoDoGrupo[] & { agendamentoCpu?: PlanoCpuDoGrupo };

interface Especificacao {
  itens: ItemParalelo[];
  dir: string;
  maxParalelo?: number;
  cpus?: number;
  /** Injecao deterministica dos testes; em producao a sonda le `/proc`. */
  medicaoCpu?: MedicaoCpuDoGrupo;
}
interface Terminado { nome: string; code: number | null; signal: string | null; error?: string; duracaoMs: number; comGrupo: boolean;
  medicaoCpu?: MedicaoCpuDaIntegracao }

interface PerfilCpuIntegracao {
  contrato: typeof CONTRATO_PERFIL_INTEGRACAO;
  chave: string;
  cpus: number;
  picoCpus: number;
  completa: boolean;
  medidoEm: string;
}

/** O argv de um item: `nice` (se pedido e existir), `timeout(1)` (se existir) e o `argv` do item ou `bash -c`. */
export function argvDoItem(item: ItemParalelo, comGrupo = fs.existsSync(TIMEOUT_BIN), comNice = fs.existsSync(NICE_BIN)): string[] {
  const programa = item.argv?.length ? item.argv : ['bash', '-c', item.comando];
  const base = comGrupo ? [TIMEOUT_BIN, '--kill-after=15', `${Math.ceil(item.prazoMs / 1000)}`, ...programa] : programa;
  return item.nice && comNice ? [NICE_BIN, '-n', String(item.nice), ...base] : base;
}

/** As vagas do grupo: no maximo `max` comandos ao mesmo tempo, na ordem em que pediram. */
function vagas(max: number): { tomar: () => Promise<void>; soltar: () => void } {
  let livres = max;
  const fila: Array<() => void> = [];
  return {
    tomar: () => new Promise<void>((pronto) => { if (livres > 0) { livres--; pronto(); } else fila.push(pronto); }),
    soltar: () => { const proximo = fila.shift(); if (proximo) proximo(); else livres++; },
  };
}

function arquivoDoPerfilIntegracao(): string {
  const base = process.env.XDG_CACHE_HOME && path.isAbsolute(process.env.XDG_CACHE_HOME)
    ? process.env.XDG_CACHE_HOME : path.join(os.homedir(), '.cache');
  return path.join(base, 'orkastery', 'check', 'cpu-integracao.json');
}

/** A medida so atravessa rodadas quando comando, capacidade e entradas que definem a lane continuam iguais. */
function chaveDoPerfilIntegracao(itens: ItemParalelo[], cpus: number): string | null {
  const integracao = itens.filter((i) => i.papelCpu === 'integracao');
  if (!integracao.length) return null;
  const h = createHash('sha256').update(JSON.stringify({ cpus, node: process.version,
    comandos: integracao.map((i) => i.comando) }));
  const cwd = integracao[0].cwd;
  for (const relativo of ['core/dist/integracoes-locais.js', 'core/scripts/test-lanes.cjs']) {
    try { h.update(relativo).update(fs.readFileSync(path.join(cwd, relativo))); }
    catch { h.update(`${relativo}:ausente`); }
  }
  return h.digest('hex');
}

function lerPerfilIntegracao(chave: string | null, cpus: number): PerfilCpuIntegracao | null {
  if (!chave) return null;
  try {
    const p = JSON.parse(fs.readFileSync(arquivoDoPerfilIntegracao(), 'utf8')) as PerfilCpuIntegracao;
    return p?.contrato === CONTRATO_PERFIL_INTEGRACAO && p.chave === chave && p.cpus === cpus && p.completa
      && Number.isFinite(p.picoCpus) && p.picoCpus > 0 ? p : null;
  } catch { return null; }
}

function gravarPerfilIntegracao(chave: string | null, cpus: number, medicao: MedicaoCpuDaIntegracao): void {
  if (!chave || !medicao.completa || medicao.picoCpus === null || !(medicao.picoCpus > 0)) return;
  const arquivo = arquivoDoPerfilIntegracao();
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const temporario = `${arquivo}.${process.pid}.tmp`;
    const perfil: PerfilCpuIntegracao = { contrato: CONTRATO_PERFIL_INTEGRACAO, chave, cpus,
      picoCpus: medicao.picoCpus, completa: true, medidoEm: new Date().toISOString() };
    fs.writeFileSync(temporario, JSON.stringify(perfil) + '\n', { mode: 0o600 });
    fs.renameSync(temporario, arquivo);
  } catch { /* cache de desempenho ausente conserva a reserva; nunca derruba o CHECK */ }
}

const CLK_TCK = (() => {
  const r = spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 1000 });
  const n = Number(r.stdout?.trim());
  return Number.isFinite(n) && n > 0 ? n : 100;
})();

interface ProcessoCpu { ppid: number; cpuMs: number; inicio: string }

function processosCpu(): Map<number, ProcessoCpu> {
  const tabela = new Map<number, ProcessoCpu>();
  let nomes: string[] = [];
  try { nomes = fs.readdirSync('/proc'); } catch { return tabela; }
  for (const nome of nomes) {
    if (!/^\d+$/.test(nome)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${nome}/stat`, 'utf8');
      const depois = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
      tabela.set(Number(nome), { ppid: Number(depois[1]), cpuMs: (Number(depois[11]) + Number(depois[12])) * 1000 / CLK_TCK,
        inicio: depois[19] });
    } catch { /* acabou entre a lista e a leitura */ }
  }
  return tabela;
}

function arvoreDeProcessos(raiz: number, tabela: Map<number, ProcessoCpu>): number[] {
  const filhos = new Map<number, number[]>();
  for (const [pid, p] of tabela) { const lista = filhos.get(p.ppid) ?? []; lista.push(pid); filhos.set(p.ppid, lista); }
  const vistos = new Set<number>(), pilha = [raiz];
  while (pilha.length) {
    const pid = pilha.pop()!;
    if (vistos.has(pid)) continue;
    vistos.add(pid);
    pilha.push(...(filhos.get(pid) ?? []));
  }
  return [...vistos];
}

function nomesDosContainers(arquivo: string): string[] {
  try {
    return [...new Set(fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean).flatMap((linha) => {
      try { const r = JSON.parse(linha) as { nome?: unknown }; return typeof r.nome === 'string' ? [r.nome] : []; }
      catch { return []; }
    }))];
  } catch { return []; }
}

function arquivoCpuDoContainer(nome: string): { arquivo: string; divisor: number } | null {
  const r = spawnSync('docker', ['inspect', '--format', '{{.State.Pid}}', nome], { encoding: 'utf8', timeout: 1000 });
  const pid = Number(r.stdout?.trim());
  if (r.status !== 0 || !Number.isInteger(pid) || pid <= 0) return null;
  let linhas = '';
  try { linhas = fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8'); } catch { return null; }
  const unificado = /^0::(.+)$/m.exec(linhas)?.[1];
  if (unificado) return { arquivo: path.join('/sys/fs/cgroup', unificado, 'cpu.stat'), divisor: 1000 };
  const legado = /^(?:\d+):[^\n]*(?:cpuacct|cpu)[^\n]*:(.+)$/m.exec(linhas)?.[1];
  return legado ? { arquivo: path.join('/sys/fs/cgroup/cpuacct', legado, 'cpuacct.usage'), divisor: 1_000_000 } : null;
}

function lerCpuDoCgroup(fonte: { arquivo: string; divisor: number }): number | null {
  try {
    const texto = fs.readFileSync(fonte.arquivo, 'utf8');
    const bruto = fonte.arquivo.endsWith('cpu.stat') ? Number(/^usage_usec\s+(\d+)$/m.exec(texto)?.[1]) : Number(texto.trim());
    return Number.isFinite(bruto) && bruto >= 0 ? bruto / fonte.divisor : null;
  } catch { return null; }
}

/** CPU acumulada e pico por janela da integracao; nomes registrados mas nunca observados tornam a medida incompleta. */
function sondarCpuDaIntegracao(pid: number, registro: string): { amostrar: () => void; fechar: (arvoreMs: number, paredeMs: number) => MedicaoCpuDaIntegracao } {
  const processos = new Map<string, number>();
  const fontes = new Map<string, { arquivo: string; divisor: number }>();
  const containers = new Map<string, number>();
  let anterior: { em: number; total: number } | null = null;
  let pico = 0;
  const amostrar = () => {
    const tabela = processosCpu();
    for (const p of arvoreDeProcessos(pid, tabela)) {
      const x = tabela.get(p);
      if (x) processos.set(`${p}:${x.inicio}`, Math.max(processos.get(`${p}:${x.inicio}`) ?? 0, x.cpuMs));
    }
    for (const nome of nomesDosContainers(registro)) {
      const fonte = fontes.get(nome) ?? arquivoCpuDoContainer(nome);
      if (fonte) fontes.set(nome, fonte);
      const cpu = fonte ? lerCpuDoCgroup(fonte) : null;
      if (cpu !== null) containers.set(nome, Math.max(containers.get(nome) ?? 0, cpu));
    }
    const agora = Date.now();
    const total = [...processos.values()].reduce((a, b) => a + b, 0) + [...containers.values()].reduce((a, b) => a + b, 0);
    if (anterior && agora > anterior.em) pico = Math.max(pico, (total - anterior.total) / (agora - anterior.em));
    anterior = { em: agora, total };
  };
  return {
    amostrar,
    fechar: (arvoreMs, paredeMs) => {
      amostrar();
      const nomes = nomesDosContainers(registro);
      const containersMs = [...containers.values()].reduce((a, b) => a + b, 0);
      const ausentes = nomes.filter((nome) => !containers.has(nome));
      return { arvoreMs, containersMs, totalMs: arvoreMs + containersMs, paredeMs,
        picoCpus: pico > 0 ? Math.ceil(pico * 100) / 100 : null, completa: ausentes.length === 0,
        containers: nomes, ausentes };
    },
  };
}

/**
 * O lado do auxiliar: lanca cada item quando os de `apos` terminam e ha vaga, espera todos e grava `resultado.json` ao
 * lado das saidas.
 */
async function rodarEspecificacao(esp: Especificacao): Promise<void> {
  const comGrupo = fs.existsSync(TIMEOUT_BIN);
  const usaAgendador = esp.itens.some((i) => i.papelCpu === 'hermetica');
  const cpus = esp.cpus ?? os.availableParallelism();
  const chaveDoPerfil = usaAgendador ? chaveDoPerfilIntegracao(esp.itens, cpus) : null;
  const perfil = esp.medicaoCpu?.cpusIntegracao === undefined ? lerPerfilIntegracao(chaveDoPerfil, cpus) : null;
  const medicao = esp.medicaoCpu ?? await medirCpuDoGrupo();
  if (perfil) Object.assign(medicao, { cpusIntegracao: perfil.picoCpus, fonteCpusIntegracao: 'medida' as const });
  else if (medicao.cpusIntegracao === undefined) Object.assign(medicao, { cpusIntegracao: null, fonteCpusIntegracao: 'conservadora' as const });
  const plano = usaAgendador ? planejarCpuDoGrupo(cpus, medicao) : undefined;
  const sinalDaReserva = plano && !plano.saturado ? path.join(esp.dir, 'reserva-devolvida.json') : undefined;
  const itens = plano ? aplicarPlano(esp.itens, plano, sinalDaReserva) : esp.itens;
  const limite = vagas(esp.maxParalelo && esp.maxParalelo > 0 ? esp.maxParalelo : itens.length);
  const porNome = new Map<string, Promise<Terminado>>();
  const indice = new Map(itens.map((item, i) => [item.nome, i]));
  const vezDoItem = (item: ItemParalelo, i: number): Promise<Terminado> => {
    const existente = porNome.get(item.nome);
    if (existente) return existente;
    // O primeiro `then` deixa a promessa entrar no mapa antes de resolver dependencias; assim `apos` funciona mesmo
    // quando o plano põe uma dependencia que aparece depois na ordem canonica dos resultados.
    const vez = Promise.resolve().then(async () => {
      for (const nome of item.apos ?? []) {
        const j = indice.get(nome);
        if (j !== undefined) await vezDoItem(itens[j], j);
      }
      await limite.tomar();
      try { return await lancar(item, i); } finally { limite.soltar(); }
    });
    porNome.set(item.nome, vez);
    return vez;
  };
  const todos = Promise.all(itens.map(vezDoItem));
  const reservados = itens.filter((item) => item.papelCpu === 'varredura' || item.papelCpu === 'integracao');
  const devolverReserva = async (): Promise<void> => {
    if (!sinalDaReserva || !reservados.some((item) => item.papelCpu === 'varredura')
      || !reservados.some((item) => item.papelCpu === 'integracao')) return;
    const varreduras = reservados.filter((item) => item.papelCpu === 'varredura');
    const integracoes = reservados.filter((item) => item.papelCpu === 'integracao');
    const degrau = async (origem: 'varredura' | 'integracao', pecas: ItemParalelo[], vagas: number, antes: number) => {
      await Promise.all(pecas.map((item) => vezDoItem(item, indice.get(item.nome)!)));
      fs.appendFileSync(sinalDaReserva, JSON.stringify({ contrato: 'ork.check.reserva-devolvida/v2', origem,
        em: new Date().toISOString(), vagasGanhas: vagas - antes, vagas }) + '\n', { mode: 0o600 });
    };
    if (!plano!.integracaoEmParalelo) {
      await degrau('varredura', varreduras, plano!.cpusHermeticaAposVarredura, plano!.cpusHermetica);
      await degrau('integracao', integracoes, plano!.cpusHermeticaAposReserva, plano!.cpusHermeticaAposVarredura);
    } else {
      // As promessas escrevem em série no event loop; o primeiro término recebe somente a reserva da própria peça.
      let vagas = plano!.cpusHermetica;
      const aoTerminar = async (origem: 'varredura' | 'integracao', pecas: ItemParalelo[], libera: number) => {
        await Promise.all(pecas.map((item) => vezDoItem(item, indice.get(item.nome)!)));
        const antes = vagas;
        vagas = Math.min(plano!.cpus, vagas + libera);
        fs.appendFileSync(sinalDaReserva, JSON.stringify({ contrato: 'ork.check.reserva-devolvida/v2', origem,
          em: new Date().toISOString(), vagasGanhas: vagas - antes, vagas }) + '\n', { mode: 0o600 });
      };
      await Promise.all([aoTerminar('varredura', varreduras, plano!.cpusDaFatia),
        aoTerminar('integracao', integracoes, plano!.cpusIntegracao)]);
    }
  };
  const [, terminados] = await Promise.all([devolverReserva(), todos]);
  const medidaDaIntegracao = terminados.find((t) => t.medicaoCpu)?.medicaoCpu;
  if (plano && medidaDaIntegracao) {
    plano.medicaoCpuIntegracao = medidaDaIntegracao;
    gravarPerfilIntegracao(chaveDoPerfil, cpus, medidaDaIntegracao);
  }
  fs.writeFileSync(path.join(esp.dir, 'resultado.json'), JSON.stringify({ terminados, ...(plano ? { agendamentoCpu: plano } : {}) }), { mode: 0o600 });

  function lancar(item: ItemParalelo, i: number): Promise<Terminado> {
    return new Promise<Terminado>((resolve) => {
      const saida = fs.openSync(path.join(esp.dir, `${i}.out`), 'w', 0o600);
      const erro = fs.openSync(path.join(esp.dir, `${i}.err`), 'w', 0o600);
      const inicio = Date.now();
      const medirIntegracao = item.papelCpu === 'integracao';
      const registro = path.join(esp.dir, `${i}.containers.jsonl`);
      const tempo = path.join(esp.dir, `${i}.tempo`);
      if (medirIntegracao) fs.writeFileSync(registro, '', { mode: 0o600 });
      const base = argvDoItem(item, comGrupo);
      const medido = medirIntegracao && fs.existsSync(TIME_BIN)
        ? [TIME_BIN, '-f', '%U %S', '-o', tempo, ...base] : base;
      const [bin, ...args] = medido;
      let fim: Terminado | null = null;
      let sonda: ReturnType<typeof sondarCpuDaIntegracao> | null = null;
      let relogio: ReturnType<typeof setInterval> | null = null;
      const encerrar = (t: Terminado) => {
        if (fim) return;
        if (relogio) clearInterval(relogio);
        let arvoreMs = 0;
        if (medirIntegracao) {
          try { const [user, sys] = fs.readFileSync(tempo, 'utf8').trim().split(/\s+/).map(Number); arvoreMs = (user + sys) * 1000; }
          catch { /* medida incompleta abaixo */ }
        }
        const medicaoCpu = medirIntegracao && sonda ? sonda.fechar(arvoreMs, t.duracaoMs) : undefined;
        if (medicaoCpu && !(arvoreMs > 0)) medicaoCpu.completa = false;
        fim = { ...t, ...(medicaoCpu ? { medicaoCpu } : {}) };
        fs.closeSync(saida);
        fs.closeSync(erro);
        resolve(fim);
      };
      // Sem o `timeout(1)`, o proprio auxiliar mata pelo prazo, como o `spawnSync` do `exec` faria.
      const ambiente = { ...process.env, ...item.ambiente,
        ...(medirIntegracao ? { [ENV_CONTAINERS_DA_LANE]: registro } : {}) };
      const filho = spawn(bin, args, { cwd: item.cwd, env: ambiente, stdio: ['ignore', saida, erro],
        ...(comGrupo ? {} : { timeout: item.prazoMs, killSignal: 'SIGTERM' as const }) });
      if (medirIntegracao) {
        sonda = sondarCpuDaIntegracao(filho.pid!, registro);
        sonda.amostrar();
        relogio = setInterval(sonda.amostrar, INTERVALO_CPU_MS);
      }
      filho.on('error', (e: NodeJS.ErrnoException) => encerrar({ nome: item.nome, code: null, signal: null,
        error: e.code ?? e.message, duracaoMs: Date.now() - inicio, comGrupo }));
      filho.on('close', (code, signal) => encerrar({ nome: item.nome, code, signal,
        ...(!comGrupo && signal && Date.now() - inicio >= item.prazoMs ? { error: 'ETIMEDOUT' } : {}),
        duracaoMs: Date.now() - inicio, comGrupo }));
    });
  }
}

/** Aplica a mesma conta aos processos, as lanes e aos conteineres que eles criarem. */
function aplicarPlano(originais: ItemParalelo[], plano: PlanoCpuDoGrupo, sinalDaReserva?: string): ItemParalelo[] {
  const itens = originais.map((item) => ({ ...item, ambiente: { ...item.ambiente } }));
  const porPapel = (papel: ItemParalelo['papelCpu']): ItemParalelo[] => itens.filter((i) => i.papelCpu === papel);
  const hermetica = porPapel('hermetica')[0];
  const varredura = porPapel('varredura')[0];
  const integracoes = porPapel('integracao');
  const outros = porPapel('outro');
  const depender = (item: ItemParalelo | undefined, nomes: Array<string | undefined>): void => {
    if (!item) return;
    item.apos = [...new Set([...(item.apos ?? []), ...nomes.filter((n): n is string => !!n && n !== item.nome)])];
  };
  const ambiente = (item: ItemParalelo | undefined, valores: Record<string, string>): void => {
    if (item) item.ambiente = { ...item.ambiente, ...valores };
  };
  const cpusContainer = String(plano.cpusPorContainer);
  ambiente(hermetica, { [ENV_CPUS_DA_LANE]: String(plano.cpusHermetica), [ENV_CPUS_DOCKER]: cpusContainer,
    ...(sinalDaReserva && varredura && integracoes.length > 0 ? {
      [ENV_CPUS_DA_LANE_APOS_VARREDURA]: String(plano.cpusHermeticaAposVarredura),
      [ENV_CPUS_DA_LANE_APOS_RESERVA]: String(plano.cpusHermeticaAposReserva), [ENV_SINAL_DA_RESERVA]: sinalDaReserva,
    } : {}) });
  ambiente(varredura, {
    ORK_CHECK_VARREDURA_PARALELA: String(plano.ferramentasDaVarredura),
    [ENV_CPUS_DOCKER]: cpusContainer,
  });
  let anteriorIntegracao: string | undefined;
  for (const item of integracoes) {
    ambiente(item, { [ENV_CPUS_DA_LANE]: String(plano.cpusIntegracao), [ENV_CPUS_DOCKER]: cpusContainer });
    depender(item, [anteriorIntegracao ?? (plano.integracaoEmParalelo ? undefined : varredura?.nome)]);
    anteriorIntegracao = item.nome;
  }
  if (plano.saturado) depender(varredura, [hermetica?.nome]);
  // Comandos sem papel conhecido nao disputam CPU com as tres pecas: fecham a cadeia, um por vez.
  for (const item of outros) {
    depender(item, [hermetica?.nome, varredura?.nome, anteriorIntegracao]);
    anteriorIntegracao = item.nome;
  }
  return itens;
}

/**
 * A espera do grupo inteiro: o maior prazo, ou a soma deles quando ha fila (item com `apos` ou vagas a menos que itens),
 * que e o teto do pior caso.
 */
export function esperaDoGrupo(itens: ItemParalelo[], maxParalelo?: number): number {
  const comFila = itens.some((i) => i.apos?.length || i.papelCpu) || (!!maxParalelo && maxParalelo < itens.length);
  return comFila ? itens.reduce((t, i) => t + i.prazoMs, 0) : Math.max(...itens.map((i) => i.prazoMs));
}

/**
 * O lado do pai: roda o grupo pelo auxiliar e devolve cada processo, na ordem dos itens. A espera e a do grupo
 * (`esperaDoGrupo`), com folga para o `--kill-after` e para o auxiliar gravar; o diretorio das saidas some no fim.
 */
export function rodarEmParalelo(itens: ItemParalelo[], ambiente: NodeJS.ProcessEnv = process.env,
  opcoes: { maxParalelo?: number; cpus?: number; medicaoCpu?: MedicaoCpuDoGrupo } = {}): ProcessosDoGrupo {
  if (itens.length === 0) return [] as ProcessosDoGrupo;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-check-paralelo-'));
  try {
    const especificacao = path.join(dir, 'especificacao.json');
    const esp: Especificacao = { itens, dir, ...(opcoes.maxParalelo ? { maxParalelo: opcoes.maxParalelo } : {}),
      ...(opcoes.cpus ? { cpus: opcoes.cpus } : {}), ...(opcoes.medicaoCpu ? { medicaoCpu: opcoes.medicaoCpu } : {}) };
    fs.writeFileSync(especificacao, JSON.stringify(esp), { mode: 0o600 });
    const prazo = esperaDoGrupo(itens, opcoes.maxParalelo) + 60_000;
    const r = spawnSync(process.execPath, [__filename, especificacao], { env: ambiente, encoding: 'utf8', timeout: prazo,
      killSignal: 'SIGKILL' });
    let lido: { terminados: Terminado[]; agendamentoCpu?: PlanoCpuDoGrupo } = { terminados: [] };
    try { lido = JSON.parse(fs.readFileSync(path.join(dir, 'resultado.json'), 'utf8')) as typeof lido; } catch { /* abaixo */ }
    const processos = itens.map((item, i) => {
      const t = lido.terminados[i];
      const ler = (sufixo: string) => { try { return fs.readFileSync(path.join(dir, `${i}.${sufixo}`), 'utf8'); } catch { return ''; } };
      if (!t) {
        // O auxiliar morreu antes de gravar: o comando nao tem veredito, e a causa vai junto.
        const motivo = r.error ? (r.error as NodeJS.ErrnoException).code ?? r.error.message : `auxiliar saiu ${r.status ?? r.signal}`;
        return { nome: item.nome, ok: false, code: -1, signal: r.signal ?? null, error: motivo, stdout: ler('out'),
          stderr: `${ler('err')}${r.stderr ?? ''}`, duracaoMs: 0, comGrupo: fs.existsSync(TIMEOUT_BIN), semResultado: true };
      }
      return { nome: item.nome, ok: t.code === 0, code: t.code ?? -1, signal: t.signal, ...(t.error ? { error: t.error } : {}),
        stdout: ler('out'), stderr: ler('err'), duracaoMs: t.duracaoMs, comGrupo: t.comGrupo };
    }) as ProcessosDoGrupo;
    if (lido.agendamentoCpu) processos.agendamentoCpu = lido.agendamentoCpu;
    return processos;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const esp = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as Especificacao;
  rodarEspecificacao(esp).then(() => process.exit(0), (e: Error) => { process.stderr.write(`check-paralelo: ${e.message}\n`); process.exit(1); });
}
