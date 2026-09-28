import { strict as assert } from 'node:assert';
import { test, mock } from 'node:test';
const childProcess: typeof import('node:child_process') = require('node:child_process');
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { criarExecutorSandbox, ResultadoSandbox } from '../src/verify-sandbox';
import { executar, gravarBaseline, verificar } from '../src/verify';
import { adicionarClaim } from '../src/claims';
import { ship } from '../src/ship';
import { lerLedger } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { commitar, projetoTemporario } from './apoio';

const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-test-sandbox-'));
  const wt = path.join(base, 'wt'); fs.mkdirSync(wt); fs.mkdirSync(path.join(wt, '.git'));
  const externo = path.join(base, 'externo'); fs.writeFileSync(externo, 'original');
  fs.writeFileSync(path.join(wt, '.git', 'sentinel'), 'git-original');
  const e = criarExecutorSandbox({ worktree: wt, timeoutMs: 3_000 });
  return { base, wt, externo, e, limpar: () => { e.fechar(); fs.rmSync(base, { recursive: true, force: true }); } };
}

test('sandbox real permite WT, bloqueia externo, symlink, Git e rede, preservando stdout/exit', () => {
  const f = fixture();
  try {
    const positivo = f.e.executar('ok', 'echo real-output; echo gravado > local.txt', f.wt) as ResultadoSandbox;
    assert.equal(positivo.ok, true, positivo.resumo); assert.match(positivo.stdout, /real-output/);
    assert.equal(fs.readFileSync(path.join(f.wt, 'local.txt'), 'utf8'), 'gravado\n');
    fs.symlinkSync(f.externo, path.join(f.wt, 'atalho'));
    for (const comando of [`echo fuga > ${q(f.externo)}`, 'echo fuga > atalho', 'echo fuga > .git/sentinel']) {
      const r = f.e.executar('negativo', comando, f.wt); assert.equal(r.ok, false, comando); assert.notEqual(r.code, 0);
    }
    const rede = f.e.executar('rede', "python3 -c 'import socket; socket.socket()'", f.wt) as ResultadoSandbox;
    assert.equal(rede.ok, false); assert.match(rede.stderr, /Operation not permitted/);
    assert.equal(fs.readFileSync(f.externo, 'utf8'), 'original');
    assert.equal(fs.readFileSync(path.join(f.wt, '.git', 'sentinel'), 'utf8'), 'git-original');
    const erro = f.e.executar('exit', 'echo erro-real >&2; exit 23', f.wt) as ResultadoSandbox;
    assert.equal(erro.code, 23); assert.match(erro.stderr, /erro-real/);
  } finally { f.limpar(); }
});

test('sandbox não herda perfil permissivo do projeto nem aceita outro cwd ou executor fechado', () => {
  const f = fixture();
  try {
    assert.equal(f.e.executar('missing', 'mkdir .codex; echo fuga > .codex/config.toml', f.wt).ok, false);
    assert.equal(fs.existsSync(path.join(f.wt, '.codex')), false);
    fs.mkdirSync(path.join(f.wt, '.codex'));
    fs.writeFileSync(path.join(f.wt, '.codex', 'config.toml'), 'sandbox_mode = "danger-full-access"\n');
    assert.equal(f.e.executar('config', `echo fuga > ${q(f.externo)}`, f.wt).ok, false);
    assert.equal(f.e.executar('config-write', 'echo fuga > .codex/config.toml', f.wt).ok, false);
    assert.throws(() => f.e.executar('wrong', 'true', f.base), /escopo/);
    f.e.fechar(); assert.throws(() => f.e.executar('closed', 'true', f.wt), /fechado/);
  } finally { f.limpar(); }
});

test('timeout recolhe neto setsid e nenhum processo marcado sobrevive', async () => {
  // As janelas crescem juntas para o teste nao depender de o neto nascer em 500 ms: sob a
  // suite paralela ele nao nascia, e a reprovacao caia no passo que so PREPARA o cenario
  // ("o comando realmente iniciou"). O que se prova continua o mesmo: o timeout estoura
  // antes do neto terminar, e nada marcado sobrevive (GO-FIX 1).
  const f = fixture(); const e = criarExecutorSandbox({ worktree: f.wt, timeoutMs: 2000 });
  const marker = 'ORK_SANDBOX_TEST=' + randomUUID();
  try {
    const inicio = Date.now();
    const command = marker + " setsid /bin/sh -c 'echo iniciado > iniciado; sleep 4; echo escapou > tardio' & wait";
    const r = e.executar('timeout', command, f.wt) as ResultadoSandbox;
    assert.equal(fs.existsSync(path.join(f.wt, 'iniciado')), true, 'o comando realmente iniciou');
    assert.equal(r.ok, false); assert.match(r.stderr, /timeout/); assert.ok(Date.now() - inicio < 8_000);
    const marcados = fs.readdirSync('/proc').filter(pid => /^\d+$/.test(pid)).filter(pid => {
      try { return fs.readFileSync(`/proc/${pid}/environ`).toString().split('\0').includes(marker); }
      catch { return false; }
    });
    assert.deepEqual(marcados, [], 'nenhum descendente marcado após retorno');
    await new Promise(resolve => setTimeout(resolve, 4_200));
    assert.equal(fs.existsSync(path.join(f.wt, 'tardio')), false, 'neto não escreve depois do timeout');
    for(const nome of ['.codex','.claude','.orkastery','.agents'])assert.equal(fs.existsSync(path.join(f.wt,nome)),false,'placeholder removido após recolher netos');
  } finally { e.fechar(); f.limpar(); }
});

test('limite de saída falha fechado e comando não recebe credenciais herdadas', () => {
  const f = fixture(); const anterior = process.env.ORK_VERIFY_SECRET;
  process.env.ORK_VERIFY_SECRET = 'nao-deve-chegar';
  try {
    const env = f.e.executar('env', 'test -z "$ORK_VERIFY_SECRET"', f.wt); assert.equal(env.ok, true, env.resumo);
    const r = f.e.executar('output', "python3 -c 'print(\"x\" * 1100000)'", f.wt) as ResultadoSandbox;
    assert.equal(r.ok, false); assert.match(r.stderr, /limite de saída/);
  } finally { if (anterior === undefined) delete process.env.ORK_VERIFY_SECRET; else process.env.ORK_VERIFY_SECRET = anterior; f.limpar(); }
});

test('VERIFY baseline/claims/manifest e SHIP dry-run usam executor interno; ledger continua canônico', () => {
  const p = projetoTemporario('sandbox-integration');
  const { thread } = novaThread(p.carregado, { nome: 'sandbox integration', modo: 'auto', criarWorktree: true });
  const wt = thread.worktree as string; const e = criarExecutorSandbox({ worktree: wt, timeoutMs: 3_000 });
  const externo = path.join(p.dir, 'sentinel'); fs.writeFileSync(externo, 'original');
  try {
    commitar(wt, 'produto.md', 'entrega', 'produto');
    p.carregado.manifesto.verify = { typecheck: 'true', build: 'true', test: 'true' };
    const base = gravarBaseline(p.carregado, thread.id, e.executar); assert.equal(base.comandos.every(c => c.ok), true);
    adicionarClaim(p.dir, thread.id, { arquivo: 'produto.md', alegacao: 'sentinela', verificar: [`echo fuga > ${q(externo)}`] });
    const v = verificar(p.carregado, thread.id, { executor: e.executar, soClaims: true });
    assert.equal(v.ok, false); assert.equal(v.claims[0].execucoes[0].ok, false);
    const s = ship(p.carregado, thread.id, { para: 'main', dryRun: true, executorVerify: e.executar });
    assert.equal(s.ok, false); assert.equal(s.verificacao?.claims[0].execucoes[0].ok, false);
    assert.equal(fs.readFileSync(externo, 'utf8'), 'original');
    assert.ok(lerLedger(dirThread(p.dir, thread.id)).some(x => x.tipo === 'verify_run'));
    // O default legado continua disponível por API, sem torná-lo escolha de ferramenta MCP.
    assert.equal(executar('legacy', 'exit 7', wt).code, 7);
  } finally { e.fechar(); p.limpar(); }
});


test('scratch fora WT mantém Git limpo antes/durante/depois sem ocultar untracked real',()=>{
  const p=projetoTemporario('sandbox-clean-git');
  // Commitar os arquivos reais de init estabelece o oráculo limpo explicitamente.
  const git=(args:string[])=>{const r=childProcess.spawnSync('git',args,{cwd:p.dir,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;};
  git(['add','--all']);git(['commit','-m','fixture baseline']);
  const e=criarExecutorSandbox({worktree:p.dir,timeoutMs:3000});
  try {
    assert.equal(git(['status','--porcelain']),'');
    const r=e.executar('clean','git status --porcelain; test -z "$(git status --porcelain)"',p.dir) as ResultadoSandbox;
    assert.equal(r.ok,true,r.resumo);assert.equal(r.stdout,'');assert.equal(git(['status','--porcelain']),'');
    fs.writeFileSync(path.join(p.dir,'untracked-real.txt'),'real');
    const visible=e.executar('real','git status --porcelain',p.dir) as ResultadoSandbox;
    assert.equal(visible.ok,true,visible.resumo);assert.match(visible.stdout,/\?\? untracked-real.txt/);
    assert.equal(git(['status','--porcelain']),'?? untracked-real.txt\n');
    assert.equal(fs.readFileSync(path.join(p.dir,'untracked-real.txt'),'utf8'),'real');
  } finally {e.fechar();p.limpar();}
});

test('leaf scratch gravável, parent/sibling/codexHome e metadados readonly',()=>{
  const f=fixture();
  try {
    const r=f.e.executar('scratch',`printf '%s\n' "$HOME"; echo scratch > "$TMPDIR/proof"; test -s "$TMPDIR/proof"`,f.wt) as ResultadoSandbox;
    assert.equal(r.ok,true,r.resumo);assert.equal(r.stdout.trim().startsWith(f.wt+'/'),false);
    const isolated=path.dirname(path.dirname(r.stdout.trim()));assert.equal(fs.existsSync(path.dirname(r.stdout.trim())),false,'leaf recolhido');
    for(const comando of ['echo escape > "$HOME/../../parent-proof"','mkdir "$HOME/../../sibling"','echo escape > "$CODEX_HOME/config.toml"',...['.git','.orkastery','.codex','.claude','.agents'].map(n=>'echo escape > '+n+'/proof')]) {
      assert.equal(f.e.executar('negative',comando,f.wt).ok,false,comando);
    }
    assert.equal(fs.existsSync(path.join(isolated,'parent-proof')),false);assert.equal(fs.existsSync(path.join(isolated,'sibling')),false);
    assert.equal(fs.readFileSync(path.join(isolated,'codex/config.toml'),'utf8'),'');
  } finally {f.limpar();}
});

test('diretório protegido preexistente fica intacto; arquivo/symlink inesperado não é convertido',()=>{
  const f=fixture();
  try {
    const target=path.join(f.wt,'.claude');fs.mkdirSync(target);fs.writeFileSync(path.join(target,'sentinel'),'owner');
    const original=fs.statSync(target);assert.equal(f.e.executar('existing','true',f.wt).ok,true);
    assert.equal(fs.statSync(target).ino,original.ino);assert.equal(fs.readFileSync(path.join(target,'sentinel'),'utf8'),'owner');
    fs.writeFileSync(path.join(f.wt,'.codex'),'owner-file');
    assert.throws(()=>f.e.executar('file','true',f.wt),/metadado protegido inesperado/);
    assert.equal(fs.readFileSync(path.join(f.wt,'.codex'),'utf8'),'owner-file');fs.unlinkSync(path.join(f.wt,'.codex'));
    fs.symlinkSync(f.externo,path.join(f.wt,'.agents'));
    assert.throws(()=>f.e.executar('link','true',f.wt),/metadado protegido inesperado/);
    assert.equal(fs.readlinkSync(path.join(f.wt,'.agents')),f.externo);
  } finally {f.limpar();}
});

for(const tipo of ['conteudo','substituido'] as const) {
  test('cleanup preserva placeholder '+tipo+' por outro escritor e não declara sucesso',()=>{
    const f=fixture(),target=path.join(f.wt,'.claude');
    const spawn=childProcess.spawnSync;let isolamentoProprio='';
    let restore=()=>{};
    try {
    const stub=mock.method(childProcess,'spawnSync',((...args:Parameters<typeof childProcess.spawnSync>)=>{
      const r=spawn(...args);
      if(args[0]==='/usr/bin/python3') {
        isolamentoProprio=String((args[2] as {cwd?:string}).cwd);
        if(tipo==='substituido'){fs.renameSync(target,path.join(f.base,'original-owned'));fs.mkdirSync(target);}
        fs.writeFileSync(path.join(target,'concurrent-owner'),'preservar');
      }
      return r;
    }) as typeof childProcess.spawnSync);
    restore=()=>stub.mock.restore();
      assert.throws(()=>f.e.executar('concurrent','true',f.wt),/cleanup incompleto.*preservados/);
      assert.equal(fs.readFileSync(path.join(target,'concurrent-owner'),'utf8'),'preservar');
      assert.throws(()=>f.e.fechar(),/cleanup incompleto/);
    } finally {restore();try{f.e.fechar();}catch{}if(isolamentoProprio){assert.ok(path.basename(isolamentoProprio).startsWith('ork-verify-config-'));fs.rmSync(isolamentoProprio,{recursive:true,force:true});}fs.rmSync(f.base,{recursive:true,force:true});}
  });
}


test('fechar preserva scratch substituído após erro de identidade; teardown explícito só da fixture',()=>{
  const f=fixture(),spawn=childProcess.spawnSync;let isolamentoProprio='',scratch='';
  let restore=()=>{};
  try {
  const stub=mock.method(childProcess,'spawnSync',((...args:Parameters<typeof childProcess.spawnSync>)=>{
    const r=spawn(...args);
    if(args[0]==='/usr/bin/python3') {
      const options=args[2] as {cwd:string;input:string};isolamentoProprio=String(options.cwd);
      const pedido=JSON.parse(options.input);scratch=path.dirname(pedido.env.HOME);
      fs.renameSync(scratch,path.join(f.base,'scratch-original-owned'));
      fs.mkdirSync(scratch);fs.writeFileSync(path.join(scratch,'outro-escritor'),'preservar');
    }
    return r;
  }) as typeof childProcess.spawnSync);
  restore=()=>stub.mock.restore();
    assert.throws(()=>f.e.executar('replacement','true',f.wt),/cleanup incompleto.*scratch/);
    assert.throws(()=>f.e.fechar(),/isolamento preservado/);
    assert.equal(fs.readFileSync(path.join(scratch,'outro-escritor'),'utf8'),'preservar');
    assert.equal(fs.existsSync(path.join(f.base,'scratch-original-owned')),true);
  } finally {
    restore();try{f.e.fechar();}catch{}
    if(isolamentoProprio){assert.ok(path.basename(isolamentoProprio).startsWith('ork-verify-config-'));fs.rmSync(isolamentoProprio,{recursive:true,force:true});}
    fs.rmSync(f.base,{recursive:true,force:true});
  }
});
