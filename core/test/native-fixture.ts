/** Dev provisioner and reviewer consumer are separate. No privilege delegation or inherited DSN. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const fixtureEnv = () => ({ PATH: process.env.PATH, HOME: process.env.HOME, PYTHONDONTWRITEBYTECODE: '1' });
export const assets = path.resolve(__dirname, '../../assets');
export function pythonFixture(): string {
  const cli = (process.env.PATH ?? '').split(path.delimiter).map(p => path.join(p, 'orkmind')).find(p => fs.existsSync(p));
  if (!cli) throw Error('runtime.unavailable: installed OrkMind interpreter');
  const python = /^#!(\S+)/.exec(fs.readFileSync(cli, 'utf8'))?.[1];
  if (!python) throw Error('runtime.unavailable: installed OrkMind interpreter');
  return python;
}
const DOCKER_TIMEOUT_PADRAO_MS = 20_000;
function docker(args: string[], timeout: number = DOCKER_TIMEOUT_PADRAO_MS) {
  return spawnSync('docker', args, { encoding: 'utf8', env: fixtureEnv(), timeout });
}
/**
 * O entrypoint do PostgreSQL sobe um servidor temporario para inicializar o cluster e o derruba antes
 * de exec do servidor final. Esse temporario ja aceita conexao no mesmo socket, entao pg_isready ou
 * "conectou" nao distinguem os dois: quem conecta no temporario recebe AdminShutdown no meio do DDL.
 * A unica marca do servidor final e ser o PID 1 do container, porque ate o exec o PID 1 e o entrypoint.
 */
export type LeituraDeArranque = { rodando: boolean; identidade: string | null; logs: string };
/** `saldoMs` devolve quanto resta do prazo AGORA: o leitor nunca pode gastar mais do que isso. */
export type LeitorDeArranque = (container: string, saldoMs: () => number) => LeituraDeArranque;
export type OpcoesDeArranque = { prazoMs?: number; intervaloMs?: number; agora?: () => number;
  dormir?: (ms: number) => void; ler?: LeitorDeArranque };
export const ARRANQUE_PRAZO_PADRAO_MS = 30_000, ARRANQUE_INTERVALO_PADRAO_MS = 100;
// Linha estrutural inteira do servidor, ancorada nas duas pontas: carimbo, zona, [pid] e nivel.
// Uma citacao dentro de um diagnostico ("diagnostico textual: <linha>") nao e a linha do servidor.
const CARIMBO = String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \S+`;
const PRONTO = new RegExp(`^${CARIMBO} \\[(\\d+)\\] LOG:  database system is ready to accept connections$`);
const PARADO = new RegExp(`^${CARIMBO} \\[1\\] LOG:  (?:received (?:fast|smart|immediate) shutdown request|database system is shut down)$`);
const INIT_COMPLETO = 'PostgreSQL init process complete; ready for start up.';
/** Analise pura do log do container: nada aqui fala com Docker. */
export function analisarArranque(logs: string) {
  const linhas = logs.split('\n').map(l => l.replace(/\r+$/, ''));
  const pid = (l: string) => PRONTO.exec(l)?.[1];
  const final = linhas.findIndex(l => pid(l) === '1');
  const temporario = linhas.some((l, i) => (final < 0 || i < final) && pid(l) !== undefined && pid(l) !== '1');
  // Igualdade exata da linha: o marcador citado dentro de outra linha nao completa a transicao.
  const inicializado = linhas.findIndex(l => l === INIT_COMPLETO);
  return { final, temporario, parado: linhas.some((l, i) => i > final && final >= 0 && PARADO.test(l)),
    // O marcador do entrypoint precisa vir antes do pronto final sempre que houve servidor temporario.
    transicaoCompleta: !temporario || (inicializado >= 0 && final >= 0 && inicializado < final) };
}
// Os dois subprocessos gastam do MESMO saldo da guarda: 20s fixos cada extrapolariam o prazo.
const lerArranqueReal: LeitorDeArranque = (container, saldoMs) => {
  const orcamento = () => {
    const ms = Math.floor(saldoMs());
    if (ms <= 0) throw Error('runtime.fixture.startup-timeout');
    return Math.min(ms, DOCKER_TIMEOUT_PADRAO_MS);
  };
  const inspecionado = docker(['inspect', '--format', '{{.State.Running}} {{index .Config.Labels "ork.fixture.identity"}}', container], orcamento());
  const logs = docker(['logs', container], orcamento());
  if (inspecionado.status !== 0 || logs.status !== 0) throw Error('runtime.fixture.startup-unavailable');
  const [rodando, identidade] = inspecionado.stdout.trim().split(' ');
  return { rodando: rodando === 'true', identidade: identidade ?? null, logs: logs.stdout + logs.stderr };
};
/**
 * Bloqueia ate o postgres final estar pronto no container exato, ou falha tipado. Prazo monotonico.
 * Devolve o saldo residual do MESMO limite: quem libera o DDL reconfere sem recomecar a contagem.
 */
export function aguardarPostgresFinal(container: string, identidade: string, opcoes: OpcoesDeArranque = {}): () => number {
  // Id de 64 hex do container recem-criado: nome pode ser reaproveitado, id nao.
  if (!/^[a-f0-9]{64}$/.test(container)) throw Error('runtime.fixture.startup-container');
  const prazoMs = opcoes.prazoMs ?? ARRANQUE_PRAZO_PADRAO_MS;
  const intervaloMs = opcoes.intervaloMs ?? ARRANQUE_INTERVALO_PADRAO_MS;
  // NaN, infinito, zero e negativo nao viram espera infinita nem busy loop: sao pedido invalido.
  if (!Number.isFinite(prazoMs) || prazoMs <= 0 || !Number.isFinite(intervaloMs) || intervaloMs <= 0)
    throw Error('runtime.fixture.startup-invalid');
  const agora = opcoes.agora ?? (() => Number(process.hrtime.bigint() / 1_000_000n));
  const dormir = opcoes.dormir ?? ((ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); });
  const ler = opcoes.ler ?? lerArranqueReal;
  const limite = agora() + prazoMs;
  // Estritamente antes do limite: alcancar o limite ja e expiracao, nao pronto no ultimo instante.
  const saldo = () => limite - agora();
  for (;;) {
    if (saldo() <= 0) throw Error('runtime.fixture.startup-timeout');
    const leitura = ler(container, saldo);
    // O leitor pode demorar mais do que o saldo; o retorno tardio e recusado antes de qualquer DDL.
    if (saldo() <= 0) throw Error('runtime.fixture.startup-timeout');
    if (leitura.identidade !== identidade) throw Error('runtime.fixture.startup-identity');
    const estado = analisarArranque(leitura.logs);
    // Analisar o log tambem gasta prazo, e a conferencia anterior e a do retorno do leitor. Esta vem
    // ANTES de qualquer caminho: sem ela o tempo do parser corria fora do limite nos dois ramos.
    if (saldo() <= 0) throw Error('runtime.fixture.startup-timeout');
    if (estado.final >= 0) {
      if (estado.parado) throw Error('runtime.fixture.startup-stopped');
      if (!estado.transicaoCompleta) throw Error('runtime.fixture.startup-unfinished');
      if (!leitura.rodando) throw Error('runtime.fixture.startup-exited');
      // Guarda do retorno: decidir sobre o estado tambem consome prazo antes de liberar o DDL.
      if (saldo() <= 0) throw Error('runtime.fixture.startup-timeout');
      return saldo;
    }
    if (!leitura.rodando) throw Error('runtime.fixture.startup-exited');
    // A espera sai do saldo recalculado AGORA: prazo esgotado e recusa tipada, nunca dormir(-1).
    const espera = saldo();
    if (espera <= 0) throw Error('runtime.fixture.startup-timeout');
    dormir(Math.min(intervaloMs, espera));
  }
}
/** Costura unica: nenhum DDL corre antes da guarda do arranque passar, nem depois do limite. */
export function arrancarFixture(container: string, identidade: string, ddl: () => void, opcoes: OpcoesDeArranque = {}): void {
  const saldo = aguardarPostgresFinal(container, identidade, opcoes);
  // Guarda de entrada do DDL: o intervalo entre o retorno da guarda e o callback tambem conta prazo.
  if (saldo() <= 0) throw Error('runtime.fixture.startup-timeout');
  ddl();
}
/** Validade inicial finita e inteira, decidida no provisionamento. Nao existe renovacao. */
export const FIXTURE_TTL_PADRAO_MS = 1_800_000, FIXTURE_TTL_MIN_MS = 60_000, FIXTURE_TTL_MAX_MS = 3_600_000;
export function prepareFixture(preparedBy: string, opcoes: { ttlMs?: number } = {}): string {
  if (!preparedBy.trim()) throw Error('runtime.fixture.owner-required');
  // Validado antes de Docker e antes de criar qualquer arquivo: pedido invalido nao deixa rastro.
  const ttlMs = opcoes.ttlMs === undefined ? FIXTURE_TTL_PADRAO_MS : opcoes.ttlMs;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < FIXTURE_TTL_MIN_MS || ttlMs > FIXTURE_TTL_MAX_MS)
    throw Error('runtime.fixture.ttl-invalid');
  const image = docker(['image', 'inspect', '--format', '{{.Id}}', 'pgvector/pgvector:pg16']);
  if (image.status !== 0 || !/^sha256:[a-f0-9]{64}$/.test(image.stdout.trim()))
    throw Error('runtime.unavailable: Docker or identified local PostgreSQL image');
  const socket = fs.mkdtempSync('/tmp/ork-prospective-fixture-');
  const filename = path.join(socket, 'receipt.json');
  const name = 'ork-fixture-' + randomBytes(12).toString('hex');
  const receipt = { schema: 'ork.native-fixture/v1', synthetic: true, preparedBy, ownerUid: process.getuid!(),
    socket, database: 'ork_i06_txn_fixture', tenant: 'synthetic', identity: randomBytes(32).toString('hex'),
    image: image.stdout.trim(), container: '', name, expiresAt: (Date.now() + ttlMs) / 1000 };
  fs.writeFileSync(filename, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
  try {
    const start = docker(['run', '-d', '--pull=never', '--name', name, '--label', 'ork.fixture.identity='+receipt.identity,
      '--network', 'none', '--user', `${process.getuid!()}:${process.getgid!()}`,
      '--tmpfs', `/var/lib/postgresql/data:rw,uid=${process.getuid!()},gid=${process.getgid!()},mode=0700`,
      '--tmpfs', `/var/run/postgresql:rw,uid=${process.getuid!()},gid=${process.getgid!()},mode=0700`,
      '--mount', `type=bind,src=${socket},dst=/var/run/postgresql/fixture`,
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_USER=postgres',
      '-e', 'POSTGRES_DB=ork_i06_txn_fixture', receipt.image, '-c', 'listen_addresses=', '-c', 'unix_socket_directories=/var/run/postgresql,/var/run/postgresql/fixture']);
    if (start.status !== 0 || !/^[a-f0-9]{64}$/.test(start.stdout.trim())) throw Error('runtime.unavailable: Docker fixture launch');
    receipt.container = start.stdout.trim();
    fs.writeFileSync(filename, JSON.stringify(receipt));
    arrancarFixture(receipt.container, receipt.identity, () => {
    const boot = spawnSync(pythonFixture(), ['-c', `
import asyncio,json,sys
sys.path.insert(0,sys.argv[2])
from orkmind_fixture import receipt_file,fixture_dsn
import psycopg
async def run():
 for _ in range(150):
  try:
   r=receipt_file(sys.argv[1]);c=await psycopg.AsyncConnection.connect(fixture_dsn(r),autocommit=True);break
  except (PermissionError,psycopg.OperationalError):await asyncio.sleep(.1)
 else:raise RuntimeError('runtime.unavailable: fixture startup')
 try:
  assert (await (await c.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public'")).fetchone())[0]==0
  await c.execute('CREATE EXTENSION vector')
  await c.execute('CREATE TABLE public.ork_fixture_identity (identity text NOT NULL, tenant text NOT NULL)')
  await c.execute('INSERT INTO public.ork_fixture_identity VALUES (%s,%s)',(r['identity'],r['tenant']))
 finally:await c.close()
asyncio.run(run())
`, filename, assets], { encoding: 'utf8', env: fixtureEnv(), timeout: 25000 });
    if (boot.status !== 0) throw Error('runtime.unavailable: fixture bootstrap: '+boot.stderr+docker(['logs',receipt.container]).stderr);
    });
    return filename;
  } catch (error) {
    // A timed out launch may have created a named container: cleanup validates its label.
    cleanupFixture(filename);
    throw error;
  }
}
export function cleanupFixture(filename: string): void {
  const r = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (r.ownerUid !== process.getuid!() || filename !== path.join(r.socket, 'receipt.json') ||
      !/^\/tmp\/ork-prospective-fixture-[a-zA-Z0-9-]+$/.test(r.socket) || fs.realpathSync(r.socket) !== r.socket)
    throw Error('runtime.fixture.cleanup-owner');
  const inspected = docker(['inspect', r.container || r.name]);
  if (inspected.status === 0) {
    const c = JSON.parse(inspected.stdout)[0];
    if (c.Config.Labels['ork.fixture.identity'] !== r.identity || c.HostConfig.NetworkMode !== 'none' ||
        c.Mounts.filter((m: { Type: string }) => m.Type === 'bind').some((m: { Source: string }) => m.Source !== r.socket))
      throw Error('runtime.fixture.cleanup-identity');
    if (docker(['rm', '-f', c.Id]).status !== 0) throw Error('runtime.fixture.cleanup-failed');
  } else if (docker(['info', '--format', '{{.ID}}']).status !== 0) throw Error('runtime.fixture.cleanup-unavailable');
  fs.rmSync(r.socket, { recursive: true });
  if (fs.existsSync(r.socket)) throw Error('runtime.fixture.cleanup-failed');
  console.error(JSON.stringify({type:'fixture.cleanup', ownerUid:r.ownerUid, preparedBy:r.preparedBy, container:r.container, socket:r.socket, removed:true}));
}
export function usingFixture<T>(fn: (receipt: string) => T): T {
  const external = process.env.ORK_NATIVE_FIXTURE_RECEIPT;
  if (external) return fn(external); // Consumer never provisions or removes external fixture.
  const receipt = prepareFixture('local-development-executor');
  try { return fn(receipt); } finally { cleanupFixture(receipt); }
}
if (require.main === module) {
  try {
    if (process.argv[2] === 'prepare')
      console.log(prepareFixture(process.argv[3] ?? '', process.argv[4] === undefined ? {} : { ttlMs: Number(process.argv[4]) }));
    else if (process.argv[2] === 'cleanup') { cleanupFixture(process.argv[3]); console.log('fixture cleaned'); }
    else throw Error('usage: native-fixture prepare <owner> [ttlMs] | cleanup <receipt>');
  } catch (e) { console.error((e as Error).message); process.exitCode = 1; }
}
