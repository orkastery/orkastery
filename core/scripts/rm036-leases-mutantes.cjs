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
  'B1-ttl': [[lease, 'fim - inicio > exports.TTL_PADRAO_MS + 1_000', 'false']],
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
      'fs.constants.O_RDONLY | fs.constants.O_NONBLOCK', 2],
    [lease, '!identidadeLegada.isFile()', 'false'],
    [lease, 'lease && identidadeLegada.isFile()', 'lease']],
  'A3-link-diretorio': [[lease, 'return fs.lstatSync(caminho).isDirectory();', 'return fs.statSync(caminho).isDirectory();']],
  'S1-liberar': [[lease, 'lease: lerArquivoDeLease(canonico)',
    'lease: lerArquivoDeLease(canonico) ?? copiasLegadas(raiz, nome)[0]?.lease ?? null']],
  'S3-planejar': [[board, '[...new Set(ativos.filter((l) => l.thread === t.id).map((l) => l.nome))]',
    'ativos.filter((l) => l.thread === t.id).map((l) => l.nome)', 2]],
  'S5-deduplicar': [[lease, ' || nomes.has(l.nome)', '']],
  'S5-fila-atomica': [[lease, 'const temporario = `${caminho}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.tmp`;',
    'const temporario = caminho;']],
  'S5-prazo': [[paralelo, '}, 60_000);', '}, 60_001);']],
  'S6-wx': [[lease, ' || (!atual && escritaRecente(caminho))', ''],
    [lease, ' || (!atual && Date.now() - fs.fstatSync(fd).mtimeMs < 5_000)', '']],
  'S7-vinculo': [[lease, '!volta || real(path.resolve(path.dirname(gitDaWorktree), volta[1].trim())) !== real(entrada)', 'false']],
  'S8-janela': [[feat7, 'janela de 30 minutos', 'legado lido até vencer', 2]],
  'S8-fila': [[feat29, 'A fila legada não é lida', 'A espera legada entra na fila canônica']],
  'S8-plan-privado': [[rm, 'os leases das famílias antigas passam ao domínio canônico',
    'O inventário está no PLAN da thread; os leases das famílias antigas passam ao domínio canônico']],
  'S8-prova-publica': [[rm, 'Cenários executáveis:', 'os testes caem com o código anterior. Cenários executáveis:']],
  'S8-cli': [[cli, 'Todas as famílias e a fila por colisão moram no', 'A exec mora no']],
  'S8-changelog': [['CHANGELOG.md', 'a fila legada não é lida', 'a espera legada entra na fila canônica']],
  'R2-B2-nome': [[lease, '!nomeLegadoSeguro(lease.nome)', 'false']],
  'R2-B2-aspas': [[lease, 'function argumentoDeLease(texto) {', 'function argumentoDeLease(texto) { return JSON.stringify(texto);']],
  'R2-B2-monitor': [['core/dist-test/src/orquestracao.js', '(0, leases_1.argumentoDeLease)(p.colidiuCom)', 'p.colidiuCom']],
  'R2-A1-primeira-consulta': [[lease, "fs.closeSync(fs.openSync(marcador, 'wx'));", '/* marcador adiado ate descobrir legado */']],
  'R2-A1-renovar': [[lease, "fs.closeSync(fs.openSync(marcador, 'wx'));", "fs.writeFileSync(marcador, '');"]],
  'R2-A2-tolerancia': [[lease, 'fim - inicio > exports.TTL_PADRAO_MS + 1_000', 'fim - inicio > exports.TTL_PADRAO_MS']],
  'R2-A3-adquirir': [[lease, 'tomouLegado = true;', 'fs.unlinkSync(copia.caminho); tomouLegado = true;']],
  'R2-A3-inode': [[lease, ' || atual.dev !== identidade.dev || atual.ino !== identidade.ino', '']],
  'R2-A4-trava': [[lease, 'trava.status === 1', 'false']],
  'R2-A4-inode': [[lease, ' || agoraNoPath.dev !== stat.dev || agoraNoPath.ino !== stat.ino', '']],
  'R2-A4-releitura': [[lease, '(atual && !expirado(atual)) || (!atual && Date.now() - fs.fstatSync(fd).mtimeMs < 5_000)', 'false']],
  'R2-A5-dry-run': [['core/dist-test/src/ship.js', '(0, leases_1.leasesColidentes)(raiz, leases_1.LEASE_MAIN_TREE)[0] ?? null',
    '(0, leases_1.lerLease)(raiz, leases_1.LEASE_MAIN_TREE)']],
  // R2-B2-diagnostico/roundtrip foram retirados: nao existe mais comando no diagnostico legado.
  'R3-legado-diagnostico': [[lease, "linhas.push('    arquivo legado preservado; ignorado sem alterar o lease canonico');",
    "linhas.push(`    remover: ork lease release ${argumentoDeLease(nome)} --forcar`);"]],
  'R3-legado-unlink': [[lease, "fs.writeFileSync(marcaDeLegado(raiz, identidade), '', { flag: 'wx' });",
    "fs.unlinkSync(caminho); fs.writeFileSync(marcaDeLegado(raiz, identidade), '', { flag: 'wx' });"]],
  'R3-legado-marca': [[lease, 'return arquivoDeVerdade(marcaDeLegado(raiz, identidade));', 'return false;']],
  'R3-legado-origens': [[lease, 'if (copias.length === 0) {\n        for (const copia of copiasLegadas(raiz, nome))', 'if (true) {\n        for (const copia of copiasLegadas(raiz, nome))']],
  'R3-liberado-sem-efeito': [[lease, 'if (removidas.length === 0)', 'if (false)']],
  'R3-flock-indisponivel': [[lease, "trava.error || (trava.status !== 0 && trava.status !== 1)", 'false']],
  'R3-retomada-nlink': [[lease, ' || stat.nlink !== 1', '']],
  'R3-retomada-tipagem': [[lease, "falhaRetomada: 'lease.resume-unavailable'", 'falhaRetomada: undefined']],
  'R3-retomada-regiao': [[lease, "motivo: r.falhaRetomada ?? 'lease.busy'", "motivo: 'lease.busy'"]],
  'R3-retomada-correcao': [[lease, 'ork lease release ${argumentoDeLease(nome)} --forcar; depois repita a aquisicao', 'espere a vez']],
  'R3-retomada-retry': [['core/dist-test/src/retry.js', "motivo: 'lease.resume-unavailable',\n        acao: 'corrigir-dirigido',\n        automatica: false",
    "motivo: 'lease.resume-unavailable',\n        acao: 'corrigir-dirigido',\n        automatica: true"]],
  'R3-motivo-legado': [[lease, "motivo: '(legado)'", 'motivo: lease.motivo']],
  'R3-ship-motivo': [['core/dist-test/src/ship.js', "aquisicao.motivo ?? 'lease.busy'", "'lease.busy'", 2]],
  'R3-ship-correcao': [['core/dist-test/src/ship.js', 'aquisicao.correcao', "'ork lease release main-tree --forcar'"]],
  'R3-docs-legado': [[feat7, 'O legado nunca é apagado', 'O legado é apagado']],
  'R3-docs-retomada': [[cli, 'lease.resume-unavailable', 'lease.busy']],
  'R3-docs-motivo': [[feat29, '(legado)', 'texto livre']],
  'R3-docs-changelog': [['CHANGELOG.md', 'Nenhuma liberação é anunciada quando nada saiu', 'Liberação anunciada mesmo sem efeito']],
  'R2-docs-janela': [[feat7, 'primeira consulta desta versão, mesmo sem legado', 'primeira descoberta de legado']],
};

function aplicar(texto, relativo, receitas, nome) {
  let alterado = texto;
  for (const [alvo, antes, depois, quantidade = 1] of receitas) {
    if (alvo !== relativo) continue;
    if (alterado.split(antes).length - 1 !== quantidade) throw new Error(`receita desatualizada: ${nome} em ${relativo}`);
    alterado = alterado.split(antes).join(depois);
  }
  if (relativo.endsWith('.js')) new Script(alterado, { filename: relativo });
  return alterado;
}

if (process.argv.includes('--listar')) {
  console.log(['controle', ...Object.keys(mutantes)].join('\n'));
} else if (process.argv.includes('--validar')) {
  // Confere receitas e sintaxe sem executar mutantes nem escrever estado.
  for (const [nome, receitas] of Object.entries(mutantes)) {
    for (const relativo of new Set(receitas.map(([arquivo]) => arquivo))) {
      aplicar(fs.readFileSync(path.join(projeto, relativo), 'utf8'), relativo, receitas, nome);
    }
  }
  console.log(`${Object.keys(mutantes).length} receitas validas; mutantes nao executados`);
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
  const receitas = mutantes[nome] || [];
  for (const relativo of new Set(receitas.map(([arquivo]) => arquivo))) {
    const alvo = path.join(destino, relativo), texto = fs.readFileSync(alvo, 'utf8');
    fs.writeFileSync(alvo, aplicar(texto, relativo, receitas, nome));
  }
  console.log(`RM-036 mutante: ${nome}`);
  for (const teste of ['rm036-leases-gofix', 'rm036-leases-docs', 'rm036-leases-canonicos']) {
    require(path.join(destino, 'core/dist-test/test', `${teste}.test.js`));
  }
}
