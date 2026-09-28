import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { exportarHandoff } from '../src/handoff';
import { inventariarHandoffs, migrarHandoffs, repositorioAlvoDeclarado } from '../src/memory-migration';
import { DriverEmMemoria } from '../src/orkmind';
import { novaThread, gravarThread } from '../src/thread';
import { projetoTemporario } from './apoio';

function fixture() {
  const p = projetoTemporario('migracao');
  const { thread } = novaThread(p.carregado, { nome: 'origem confirmada', modo: 'auto' });
  const exportado = exportarHandoff(p.carregado, thread.id, { proximaFase: 'GOAL' });
  p.carregado.manifesto.memory.mode = 'orkmind';
  p.carregado.manifesto.memory.database_url_env = 'TENANT_DE_TESTE';
  const driver = new DriverEmMemoria();
  return { p, thread, exportado, driver };
}

// D23: os oraculos de tenant externo e de formato sem contrato passam a viver DENTRO de threads
// sinteticas autorizadas, porque a caixa compartilhada deixou de ser lida. Nenhuma classificacao
// foi removida: as duas fontes classificadas continuam sendo hasheadas, excluidas e explicadas.
test('inventario inclui atuais e historicos; separa tenant externo e formato sem contrato dentro do escopo; CLI e somente leitura', () => {
  const { p, driver, thread } = fixture();
  try {
    const fontesDaThread = path.join(p.dir, '.orkastery/threads', thread.id, 'handoffs');
    fs.writeFileSync(path.join(fontesDaThread, 'externo.md'), 'Repo alvo: `/srv/projetos/Outro-Board`.');
    fs.writeFileSync(path.join(fontesDaThread, 'desconhecido.md'), 'Outro Board aparece como referencia, sem declarar origem.');
    const files = { ...p.carregado, manifesto: { ...p.carregado.manifesto, memory: { ...p.carregado.manifesto.memory, mode: 'files' as const } } };
    const { thread: outra } = novaThread(files, { nome: 'externa', modo: 'auto' });
    exportarHandoff(files, outra.id, { proximaFase: 'GOAL' });
    outra.projeto.name = 'outro'; gravarThread(p.dir, outra);
    // `outra` esta na allowlist e mesmo assim nao migra: o tenant dela nao e o do manifesto.
    const i = inventariarHandoffs(p.carregado, [thread.id, outra.id]);
    assert.equal(i.incluidos, 2); assert.equal(i.excluidos, 4);
    const fonte = (sufixo: string) => i.fontes.find(f => f.arquivo.endsWith(sufixo));
    assert.equal(fonte('/externo.md')?.tenant, 'outro-board');
    assert.equal(fonte('/externo.md')?.destino, 'Outro-Board');
    assert.equal(fonte('/externo.md')?.motivo, 'tenant_externo_reservado');
    assert.equal(fonte('/desconhecido.md')?.motivo, 'formato_sem_contrato');
    assert.ok(i.fontes.filter(f => f.thread === outra.id).length === 2 &&
      i.fontes.filter(f => f.thread === outra.id).every(f => f.tenant === 'outro' && f.motivo === 'tenant_externo_reservado'),
      'thread autorizada de outro tenant e inventariada e excluida, nunca migrada');
    assert.ok(i.fontes.every(f => f.bytes > 0 && /^[a-f0-9]{64}$/.test(f.sha256)));
    const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../src/index.js'), 'memory', 'inventory', '--escopo', [thread.id, outra.id].join(','), '--json'], { cwd: p.dir, encoding: 'utf8' });
    assert.equal(cli.status, 0); assert.deepEqual(JSON.parse(cli.stdout), i);
    assert.equal(driver.tudo().length, 0);
  } finally { p.limpar(); }
});

/**
 * Traps reais sobre as funcoes de `node:fs` usadas pelo inventario: observam e delegam ao original.
 * O alvo e o objeto de modulo real, o mesmo que `memory-migration` enxerga pelo seu namespace.
 */
const fsReal = createRequire(__filename)('node:fs') as Record<string, (...a: unknown[]) => unknown>;
const FUNCOES_DE_FS = ['readdirSync', 'readFileSync', 'existsSync', 'lstatSync', 'statSync', 'realpathSync', 'openSync'] as const;
function comTrapsDeFs<T>(executar: () => T): { valor: T; tocados: string[] } {
  const tocados: string[] = [], originais = new Map<string, (...a: unknown[]) => unknown>();
  for (const nome of FUNCOES_DE_FS) {
    const original = fsReal[nome];
    originais.set(nome, original);
    fsReal[nome] = (alvo: unknown, ...resto: unknown[]) => {
      if (typeof alvo === 'string') tocados.push(`${nome} ${alvo}`);
      return original.call(fsReal, alvo, ...resto);
    };
  }
  try { return { valor: executar(), tocados }; }
  finally { for (const nome of FUNCOES_DE_FS) fsReal[nome] = originais.get(nome)!; }
}

test('D23: caixa compartilhada e thread alheia nao sao enumeradas, lidas nem hasheadas pelo inventario ou pelo preflight da migracao', () => {
  const { p, driver, thread } = fixture();
  try {
    const files = { ...p.carregado, manifesto: { ...p.carregado.manifesto, memory: { ...p.carregado.manifesto.memory, mode: 'files' as const } } };
    const alheia = novaThread(files, { nome: 'fora do escopo', modo: 'auto' }).thread;
    exportarHandoff(files, alheia.id, { proximaFase: 'GOAL' });
    const caixa = path.join(p.dir, '.orkastery/handoffs');
    fs.mkdirSync(path.join(caixa, 'sub'), { recursive: true });
    // O avulso declara a thread autorizada por dentro: texto interno nunca e autorizacao.
    fs.writeFileSync(path.join(caixa, 'avulso.json'), JSON.stringify({ thread: thread.id, versao: 1,
      de: { slug: 'x' }, para: { slug: 'y' }, inline: [], pointers: [], summaries: [] }));
    fs.writeFileSync(path.join(caixa, 'externo.md'), 'Repo alvo: `/srv/projetos/Outro-Board`.');
    fs.writeFileSync(path.join(caixa, 'sub/aninhado.md'), 'texto da caixa compartilhada');
    const foraDoEscopo = [caixa, path.join(p.dir, '.orkastery/threads', alheia.id)];
    const conteudo = (raiz: string) => (fs.readdirSync(raiz, { recursive: true }) as string[])
      .filter(f => fs.statSync(path.join(raiz, f)).isFile()).sort()
      .map(f => [f, fs.readFileSync(path.join(raiz, f)).toString('hex')]);
    const antes = foraDoEscopo.map(conteudo);

    const { valor, tocados } = comTrapsDeFs(() => ({
      inventario: inventariarHandoffs(p.carregado, [thread.id]),
      migracao: migrarHandoffs(p.carregado, { operadora: thread.id, escopo: [thread.id], driver }),
    }));
    const violacoes = [...new Set(tocados.filter(t => {
      const alvo = path.resolve(t.slice(t.indexOf(' ') + 1));
      return foraDoEscopo.some(f => alvo === f || alvo.startsWith(f + path.sep));
    }))].sort();
    assert.deepEqual(violacoes, [], 'nenhuma operacao de FS na caixa compartilhada ou na thread alheia');
    assert.ok(tocados.length > 0, 'a trap realmente observou o inventario');
    assert.equal(valor.inventario.fontes.length, 2);
    assert.equal(valor.inventario.excluidos, 0);
    assert.ok(valor.inventario.fontes.every(f => f.thread === thread.id && f.incluir));
    assert.equal(valor.migracao.ok, true); assert.equal(valor.migracao.resultados.length, 2);
    assert.deepEqual(foraDoEscopo.map(conteudo), antes, 'as fontes fora do escopo ficam intactas byte a byte');
  } finally { p.limpar(); }
});

test('migracao preserva fontes e entradas preexistentes; repete IDs e contagens por origem/hash', () => {
  const { p, driver, thread } = fixture();
  try {
    driver.adicionar({ collection: 'decision', content: 'Registro anterior de outro fluxo, preservado.', tags: { project: ['orkastery'] }, priority: 'medium', metadata: {} });
    const anterior = JSON.stringify(driver.tudo());
    const i = inventariarHandoffs(p.carregado, [thread.id]);
    const bytes = i.fontes.map(f => fs.readFileSync(path.join(p.dir, f.arquivo)));
    const a = migrarHandoffs(p.carregado, { operadora: thread.id, escopo: [thread.id], driver, inventario: i });
    assert.equal(a.ok, true); assert.equal(a.antes.decision, 1); assert.equal(a.resultados.length, 2);
    const b = migrarHandoffs(p.carregado, { operadora: thread.id, escopo: [thread.id], driver, inventario: i });
    assert.equal(b.ok, true); assert.deepEqual(a.depois, b.depois);
    assert.deepEqual(a.resultados.map(r => r.readback), b.resultados.map(r => r.readback));
    assert.ok(b.resultados.every(r => r.gravacao?.duplicada));
    assert.equal(new Set(a.resultados.map(r => r.gravacao?.id)).size, 2, 'origens diferentes conservam identidades distintas');
    assert.equal(JSON.stringify(driver.tudo().filter(e => e.collection === 'decision')), anterior);
    i.fontes.forEach((f, n) => assert.deepEqual(fs.readFileSync(path.join(p.dir, f.arquivo)), bytes[n]));
  } finally { p.limpar(); }
});

test('preflight recusa inventario incompleto, fonte alterada e handoff invalido antes de gravar', () => {
  const { p, driver, exportado, thread } = fixture();
  try {
    const i = inventariarHandoffs(p.carregado, [thread.id]);
    assert.throws(() => migrarHandoffs(p.carregado, { operadora: thread.id, escopo: [thread.id], driver, inventario: { ...i, fontes: i.fontes.slice(1) } }), /incomplete-inventory/);
    fs.appendFileSync(exportado.caminhoHistorico, '\n');
    assert.throws(() => migrarHandoffs(p.carregado, { operadora: thread.id, escopo: [thread.id], driver, inventario: i }), /source-changed/);
    fs.writeFileSync(exportado.caminhoHistorico, '{}');
    assert.throws(() => migrarHandoffs(p.carregado, { operadora: thread.id, escopo: [thread.id], driver }), /invalid-inventory/);
    assert.equal(driver.tudo().length, 0);
  } finally { p.limpar(); }
});

test('readback incompleto e erro de contagem nunca viram migracao aprovada ou base vazia', () => {
  const { p, driver, thread } = fixture();
  try {
    const submeter = driver.submeterHandoff.bind(driver);
    driver.submeterHandoff = pedido => {
      const r = submeter(pedido);
      driver.tudo().find(e => e.id === r.package_entry_id)!.content = '{}';
      return r;
    };
    const r = migrarHandoffs(p.carregado, { operadora: thread.id, escopo: [thread.id], driver });
    assert.equal(r.ok, false); assert.equal(r.falhas, 2);
    assert.ok(r.resultados.every(i => i.erro === 'memory.migration.readback-mismatch'));
    driver.contagens = () => { throw new Error('memory.transport.failed'); };
    assert.throws(() => migrarHandoffs(p.carregado, { operadora: thread.id, escopo: [thread.id], driver }), /memory.transport.failed/);
  } finally { p.limpar(); }
});

test('CLI sync distingue files explicito de OrkMind pedido sem publicacao disponivel', () => {
  const { p } = fixture();
  try {
    const executar = () => spawnSync(process.execPath,
      [path.resolve(__dirname, '../src/index.js'), 'memory', 'sync', '--json'],
      { cwd: p.dir, encoding: 'utf8', env: { ...process.env, TENANT_DE_TESTE: '' } });
    const files = executar();
    assert.equal(files.status, 0);
    const informativo = JSON.parse(files.stdout);
    assert.equal(informativo.estado.pedido, 'files'); assert.equal(informativo.regime, 'files');
    assert.ok(informativo.falhas > 0, 'saida nao alega publicacao no banco');
    const arquivo = path.join(p.dir, 'orkastery.yaml');
    fs.writeFileSync(arquivo, fs.readFileSync(arquivo, 'utf8').replace(/^  mode: files$/m, '  mode: orkmind')
      .replace(/^  database_url_env: ""$/m, '  database_url_env: "TENANT_DE_TESTE"'));
    const indisponivel = executar();
    assert.equal(indisponivel.status, 1);
    const falha = JSON.parse(indisponivel.stdout);
    assert.equal(falha.estado.pedido, 'orkmind'); assert.equal(falha.regime, 'files');
    assert.ok(falha.falhas > 0, 'degradacao nao pode confirmar sync sem gravacao');
    assert.equal(falha.publicacao.estado, 'pendente');
    assert.equal(falha.erro, 'write.activation.inactive');
    assert.deepEqual(falha.gravadas, []);
    assert.match(falha.detalhe, /colisao legada nao foi reavaliada/);
    assert.ok(!fs.existsSync(path.join(p.dir, '.orkastery/monitor/write-activation.json')));
  } finally { p.limpar(); }
});

test('escopo exige autorizacao antes de ler/publicar; fontes alheias e replay preservam bytes e contagens', () => {
  const { p, thread, driver } = fixture();
  try {
    const files = { ...p.carregado, manifesto: { ...p.carregado.manifesto,
      memory: { ...p.carregado.manifesto.memory, mode: 'files' as const } } };
    const operadora = novaThread(files, { nome: 'operadora', modo: 'auto' }).thread;
    const alheia = novaThread(files, { nome: 'fora do escopo', modo: 'auto' }).thread;
    exportarHandoff(files, alheia.id, { proximaFase: 'GOAL' });
    const raizThreads = path.join(p.dir, '.orkastery/threads');
    const snapshot = (id: string) => (fs.readdirSync(path.join(raizThreads, id), { recursive: true }) as string[])
      .filter(f => fs.statSync(path.join(raizThreads, id, f)).isFile()).sort()
      .map(f => [f, fs.readFileSync(path.join(raizThreads, id, f)).toString('hex')]);
    const antes = [snapshot(thread.id), snapshot(alheia.id)];
    assert.throws(() => inventariarHandoffs(p.carregado), /scope.write.required/);
    for (const id of ['ork-grandeevoluc', 'ork-jornadasdpa', 'ork-renarrativac', '../escape']) {
      assert.throws(() => inventariarHandoffs(p.carregado, [id]), /scope.thread/);
      assert.throws(() => migrarHandoffs(p.carregado, { driver, operadora: id, escopo: [thread.id] }), /scope.thread/);
    }
    assert.equal(driver.tudo().length, 0);
    const inventario = inventariarHandoffs(p.carregado, [thread.id]);
    assert.ok(inventario.fontes.every(f => f.thread === thread.id));
    const args = { driver, operadora: operadora.id, escopo: [thread.id, operadora.id], inventario, operacaoId: 'replay-explicito' };
    const first = migrarHandoffs(p.carregado, args);
    assert.equal(first.ok, true);
    const log = path.join(raizThreads, operadora.id, 'ledger.jsonl');
    const depois = fs.readFileSync(log);
    assert.equal(migrarHandoffs(p.carregado, args).ok, true);
    assert.deepEqual(fs.readFileSync(log), depois, 'replay nao acumula auditoria');
    assert.deepEqual(driver.contagens(), first.depois);
    assert.deepEqual([snapshot(thread.id), snapshot(alheia.id)], antes, 'origem e nao autorizada byte a byte');
    const eventos = depois.toString().trim().split('\n').map(l => JSON.parse(l)).filter(e => e.tipo === 'memory_migrated');
    assert.equal(eventos.length, 2);
    assert.ok(eventos.every(e => e.thread === operadora.id && e.fonteThread === thread.id));
    const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../src/index.js'), 'memory', 'migrate',
      '--escopo', thread.id, '--dry-run', '--json'], { cwd: p.dir, encoding: 'utf8' });
    assert.equal(cli.status, 0); assert.equal(JSON.parse(cli.stdout).incluidos, 2);
    assert.deepEqual(fs.readFileSync(log), depois);
    assert.throws(() => migrarHandoffs(p.carregado, { ...args, inventario: { ...inventario,
      fontes: inventario.fontes.map(f => ({ ...f, thread: alheia.id })) } }), /incomplete-inventory/);
  } finally { p.limpar(); }
});


test('aliases de thread e de pasta de fontes nao ampliam escopo por symlink', () => {
  const { p, thread, driver } = fixture();
  try {
    const threads = path.join(p.dir, '.orkastery/threads');
    fs.symlinkSync(path.join(threads, thread.id), path.join(threads, 'alias-fonte'));
    assert.throws(() => inventariarHandoffs(p.carregado, ['alias-fonte']), /scope.thread.alias/);
    assert.throws(() => migrarHandoffs(p.carregado, { driver, operadora: 'alias-fonte', escopo: [thread.id, 'alias-fonte'] }), /scope.thread.alias/);
    const fontes = path.join(threads, thread.id, 'handoffs');
    fs.renameSync(fontes, fontes + '-preservadas');
    fs.symlinkSync(fontes + '-preservadas', fontes);
    assert.throws(() => inventariarHandoffs(p.carregado, [thread.id]), /memory.inventory.special-file/);
    assert.equal(driver.tudo().length, 0);
  } finally { p.limpar(); }
});

test('CG2: operadora fora da allowlist e recusada sem alterar fonte, operadora ou driver', () => {
  const { p, driver, thread } = fixture();
  try {
    const files = { ...p.carregado, manifesto: { ...p.carregado.manifesto,
      memory: { ...p.carregado.manifesto.memory, mode: 'files' as const } } };
    const op = novaThread(files, { nome: 'operadora alheia', modo: 'auto' }).thread;
    const logs = [thread.id, op.id].map(id => path.join(p.dir, '.orkastery/threads', id, 'ledger.jsonl'));
    const before = logs.map(f => fs.readFileSync(f));
    assert.throws(() => migrarHandoffs(p.carregado, { driver, operadora: op.id, escopo: [thread.id] }), /scope.thread.unauthorized/);
    logs.forEach((f, i) => assert.deepEqual(fs.readFileSync(f), before[i]));
    assert.equal(driver.tudo().length, 0);
  } finally { p.limpar(); }
});

test('CG3: replay da operacao falha nao reenvia; tentativa nova preserva nova falha real', () => {
  const { p, driver, thread } = fixture();
  try {
    let chamadas = 0;
    driver.submeterHandoff = () => { chamadas++; return { ok: false, id: null, duplicada: false,
      collection: 'handoff', detalhe: 'falha isolada' }; };
    const args = { driver, operadora: thread.id, escopo: [thread.id], operacaoId: 'operacao-a' };
    const log = path.join(p.dir, '.orkastery/threads', thread.id, 'ledger.jsonl');
    const a = migrarHandoffs(p.carregado, args), before = fs.readFileSync(log);
    assert.equal(a.falhas, 2); assert.equal(chamadas, 2);
    const b = migrarHandoffs(p.carregado, args);
    assert.equal(b.falhas, 2); assert.equal(b.ok, false);
    assert.ok(b.resultados.every(r => 'replay' in r && r.replay === true));
    assert.equal(chamadas, 2, 'replay consulta recibos da mesma operacao, sem nova tentativa');
    assert.deepEqual(fs.readFileSync(log), before);
    assert.deepEqual(a.depois, b.depois);
    const tentativaNova = { ...args, operacaoId: 'operacao-b' };
    assert.equal(migrarHandoffs(p.carregado, tentativaNova).falhas, 2);
    assert.equal(chamadas, 4);
    assert.equal(migrarHandoffs(p.carregado, { driver, operadora: thread.id, escopo: [thread.id] }).falhas, 2);
    assert.equal(chamadas, 6, 'chamada sem ID e tentativa real nova');
    const falhas = fs.readFileSync(log, 'utf8').trim().split('\n').map(s => JSON.parse(s)).filter(e => e.tipo === 'memory_migration_failed');
    assert.equal(falhas.length, 6); assert.equal(new Set(falhas.map(e => e.operacaoId)).size, 3);
  } finally { p.limpar(); }
});

test('F4: replay misto recupera sucesso e falha; ID novo tenta de novo e pode ser retomado', () => {
  const { p, driver, thread } = fixture();
  try {
    const submit = driver.submeterHandoff.bind(driver); let chamadas = 0, falhar = true;
    driver.submeterHandoff = pedido => {
      chamadas++;
      return falhar && chamadas === 2 ? { ok: false, id: null, duplicada: false, collection: 'handoff', detalhe: 'sintetico' } : submit(pedido);
    };
    const args = { driver, operadora: thread.id, escopo: [thread.id], operacaoId: 'mista' };
    const first = migrarHandoffs(p.carregado, args);
    assert.equal(first.falhas, 1); assert.equal(chamadas, 2);
    const log = path.join(p.dir, '.orkastery/threads', thread.id, 'ledger.jsonl');
    const bytes = fs.readFileSync(log);
    const replay = migrarHandoffs(p.carregado, args);
    assert.equal(chamadas, 2); assert.equal(replay.falhas, 1);
    assert.ok(replay.resultados.every(r => 'replay' in r && r.replay === true));
    assert.deepEqual(fs.readFileSync(log), bytes);
    falhar = false;
    const next = { ...args, operacaoId: 'mista-nova' };
    assert.equal(migrarHandoffs(p.carregado, next).falhas, 0); assert.equal(chamadas, 4);
    const after = fs.readFileSync(log);
    assert.equal(migrarHandoffs(p.carregado, next).falhas, 0); assert.equal(chamadas, 4);
    assert.deepEqual(fs.readFileSync(log), after);
    assert.throws(() => migrarHandoffs(p.carregado, { ...args, operacaoId: '!' }), /operation-invalid/);
  } finally { p.limpar(); }
});

test('repositorio alvo declarado: so a linha explicita classifica, e o proprio projeto nao vira externo', () => {
  assert.deepEqual(repositorioAlvoDeclarado('Repo alvo: `/srv/projetos/Outro-Board`.'), { nome: 'Outro-Board', tenant: 'outro-board' });
  assert.deepEqual(repositorioAlvoDeclarado('x\n  repo alvo: C:\\dev\\Meu App\\\n'), { nome: 'Meu App', tenant: 'meu-app' });
  assert.equal(repositorioAlvoDeclarado('O Outro-Board aparece aqui sem declarar origem.'), null);
  assert.equal(repositorioAlvoDeclarado('Repo alvo: `/`'), null);
});
