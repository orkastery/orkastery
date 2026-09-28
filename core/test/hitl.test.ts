/**
 * Radar HITL das sessoes do runtime (`ork sessions hitl`).
 *
 * O incidente que estes testes travam (05/09/2026): uma sessao `claude --bg` ficou em
 * `state: blocked` pedindo o codigo 2FA do `npm publish` e o orquestrador so soube
 * quando o humano reclamou. O criterio nao e "o comando imprime alguma coisa", e "de UMA
 * chamada da para saber QUAIS sessoes esperam o humano, O QUE cada uma pergunta e o que
 * destrava -- inclusive as sessoes que nao tem thread nenhuma no ork".
 *
 * O caminho roda inteiro contra o runtime falso: despacho de verdade, `claude agents`
 * de verdade, `claude logs` de verdade, com o binario `claude` trocado por um stub.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  classificarEstado,
  contextoSeguro,
  duracaoCurta,
  estadoBruto,
  lerPerguntaDaTela,
  varrerSessoes,
} from '../src/hitl';
import { rodarFase } from '../src/phase';
import { novaThread } from '../src/thread';
import { projetoTemporario, runtimeFalso } from './apoio';

test('redação remove Bearer completo, tokens de provedores e conteúdo PEM antes das últimas linhas', () => {
  const amostras = [
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.EXEMPLO.assinatura',
    'TELEGRAM_BOT=123456789:AA-EXEMPLO-nao-e-um-token-real-000000',
    'GOOGLE=AI' + 'zaSyEXEMPLOxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'xo' + 'xb-EXEMPLO-000000000000-aaaaaaaaaaaaaaaaaaaaaaaa',
  ];
  for (const amostra of amostras) {
    const limpo = contextoSeguro(amostra).join('\n');
    assert.ok(!limpo.includes('EXEMPLO'), limpo);
    assert.match(limpo, /redigido/);
  }
  const pem = 'antes\n-----BEGIN OPENSSH PRIVATE ' + 'KEY-----\nCONTEUDO_PRIVADO\n-----END OPENSSH PRIVATE ' + 'KEY-----\ndepois';
  assert.deepEqual(contextoSeguro(pem, 2), ['[chave privada redigida]', 'depois']);
  assert.deepEqual(contextoSeguro('-----BEGIN RSA PRIVATE ' + 'KEY-----\nINCOMPLETO'), ['[chave privada redigida]']);
});

const ORK = path.resolve(__dirname, '../../dist/index.js');

/** Dump de tela real da sessao que travou no 2FA do npm, ja sem os codigos ANSI. */
const TELA_DO_2FA = [
  'Ran 1 shell command',
  'A publicacao parou em 2FA. Vou deixar tudo pronto e commitado:',
  '────────────────────────────────────────────',
  ' ☐ Publicar',
  '│A publicacao parou em 2FA: a conta `orkastery` esta com two-factor auth, entao todo',
  '❯1. Passo o codigo agora',
  '     Escolha "Outro" e cole os 6 digitos do autenticador.',
  '2.Eu mesmo publico',
  ' 3. Crio um token de automacao',
  '4. Type something.',
  '────────────────────────────────────────────',
  'Enter to select · Esc to cancel',
].join('\n');

/** Despacha uma fase pelo runtime falso e devolve o projeto pronto para a varredura. */
function projetoComSessao(nome: string) {
  const runtime = runtimeFalso(nome);
  const p = projetoTemporario(nome);
  const { thread } = novaThread(p.carregado, { nome: 'radar hitl', modo: 'auto' });
  rodarFase(p.carregado, thread.id, { fase: 'GOAL', prompt: 'trabalhe' });
  // I-34: o despacho claude-bg inicia um watcher destacado; apagar o projeto junto com o
  // runtime falso encerra esse observador em vez de deixá-lo consultar o `claude` real do PATH.
  return { runtime: { ...runtime, restaurar: () => { runtime.restaurar(); p.limpar(); } }, p, thread };
}

// ---------------------------------------------------------------------------
// Classificacao: a tipologia deterministica que o orquestrador consome.
// ---------------------------------------------------------------------------

test('cada estado do runtime vira uma classe tipada, e so as paradas pedem humano', () => {
  assert.equal(classificarEstado('blocked').classe, 'hitl');
  assert.equal(classificarEstado('blocked').precisaDeHumano, true);
  assert.equal(classificarEstado('failed').classe, 'falha');
  assert.equal(classificarEstado('failed').precisaDeHumano, true);
  assert.equal(classificarEstado('working').classe, 'trabalhando');
  assert.equal(classificarEstado('working').precisaDeHumano, false);
  assert.equal(classificarEstado('done').classe, 'concluida');
  assert.equal(classificarEstado('done').precisaDeHumano, false);
  // `stopped` e decisao humana ja tomada: avisar de novo seria ruido.
  assert.equal(classificarEstado('stopped').classe, 'interrompida');
  assert.equal(classificarEstado('stopped').precisaDeHumano, false);
  assert.equal(classificarEstado('idle').classe, 'interativa');
  assert.equal(classificarEstado('idle').precisaDeHumano, false);
});

test('estado que o runtime inventar amanha avisa A MAIS, em vez de sumir da varredura', () => {
  const nova = classificarEstado('awaiting_input');
  assert.equal(nova.classe, 'desconhecida');
  assert.equal(nova.precisaDeHumano, true, 'estado fora do catalogo tem de virar aviso');
  assert.match(nova.detalhe, /awaiting_input/);
  // Sessao sem estado nenhum cai no mesmo lugar, pelo mesmo motivo.
  assert.equal(classificarEstado('').classe, 'desconhecida');
  assert.equal(classificarEstado('').precisaDeHumano, true);
});

test('o estado cru sai normalizado, com `state` mandando sobre `status`', () => {
  assert.equal(estadoBruto({ sessionId: 'x', state: 'BLOCKED' }), 'blocked');
  assert.equal(estadoBruto({ sessionId: 'x', state: ' working ' }), 'working');
  assert.equal(estadoBruto({ sessionId: 'x', status: 'idle' }), 'idle');
  assert.equal(estadoBruto({ sessionId: 'x', state: 'done', status: 'idle' }), 'done');
  assert.equal(estadoBruto({ sessionId: 'x' }), '');
});

// ---------------------------------------------------------------------------
// Leitura de tela: o que a sessao pergunta e o que ela oferece.
// ---------------------------------------------------------------------------

test('a pergunta e as alternativas saem do dump de tela da sessao travada', () => {
  const lido = lerPerguntaDaTela(TELA_DO_2FA);
  assert.match(lido.pergunta, /A publicacao parou em 2FA/);
  assert.equal(lido.alternativas.length, 4);
  assert.equal(lido.alternativas[0], '1. Passo o codigo agora');
  assert.equal(lido.alternativas[1], '2. Eu mesmo publico');
  assert.equal(lido.alternativas[2], '3. Crio um token de automacao');
  // O pedido de segredo e tipado: e o que muda a acao do humano.
  assert.equal(lido.tipo, 'hitl.credencial');
});

test('menu sem segredo nenhum e pergunta comum, e permissao tem tipo proprio', () => {
  const comum = lerPerguntaDaTela(
    ['│Achei dois caminhos para o refactor. Qual voce prefere?', '1. Extrair modulo', '2. Manter inline'].join('\n')
  );
  assert.equal(comum.tipo, 'hitl.pergunta');
  assert.equal(comum.alternativas.length, 2);

  const permissao = lerPerguntaDaTela(
    ['│Do you want to proceed with this command?', '1. Yes', '2. No'].join('\n')
  );
  assert.equal(permissao.tipo, 'hitl.permissao');
});

test('o menu de SELECAO tambem vira alternativa, e nao so o menu numerado', () => {
  // Tela REAL das duas sessoes `blocked` com job vivo em 05/09/2026 (prompt de MCP).
  // Antes desta leitura elas saiam como `hitl.desconhecido`, sem pergunta e sem opcao:
  // o radar dizia que alguem esperava, e nao dizia esperando o que.
  const lido = lerPerguntaDaTela(
    [
      '2 new MCP servers found in this project',
      'Select any you wish to enable.',
      'MCP servers may execute code or access system resources. All tool calls require approval.',
      '❯ [✔] codegraph',
      '[✔] codebase-memory-mcp',
      'Space to select · Esc to reject all',
    ].join('\n')
  );
  assert.deepEqual(lido.alternativas, ['[x] codegraph', '[x] codebase-memory-mcp']);
  assert.match(lido.pergunta, /require approval/);
  assert.equal(lido.tipo, 'hitl.permissao');
});

test('lista de tarefas com caixinha nao vira alternativa quando ha menu numerado', () => {
  // O Claude Code desenha TODO com caixinha na mesma tela do menu. Oferecer tarefa
  // concluida como se fosse resposta possivel seria pior do que nao ler nada.
  const lido = lerPerguntaDaTela(
    [
      '[x] Rodar os testes',
      '[ ] Publicar o pacote',
      'Achei dois caminhos para o refactor. Qual voce prefere?',
      '1. Extrair modulo',
      '2. Manter inline',
    ].join('\n')
  );
  assert.deepEqual(lido.alternativas, ['1. Extrair modulo', '2. Manter inline']);
  assert.equal(lido.tipo, 'hitl.pergunta');
});

test('so o bloco CONTIGUO de caixinhas conta como menu de selecao', () => {
  const lido = lerPerguntaDaTela(
    [
      '[x] tarefa antiga concluida bem longe do menu',
      'muitas linhas de trabalho no meio da tela',
      'Selecione o que deseja habilitar agora:',
      '[ ] alpha',
      '[ ] beta',
    ].join('\n')
  );
  assert.deepEqual(lido.alternativas, ['[ ] alpha', '[ ] beta']);
});

test('tela sem menu nenhum nao inventa pergunta', () => {
  const lido = lerPerguntaDaTela('Checking for updates\nChecking for updates');
  assert.equal(lido.pergunta, '');
  assert.deepEqual(lido.alternativas, []);
  assert.equal(lido.tipo, 'hitl.desconhecido');
});

// ---------------------------------------------------------------------------
// Varredura: o caminho inteiro contra o runtime.
// ---------------------------------------------------------------------------

test('a sessao BLOCKED com job vivo vira HITL com a pergunta e o comando que destrava', (t) => {
  const { runtime, p, thread } = projetoComSessao('hitl-vivo');
  t.after(() => runtime.restaurar());
  runtime.estadoDaSessao('blocked');
  runtime.telaDaSessao(TELA_DO_2FA);

  const r = varrerSessoes({ raiz: p.dir });
  assert.equal(r.runtimeConsultado, true);
  assert.equal(r.resumo.precisamDeHumano, 1);
  assert.equal(r.resumo.hitl, 1);
  assert.equal(r.resumo.abandonadas, 0);

  const s = r.sessoes[0];
  assert.equal(s.classe, 'hitl');
  assert.equal(s.estadoBruto, 'blocked');
  assert.equal(s.jobVivo, true);
  assert.equal(s.tipoDeHitl, 'hitl.credencial');
  assert.match(s.pergunta, /2FA/);
  assert.ok(s.alternativas.length >= 3, 'as alternativas tem de chegar ao humano');
  assert.match(s.comandos.attach, /^claude attach /);
  // A sessao foi despachada pelo `ork`, entao o radar sabe de que thread ela e.
  assert.equal(s.thread?.id, thread.id);
  assert.equal(s.thread?.fase, 'GOAL');
});

test('a sessao BLOCKED cujo job ja saiu e ABANDONADA, nao um prompt para responder', (t) => {
  const { runtime, p } = projetoComSessao('hitl-morto');
  t.after(() => runtime.restaurar());
  runtime.estadoDaSessao('blocked');
  runtime.telaDaSessao(null); // sem tela: o stub responde "job not found", como o runtime real

  const r = varrerSessoes({ raiz: p.dir });
  const s = r.sessoes[0];
  assert.equal(s.classe, 'abandonada');
  assert.equal(s.jobVivo, false);
  assert.equal(s.tipoDeHitl, 'hitl.encerrado');
  assert.equal(s.precisaDeHumano, true, 'trabalho parado pela metade tambem e assunto do humano');
  assert.equal(r.resumo.abandonadas, 1);
  assert.equal(r.resumo.hitl, 0);
  assert.match(s.detalhe, /ja saiu do runtime/);
});

test('sessao trabalhando nao vira alarme', (t) => {
  const { runtime, p } = projetoComSessao('hitl-working');
  t.after(() => runtime.restaurar());

  const r = varrerSessoes({ raiz: p.dir });
  assert.equal(r.resumo.trabalhando, 1);
  assert.equal(r.resumo.precisamDeHumano, 0);
  assert.equal(r.sessoes[0].classe, 'trabalhando');
  assert.equal(r.sessoes[0].jobVivo, null, 'o radar nao gasta uma chamada de log com quem trabalha');
});

test('--sem-logs continua dizendo QUEM esta parado, sem afirmar o que nao leu', (t) => {
  const { runtime, p } = projetoComSessao('hitl-sem-logs');
  t.after(() => runtime.restaurar());
  runtime.estadoDaSessao('blocked');
  runtime.telaDaSessao(null);

  const r = varrerSessoes({ raiz: p.dir, semLogs: true });
  assert.equal(r.logsLidos, false);
  assert.equal(r.resumo.precisamDeHumano, 1);
  const s = r.sessoes[0];
  // Sem ler os logs nao da para saber se o job vive, entao o radar nao decide: ele avisa.
  assert.equal(s.classe, 'hitl');
  assert.equal(s.jobVivo, null);
  assert.equal(s.tipoDeHitl, null);
  assert.equal(s.pergunta, '');
});

test('--so-paradas entrega so a fila do humano, e a ordem poe o HITL vivo na frente', (t) => {
  const { runtime, p } = projetoComSessao('hitl-fila');
  t.after(() => runtime.restaurar());
  runtime.estadoDaSessao('blocked');
  runtime.telaDaSessao(TELA_DO_2FA);

  const r = varrerSessoes({ raiz: p.dir, soParadas: true });
  assert.equal(r.sessoes.length, 1);
  assert.ok(r.sessoes.every((s) => s.precisaDeHumano));
});

test('sem runtime na maquina o radar diz que NAO SABE, em vez de dizer que esta tudo bem', () => {
  const pathAnterior = process.env.PATH;
  process.env.PATH = '/nao-existe';
  try {
    const r = varrerSessoes();
    assert.equal(r.runtimeConsultado, false);
    assert.equal(r.resumo.total, 0);
    assert.match(r.runtimeDetalhe, /indisponivel/);
  } finally {
    process.env.PATH = pathAnterior;
  }
});

// ---------------------------------------------------------------------------
// CLI: o contrato que o orquestrador consome.
// ---------------------------------------------------------------------------

test('`ork sessions hitl --json` entrega o radar, e --exigir-limpo sai != 0 com gente parada', (t) => {
  const { runtime, p } = projetoComSessao('hitl-cli');
  t.after(() => runtime.restaurar());
  runtime.estadoDaSessao('blocked');
  runtime.telaDaSessao(TELA_DO_2FA);

  const bruto = execFileSync('node', [ORK, 'sessions', 'hitl', '--json'], {
    cwd: p.dir,
    encoding: 'utf8',
  });
  const radar = JSON.parse(bruto);
  assert.equal(radar.resumo.precisamDeHumano, 1);
  assert.equal(radar.sessoes[0].tipoDeHitl, 'hitl.credencial');

  let codigo = 0;
  try {
    execFileSync('node', [ORK, 'sessions', 'hitl', '--exigir-limpo'], {
      cwd: p.dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e) {
    codigo = (e as { status: number }).status;
  }
  assert.equal(codigo, 1, 'com sessao esperando humano o watchdog tem de falhar');

  // Sessao voltando a trabalhar, o watchdog limpa.
  runtime.estadoDaSessao('working');
  const saida = execFileSync('node', [ORK, 'sessions', 'hitl', '--exigir-limpo'], {
    cwd: p.dir,
    encoding: 'utf8',
  });
  assert.match(saida, /Nenhuma sessao esperando o humano/);
});

test('o texto do radar poe a pergunta e as alternativas na frente do humano', (t) => {
  const { runtime, p } = projetoComSessao('hitl-texto');
  t.after(() => runtime.restaurar());
  runtime.estadoDaSessao('blocked');
  runtime.telaDaSessao(TELA_DO_2FA);

  const saida = execFileSync('node', [ORK, 'sessions', 'hitl', '--so-paradas'], {
    cwd: p.dir,
    encoding: 'utf8',
  });
  assert.match(saida, /Esperando o HUMANO agora/);
  assert.match(saida, /pergunta : .*2FA/);
  assert.match(saida, /opcao    : 1\. Passo o codigo agora/);
  assert.match(saida, /responder: claude attach/);
});

test('duracaoCurta escreve minutos, horas e dias sem virar numero cru', () => {
  assert.equal(duracaoCurta(12), '12min');
  assert.equal(duracaoCurta(185), '3h05');
  assert.equal(duracaoCurta(3000), '2d 02h');
});

test('hitl.desconhecido traz as últimas N linhas limpas e redige segredo reconhecível', t => {
  const { runtime, p } = projetoComSessao('hitl-contexto');
  t.after(() => runtime.restaurar());
  runtime.estadoDaSessao('blocked');
  runtime.telaDaSessao('linha antiga\naguardando operador\nghp_aaaaaaaaaaaaaaaaaaaaaaaaa\nsem menu nesta tela');
  const s = varrerSessoes({ raiz:p.dir, linhasLogs:2 }).sessoes[0];
  assert.equal(s.tipoDeHitl,'hitl.desconhecido');
  assert.deepEqual(s.contextoLogs,['[redigido]','sem menu nesta tela']);
  assert.deepEqual(s.alternativas,[]);
});

test('consulta indisponível é diferente de lista vazia e mantém diagnóstico', () => {
  const r = varrerSessoes({ consulta:{ok:false,sessoes:[],detalhe:'consulta falhou'} });
  assert.equal(r.runtimeConsultado,false);
  assert.equal(r.runtimeDetalhe,'consulta falhou');
  assert.equal(varrerSessoes({consulta:{ok:true,sessoes:[],detalhe:''}}).runtimeConsultado,true);
});

test('cada parada sai com UMA recomendacao, e ela muda com o tipo da parada', (t) => {
  const { runtime, p } = projetoComSessao('hitl-recomendacao');
  t.after(() => runtime.restaurar());

  runtime.estadoDaSessao('blocked');
  runtime.telaDaSessao(TELA_DO_2FA);
  const credencial = varrerSessoes({ raiz: p.dir }).sessoes[0];
  assert.equal(credencial.tipoDeHitl, 'hitl.credencial');
  assert.match(credencial.recomendacao, /credencial de automacao/);

  // A mesma sessao, agora com o job morto: a recomendacao vira outra coisa.
  runtime.telaDaSessao(null);
  const abandonada = varrerSessoes({ raiz: p.dir }).sessoes[0];
  assert.equal(abandonada.classe, 'abandonada');
  assert.match(abandonada.recomendacao, /nao responda/);
  assert.match(abandonada.recomendacao, /redespache/);

  // Quem nao precisa de humano nao recebe recomendacao nenhuma: seria ruido.
  runtime.estadoDaSessao('working');
  assert.equal(varrerSessoes({ raiz: p.dir }).sessoes[0].recomendacao, '');
});


test('pergunta e alternativas redigem credenciais de URL antes do radar e ledger', t => {
  const { runtime, p, thread } = projetoComSessao('hitl-url-redacao');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const senha = 'SenhaSinteticaDeFixture';
  const url = `postgresql://fixture:${senha}@host.invalid/base`;
  runtime.estadoDaSessao('blocked');
  runtime.telaDaSessao(`Usar ${url}?\n1. Sim ${url}\n2. Nao`);
  const radar = varrerSessoes({ raiz: p.dir, registrar: true, escopo: [thread.id] });
  assert.equal(radar.sessoes[0].classe, 'hitl');
  assert.ok(radar.sessoes[0].pergunta.includes('redigida'));
  assert.ok(radar.sessoes[0].alternativas[0].includes('redigida'));
  assert.ok(!JSON.stringify(radar).includes(senha));
  const log = fs.readFileSync(path.join(p.dir, '.orkastery/threads', thread.id, 'ledger.jsonl'), 'utf8');
  assert.ok(!log.includes(senha));
  assert.match(log, /sessao_bloqueada/);
});


test('CG4: arrobas em senha sao removidas do radar, alternativas e ledger', t => {
  const { runtime, p, thread } = projetoComSessao('hitl-url-arrobas');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const url = 'postgresql://fixture:prefixo@fragmentoSecreto@host.invalid/base';
  runtime.estadoDaSessao('blocked');
  runtime.telaDaSessao(`Usar ${url}?\n1. Sim ${url}\n2. Nao`);
  const radar = varrerSessoes({ raiz: p.dir, registrar: true, escopo: [thread.id] });
  assert.equal(radar.sessoes[0].classe, 'hitl');
  for (const texto of [JSON.stringify(radar), fs.readFileSync(path.join(p.dir, '.orkastery/threads', thread.id, 'ledger.jsonl'), 'utf8')]) {
    assert.ok(!texto.includes('fragmentoSecreto'));
    assert.ok(!texto.includes('prefixo'));
    assert.ok(texto.includes('host.invalid/base'));
  }
});
