/**
 * Contraprovas do GO-FIX da RM-036. Nunca altera o checkout nem abre subprocessos.
 * Primeiro: npm --prefix core run build:test
 * Controle (deve passar), ou um nome de `node core/scripts/rm036-leases-mutantes.cjs --listar` (deve falhar):
 * ORK_RM036_MUTANT=controle node --experimental-test-isolation=none --test \
 *   --test-name-pattern='rm036 (gofix:|docs:|leases: orkEmParalelo)' core/scripts/rm036-leases-mutantes.cjs
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Script } = require('node:vm');

const projeto = path.resolve(__dirname, '../..');
const lease = 'core/dist-test/src/leases.js';
const board = 'core/dist-test/src/board.js';
const paralelo = 'core/dist-test/test/rm036-leases-canonicos.test.js';
const rm = 'docs/roadmap/RM-036-maestro-multicanal.md';
const feat7 = 'docs/produto/FEAT-007-worktree-e-leases.md';
const feat29 = 'docs/produto/FEAT-029-conducao-multicanal.md';
const cli = 'docs/referencia/cli.md';

// Cada receita retira uma guarda ou reintroduz o comportamento apontado no CHECK.
const mutantes = {
  'B1-nome': [[lease, 'path.basename(caminho) !== `${encodeURIComponent(lease.nome)}.json`', 'false']],
  'B1-thread': [[lease, '!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(lease.thread)', 'false']],
  'B1-iso': [[lease, 'new Date(inicio).toISOString() !== lease.adquiridoEm', 'false']],
  'B1-ttl': [[lease, 'fim - inicio > exports.TTL_PADRAO_MS', 'false']],
  'B1-controles': [[lease, "String(texto ?? '').replace(/[\\p{Cc}\\p{Cf}\\u2028\\u2029]/gu, '')", "String(texto ?? '')"]],
  'B1-posse': [[lease, 'return lerArquivoDeLease(caminhoLease(raiz, nome));',
    'return lerArquivoDeLease(caminhoLease(raiz, nome)) ?? copiasLegadas(raiz, nome)[0]?.lease ?? null;']],
  'B1-janela': [[lease, 'Date.now() - stat.mtimeMs < exports.TTL_PADRAO_MS', 'true']],
  'A1-fila-legada': [[lease, 'const todos = lerArquivoDeFila(caminhoFila(raiz)) ?? [];',
    'const todos = [...(lerArquivoDeFila(caminhoFila(raiz)) ?? []), ...dirsLegadosDeLeases(raiz).flatMap(d => lerArquivoDeFila(path.join(d, "fila.json")) ?? [])];']],
  'A1-autoespera': [[lease, 'if (proprio?.lease) {', 'if (false) {']],
  'A2-bloqueio': [[lease, 'if (copia.lease && !expirado(copia.lease)) {',
    'if (opcoes.retomarVencido === false || (copia.lease && !expirado(copia.lease))) {']],
  'A2-remocao': [[lease, 'copias.push(copia);', 'if (copia.lease) copias.push(copia);']],
  'A2-diagnostico': [[lease, 'if (tipoDoLease(nome) === \'exec\')\n                continue;',
    'if (true)\n                continue;']],
  'A3-link-arquivo': [
    [lease, 'return fs.lstatSync(caminho).isFile();', 'return fs.statSync(caminho).isFile();'],
    [lease, 'fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK',
      'fs.constants.O_RDONLY | fs.constants.O_NONBLOCK']],
  'A3-link-diretorio': [[lease, 'return fs.lstatSync(caminho).isDirectory();', 'return fs.statSync(caminho).isDirectory();']],
  'S1-liberar': [[lease, 'lease: lerArquivoDeLease(canonico)',
    'lease: lerArquivoDeLease(canonico) ?? copiasLegadas(raiz, nome)[0]?.lease ?? null']],
  'S3-planejar': [[board, '[...new Set(ativos.filter((l) => l.thread === t.id).map((l) => l.nome))]',
    'ativos.filter((l) => l.thread === t.id).map((l) => l.nome)', 2]],
  'S5-deduplicar': [[lease, ' || nomes.has(l.nome)', '']],
  'S5-fila-atomica': [[lease, 'const temporario = `${caminho}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.tmp`;',
    'const temporario = caminho;']],
  'S5-prazo': [[paralelo, '}, 60_000);', '}, 60_001);']],
  'S6-wx': [[lease, ' || (!atual && escritaRecente(caminho))', '']],
  'S7-vinculo': [[lease, '!volta || real(path.resolve(path.dirname(gitDaWorktree), volta[1].trim())) !== real(entrada)', 'false']],
  'S8-janela': [[feat7, 'janela de 30 minutos', 'legado lido até vencer', 2]],
  'S8-fila': [[feat29, 'A fila legada não é lida', 'A espera legada entra na fila canônica']],
  'S8-plan-privado': [[rm, 'os leases das famílias antigas passam ao domínio canônico',
    'O inventário está no PLAN da thread; os leases das famílias antigas passam ao domínio canônico']],
  'S8-prova-publica': [[rm, 'Cenários executáveis:', 'os testes caem com o código anterior. Cenários executáveis:']],
  'S8-cli': [[cli, 'Todas as famílias e a fila por colisão moram no', 'A exec mora no']],
  'S8-changelog': [['CHANGELOG.md', 'a fila legada não é lida', 'a espera legada entra na fila canônica']],
};

if (process.argv.includes('--listar')) {
  console.log(['controle', ...Object.keys(mutantes)].join('\n'));
} else {
  const nome = process.env.ORK_RM036_MUTANT || 'controle';
  if (nome !== 'controle' && !Object.hasOwn(mutantes, nome)) throw new Error(`mutante desconhecido: ${nome}`);
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm036-mutante-'));
  process.once('exit', () => fs.rmSync(destino, { recursive: true, force: true }));
  for (const relativo of ['core/dist-test', feat7, feat29, rm, cli, 'CHANGELOG.md']) {
    const alvo = path.join(destino, relativo);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.cpSync(path.join(projeto, relativo), alvo, { recursive: true });
  }
  // Fontes publicas citadas pelos testes de docs; dependencias sao somente lidas.
  for (const dir of ['src', 'test', 'node_modules', 'schemas', 'assets']) {
    fs.symlinkSync(path.join(projeto, 'core', dir), path.join(destino, 'core', dir), 'dir');
  }
  fs.copyFileSync(path.join(projeto, 'core/package.json'), path.join(destino, 'core/package.json'));
  for (const [relativo, antes, depois, quantidade = 1] of mutantes[nome] || []) {
    const alvo = path.join(destino, relativo), texto = fs.readFileSync(alvo, 'utf8');
    if (texto.split(antes).length - 1 !== quantidade) throw new Error(`receita desatualizada: ${nome} em ${relativo}`);
    const alterado = texto.split(antes).join(depois);
    if (relativo.endsWith('.js')) new Script(alterado, { filename: relativo });
    fs.writeFileSync(alvo, alterado);
  }
  console.log(`RM-036 mutante: ${nome}`);
  for (const teste of ['rm036-leases-gofix', 'rm036-leases-docs', 'rm036-leases-canonicos']) {
    require(path.join(destino, 'core/dist-test/test', `${teste}.test.js`));
  }
}
