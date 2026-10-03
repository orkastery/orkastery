/**
 * RM-053 (fatia 2): a rede no `ork doctor`, o retrato parado fora do `REDE.md`, a saida saneada do
 * `ork fabrica` e a trava orfa tirada em serie (W9).
 *
 * Nenhum teste toca a forja: o doctor so le arquivos de `ORK_USUARIO_DIR`, o `REDE.md` sai de uma
 * funcao pura e a fabrica e lida de um painel montado no teste.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { checar } from '../src/doctor';
import { formatarDataHora } from '../src/horario';
import { painelDaRede, RETRATO_PARADO_MS, retratoParado, tirarTravaOrfa } from '../src/rede';
import { textoDaFabrica, textoDasOutrasMaquinas } from '../src/fabrica-estado';
import { jsonSemInvisivel, valoresEmUmaLinha } from '../src/saida-segura';
import { dirTemporario } from './apoio';

function naMaquina<T>(usuario: string, f: () => T): T {
  const antes = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = usuario;
  try { return f(); } finally {
    if (antes === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = antes;
  }
}

const semCrontab = () => ({ ok: false as const, motivo: 'teste' });

function checkDaRede(usuario: string, fora: string) {
  const c = naMaquina(usuario, () => checar(fora, [], semCrontab)).find((x) => x.nome === 'rede');
  assert.ok(c, 'o doctor tem o check "rede"');
  return c!;
}

test('RM-053 fatia 2 doctor: membro herdado com a casa ausente vira aviso com a falha do rede.log e a correcao', () => {
  const raiz = dirTemporario('rm053f2-doctor');
  try {
    const usuario = path.join(raiz, 'usuario'), fora = path.join(raiz, 'fora');
    fs.mkdirSync(path.join(usuario, 'rede'), { recursive: true });
    fs.mkdirSync(fora);

    // Fora da rede: ok, e diz como entrar.
    let c = checkDaRede(usuario, fora);
    assert.equal(c.nivel, 'ok');
    assert.match(c.detalhe, /fora da rede; ork network entrar/);

    // O caso da srvjcp86 em 02/10: membro herdado da fabrica, toda publicacao caindo sem casa.
    fs.writeFileSync(path.join(usuario, 'maquina.json'), JSON.stringify({ contrato: 'ork.maquina/v1', nome: 'pc-a', fabricaCompartilhada: true }));
    const log = path.join(usuario, 'rede', 'rede.log');
    fs.writeFileSync(log, [
      JSON.stringify({ ts: '2026-09-02T17:17:53.612Z', acao: 'falhou', origem: 'evento', erro: 'rede.sem-forja: antiga' }),
      'linha quebrada {',
      JSON.stringify({ ts: '2026-09-03T06:08:44.187Z', acao: 'falhou', origem: 'pulse',
        erro: 'rede.sem-repositorio: github.com/p/orkastery-network ainda nao existe\n\u001b[31mFALSO\u001b[0m' }),
    ].join('\n') + '\n');
    c = checkDaRede(usuario, fora);
    assert.equal(c.nivel, 'warn', 'a rede caindo nao passa calada');
    assert.match(c.detalhe, /membro herdado da fabrica/);
    assert.match(c.detalhe, /casa ainda nao gravada/);
    assert.match(c.detalhe, /nenhuma batida publicada/);
    assert.ok(c.detalhe.includes(`ultima falha ${formatarDataHora('2026-09-03T06:08:44.187Z')} (pulse): rede.sem-repositorio`), c.detalhe);
    assert.ok(!/[\u001b\n]/.test(c.detalhe), 'o erro do log chega numa linha, sem controle de terminal');
    assert.match(c.correcao ?? '', /ork network entrar/);

    // Uma batida publicada DEPOIS da falha: ok, com a casa e a hora da batida.
    const agora = Date.now();
    const marca = (em: number) => fs.writeFileSync(path.join(usuario, 'rede', 'publicada.json'), JSON.stringify({
      assinatura: 'x', em: new Date(em).toISOString(), commit: 'abc', casa: 'github.com/p/orkastery-network', forja: 'github',
      maquina: 'pc-a', projetos: [] }));
    marca(agora - 10 * 60 * 1000);
    c = checkDaRede(usuario, fora);
    assert.equal(c.nivel, 'ok');
    assert.match(c.detalhe, /casa github\.com\/p\/orkastery-network/);
    assert.match(c.detalhe, /ultima batida .* \(ha 10 min\)/);
    assert.ok(c.detalhe.includes(`ultima falha ${formatarDataHora('2026-09-03T06:08:44.187Z')}`), 'a falha que ja passou continua dita');

    // A batida parada ha mais de 3 h: aviso, mesmo sem falha nova.
    marca(agora - 4 * 60 * 60 * 1000);
    fs.writeFileSync(log, '');
    c = checkDaRede(usuario, fora);
    assert.equal(c.nivel, 'warn');
    assert.match(c.detalhe, /nenhuma falha no rede\.log/);
    assert.match(c.correcao ?? '', /cron do pulse/);

    // Quem saiu da rede: ok, e o doctor nao inventa casa.
    fs.writeFileSync(path.join(usuario, 'rede.json'), JSON.stringify({ contrato: 'ork.rede/v1', membro: false }));
    c = checkDaRede(usuario, fora);
    assert.equal(c.nivel, 'ok');
    assert.match(c.detalhe, /saiu com ork network sair/);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('RM-053 fatia 2 REDE.md: a regua do retrato parado e de 14 dias; batida ilegivel ou no futuro fica no indice', () => {
  const agora = Date.parse('2026-10-03T12:00:00Z');
  const dia = 24 * 60 * 60 * 1000;
  assert.equal(RETRATO_PARADO_MS, 14 * dia);
  assert.equal(retratoParado({ publicadoEm: new Date(agora - 14 * dia).toISOString() }, agora), false, 'no limite, fica');
  assert.equal(retratoParado({ publicadoEm: new Date(agora - 14 * dia - 1).toISOString() }, agora), true);
  assert.equal(retratoParado({ publicadoEm: 'ontem' }, agora), false, 'ilegivel nao se sabe parado');
  assert.equal(retratoParado({ publicadoEm: new Date(agora + 30 * dia).toISOString() }, agora), false, 'relogio adiantado fica');
  const retrato = (maquina: string, publicadoEm: string) => ({ contrato: 'ork.rede-maquina/v1' as const, maquina, hostname: maquina,
    adesao: 'rede' as const, forjas: [], runtimes: [], hosts: [], projetos: [], versaoOrk: '0.5.2', publicadoEm });
  const so = painelDaRede([retrato('pc-velho', new Date(agora - 40 * dia).toISOString())], agora);
  assert.match(so, /nenhuma máquina com batida recente/);
  assert.match(so, /Fora do índice, sem batida há mais de 14 dias: pc-velho/);
  assert.doesNotMatch(painelDaRede([], agora), /Fora do índice/);
});

test('RM-053 fatia 2 saida: o ork fabrica e o board nao imprimem quebra de linha nem controle de terminal do remoto', () => {
  const ESC = '\u001b';
  const thread = { id: 'ork-x', nome: 'x', modo: '#Auto', fase: 'GO', status: 'aberta' as const, roadmap: 'RM-1\u202e', branch: null,
    atualizadaEm: null, entregue: null, esperaVoce: true, pergunta: `veredito?${ESC}]8;;http://x${ESC}\\`, paradaDesde: null };
  const painel = { atualizado: true, ponta: 'abc', maquinas: [{ contrato: 'ork.fabrica-maquina/v1' as const, maquina: 'pc-outra',
    por: `Fulano\n  [ok] tudo certo, pode mesclar${ESC}[2J`, projeto: `orkastery${ESC}[31m\r\nfalso`, versaoOrk: '0.5.2',
    publicadoEm: '2026-10-03T06:00:00.000Z', threads: [thread] }] };
  for (const texto of [textoDaFabrica(painel, 'pc-a'), textoDasOutrasMaquinas(painel, 'pc-a')]) {
    assert.ok(!texto.includes(ESC), 'nenhum ESC chega a tela');
    assert.ok(!texto.includes('\u202e'), 'nem o bidi');
    assert.ok(!texto.split('\n').some((l) => /^\s*\[ok\] tudo certo/.test(l)), 'o valor alheio nao abre uma linha propria');
    assert.match(texto, /Fulano {3}\[ok\] tudo certo, pode mesclar\[2J/, 'o texto fica, numa linha');
  }
  assert.ok(painel.maquinas[0].por.includes(ESC), 'o painel lido nao e alterado');
  // O --json: o mesmo valor, com o invisivel escrito como \uXXXX.
  const json = jsonSemInvisivel(painel);
  assert.ok(!json.includes(ESC) && !json.includes('\r') && !json.includes('\u202e'));
  assert.deepEqual(JSON.parse(json), painel, 'quem le o JSON recebe o mesmo texto');
  assert.deepEqual(valoresEmUmaLinha({ n: Number.NaN, a: ['x\ny'], b: null }), { n: Number.NaN, a: ['x y'], b: null });
});

test('RM-053 fatia 2 W9: a trava viva nunca sai do lugar, mesmo com um terceiro entrando no meio; a faxina e serial', () => {
  const d = dirTemporario('rm053f2-w9');
  const fsReal = createRequire(__filename)('node:fs') as typeof fs;
  const renomear = fsReal.renameSync;
  try {
    const trava = path.join(d, 'publicar.lock');
    // Quem julgou "orfa" chega tarde: no lugar ja esta a trava viva de B. Se ela for movida, C entra
    // no lugar vazio antes da volta (o renomear de teste simula C), e a de B encalharia em .orfa-*.
    fs.mkdirSync(trava);
    fs.writeFileSync(path.join(trava, 'pid'), String(process.pid));
    fsReal.renameSync = ((de: fs.PathLike, para: fs.PathLike) => {
      renomear(de, para);
      if (String(de) === trava && String(para).includes('.orfa-')) {
        fs.mkdirSync(trava);
        fs.writeFileSync(path.join(trava, 'pid'), 'C');
      }
    }) as typeof fs.renameSync;
    assert.equal(tirarTravaOrfa(trava), 'viva');
    fsReal.renameSync = renomear;
    assert.deepEqual(fs.readdirSync(d).filter((n) => n.includes('.orfa-')), [], 'a trava viva de B nao encalhou');
    assert.equal(fs.readFileSync(path.join(trava, 'pid'), 'utf8'), String(process.pid), 'a trava de B continua no lugar');

    // Com outra faxina em curso (pid vivo), ninguem mexe na orfa: a faxina e uma por vez.
    fs.rmSync(trava, { recursive: true });
    fs.mkdirSync(trava);
    const velho = (Date.now() - 10 * 60 * 1000) / 1000;
    fs.utimesSync(trava, velho, velho);
    const faxina = `${trava}.faxina`;
    fs.mkdirSync(faxina);
    fs.writeFileSync(path.join(faxina, 'pid'), String(process.pid));
    assert.equal(tirarTravaOrfa(trava), 'ocupada');
    assert.ok(fs.existsSync(trava), 'a orfa espera a faxina em curso');
    // A faxina que caiu antes de gravar o pid (velha) sai; a rodada seguinte tira a orfa.
    fs.rmSync(path.join(faxina, 'pid'));
    fs.utimesSync(faxina, velho, velho);
    assert.equal(tirarTravaOrfa(trava), 'ocupada');
    assert.equal(fs.existsSync(faxina), false);
    assert.equal(tirarTravaOrfa(trava), 'removida');
    assert.deepEqual(fs.readdirSync(d), [], 'nem orfa, nem faxina, nem .orfa- para tras');
  } finally { fsReal.renameSync = renomear; fs.rmSync(d, { recursive: true, force: true }); }
});
