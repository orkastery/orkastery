/**
 * Testes do `ork adapter install` e do guard PreToolUse (bloco B4).
 *
 * Instalacao e um comando que escreve em disco na maquina de outra pessoa: o que precisa ficar
 * provado e o que ele escreve, o que ele NAO sobrescreve e que o guard instalado bloqueia de
 * verdade. Adaptador que "instala com sucesso" e nao expoe nada e o pitfall numero 1 do host.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exigirCatalogo, skillsDoCatalogo } from '../src/catalogo';
import { HOSTS, instalarAdaptador, ORDEM_DOS_HOSTS, parseHost, textoDosPitfalls } from '../src/hosts';
import { dirTemporario } from '../src/sandbox';

const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));
const ORK_FALSO = '/opt/ork/bin/ork';

test('parseHost reconhece os hosts suportados e recusa o que nao existe', () => {
  assert.equal(parseHost('claude-code'), 'claude-code');
  assert.equal(parseHost('CLAUDE'), 'claude-code');
  assert.equal(parseHost('hermes'), 'hermes');
  assert.equal(parseHost(' Codex '), 'codex');
  assert.equal(parseHost('open-claw'), 'openclaw');
  assert.equal(parseHost('cursor'), null);
  assert.equal(parseHost(undefined), null);
});

test('todo host declara exatamente os 3 pitfalls, cada um com a prova', () => {
  for (const host of ORDEM_DOS_HOSTS) {
    const def = HOSTS[host];
    assert.equal(def.pitfalls.length, 3, `${host}: os 3 pitfalls de instalacao`);
    for (const p of def.pitfalls) {
      assert.ok(p.titulo.length > 10, `${host}: pitfall sem titulo`);
      assert.ok(p.detalhe.length > 40, `${host}: pitfall sem explicacao`);
      assert.ok(p.prova.length > 5, `${host}: pitfall sem comando que prova`);
    }
    const texto = textoDosPitfalls(host);
    assert.ok(texto.includes('prova:'), `${host}: o texto do CLI precisa mostrar a prova`);
  }
});

test('instalar o claude-code leva o catalogo inteiro e renderiza os placeholders', () => {
  const destino = dirTemporario('inst-cc');
  try {
    const r = instalarAdaptador('claude-code', {
      projeto: destino,
      catalogo: RAIZ,
      orkBin: ORK_FALSO,
      versao: '9.9.9',
    });
    assert.ok(r.ok);
    const raizDoPlugin = path.join(destino, '.claude', 'plugins', 'orkastery');
    assert.equal(r.destino, raizDoPlugin);

    // Pitfall 1: o manifesto declara as skills do catálogo uma a uma, e elas existem em disco.
    const manifesto = JSON.parse(
      fs.readFileSync(path.join(raizDoPlugin, '.claude-plugin', 'plugin.json'), 'utf8')
    ) as { version: string; skills: string[] };
    assert.equal(manifesto.version, '9.9.9', 'placeholder de versao renderizado');
    assert.equal(manifesto.skills.length, skillsDoCatalogo(RAIZ).length);
    assert.equal(new Set(manifesto.skills).size, skillsDoCatalogo(RAIZ).length, 'catálogo sem duplicatas');
    for (const declarada of manifesto.skills) {
      const caminho = path.join(raizDoPlugin, declarada, 'SKILL.md');
      assert.ok(fs.existsSync(caminho), `skill declarada e nao instalada: ${declarada}`);
    }

    // As 5 checklists normativas vao junto: sem elas as skills citam `DoD 4` no vazio.
    for (const ref of ['definition-of-done.md', 'security-checklist.md', 'testing-patterns.md']) {
      assert.ok(fs.existsSync(path.join(raizDoPlugin, 'references', ref)));
    }

    // Comandos e subagentes das 6 fases.
    for (const fase of ['goal', 'plan', 'go', 'check', 'ship', 'master']) {
      assert.ok(fs.existsSync(path.join(raizDoPlugin, 'commands', `${fase}.md`)), `/${fase}`);
      assert.ok(fs.existsSync(path.join(raizDoPlugin, 'agents', `ork-${fase}.md`)), `ork-${fase}`);
    }

    // Pitfall 3: o hook chama o guard pelo CLAUDE_PLUGIN_ROOT, nunca por caminho relativo.
    const hooks = fs.readFileSync(path.join(raizDoPlugin, 'hooks', 'hooks.json'), 'utf8');
    assert.ok(hooks.includes('${CLAUDE_PLUGIN_ROOT}/hooks/ork-guard.js'));
    assert.ok(!hooks.includes('./hooks/ork-guard.js'));

    // O recibo, que e o que permite detectar edicao na copia instalada.
    const recibo = JSON.parse(fs.readFileSync(path.join(raizDoPlugin, 'INSTALADO.json'), 'utf8')) as {
      contrato: string;
      host: string;
      arquivos: { arquivo: string; sha256: string }[];
    };
    assert.equal(recibo.contrato, 'ork.adapter-install/v1');
    assert.equal(recibo.host, 'claude-code');
    assert.equal(recibo.arquivos.length, r.arquivos.length);
    for (const a of recibo.arquivos) assert.match(a.sha256, /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(destino, { recursive: true, force: true });
  }
});

test('hermes e openclaw instalam o roteador e as tools, sem placeholder sobrando', () => {
  const destino = dirTemporario('inst-outros');
  try {
    const hermes = instalarAdaptador('hermes', {
      projeto: destino,
      catalogo: RAIZ,
      orkBin: ORK_FALSO,
    });
    assert.ok(hermes.ok);
    const skill = fs.readFileSync(
      path.join(destino, '.hermes', 'skills', 'orkastery-devmaster', 'SKILL.md'),
      'utf8'
    );
    // O roteador do Hermes precisa continuar sendo um roteador.
    assert.ok(skill.split('\n').length <= 170, 'a skill do Hermes voltou a engordar');
    assert.ok(skill.includes('ork modos --do-pedido'), 'o host nao pode reimplementar o parse');
    assert.ok(skill.includes('allowed_modes'), 'a validacao de modo fica no nucleo');

    const openclaw = instalarAdaptador('openclaw', {
      projeto: destino,
      catalogo: RAIZ,
      orkBin: ORK_FALSO,
    });
    assert.ok(openclaw.ok);
    // O destino e o source root global de extensoes do OpenClaw 2026.7.1.
    const raizPlugin = path.join(destino, '.openclaw', 'extensions', 'orkastery');
    const pacote = JSON.parse(fs.readFileSync(path.join(raizPlugin, 'package.json'), 'utf8')) as {
      openclaw?: { extensions?: string[] };
    };
    assert.deepEqual(
      pacote.openclaw?.extensions,
      ['./dist/index.js'],
      'sem openclaw.extensions o loader 2026.7.1 nem descobre o plugin'
    );
    const bruto = fs.readFileSync(path.join(raizPlugin, 'openclaw.plugin.json'), 'utf8');
    assert.ok(!bruto.includes('{{'), 'sobrou placeholder no manifesto do OpenClaw');
    const manifesto = JSON.parse(bruto) as { id: string; contracts: { tools: string[] } };
    assert.equal(manifesto.id, 'orkastery');
    assert.equal(manifesto.contracts.tools.length, 25, 'catálogo onboarding, portfólio, tickets, HITL, Company Brain e Maestro instalado');
    assert.ok(manifesto.contracts.tools.includes('ork_maestro'));
    assert.ok(manifesto.contracts.tools.includes('ork_onboarding'));
    assert.ok(manifesto.contracts.tools.includes('ork_gate_answer'));
    assert.ok(manifesto.contracts.tools.includes('ork_session_answer'));
    assert.ok(manifesto.contracts.tools.includes('ork_objective_status'));
    assert.ok(manifesto.contracts.tools.includes('ork_objective_message'));
    assert.ok(manifesto.contracts.tools.includes('ork_portfolio_list'));
    assert.ok(!manifesto.contracts.tools.includes('ork_gate_approve'));
    assert.equal(new Set(manifesto.contracts.tools).size, manifesto.contracts.tools.length);
    for (const nome of manifesto.contracts.tools) {
      assert.match(nome, /^ork_/, 'toda tool do plugin e ork_*');
    }
    assert.ok(manifesto.contracts.tools.includes('ork_modo_do_pedido'));
    // Pitfall 1: o unico placeholder renderizavel vive no entry e precisa sair renderizado.
    const entry = fs.readFileSync(path.join(raizPlugin, 'dist', 'index.js'), 'utf8');
    assert.ok(!entry.includes('{{'), 'sobrou placeholder no entry do plugin');
    assert.ok(entry.includes(ORK_FALSO), 'o entry nao aponta para o ork instalado');
  } finally {
    fs.rmSync(destino, { recursive: true, force: true });
  }
});

test('Hermes instala ingresso no diretório nativo de plugins', () => {
  const destino = dirTemporario('inst-ingress');
  try {
    instalarAdaptador('hermes', { projeto: destino, catalogo: RAIZ, orkBin: ORK_FALSO });
    const plugin = path.join(destino, '.hermes/plugins/orkastery-hitl');
    assert.ok(fs.readFileSync(path.join(plugin, '__init__.py'), 'utf8').includes('pre_gateway_dispatch'));
    assert.ok(fs.existsSync(path.join(plugin, 'plugin.yaml')));
  } finally { fs.rmSync(destino, { recursive: true, force: true }); }
});

test('reinstalar nao sobrescreve arquivo editado sem --force', () => {
  const destino = dirTemporario('inst-conflito');
  try {
    const opcoes = { projeto: destino, catalogo: RAIZ, orkBin: ORK_FALSO };
    assert.ok(instalarAdaptador('openclaw', opcoes).ok);
    const alvo = path.join(destino, '.openclaw', 'extensions', 'orkastery', 'openclaw.plugin.json');
    fs.writeFileSync(alvo, fs.readFileSync(alvo, 'utf8') + '\n// editado na mao\n', 'utf8');

    const barrada = instalarAdaptador('openclaw', opcoes);
    assert.equal(barrada.ok, false, 'edicao na copia instalada barra a reinstalacao');
    assert.equal(barrada.conflitos.length, 1);
    assert.ok(fs.readFileSync(alvo, 'utf8').includes('editado na mao'), 'nada foi sobrescrito');

    const forcada = instalarAdaptador('openclaw', { ...opcoes, force: true });
    assert.ok(forcada.ok);
    assert.ok(!fs.readFileSync(alvo, 'utf8').includes('editado na mao'), '--force ressincroniza');

    // Sem mudanca nenhuma, tudo aparece como ja identico: reinstalar e barato e silencioso.
    const denovo = instalarAdaptador('openclaw', opcoes);
    assert.ok(denovo.arquivos.every((a) => a.estado === 'igual'));
  } finally {
    fs.rmSync(destino, { recursive: true, force: true });
  }
});

test('--dry-run nao escreve nada e ainda diz o que faria', () => {
  const destino = dirTemporario('inst-ensaio');
  try {
    const r = instalarAdaptador('hermes', {
      projeto: destino,
      catalogo: RAIZ,
      orkBin: ORK_FALSO,
      dryRun: true,
    });
    assert.ok(r.arquivos.length >= 3);
    assert.equal(fs.existsSync(path.join(destino, '.hermes')), false, 'o ensaio nao escreve');
  } finally {
    fs.rmSync(destino, { recursive: true, force: true });
  }
});

test('o guard instalado bloqueia destruicao em massa e deixa o ork passar', () => {
  const destino = dirTemporario('inst-guard');
  try {
    instalarAdaptador('claude-code', { projeto: destino, catalogo: RAIZ, orkBin: ORK_FALSO });
    const guard = path.join(destino, '.claude', 'plugins', 'orkastery', 'hooks', 'ork-guard.js');
    assert.ok(fs.existsSync(guard));
    assert.ok((fs.statSync(guard).mode & 0o111) !== 0, 'o guard precisa sair executavel');

    const decidir = (comando: string): { decisao: string; codigo: number } => {
      const entrada = JSON.stringify({ tool_name: 'Bash', tool_input: { command: comando } });
      try {
        const saida = execFileSync(process.execPath, [guard], {
          input: entrada,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { decisao: JSON.parse(saida).hookSpecificOutput.permissionDecision, codigo: 0 };
      } catch (e) {
        const erro = e as { status?: number; stdout?: string };
        const saida = JSON.parse(erro.stdout ?? '{}') as {
          hookSpecificOutput?: { permissionDecision?: string };
        };
        return {
          decisao: saida.hookSpecificOutput?.permissionDecision ?? 'sem-decisao',
          codigo: erro.status ?? -1,
        };
      }
    };

    for (const comando of [
      'git add -A',
      'git add --all .',
      'git add .',
      'git commit -am "tudo"',
      'git push origin main',
      'git push --force origin main',
      'git reset --hard origin/main',
      'git clean -fd',
      'git checkout -- .',
      'rm -rf $DESTINO/',
    ]) {
      const r = decidir(comando);
      assert.equal(r.decisao, 'deny', `deveria bloquear: ${comando}`);
      assert.equal(r.codigo, 2, `codigo de bloqueio errado em: ${comando}`);
    }

    for (const comando of [
      'ork ship ork-x --para main --autorizar-push julio',
      'git add -- src/pagamentos.ts',
      'git commit -m "ork-x T3: extrai o calculo de frete"',
      'git status',
      'npm test',
    ]) {
      const r = decidir(comando);
      assert.equal(r.decisao, 'allow', `nao deveria bloquear: ${comando}`);
      assert.equal(r.codigo, 0);
    }

    // Ferramenta que nao e Bash nao e assunto do guard, e entrada quebrada nunca bloqueia.
    const outraFerramenta = execFileSync(process.execPath, [guard], {
      input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } }),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.equal(JSON.parse(outraFerramenta).hookSpecificOutput.permissionDecision, 'allow');
    const lixo = execFileSync(process.execPath, [guard], {
      input: 'isto nao e json',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.equal(JSON.parse(lixo).decisao, 'allow', 'guard que quebra libera, nao derruba a sessao');
  } finally {
    fs.rmSync(destino, { recursive: true, force: true });
  }
});


test('Codex instala catalogo e entrada em pasta propria e preserva configuracao e skills alheias', () => {
  const projeto = dirTemporario('inst-codex');
  try {
    const preservados = ['AGENTS.md', '.codex/config.toml', '.agents/INSTALADO.json',
      '.agents/skills/pessoal/SKILL.md'];
    for (const rel of preservados) {
      const p = path.join(projeto,rel); fs.mkdirSync(path.dirname(p),{recursive:true});
      fs.writeFileSync(p,`conteudo anterior: ${rel}`);
    }
    const opcoes = { projeto, catalogo: RAIZ, orkBin: ORK_FALSO };
    const dry = instalarAdaptador('codex',{...opcoes,dryRun:true});
    assert.equal(dry.ok,true);
    assert.equal(fs.existsSync(path.join(projeto,'.agents/skills/orkastery')),false);
    const instalado = instalarAdaptador('codex',opcoes);
    assert.equal(instalado.ok,true);
    assert.equal(instalado.destino,path.join(projeto,'.agents/skills/orkastery'));
    for (const skill of skillsDoCatalogo(RAIZ)) {
      assert.equal(fs.readFileSync(path.join(instalado.destino,skill.relativo),'utf8'),
        fs.readFileSync(skill.caminho,'utf8'));
    }
    const entrada = path.join(instalado.destino,'skills/ork/SKILL.md');
    const texto = fs.readFileSync(entrada,'utf8');
    assert.ok(texto.includes(ORK_FALSO)); assert.ok(!texto.includes('{{ork_bin}}'));
    assert.ok(fs.existsSync(path.join(instalado.destino,'references/definition-of-done.md')));
    const recibo = JSON.parse(fs.readFileSync(path.join(instalado.destino,'INSTALADO.json'),'utf8'));
    assert.equal(recibo.host,'codex');
    assert.equal(instalarAdaptador('codex',opcoes).arquivos.every(a=>a.estado==='igual'),true);
    fs.writeFileSync(entrada,'edicao local');
    const conflito = instalarAdaptador('codex',opcoes);
    assert.equal(conflito.ok,false); assert.equal(conflito.conflitos.length,1);
    assert.equal(fs.readFileSync(entrada,'utf8'),'edicao local');
    for (const rel of preservados) assert.equal(fs.readFileSync(path.join(projeto,rel),'utf8'),`conteudo anterior: ${rel}`);
  } finally { fs.rmSync(projeto,{recursive:true,force:true}); }
});

test('CLI expoe Codex em list/show e executa install dry-run sem criar arquivos', () => {
  const projeto = dirTemporario('inst-codex-cli');
  try {
    const cli = path.resolve(__dirname,'../src/index.js');
    const rodar = (...args:string[]) => execFileSync(process.execPath,[cli,'adapter',...args],
      {cwd:projeto,encoding:'utf8',timeout:10000});
    assert.ok(rodar('list').includes('codex'));
    assert.ok(rodar('show','codex').includes('.agents/skills/orkastery'));
    assert.ok(rodar('install','codex','--dry-run').includes('codex'));
    assert.equal(fs.existsSync(path.join(projeto,'.agents')),false);
  } finally { fs.rmSync(projeto,{recursive:true,force:true}); }
});
