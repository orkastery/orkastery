/**
 * I-33 (T1, D3): store `ork.runtime-profiles/v1`. Prova o armazenamento privado (0700/0600,
 * mesmo com umask permissivo), a recusa de arquivo afrouxado ou por link, a escolha do perfil
 * na ordem do store e a resolucao pelo registro da sessao, que nunca cai para o env do processo
 * quando o perfil gravado e invalido.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  adicionarPerfil, ambienteComPerfil, caminhoDoStore, CONTRATO_PERFIS, desativarPerfil, diretorioEfetivo, lerPerfis,
  linhasDePerfis, marcarFalhaDePerfil, menorEsgotadoAte, pastaPrivada, perfilDeDespacho, perfilDisponivel, perfilDoRegistro,
  POLITICA_PADRAO, prazoDaFila, prazoDoRuntime, proximoPerfilDisponivel, reativarPerfil, registrarUsoDePerfil,
} from '../src/runtime-profiles';
import { dirTemporario } from './apoio';

/** D5 com a troca ligada (D14); a politica com a troca por cota desligada tem asserts proprios abaixo. */
const ROTACAO_D5 = { mesmoRuntimePorCota: true, mesmoRuntimePorAuth: true };
/** D16: o operador desligou a troca por cota no manifesto. */
const SEM_TROCA_POR_COTA = { mesmoRuntimePorCota: false, mesmoRuntimePorAuth: true };

function projeto(): { raiz: string; limpar: () => void } {
  const raiz = dirTemporario('perfis');
  fs.mkdirSync(path.join(raiz, '.orkastery'));
  return { raiz, limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

test('sem store nao ha perfil: leitura devolve lista vazia e nada e criado', () => {
  const { raiz, limpar } = projeto();
  try {
    assert.deepEqual(lerPerfis(raiz), { contrato: CONTRATO_PERFIS, perfis: [] });
    assert.equal(fs.existsSync(pastaPrivada(raiz)), false);
  } finally { limpar(); }
});

test('adicionar grava em pasta 0700 e arquivo 0600 mesmo com umask permissivo, sem segredo', () => {
  const { raiz, limpar } = projeto();
  const anterior = process.umask(0);
  try {
    const p = adicionarPerfil(raiz, { id: 'claude-a', runtime: 'claude-bg', dir: path.join(raiz, 'contas', 'a') }, '2026-09-19T10:00:00.000Z');
    adicionarPerfil(raiz, { id: 'codex-a', runtime: 'codex', dir: path.join(raiz, 'contas', 'codex-a') });
    assert.equal(p.estado, 'ativo');
    assert.equal(fs.statSync(pastaPrivada(raiz)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(caminhoDoStore(raiz)).mode & 0o777, 0o600);
    const lido = lerPerfis(raiz);
    assert.deepEqual(lido.perfis.map(x => [x.id, x.runtime]), [['claude-a', 'claude-bg'], ['codex-a', 'codex']]);
    assert.equal(lido.perfis[0].configDir, path.join(raiz, 'contas', 'a'));
    assert.equal(lido.perfis[1].codexHome, path.join(raiz, 'contas', 'codex-a'));
    // O store guarda identidade, diretorio e estado de uso; nada lido de dentro do diretorio.
    const chaves = new Set(lido.perfis.flatMap(x => Object.keys(x)));
    assert.deepEqual([...chaves].sort(), ['codexHome', 'configDir', 'criadoEm', 'esgotadoAte', 'estado', 'id', 'runtime',
      'ultimaFalha', 'ultimoUso'].sort());
    assert.equal(fs.existsSync(path.join(raiz, 'contas')), false, 'o store nunca cria nem le o diretorio do perfil');
    assert.deepEqual(linhasDePerfis(lido)[0].slice(0, 4), ['claude-a', 'claude-bg', path.join(raiz, 'contas', 'a'), 'ativo']);
  } finally { process.umask(anterior); limpar(); }
});

test('store afrouxado, por link ou fora do contrato e recusado', () => {
  const { raiz, limpar } = projeto();
  try {
    adicionarPerfil(raiz, { id: 'a', runtime: 'claude-bg', dir: '/srv/contas/a' });
    const arquivo = caminhoDoStore(raiz);
    fs.chmodSync(arquivo, 0o644);
    assert.throws(() => lerPerfis(raiz), /0600/);
    fs.chmodSync(arquivo, 0o600);
    fs.chmodSync(pastaPrivada(raiz), 0o755);
    assert.throws(() => lerPerfis(raiz), /0700/);
    fs.chmodSync(pastaPrivada(raiz), 0o700);
    const conteudo = fs.readFileSync(arquivo, 'utf8');
    fs.writeFileSync(arquivo, conteudo.replace(CONTRATO_PERFIS, 'ork.runtime-profiles/v0'));
    assert.throws(() => lerPerfis(raiz), /contrato/);
    fs.rmSync(arquivo);
    const real = path.join(raiz, 'real.json');
    fs.writeFileSync(real, conteudo, { mode: 0o600 });
    fs.symlinkSync(real, arquivo);
    assert.throws(() => lerPerfis(raiz), /link simbolico/);
  } finally { limpar(); }
});

test('id repetido, diretorio repetido no mesmo runtime e caminho relativo sao recusados', () => {
  const { raiz, limpar } = projeto();
  try {
    adicionarPerfil(raiz, { id: 'a', runtime: 'claude-bg', dir: '/srv/contas/a' });
    assert.throws(() => adicionarPerfil(raiz, { id: 'a', runtime: 'codex', dir: '/srv/contas/x' }), /ja existe/);
    assert.throws(() => adicionarPerfil(raiz, { id: 'b', runtime: 'claude-bg', dir: '/srv/contas/a' }), /ja ha perfil/);
    assert.throws(() => adicionarPerfil(raiz, { id: 'c', runtime: 'claude-bg', dir: 'contas/c' }), /absoluto/);
    assert.throws(() => adicionarPerfil(raiz, { id: 'c', runtime: 'claude-bg', dir: '/srv/../etc' }), /normalizado/);
    assert.throws(() => adicionarPerfil(raiz, { id: 'c d', runtime: 'claude-bg', dir: '/srv/c' }), /id do perfil/);
    assert.throws(() => adicionarPerfil(raiz, { id: 'c', runtime: 'gemini', dir: '/srv/c' }), /nao aceita perfil/);
    // O mesmo diretorio em outro runtime e outro perfil: cada CLI le a sua variavel.
    adicionarPerfil(raiz, { id: 'b', runtime: 'codex', dir: '/srv/contas/a' });
    assert.equal(lerPerfis(raiz).perfis.length, 2);
  } finally { limpar(); }
});

test('rodizio: ordem do store, esgotado volta no prazo, sem-auth e desativado nunca recebem despacho', () => {
  const { raiz, limpar } = projeto();
  try {
    for (const id of ['a', 'b', 'c']) adicionarPerfil(raiz, { id, runtime: 'claude-bg', dir: `/srv/contas/${id}` });
    adicionarPerfil(raiz, { id: 'x', runtime: 'codex', dir: '/srv/contas/x' });
    const agora = Date.parse('2026-09-19T12:00:00Z');
    assert.equal(proximoPerfilDisponivel(lerPerfis(raiz), 'claude-bg', ROTACAO_D5, { agoraMs: agora })?.id, 'a');
    assert.throws(() => marcarFalhaDePerfil(raiz, 'a', { estado: 'esgotado', esgotadoAte: null, motivo: 'runtime.quota-exhausted', detalhe: '' }), /esgotadoAte/);
    marcarFalhaDePerfil(raiz, 'a', { estado: 'esgotado', esgotadoAte: '2026-09-19T15:00:00.000Z',
      motivo: 'runtime.quota-exhausted', detalhe: 'out of credits' + String.fromCharCode(7), em: '2026-09-19T12:00:00.000Z' });
    marcarFalhaDePerfil(raiz, 'b', { estado: 'sem-auth', esgotadoAte: null, motivo: 'runtime.auth-missing', detalhe: 'Not logged in' });
    let store = lerPerfis(raiz);
    assert.equal(store.perfis[0].ultimaFalha?.detalhe, 'out of credits ', 'controle nunca entra no store');
    assert.equal(proximoPerfilDisponivel(store, 'claude-bg', ROTACAO_D5, { agoraMs: agora })?.id, 'c');
    assert.equal(proximoPerfilDisponivel(store, 'claude-bg', ROTACAO_D5, { agoraMs: agora, excluir: ['c'] }), null);
    assert.equal(menorEsgotadoAte(store, ['claude-bg', 'codex'], agora), '2026-09-19T15:00:00.000Z');
    // D16: a politica padrao troca por cota, como a D5.
    assert.deepEqual(POLITICA_PADRAO, ROTACAO_D5);
    assert.equal(proximoPerfilDisponivel(store, 'claude-bg', POLITICA_PADRAO, { agoraMs: agora })?.id, 'c');
    // D14: com a troca por cota desligada pelo operador, o perfil da vez esgotado segura o runtime ate o prazo dele.
    assert.equal(proximoPerfilDisponivel(store, 'claude-bg', SEM_TROCA_POR_COTA, { agoraMs: agora }), null);
    assert.equal(prazoDoRuntime(store, 'claude-bg', SEM_TROCA_POR_COTA, agora), '2026-09-19T15:00:00.000Z');
    assert.equal(proximoPerfilDisponivel(store, 'codex', SEM_TROCA_POR_COTA, { agoraMs: agora })?.id, 'x');
    assert.equal(prazoDaFila(store, ['claude-bg', 'codex'], SEM_TROCA_POR_COTA, agora), '2026-09-19T15:00:00.000Z');
    assert.equal(perfilDisponivel(store.perfis[0], Date.parse('2026-09-19T15:00:00Z')), true, 'prazo vencido devolve ao rodizio');
    assert.equal(perfilDisponivel(store.perfis[1], Date.parse('2030-01-01T00:00:00Z')), false, 'sem-auth nao tem prazo');
    desativarPerfil(raiz, 'c');
    store = lerPerfis(raiz);
    assert.equal(proximoPerfilDisponivel(store, 'claude-bg', ROTACAO_D5, { agoraMs: agora }), null);
    assert.throws(() => reativarPerfil(raiz, 'c'), /desativado/);
    assert.equal(reativarPerfil(raiz, 'b').estado, 'ativo');
    const usado = registrarUsoDePerfil(raiz, 'a', '2026-09-19T16:00:00.000Z');
    assert.equal(usado.estado, 'ativo');
    assert.equal(usado.esgotadoAte, null);
    assert.equal(usado.ultimoUso, '2026-09-19T16:00:00.000Z');
    assert.throws(() => registrarUsoDePerfil(raiz, 'zz'), /nao existe/);
  } finally { limpar(); }
});

test('env do perfil: so a variavel do runtime muda e a base nao e alterada', () => {
  const base = { PATH: '/bin', CLAUDE_CONFIG_DIR: '/home/u/.claude', CODEX_HOME: '/home/u/.codex' };
  const claude = ambienteComPerfil(base, { id: 'a', runtime: 'claude-bg', configDir: '/srv/contas/a' });
  const codex = ambienteComPerfil(base, { id: 'x', runtime: 'codex', codexHome: '/srv/contas/x' });
  assert.equal(claude.CLAUDE_CONFIG_DIR, '/srv/contas/a');
  assert.equal(claude.CODEX_HOME, '/home/u/.codex');
  assert.equal(codex.CODEX_HOME, '/srv/contas/x');
  assert.equal(base.CLAUDE_CONFIG_DIR, '/home/u/.claude');
  assert.deepEqual(ambienteComPerfil(base, null), base);
  assert.equal(diretorioEfetivo('claude-bg', null, { CLAUDE_CONFIG_DIR: '/env/claude' }), '/env/claude');
  assert.equal(diretorioEfetivo('codex', { id: 'x', runtime: 'codex', codexHome: '/srv/x' }, { CODEX_HOME: '/env/codex' }), '/srv/x');
  assert.throws(() => diretorioEfetivo('codex', { id: 'a', runtime: 'claude-bg', configDir: '/srv/a' }), /outro runtime/);
});

test('perfil do registro da sessao: sensor vence, ausente e null, invalido ou divergente lanca', () => {
  const sessao = { sessionId: 's1', despachadaEm: '2026-09-19T10:00:00.000Z' };
  const perfilA = { id: 'a', runtime: 'claude-bg', configDir: '/srv/contas/a' };
  const despacho = { tipo: 'phase_dispatch', sessionId: 's1', perfil: perfilA };
  const sensor = { tipo: 'session_sensor_registered', sessionId: 's1', despachoEm: sessao.despachadaEm, perfil: perfilA };
  assert.deepEqual(perfilDoRegistro([despacho, sensor], sessao), perfilA);
  assert.deepEqual(perfilDoRegistro([despacho], sessao), perfilA);
  assert.equal(perfilDoRegistro([{ tipo: 'phase_dispatch', sessionId: 's1' }], sessao), null);
  assert.equal(perfilDoRegistro([{ ...despacho, sessionId: 's2' }], sessao), null);
  assert.throws(() => perfilDoRegistro([{ ...despacho, perfil: { ...perfilA, configDir: 'relativo' } }], sessao), /absoluto/);
  assert.throws(() => perfilDoRegistro([{ ...despacho, perfil: { ...perfilA, token: 'x' } }], sessao), /campo inesperado/);
  assert.throws(() => perfilDoRegistro([despacho, { ...sensor, perfil: { ...perfilA, configDir: '/srv/contas/b' } }], sessao), /diverge/);
  assert.deepEqual(perfilDeDespacho({ ...perfilA, runtime: 'claude-bg', estado: 'esgotado', esgotadoAte: null, ultimaFalha: null,
    ultimoUso: null, criadoEm: '2026-09-19T10:00:00.000Z' }), perfilA);
});
