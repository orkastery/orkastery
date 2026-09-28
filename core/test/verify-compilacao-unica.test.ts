/**
 * I-54 (RM-037, P2): compilacao unica por preparo explicito, com a identidade do produto conferida,
 * e `executado` no contrato. Os tres casos que o R1 do PLAN da I-37 exige, mais o caminho sem
 * preparo, que continua exatamente como antes.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { adicionarClaim, lerClaims } from '../src/claims';
import { DESCRICAO_DO_MOTIVO } from '../src/gates';
import { lerLedger } from '../src/ledger';
import { POLITICA_DE_RETRY } from '../src/retry';
import { dirThread, novaThread } from '../src/thread';
import { executar, identidadeDoProduto, textoDoVerify, verificar } from '../src/verify';
import { ajustarManifesto, projetoTemporario } from './apoio';

function contador(nome: string): { arquivo: string; linhas: () => number; limpar: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ork-${nome}-`));
  const arquivo = path.join(dir, 'preparos.txt');
  return { arquivo, linhas: () => (fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean).length : 0),
    limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('o preparo roda UMA vez para N claims, e cada claim ainda roda o proprio comando inteiro', () => {
  const p = projetoTemporario('verify-preparo-unico');
  const c = contador('preparo-unico');
  try {
    ajustarManifesto(p, '  # test: nao detectado', `  preparo: "echo compilou >> ${c.arquivo}"`);
    assert.equal(p.carregado.manifesto.verify.preparo, `echo compilou >> ${c.arquivo}`);
    const { thread: t } = novaThread(p.carregado, { nome: 'preparo', modo: 'auto' });
    for (const n of [1, 2, 3]) adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: `a${n}`, verificar: [`test -s ${c.arquivo}`] });

    const r = verificar(p.carregado, t.id, { soClaims: true });
    assert.equal(r.ok, true, r.motivos.join(','));
    assert.equal(c.linhas(), 1, 'uma compilacao para a rodada inteira');
    assert.deepEqual(r.claims.map((x) => x.execucoes.length), [1, 1, 1], 'nenhum comando de claim foi pulado');
    assert.ok(r.claims.every((x) => x.execucoes.every((e) => e.executado === true)));
    assert.equal(r.preparo?.produtoAlterado, false);
    assert.match(textoDoVerify(r), /preparo {5}ok em \d+ s, uma vez para a rodada; produto conferido do preparo ao fim/);

    const evento = lerLedger(dirThread(p.dir, t.id)).filter((e) => e.tipo === 'verify_run').at(-1)!;
    const preparo = evento.preparo as Record<string, unknown>;
    assert.equal(preparo.ok, true);
    assert.equal(preparo.produtoAlterado, false);
    assert.match(String(preparo.identidade), /^[0-9a-f]{16}$/);
  } finally { c.limpar(); p.limpar(); }
});

test('produto alterado entre o preparo e o fim da rodada invalida o veredito, mesmo com toda claim passando', () => {
  const p = projetoTemporario('verify-preparo-alterado');
  try {
    ajustarManifesto(p, '  # test: nao detectado', '  preparo: "true"');
    const { thread: t } = novaThread(p.carregado, { nome: 'alterado', modo: 'auto' });
    const mexe = adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'mexe no produto', verificar: ['echo mudou >> README.md'] });

    const r = verificar(p.carregado, t.id, { soClaims: true });
    assert.equal(r.claims[0].verificado, true, 'a claim em si passou');
    assert.equal(r.preparo?.produtoAlterado, true);
    assert.equal(r.ok, false);
    assert.deepEqual(r.motivos, ['verify.sem-veredito']);
    const bloqueio = lerLedger(dirThread(p.dir, t.id)).filter((e) => e.tipo === 'gate_blocked').at(-1)!;
    assert.equal(bloqueio.motivo, 'verify.sem-veredito');
    assert.match(String(bloqueio.detalhe), /o produto mudou entre o preparo e o fim da rodada/);
    assert.match(textoDoVerify(r), /produto MUDOU no meio da rodada: nenhum veredito vale/);
    assert.equal(lerClaims(p.dir, t.id).find((c) => c.id === mexe.id)?.estado, 'verificado');
  } finally { p.limpar(); }
});

test('comando que nao rodou sai como sem veredito, nunca como verificado, e nao reprova a alegacao', () => {
  const p = projetoTemporario('verify-nao-executado');
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'nao rodou', modo: 'auto' });
    const claim = adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'x', verificar: ['true'] });
    const r = verificar(p.carregado, t.id, { soClaims: true,
      executor: (nome, comando) => ({ nome, comando, ok: true, code: 0, resumo: 'recurso esgotado', executado: false }) });
    assert.equal(r.claims[0].verificado, false, 'ok: true sem execucao nao e prova');
    assert.equal(r.claims[0].motivo, 'verify.sem-veredito');
    assert.match(r.claims[0].detalhe, /comando "true" nao foi executado: recurso esgotado/);
    assert.deepEqual(r.motivos, ['verify.sem-veredito']);
    assert.equal(lerClaims(p.dir, t.id).find((c) => c.id === claim.id)?.estado, 'pendente', 'sem veredito nao carimba reprovado');
  } finally { p.limpar(); }
});

test('sem preparo declarado, nada muda: nem compilacao extra nem conferencia de produto', () => {
  const p = projetoTemporario('verify-sem-preparo');
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'sem preparo', modo: 'auto' });
    adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'mexe', verificar: ['echo mudou >> README.md'] });
    const r = verificar(p.carregado, t.id, { soClaims: true });
    assert.equal(r.preparo, null);
    assert.equal(r.ok, true);
  } finally { p.limpar(); }
});

test('executado no contrato: comando que o sistema nao lancou e false; estouro e falha rodaram', () => {
  assert.equal(executar('ok', 'true', process.cwd(), 10_000).executado, true);
  assert.equal(executar('falha', 'exit 3', process.cwd(), 10_000).executado, true);
  assert.equal(executar('estouro', 'sleep 5', process.cwd(), 1000).executado, true);
  const semDiretorio = executar('sem-cwd', 'true', path.join(os.tmpdir(), 'ork-nao-existe-i54', 'x'), 10_000);
  assert.equal(semDiretorio.executado, false, JSON.stringify(semDiretorio));
  assert.match(DESCRICAO_DO_MOTIVO['verify.sem-veredito'], /nao produziu veredito valido/);
  assert.equal(POLITICA_DE_RETRY['verify.sem-veredito'].acao, 'reexecutar');
  assert.equal(POLITICA_DE_RETRY['verify.sem-veredito'].automatica, true);
});

test('identidade do produto: conteudo, nao mtime; arquivo ignorado pelo git fica fora', () => {
  const p = projetoTemporario('verify-identidade');
  try {
    const antes = identidadeDoProduto(p.dir);
    const agora = new Date();
    fs.utimesSync(path.join(p.dir, 'README.md'), agora, agora);
    assert.equal(identidadeDoProduto(p.dir), antes, 'touch nao muda identidade');
    fs.writeFileSync(path.join(p.dir, 'solto.txt'), 'novo\n');
    const comSolto = identidadeDoProduto(p.dir);
    assert.notEqual(comSolto, antes, 'arquivo nao rastreado entra');
    fs.appendFileSync(path.join(p.dir, '.gitignore'), '\nbuild-local/\n');
    const comIgnore = identidadeDoProduto(p.dir);
    fs.mkdirSync(path.join(p.dir, 'build-local'));
    fs.writeFileSync(path.join(p.dir, 'build-local', 'saida.js'), 'x');
    assert.equal(identidadeDoProduto(p.dir), comIgnore, 'saida de build ignorada nao muda identidade');
  } finally { p.limpar(); }
});
