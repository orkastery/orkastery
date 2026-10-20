/**
 * RM-062 (F2): a barreira de dado privado no `ork verify` (DV) e no `ork ci prepare` (DB), pela policy `dado_privado`.
 * Todo valor daqui é inventado; o arquivo entra nas exceções versionadas por caminho, só para os padrões genéricos.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ajustarManifesto, commitar, dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';
import { prepararBundleCi } from '../src/ci';
import { adicionarClaim } from '../src/claims';
import { lerLedger } from '../src/ledger';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { textoDoVerify, verificar } from '../src/verify';
import { garantirWorktree } from '../src/worktree';
import { exec } from '../src/util';

const HOME_FICTICIA = '/home/fulana-de-teste';
const EMAIL_FICTICIO = 'contato@empresa-ficticia.com.br';
const TERMO_FICTICIO = 'tralala-quarenta-e-dois';
const VALORES = [HOME_FICTICIA, 'fulana-de-teste', EMAIL_FICTICIO, 'empresa-ficticia', TERMO_FICTICIO];

/** Um projeto com a policy declarada (ou não) e uma thread com worktree. */
function cenario(nome: string, severidade: 'block' | 'warn' | 'off' | null): { p: ProjetoDeTeste; id: string; wt: string } {
  const p = projetoTemporario(`dado-privado-${nome}`);
  if (severidade) {
    ajustarManifesto(p, /^policies:\n/m, `policies:\n  dado_privado: ${severidade}\n`);
  }
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  garantirWorktree(p.carregado, thread.id);
  return { p, id: thread.id, wt: lerThread(p.dir, thread.id).worktree as string };
}

/** Roda `corpo` com a lista local de `termos` (ou ausente: a variável aponta para um arquivo que não existe). */
function comLista<T>(termos: string[] | null, corpo: () => T): T {
  const antes = process.env.ORK_TERMOS_PRIVADOS;
  const pasta = dirTemporario('dado-privado-lista');
  const arquivo = path.join(pasta, 'termos-privados.txt');
  if (termos) fs.writeFileSync(arquivo, termos.join('\n') + '\n', { mode: 0o600 });
  process.env.ORK_TERMOS_PRIVADOS = arquivo;
  try { return corpo(); } finally {
    if (antes === undefined) delete process.env.ORK_TERMOS_PRIVADOS; else process.env.ORK_TERMOS_PRIVADOS = antes;
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

function semValores(texto: string, onde: string): void {
  for (const v of VALORES) assert.equal(texto.toLowerCase().includes(v.toLowerCase()), false, `${onde} repetiu ${v.slice(0, 3)}...`);
}

test('DV1: com dado_privado em block, achado no diff da thread reprova o verify com policy.violation, sem o valor', () => {
  const { p, id, wt } = cenario('dv1', 'block');
  try {
    commitar(wt, 'docs/nota.md', `# nota\nrodou em ${HOME_FICTICIA}/projeto\n`, 'nota');
    const r = comLista(null, () => verificar(p.carregado, id, { soClaims: true }));
    assert.equal(r.ok, false);
    assert.deepEqual(r.motivos, ['policy.violation']);
    assert.deepEqual(r.dadoPrivado?.varredura.achados, [{ arquivo: 'docs/nota.md', linha: 2, coluna: 10, padrao: 'home' }]);
    const eventos = lerLedger(dirThread(p.dir, id));
    const run = eventos.filter((e) => e.tipo === 'verify_run').at(-1)!;
    const resumo = run.dadoPrivado as { policy: string; achados: number; onde: string[]; padroes: string[] };
    assert.equal(resumo.policy, 'block');
    assert.equal(resumo.achados, 1);
    assert.deepEqual(resumo.onde, ['docs/nota.md:2']);
    assert.deepEqual(resumo.padroes, ['home']);
    const bloqueio = eventos.filter((e) => e.tipo === 'gate_blocked').at(-1)!;
    assert.equal(bloqueio.gate, 'verify');
    assert.equal(bloqueio.motivo, 'policy.violation');
    assert.match(String(bloqueio.detalhe), /policy dado_privado: 1 achado\(s\) de dado privado \(home\) .*docs\/nota\.md:2/);
    assert.match(String(bloqueio.correcao), /orkastery\.privado\.json/);
    const texto = textoDoVerify(r);
    assert.match(texto, /Dado privado \(policy dado_privado em block\):/);
    assert.match(texto, / {4}docs\/nota\.md:2:10 {2}home/);
    semValores(texto, 'o texto do verify');
    semValores(fs.readFileSync(path.join(dirThread(p.dir, id), 'ledger.jsonl'), 'utf8'), 'o ledger');
  } finally { p.limpar(); }
});

test('DV2: com dado_privado em warn, o verify segue verde, grava policy_warn e mostra o aviso', () => {
  const { p, id, wt } = cenario('dv2', 'warn');
  try {
    commitar(wt, 'a.txt', `${EMAIL_FICTICIO}\n`, 'email');
    const r = comLista(null, () => verificar(p.carregado, id, { soClaims: true }));
    assert.equal(r.ok, true);
    assert.deepEqual(r.motivos, []);
    const aviso = lerLedger(dirThread(p.dir, id)).filter((e) => e.tipo === 'policy_warn').at(-1)!;
    assert.equal(aviso.gate, 'verify');
    assert.equal(aviso.policy, 'dado_privado');
    assert.match(String(aviso.detalhe), /1 achado\(s\) de dado privado \(email\)/);
    assert.match(textoDoVerify(r), /Dado privado \(policy dado_privado em warn\):/);
  } finally { p.limpar(); }
});

test('DV3: sem a policy, ou com ela em off, o verify não varre nada e o ledger não muda', () => {
  for (const severidade of [null, 'off'] as const) {
    const { p, id, wt } = cenario(`dv3-${severidade ?? 'sem'}`, severidade);
    try {
      commitar(wt, 'a.txt', `${HOME_FICTICIA}\n`, 'home');
      const r = comLista(null, () => verificar(p.carregado, id, { soClaims: true }));
      assert.equal(r.ok, true);
      assert.equal(r.dadoPrivado, null);
      const run = lerLedger(dirThread(p.dir, id)).filter((e) => e.tipo === 'verify_run').at(-1)!;
      assert.equal('dadoPrivado' in run, false);
      assert.equal(textoDoVerify(r).includes('Dado privado'), false);
    } finally { p.limpar(); }
  }
});

test('DV4: sem a lista local, o verify diz que só os padrões genéricos rodaram; com ela, o termo reprova sem sair', () => {
  const { p, id, wt } = cenario('dv4', 'block');
  try {
    commitar(wt, 'notas.txt', `a máquina ${TERMO_FICTICIO} rodou\n`, 'termo');
    const sem = comLista(null, () => verificar(p.carregado, id, { soClaims: true }));
    assert.equal(sem.ok, true);
    assert.match(textoDoVerify(sem), /lista local {2}ausente \(procurada em arquivo indicado por ORK_TERMOS_PRIVADOS\): so os padroes genericos \(home, email, hostname\)/);
    assert.equal(sem.dadoPrivado?.varredura.listaLocal.presente, false);
    const com = comLista([TERMO_FICTICIO], () => verificar(p.carregado, id, { soClaims: true }));
    assert.equal(com.ok, false);
    assert.deepEqual(com.dadoPrivado?.varredura.achados.map((a) => [a.arquivo, a.linha, a.padrao, a.termo]),
      [['notas.txt', 1, 'lista-local', 1]]);
    const texto = textoDoVerify(com);
    assert.match(texto, /lista local {2}1 termo\(s\) de /);
    assert.match(texto, /notas\.txt:1:11 {2}lista-local \(termo 1\)/);
    semValores(texto, 'o texto do verify');
    semValores(fs.readFileSync(path.join(dirThread(p.dir, id), 'ledger.jsonl'), 'utf8'), 'o ledger');
  } finally { p.limpar(); }
});

test('DV5: o arquivo não rastreado e o nome acrescentado entram; a linha que já estava na base não', () => {
  const p = projetoTemporario('dado-privado-dv5');
  try {
    ajustarManifesto(p, /^policies:\n/m, 'policies:\n  dado_privado: block\n');
    commitar(p.dir, 'antigo.txt', `${EMAIL_FICTICIO}\n`, 'linha da base');
    const { thread } = novaThread(p.carregado, { nome: 'dv5', modo: 'auto' });
    garantirWorktree(p.carregado, thread.id);
    const wt = lerThread(p.dir, thread.id).worktree as string;
    commitar(wt, `evidencia/${TERMO_FICTICIO}.json`, '{}\n', 'nome com o termo');
    fs.writeFileSync(path.join(wt, 'solto.txt'), `nada\n${HOME_FICTICIA}\n`);
    const r = comLista([TERMO_FICTICIO], () => verificar(p.carregado, thread.id, { soClaims: true }));
    assert.deepEqual(r.dadoPrivado?.varredura.achados.map((a) => `${a.arquivo}:${a.linha ?? 'nome'}:${a.padrao}`),
      ['evidencia/[omitido].json:nome:lista-local', 'solto.txt:2:home']);
    assert.equal(r.ok, false);
  } finally { p.limpar(); }
});

test('DB1: com dado_privado em block, achado no diff recusa o ci prepare e o bundle não é gravado', () => {
  const { p, id, wt } = cenario('db1', 'block');
  try {
    commitar(wt, 'docs/nota.md', `rodou em ${HOME_FICTICIA}\n`, 'nota');
    let erro = '';
    comLista(null, () => { try { prepararBundleCi(p.carregado, id); } catch (e) { erro = (e as Error).message; } });
    assert.match(erro, /^privado\.achado: o bundle nao foi gerado; .*docs\/nota\.md:1/);
    assert.match(erro, /docs\/nota\.md:1:10 {2}home/);
    semValores(erro, 'a recusa');
    assert.equal(fs.existsSync(path.join(wt, '.ork-ci', `${id}.json`)), false);
  } finally { p.limpar(); }
});

test('DB2: termo da lista local na alegação de uma claim recusa o bundle (o texto do bundle é varrido)', () => {
  const { p, id, wt } = cenario('db2', 'block');
  try {
    commitar(wt, 'core/fatia.txt', 'fatia\n', 'fatia');
    adicionarClaim(p.dir, id, { arquivo: 'core/fatia.txt', alegacao: `a fatia roda em ${TERMO_FICTICIO}`, verificar: ['test -f core/fatia.txt'] });
    let erro = '';
    comLista([TERMO_FICTICIO], () => { try { prepararBundleCi(p.carregado, id); } catch (e) { erro = (e as Error).message; } });
    assert.match(erro, new RegExp(`\\.ork-ci/${id}\\.json:\\d+:\\d+ {2}lista-local \\(termo 1\\)`));
    semValores(erro, 'a recusa');
    assert.equal(fs.existsSync(path.join(wt, '.ork-ci', `${id}.json`)), false);
  } finally { p.limpar(); }
});

test('DB3: com warn, o bundle sai com o aviso, o policy_warn vai ao ledger e a linha diz a lista ausente', () => {
  const { p, id, wt } = cenario('db3', 'warn');
  try {
    commitar(wt, 'a.txt', `${EMAIL_FICTICIO}\n`, 'email');
    const avisos: string[] = [];
    const informes: string[] = [];
    const arquivo = comLista(null, () => prepararBundleCi(p.carregado, id, { aoAvisar: (l) => avisos.push(l), aoInformar: (l) => informes.push(l) }));
    assert.equal(fs.existsSync(arquivo), true);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /^policy dado_privado: 1 achado\(s\) de dado privado \(email\)/);
    assert.equal(informes.length, 1);
    assert.match(informes[0], /^dado privado \(policy dado_privado em warn\): diff contra [0-9a-f]{12} \(merge-base com main\) e texto de \.ork-ci\//);
    assert.match(informes[0], /lista local ausente \(procurada em .*\); só os padrões genéricos \(home, email, hostname\)$/);
    const aviso = lerLedger(dirThread(p.dir, id)).filter((e) => e.tipo === 'policy_warn').at(-1)!;
    assert.equal(aviso.gate, 'ci.prepare');
    semValores([...avisos, ...informes].join('\n'), 'o aviso');
  } finally { p.limpar(); }
});

test('DB4: sem a policy, o ci prepare não varre nem avisa', () => {
  const { p, id, wt } = cenario('db4', null);
  try {
    commitar(wt, 'a.txt', `${HOME_FICTICIA}\n`, 'home');
    const avisos: string[] = [];
    const informes: string[] = [];
    const arquivo = comLista(null, () => prepararBundleCi(p.carregado, id, { aoAvisar: (l) => avisos.push(l), aoInformar: (l) => informes.push(l) }));
    assert.equal(fs.existsSync(arquivo), true);
    assert.deepEqual([avisos, informes], [[], []]);
  } finally { p.limpar(); }
});

test('DB5: o bundle anterior da própria thread sai do diff, porque o novo o substitui', () => {
  const { p, id, wt } = cenario('db5', 'block');
  try {
    commitar(wt, `.ork-ci/${id}.json`, `{"velho": "${HOME_FICTICIA}"}\n`, 'bundle velho');
    const arquivo = comLista(null, () => prepararBundleCi(p.carregado, id));
    assert.equal(fs.readFileSync(arquivo, 'utf8').includes('fulana-de-teste'), false);
  } finally { p.limpar(); }
});

test('DB6: block lê binário commitado e texto -diff, reprova o verify e não grava o bundle', () => {
  const { p, id, wt } = cenario('db6', 'block');
  try {
    fs.writeFileSync(path.join(wt, 'dados.bin'), Buffer.concat([
      Buffer.from([0, 1, 2]), Buffer.from(` ${TERMO_FICTICIO}\n`),
    ]));
    fs.writeFileSync(path.join(wt, '.gitattributes'), 'notas.txt -diff\n');
    fs.writeFileSync(path.join(wt, 'notas.txt'), `${TERMO_FICTICIO}\n`);
    assert.ok(exec('git', ['add', '--', 'dados.bin', '.gitattributes', 'notas.txt'], wt).ok);
    assert.ok(exec('git', ['commit', '-q', '-m', 'binario e menos diff'], wt).ok);

    comLista([TERMO_FICTICIO], () => {
      const verify = verificar(p.carregado, id, { soClaims: true });
      assert.equal(verify.ok, false);
      assert.deepEqual(verify.motivos, ['policy.violation']);
      assert.deepEqual(verify.dadoPrivado?.varredura.achados.map((a) => [a.arquivo, a.padrao]),
        [['dados.bin', 'lista-local'], ['notas.txt', 'lista-local']]);

      let erro = '';
      try { prepararBundleCi(p.carregado, id); } catch (e) { erro = (e as Error).message; }
      assert.match(erro, /^privado\.achado: o bundle nao foi gerado/);
      assert.equal(fs.existsSync(path.join(wt, '.ork-ci', `${id}.json`)), false);
    });
  } finally { p.limpar(); }
});
