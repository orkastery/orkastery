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
  ENV_CPUS_DOCKER, ENV_SINAL_DA_RESERVA, ENV_WORKERS,
  medirCpuDoGrupo, MedicaoCpuDaIntegracao, MedicaoCpuDoGrupo, PlanoCpuDoGrupo, planejarCpuDoGrupo,
  workersDaReserva } from './agendador-cpu';
import { TESTES_DE_INTEGRACAO_LOCAL } from './integracoes-locais';

const TIMEOUT_BIN = '/usr/bin/timeout';
const NICE_BIN = '/usr/bin/nice';
const TIME_BIN = '/usr/bin/time';
const CONTRATO_PERFIL_INTEGRACAO = 'ork.check.cpu-integracao/v2';
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
  /** RM-081 F4: servicos exclusivos locais a esta rodada, adquiridos como um conjunto indivisivel. */
  recursos?: string[];
  /** Papel na conta de CPU do grupo do Agile. Ausente nos outros usos deste auxiliar. */
  papelCpu?: 'hermetica' | 'integracao' | 'varredura' | 'claim' | 'outro';
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
  picoCpusDaArvore: number;
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

/**
 * Recursos exclusivos sem dependencia artificial. Cada pedido adquire o conjunto inteiro ou espera, o que evita
 * deadlock entre listas cruzadas; pedidos disjuntos continuam livres para avancar.
 */
function recursosExclusivos(): { tomar: (nomes: string[]) => Promise<() => void> } {
  const ocupados = new Set<string>();
  const fila: Array<{ nomes: string[]; pronto: (soltar: () => void) => void }> = [];
  const despachar = (): void => {
    for (let i = 0; i < fila.length;) {
      const pedido = fila[i];
      if (pedido.nomes.some((nome) => ocupados.has(nome))) { i++; continue; }
      fila.splice(i, 1);
      pedido.nomes.forEach((nome) => ocupados.add(nome));
      pedido.pronto(() => {
        pedido.nomes.forEach((nome) => ocupados.delete(nome));
        despachar();
      });
    }
  };
  return {
    tomar: (nomes) => new Promise<() => void>((pronto) => {
      fila.push({ nomes: [...new Set(nomes)], pronto });
      despachar();
    }),
  };
}

/** A reserva que vira ORK_WORKERS quando a lane e efetivamente lancada. */
export function workersDaLane(item: Pick<ItemParalelo, 'nome' | 'papelCpu'>, plano: PlanoCpuDoGrupo | undefined,
  cpus: number, totalDeLanes: number): number | null {
  if (!item.nome.startsWith('test:')) return null;
  const capacidade = workersDaReserva(cpus);
  if (!plano) return Math.max(1, Math.floor(capacidade / Math.max(1, Math.min(capacidade, totalDeLanes))));
  if (item.papelCpu === 'hermetica') return workersDaReserva(plano.cpusHermetica);
  if (item.papelCpu === 'integracao') return workersDaReserva(plano.cpusIntegracao);
  // Outros fecham a cadeia depois que as reservas da varredura e da integracao voltaram.
  return capacidade;
}

function arquivoDoPerfilIntegracao(): string {
  const base = process.env.XDG_CACHE_HOME && path.isAbsolute(process.env.XDG_CACHE_HOME)
    ? process.env.XDG_CACHE_HOME : path.join(os.homedir(), '.cache');
  return path.join(base, 'orkastery', 'check', 'cpu-integracao.json');
}

/** Os arquivos da lane de integracao, pela mesma regra do `test-lanes.cjs`: a lista do ambiente ou a do nucleo. */
function arquivosDaIntegracao(env: NodeJS.ProcessEnv = process.env): string[] {
  const lista = env.ORK_LANES_INTEGRACAO !== undefined
    ? env.ORK_LANES_INTEGRACAO.split(',').map((n) => n.trim()).filter(Boolean) : [...TESTES_DE_INTEGRACAO_LOCAL];
  return [...new Set(lista)].sort();
}

/**
 * A medida so atravessa rodadas quando comando, capacidade e entradas que definem a lane continuam iguais: o script das
 * lanes, a lista de integracao e o conteudo compilado de cada teste dela. Teste novo, mudado ou ausente troca a chave.
 */
export function chaveDoPerfilIntegracao(itens: ItemParalelo[], cpus: number,
  arquivos: string[] = arquivosDaIntegracao()): string | null {
  const integracao = itens.filter((i) => i.papelCpu === 'integracao');
  if (!integracao.length) return null;
  const h = createHash('sha256').update(JSON.stringify({ cpus, node: process.version,
    comandos: integracao.map((i) => i.comando), arquivos }));
  const cwd = integracao[0].cwd;
  const relativos = ['core/dist/integracoes-locais.js', 'core/scripts/test-lanes.cjs',
    ...arquivos.map((nome) => path.join('core', 'dist-test', 'test', nome))];
  for (const relativo of relativos) {
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
      && Number.isFinite(p.picoCpusDaArvore) && p.picoCpusDaArvore > 0 && p.picoCpusDaArvore <= cpus ? p : null;
  } catch { return null; }
}

/** Somente uma arvore completa e fisicamente possivel pode ensinar a reserva; lacunas de conteiner ficam na evidencia. */
export function picoDaArvoreParaPerfil(medicao: MedicaoCpuDaIntegracao, cpus: number): number | null {
  const pico = medicao.picoCpusDaArvore;
  return medicao.arvoreCompleta && !medicao.anomaliaDaArvore && pico !== null && pico > 0 && pico <= cpus ? pico : null;
}

function gravarPerfilIntegracao(chave: string | null, cpus: number, medicao: MedicaoCpuDaIntegracao): void {
  const picoCpusDaArvore = picoDaArvoreParaPerfil(medicao, cpus);
  if (!chave || picoCpusDaArvore === null) return;
  const arquivo = arquivoDoPerfilIntegracao();
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const temporario = `${arquivo}.${process.pid}.tmp`;
    const perfil: PerfilCpuIntegracao = { contrato: CONTRATO_PERFIL_INTEGRACAO, chave, cpus,
      picoCpusDaArvore, completa: true, medidoEm: new Date().toISOString() };
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

interface FonteCpuDoContainer { arquivo: string; divisor: number }
interface BuscaCpuDoContainer { fonte: FonteCpuDoContainer | null; motivo: string | null }

function arquivoCpuDoContainer(nome: string): BuscaCpuDoContainer {
  const r = spawnSync('docker', ['inspect', '--format', '{{.Id}} {{.State.Pid}}', nome], { encoding: 'utf8', timeout: 1000 });
  const [id = '', pidTexto = ''] = r.stdout?.trim().split(/\s+/) ?? [];
  const pid = Number(pidTexto);
  if (r.status !== 0) return { fonte: null, motivo: 'docker inspect nao encontrou o conteiner' };
  if (!/^[a-f0-9]{12,64}$/.test(id) || !Number.isInteger(pid) || pid <= 0) {
    return { fonte: null, motivo: 'PID ou identificador do conteiner indisponivel' };
  }
  let linhas = '';
  try { linhas = fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8'); }
  catch { return { fonte: null, motivo: 'cgroup do PID do conteiner indisponivel' }; }
  const unificado = /^0::(.+)$/m.exec(linhas)?.[1];
  const candidatos: FonteCpuDoContainer[] = [
    ...(unificado ? [{ arquivo: path.join('/sys/fs/cgroup', unificado, 'cpu.stat'), divisor: 1000 }] : []),
    { arquivo: path.join('/sys/fs/cgroup/system.slice', `docker-${id}.scope`, 'cpu.stat'), divisor: 1000 },
    { arquivo: path.join('/sys/fs/cgroup/docker', id, 'cpu.stat'), divisor: 1000 },
  ];
  const legado = /^(?:\d+):[^\n]*(?:cpuacct|cpu)[^\n]*:(.+)$/m.exec(linhas)?.[1];
  if (legado) candidatos.push({ arquivo: path.join('/sys/fs/cgroup/cpuacct', legado, 'cpuacct.usage'), divisor: 1_000_000 });
  const fonte = candidatos.find((x) => fs.existsSync(x.arquivo)) ?? null;
  return fonte ? { fonte, motivo: null }
    : { fonte: null, motivo: 'cpu.stat ausente no cgroup v2, no escopo do systemd e no caminho legado' };
}

function lerCpuDoCgroup(fonte: FonteCpuDoContainer): number | null {
  try {
    const texto = fs.readFileSync(fonte.arquivo, 'utf8');
    const bruto = fonte.arquivo.endsWith('cpu.stat') ? Number(/^usage_usec\s+(\d+)$/m.exec(texto)?.[1]) : Number(texto.trim());
    return Number.isFinite(bruto) && bruto >= 0 ? bruto / fonte.divisor : null;
  } catch { return null; }
}

export interface AmostraCpuPorFonte { em: number; fontes: Record<string, number> }

/**
 * Calcula o pico por fonte. A primeira leitura vira baseline; uma fonte que nasce depois dela contribui com o acumulado
 * desde seu nascimento, sem despejar na janela o tempo anterior de processos ou conteineres que ja existiam.
 */
export function picoCpuPorFonte(amostras: AmostraCpuPorFonte[], cpus: number): { picoCpus: number | null; anomalia: string | null } {
  let pico = 0;
  for (let i = 1; i < amostras.length; i++) {
    const anterior = amostras[i - 1], atual = amostras[i];
    if (!(atual.em > anterior.em)) continue;
    let delta = 0;
    for (const [fonte, acumulado] of Object.entries(atual.fontes)) {
      const base = anterior.fontes[fonte];
      delta += Math.max(0, acumulado - (base ?? 0));
    }
    pico = Math.max(pico, delta / (atual.em - anterior.em));
  }
  if (pico > cpus + 1e-9) {
    return { picoCpus: null, anomalia: `pico medido de ${pico.toFixed(2)} CPU excede a capacidade de ${cpus} CPU` };
  }
  return { picoCpus: pico > 0 ? Math.ceil(pico * 100) / 100 : null, anomalia: null };
}

/** CPU acumulada e pico por janela da integracao; nomes registrados mas nunca observados tornam a medida incompleta. */
function sondarCpuDaIntegracao(pid: number, registro: string, cpus: number): { amostrar: () => void; fechar: (arvoreMs: number, paredeMs: number) => MedicaoCpuDaIntegracao } {
  const fontes = new Map<string, FonteCpuDoContainer>();
  const motivos = new Map<string, string>();
  const amostras: AmostraCpuPorFonte[] = [];
  const amostrasDaArvore: AmostraCpuPorFonte[] = [];
  const primeiraCpuDosContainers = new Map<string, number>();
  const ultimaCpuDosContainers = new Map<string, number>();
  const amostrar = () => {
    const tabela = processosCpu();
    const arvore: Record<string, number> = {};
    for (const p of arvoreDeProcessos(pid, tabela)) {
      const x = tabela.get(p);
      if (x) arvore[`processo:${p}:${x.inicio}`] = x.cpuMs;
    }
    const atuais: Record<string, number> = { ...arvore };
    for (const nome of nomesDosContainers(registro)) {
      let fonte = fontes.get(nome);
      if (!fonte) {
        const busca = arquivoCpuDoContainer(nome);
        if (busca.fonte) { fonte = busca.fonte; fontes.set(nome, fonte); motivos.delete(nome); }
        else if (busca.motivo) motivos.set(nome, busca.motivo);
      }
      const cpu = fonte ? lerCpuDoCgroup(fonte) : null;
      if (cpu !== null) {
        atuais[`conteiner:${nome}`] = cpu;
        if (!primeiraCpuDosContainers.has(nome)) primeiraCpuDosContainers.set(nome, amostras.length === 0 ? cpu : 0);
        ultimaCpuDosContainers.set(nome, cpu);
        motivos.delete(nome);
      } else if (fonte) motivos.set(nome, 'contador de CPU do cgroup ilegivel');
    }
    const em = Date.now();
    amostrasDaArvore.push({ em, fontes: arvore });
    amostras.push({ em, fontes: atuais });
  };
  return {
    amostrar,
    fechar: (arvoreMs, paredeMs) => {
      amostrar();
      const nomes = nomesDosContainers(registro);
      const containersMs = nomes.reduce((total, nome) => total + Math.max(0,
        (ultimaCpuDosContainers.get(nome) ?? 0) - (primeiraCpuDosContainers.get(nome) ?? 0)), 0);
      const ausentes = nomes.filter((nome) => !ultimaCpuDosContainers.has(nome));
      const pico = picoCpuPorFonte(amostras, cpus);
      const picoDaArvore = picoCpuPorFonte(amostrasDaArvore, cpus);
      const arvoreCompleta = arvoreMs > 0 && picoDaArvore.picoCpus !== null && !picoDaArvore.anomalia;
      return { arvoreMs, containersMs, totalMs: arvoreMs + containersMs, paredeMs,
        picoCpus: pico.picoCpus, picoCpusDaArvore: picoDaArvore.picoCpus,
        completa: arvoreCompleta && ausentes.length === 0 && !pico.anomalia, arvoreCompleta,
        containers: nomes, ausentes, motivosDosAusentes: ausentes.map((container) => ({ container,
          motivo: motivos.get(container) ?? 'conteiner terminou antes de uma amostra completa' })),
        anomalia: pico.anomalia, anomaliaDaArvore: picoDaArvore.anomalia };
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
  if (perfil) Object.assign(medicao, { cpusIntegracao: perfil.picoCpusDaArvore, fonteCpusIntegracao: 'medida' as const });
  else if (medicao.cpusIntegracao === undefined) Object.assign(medicao, { cpusIntegracao: null, fonteCpusIntegracao: 'conservadora' as const });
  const nomesDasClaims = new Set(esp.itens.filter((i) => i.papelCpu === 'claim').map((i) => i.nome));
  const cadeiasDeClaims = esp.itens.filter((i) => i.papelCpu === 'claim'
    && !(i.apos ?? []).some((nome) => nomesDasClaims.has(nome))).length;
  const plano = usaAgendador ? planejarCpuDoGrupo(cpus, medicao, { cadeiasDeClaims }) : undefined;
  const sinalDaReserva = plano && !plano.saturado ? path.join(esp.dir, 'reserva-devolvida.json') : undefined;
  const itens = plano ? aplicarPlano(esp.itens, plano, sinalDaReserva) : esp.itens;
  const tetoInformado = esp.maxParalelo && esp.maxParalelo > 0 ? esp.maxParalelo : itens.length;
  const limite = vagas(Math.max(1, Math.min(tetoInformado, workersDaReserva(cpus))));
  const limiteDasClaims = plano?.cpusClaims ? vagas(plano.cpusClaims) : null;
  const exclusivos = recursosExclusivos();
  const totalDeLanes = itens.filter((item) => item.nome.startsWith('test:')).length;
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
      const soltarRecursos = await exclusivos.tomar(item.recursos ?? []);
      if (item.papelCpu === 'claim') await limiteDasClaims?.tomar();
      await limite.tomar();
      try { return await lancar(item, i); } finally {
        limite.soltar();
        if (item.papelCpu === 'claim') limiteDasClaims?.soltar();
        soltarRecursos();
      }
    });
    porNome.set(item.nome, vez);
    return vez;
  };
  const todos = Promise.all(itens.map(vezDoItem));
  const reservados = itens.filter((item) => ['varredura', 'integracao', 'claim'].includes(item.papelCpu ?? ''));
  const devolverReserva = async (): Promise<void> => {
    if (!sinalDaReserva || !reservados.length) return;
    const varreduras = reservados.filter((item) => item.papelCpu === 'varredura');
    const integracoes = reservados.filter((item) => item.papelCpu === 'integracao');
    const claims = reservados.filter((item) => item.papelCpu === 'claim');
    let vagasDaHermetica = plano!.cpusHermetica;
    const degrau = async (origem: 'varredura' | 'integracao' | 'claims', pecas: ItemParalelo[], libera: number) => {
      if (!pecas.length) return;
      await Promise.all(pecas.map((item) => vezDoItem(item, indice.get(item.nome)!)));
      const antes = vagasDaHermetica;
      vagasDaHermetica = Math.min(plano!.capacidadeEfetiva, vagasDaHermetica + libera);
      fs.appendFileSync(sinalDaReserva, JSON.stringify({ contrato: 'ork.check.reserva-devolvida/v2', origem,
        em: new Date().toISOString(), vagasGanhas: vagasDaHermetica - antes, vagas: vagasDaHermetica }) + '\n', { mode: 0o600 });
    };
    const liberadaPelaVarredura = plano!.integracaoEmParalelo
      ? plano!.cpusDaFatia : Math.max(0, plano!.cpusDaFatia - plano!.cpusIntegracao);
    const devolverInfraestrutura = plano!.integracaoEmParalelo
      ? Promise.all([degrau('varredura', varreduras, liberadaPelaVarredura),
        degrau('integracao', integracoes, plano!.cpusIntegracao)])
      : (async () => {
        await degrau('varredura', varreduras, liberadaPelaVarredura);
        await degrau('integracao', integracoes, plano!.cpusIntegracao);
      })();
    await Promise.all([
      degrau('claims', claims, plano!.cpusClaims),
      devolverInfraestrutura,
    ]);
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
        fim = { ...t, ...(medicaoCpu ? { medicaoCpu } : {}) };
        fs.closeSync(saida);
        fs.closeSync(erro);
        resolve(fim);
      };
      // Sem o `timeout(1)`, o proprio auxiliar mata pelo prazo, como o `spawnSync` do `exec` faria.
      const workers = workersDaLane(item, plano, cpus, totalDeLanes);
      const ambiente = { ...process.env, ...item.ambiente, ...(workers === null ? {} : { [ENV_WORKERS]: String(workers) }),
        ...(medirIntegracao ? { [ENV_CONTAINERS_DA_LANE]: registro } : {}) };
      const filho = spawn(bin, args, { cwd: item.cwd, env: ambiente, stdio: ['ignore', saida, erro],
        ...(comGrupo ? {} : { timeout: item.prazoMs, killSignal: 'SIGTERM' as const }) });
      if (medirIntegracao) {
        sonda = sondarCpuDaIntegracao(filho.pid!, registro, cpus);
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
  const claims = porPapel('claim');
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
    ...(sinalDaReserva && (varredura || integracoes.length > 0 || claims.length > 0) ? {
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
  if (plano.cpusClaims === 0) {
    let anteriorClaim = anteriorIntegracao;
    for (const item of claims) {
      depender(item, [anteriorClaim ?? varredura?.nome, hermetica?.nome]);
      anteriorClaim = item.nome;
    }
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
