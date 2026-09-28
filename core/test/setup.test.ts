/**
 * Feature #setup (thread ork-homologarcod).
 *
 * As garantias que estes testes seguram:
 *   - default pos-instalacao: claude-bg/opus/high em TODO bloco de TODO modo, com o
 *     arquivo de setup AUSENTE (um recem-instalado nao precisa configurar nada);
 *   - edicao por bloco persiste, valida runtime e carimba `setup_configured` no ledger
 *     do projeto;
 *   - o despacho de fase honra o setup do bloco daquele modo (a prova vai ate o comando
 *     montado, nao ate o relato);
 *   - reset volta ao default.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { lerLedger } from '../src/ledger';
import { MODOS, MODOS_APOSENTADOS, ORDEM_DOS_MODOS } from '../src/modos';
import { resolverDespacho, rodarFase } from '../src/phase';
import {
  BLOCO_PADRAO,
  caminhoSetup,
  configDoBloco,
  editarBloco,
  ehPadrao,
  lerSetup,
  resetarSetup,
  setupPadrao,
  textoDaEntrevista,
  textoDoSetup,
} from '../src/setup';
import { novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

/** I-42 (D8): o unico modo com default proprio. */
const PADRAO_DO_FAST = { runtime: 'claude-bg', model: 'sonnet', effort: 'high', fallback: ['codex:gpt-5.6-terra:high'] };

test('sem arquivo de setup, todo bloco roda no default claude-bg/opus/high, menos o do #Fast', () => {
  const p = projetoTemporario('setup-default');
  try {
    assert.equal(fs.existsSync(caminhoSetup(p.dir)), false);
    const setup = lerSetup(p.dir);
    for (const modo of ORDEM_DOS_MODOS) {
      assert.equal(setup.modos[modo].blocos.length, MODOS[modo].blocos.length);
      for (const bloco of setup.modos[modo].blocos) {
        if (modo === 'fast') {
          assert.deepEqual(bloco, PADRAO_DO_FAST);
          assert.equal(ehPadrao(bloco, modo), true, 'o default do modo e default');
          continue;
        }
        assert.deepEqual(bloco, { runtime: 'claude-bg', model: 'opus', effort: 'high' });
        assert.equal(ehPadrao(bloco), true);
        assert.equal(ehPadrao(bloco, modo), true);
      }
    }
    assert.deepEqual(setupPadrao().modos.fast.blocos, [PADRAO_DO_FAST]);
  } finally {
    p.limpar();
  }
});

test('setup gravado antes do #Fast ganha o bloco dele no default e preserva os outros modos', () => {
  const p = projetoTemporario('setup-antes-do-fast');
  try {
    // O arquivo como os projetos o tem hoje: os modos vivos de antes, blocos customizados.
    const antigos = {
      classic: { blocos: [
        { runtime: 'codex', model: 'gpt-6-astra', effort: 'xhigh' },
        { runtime: 'claude-bg', model: 'opus', effort: 'high', fallback: ['codex:gpt-5.5'] },
        { runtime: 'claude-bg', model: 'fable', effort: 'high' },
        { runtime: 'claude-bg', model: 'opus', effort: 'medium' },
      ] },
      maestro: { blocos: [
        { runtime: 'claude-bg', model: 'opus', effort: 'high' },
        { runtime: 'codex', model: 'gpt-6-astra', effort: 'high', fallback: ['claude-bg:opus:high'] },
        { runtime: 'claude-bg', model: 'sonnet', effort: 'low' },
      ] },
      auto: { blocos: [{ runtime: 'claude-bg', model: 'opus', effort: 'high', fallback: ['codex:gpt-5.5:high'] }] },
    };
    fs.mkdirSync(path.dirname(caminhoSetup(p.dir)), { recursive: true });
    fs.writeFileSync(caminhoSetup(p.dir), JSON.stringify({ contrato: 'ork.setup/v1', modos: antigos }), 'utf8');
    const setup = lerSetup(p.dir);
    assert.deepEqual(setup.modos.fast.blocos, [PADRAO_DO_FAST]);
    // A segunda metade e a que distingue "normalizou certo" de "sobrescreveu tudo".
    for (const modo of ['classic', 'maestro', 'auto'] as const) {
      assert.deepEqual(setup.modos[modo].blocos, antigos[modo].blocos, `blocos de ${modo} intactos`);
    }
  } finally {
    p.limpar();
  }
});

test('o #Fast tem um bloco so: editar o bloco 2 e recusado com a contagem real', () => {
  const p = projetoTemporario('setup-fast-bloco2');
  try {
    const fora = editarBloco(p.dir, 'fast', 2, { effort: 'high' });
    assert.equal(fora.ok, false);
    assert.match(fora.erro ?? '', /#Fast: ele tem 1 bloco/);
    assert.match(textoDoSetup(p.dir, 'fast'), /sonnet/);
    assert.match(textoDoSetup(p.dir, 'fast'), /volta para claude-bg\/sonnet\/high/);
    assert.match(textoDaEntrevista(p.dir), /menos #Fast \(claude-bg\/sonnet\/high, fallback codex:gpt-5\.6-terra:high\)/);
  } finally {
    p.limpar();
  }
});

test('editar um bloco persiste, valida o runtime e carimba setup_configured no ledger do projeto', () => {
  const p = projetoTemporario('setup-editar');
  try {
    // #Maestro, bloco 2 (GO-CHECK-SHIP) passa a abrir no codex, como no exemplo da demanda.
    const r = editarBloco(p.dir, 'maestro', 2, {
      runtime: 'codex',
      model: 'gpt-6-astra',
      effort: 'xhigh',
    });
    assert.equal(r.ok, true, r.erro);
    assert.deepEqual(r.para, { runtime: 'codex', model: 'gpt-6-astra', effort: 'xhigh' });

    const relido = lerSetup(p.dir);
    assert.deepEqual(relido.modos.maestro.blocos[1], {
      runtime: 'codex',
      model: 'gpt-6-astra',
      effort: 'xhigh',
    });
    // Os outros blocos do modo ficam no default.
    assert.equal(ehPadrao(relido.modos.maestro.blocos[0]), true);
    assert.equal(ehPadrao(relido.modos.maestro.blocos[2]), true);

    // O ledger do projeto tem o evento com de/para.
    const eventos = lerLedger(path.join(p.dir, '.orkastery'));
    const evento = eventos.find((e) => e.tipo === 'setup_configured');
    assert.ok(evento, 'setup_configured registrado');
    assert.equal(evento?.modo, 'maestro');
    assert.equal(evento?.bloco, 2);

    // Runtime desconhecido reprova ANTES de ir ao disco.
    const ruim = editarBloco(p.dir, 'maestro', 2, { runtime: 'gemini' });
    assert.equal(ruim.ok, false);
    assert.match(ruim.erro ?? '', /runtime desconhecido/);
    // Bloco fora da matriz reprova com a contagem real do modo.
    const fora = editarBloco(p.dir, 'auto', 2, { model: 'x' });
    assert.equal(fora.ok, false);
    assert.match(fora.erro ?? '', /tem 1 bloco/);
  } finally {
    p.limpar();
  }
});

test('configDoBloco resolve a config pela fase dentro do modo', () => {
  const setup = setupPadrao();
  setup.modos.maestro.blocos[1] = { runtime: 'codex', model: 'gpt-6-astra', effort: 'xhigh' };
  // GO, CHECK e SHIP moram no bloco 2 do #Maestro.
  for (const fase of ['GO', 'CHECK', 'SHIP']) {
    assert.deepEqual(configDoBloco(setup, 'maestro', fase), {
      runtime: 'codex',
      model: 'gpt-6-astra',
      effort: 'xhigh',
    });
  }
  // GOAL/PLAN e MASTER continuam no default.
  assert.deepEqual(configDoBloco(setup, 'maestro', 'GOAL'), { ...BLOCO_PADRAO });
  assert.deepEqual(configDoBloco(setup, 'maestro', 'MASTER'), { ...BLOCO_PADRAO });
  // #Auto tem um bloco so: qualquer fase resolve nele.
  setup.modos.auto.blocos[0] = { runtime: 'codex', model: 'gpt-6', effort: 'high' };
  assert.equal(configDoBloco(setup, 'auto', 'MASTER')?.runtime, 'codex');
});

test('a precedencia do despacho: CLI > setup do bloco > manifesto', () => {
  const p = projetoTemporario('setup-precedencia');
  try {
    const manifesto = p.carregado.manifesto;
    const doBloco = { runtime: 'codex', model: 'gpt-6-astra', effort: 'xhigh' };
    // Setup do bloco vence o manifesto.
    assert.deepEqual(resolverDespacho(manifesto, {}, doBloco), {
      runtime: 'codex',
      model: 'gpt-6-astra',
      effort: 'xhigh',
    });
    // Opcao explicita do CLI vence o setup.
    assert.deepEqual(resolverDespacho(manifesto, { runtime: 'claude-bg', model: 'fable' }, doBloco), {
      runtime: 'claude-bg',
      model: 'fable',
      effort: 'high',
    });
  } finally {
    p.limpar();
  }
});

test('o despacho honra o setup do bloco: o comando montado no dry-run sai pelo codex', () => {
  const p = projetoTemporario('setup-despacho');
  try {
    editarBloco(p.dir, 'auto', 1, { runtime: 'codex', model: 'gpt-6-astra', effort: 'xhigh' });
    const { thread } = novaThread(p.carregado, { nome: 'entrega', modo: 'auto' });
    const r = rodarFase(p.carregado, thread.id, {
      fase: 'GOAL',
      prompt: 'Mapear o objetivo',
      dryRun: true,
    });
    assert.equal(r.runtime, 'codex');
    assert.equal(r.model, 'gpt-6-astra');
    assert.equal(r.effort, 'xhigh');
    assert.equal(r.comando[0], 'codex');
    assert.deepEqual(r.comando, ['codex', 'app-server', '--listen', 'stdio://']);

    // Sem setup mexido, outra thread continua saindo pelo claude-bg: paridade sem downgrade.
    resetarSetup(p.dir);
    const { thread: outra } = novaThread(p.carregado, { nome: 'outra entrega', modo: 'auto' });
    const semSetup = rodarFase(p.carregado, outra.id, {
      fase: 'GOAL',
      prompt: 'Mapear o objetivo',
      dryRun: true,
    });
    assert.equal(semSetup.runtime, 'claude-bg');
    assert.equal(semSetup.comando[0], 'claude');
  } finally {
    p.limpar();
  }
});

test('reset volta o modo ao default e o texto da entrevista lista os modos vivos em ordem', () => {
  const p = projetoTemporario('setup-reset');
  try {
    editarBloco(p.dir, 'classic', 3, { runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.equal(lerSetup(p.dir).modos.classic.blocos[2].runtime, 'codex');
    resetarSetup(p.dir, 'classic');
    assert.equal(ehPadrao(lerSetup(p.dir).modos.classic.blocos[2]), true);

    const pauta = textoDaEntrevista(p.dir);
    // I-43: a pauta deriva de ORDEM_DOS_MODOS; nenhuma lista de modos escrita a mao.
    const posicoes = ORDEM_DOS_MODOS.map((m) => pauta.indexOf(MODOS[m].tag));
    assert.ok(posicoes.every((i) => i >= 0), 'todos os modos vivos na pauta');
    assert.deepEqual([...posicoes].sort((a, b) => a - b), posicoes, 'ordem do espectro');
    for (const morto of MODOS_APOSENTADOS) {
      assert.equal(pauta.includes(MODOS[morto].tag), false, `a pauta ainda oferece ${MODOS[morto].tag}`);
    }
    assert.match(pauta, /claude-bg\/opus\/high/);

    const tabelaDoClassic = textoDoSetup(p.dir, 'classic');
    assert.match(tabelaDoClassic, /GOAL/);
    assert.match(tabelaDoClassic, /default/);
  } finally {
    p.limpar();
  }
});

test('arquivo de setup torto normaliza contra a matriz atual em vez de quebrar o despacho', () => {
  const p = projetoTemporario('setup-torto');
  try {
    fs.mkdirSync(path.dirname(caminhoSetup(p.dir)), { recursive: true });
    fs.writeFileSync(
      caminhoSetup(p.dir),
      JSON.stringify({
        contrato: 'ork.setup/v1',
        modos: {
          maestro: { blocos: [{ runtime: 'runtime-que-nao-existe', model: '', effort: 'high' }] },
        },
      }),
      'utf8'
    );
    const setup = lerSetup(p.dir);
    // Runtime desconhecido e campos vazios caem no default; blocos ausentes completam.
    assert.deepEqual(setup.modos.maestro.blocos[0], { ...BLOCO_PADRAO });
    assert.equal(setup.modos.maestro.blocos.length, MODOS.maestro.blocos.length);
    assert.equal(setup.modos.classic.blocos.length, MODOS.classic.blocos.length);
  } finally {
    p.limpar();
  }
});


test('override de runtime exige modelo da nova origem e preserva pares completos', () => {
  const p = projetoTemporario('setup-origem');
  try {
    for (const [origem, destino] of [['claude-bg','codex'],['codex','claude-bg']]) {
      const bloco = {runtime: origem, model:'modelo-configurado', effort:'low'};
      assert.throws(() => resolverDespacho(p.carregado.manifesto,{runtime:destino},bloco), /setup.model.required/);
      assert.deepEqual(resolverDespacho(p.carregado.manifesto,{runtime:origem},bloco),bloco);
      assert.deepEqual(resolverDespacho(p.carregado.manifesto,{runtime:destino,model:'modelo-explicito',effort:'medium'},bloco),
        {runtime:destino,model:'modelo-explicito',effort:'medium'});
    }
  } finally { p.limpar(); }
});
test('troca incompleta de runtime nao grava setup nem ledger nem prompt de fase', () => {
  const p = projetoTemporario('setup-sem-efeitos');
  try {
    const t = novaThread(p.carregado,{nome:'modelo',modo:'auto'}).thread;
    const estado = path.join(p.dir,'.orkastery');
    const snapshot = (): Record<string,string> => {
      const out: Record<string,string> = {};
      const ler = (dir: string) => { for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
        const file=path.join(dir,entry.name); if(entry.isDirectory()) ler(file);
        else if(entry.isFile()) out[path.relative(estado,file)]=fs.readFileSync(file).toString('base64');
      }}; ler(estado); return out;
    };
    const before=snapshot();
    const r=editarBloco(p.dir,'auto',1,{runtime:'codex'});
    assert.equal(r.ok,false);assert.match(r.erro??'',/setup.model.required/);
    assert.throws(() => rodarFase(p.carregado,t.id,{fase:'GOAL',prompt:'nao deve ser escrito',runtime:'codex',dryRun:true}),/setup.model.required/);
    assert.deepEqual(snapshot(),before);
  } finally { p.limpar(); }
});
test('setup parcial de outro runtime permanece visivel e permite reparacao pelo comando de edicao', () => {
  const p = projetoTemporario('setup-reparavel');
  try {
    const raw=JSON.stringify({contrato:'ork.setup/v1',modos:{auto:{blocos:[{runtime:'codex',effort:'low'}]}}});
    fs.writeFileSync(caminhoSetup(p.dir),raw);
    const antes=lerSetup(p.dir);
    assert.equal(antes.modos.auto.blocos[0].model,'');
    assert.match(textoDoSetup(p.dir,'auto'),/modelo pendente/);
    assert.equal(fs.readFileSync(caminhoSetup(p.dir),'utf8'),raw);
    assert.throws(() => resolverDespacho(p.carregado.manifesto,{},antes.modos.auto.blocos[0]),/setup.model.required/);
    assert.equal(editarBloco(p.dir,'auto',1,{model:'modelo-autorizado'}).ok,true);
    const depois=lerSetup(p.dir);
    assert.deepEqual(depois.modos.classic,antes.modos.classic);
    assert.deepEqual(resolverDespacho(p.carregado.manifesto,{},depois.modos.auto.blocos[0]),
      {runtime:'codex',model:'modelo-autorizado',effort:'low'});
  } finally { p.limpar(); }
});
