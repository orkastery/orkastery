import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { MudancaNaBranch } from '../src/branch-de-estado';
import { CONTRATO_ATESTACAO_ACORDO, type CorpoDaAtestacao, type PortaDeAtestacao } from '../src/rede-empresa-atestacao';
import { coordenarTrabalho, type PedidoDeCoordenacao } from '../src/rede-empresa-coordenacao';
import { CONTRATO_POLITICA_EMPRESA_V2 } from '../src/rede-empresa-contrato';
import type { PortaDaBranchEmpresa } from '../src/rede-empresa-transporte';

class Branch implements PortaDaBranchEmpresa {
  id: string | null = 'c0';
  arquivos = new Map<string, string>();
  listas = 0;
  constructor() { this.arquivos.set('politica.json', JSON.stringify({ contrato: CONTRATO_POLITICA_EMPRESA_V2,
    versao: 'v2', saida: 'permitida', publicacaoMinima: 1, nivel: 'exigir', reciboVersao: 'v2', espelhos: [] })); }
  ler() { const snapshot = new Map(this.arquivos); return { id: this.id, atualizada: true,
    ler: (c: string) => snapshot.get(c) ?? null,
    listar: (prefixo: string) => { this.listas++; return [...snapshot].filter(([c]) => c.startsWith(prefixo))
      .map(([caminho, conteudo]) => ({ caminho, conteudo })); } }; }
  gravar(_ponta: string | null, mudancas: readonly MudancaNaBranch[]) {
    for (const m of mudancas) if (m.conteudo === null) this.arquivos.delete(m.caminho); else this.arquivos.set(m.caminho, m.conteudo);
    this.id = `c${Number(this.id?.slice(1) ?? 0) + 1}`; return this.id;
  }
}

const agora = '2026-11-11T12:00:00.000Z';
const projectKey = 'github:github.com/time/projeto';
const pedido = (accountId: number, acao: PedidoDeCoordenacao['acao'] = 'reserva'): PedidoDeCoordenacao => ({ acao,
  operationId: `operacao-${accountId}-abcdef`, projectKey, itemId: 'RM-089',
  identidade: { inscricaoId: `inscricao-${accountId}`, accountId, loginAtual: `login-${accountId}`, fase: 'GO' },
  agora, timeoutMs: 2_000 });

test('CAS mantém um único titular e informa inscrição, login, projeto e fase', () => {
  const b = new Branch();
  const a = coordenarTrabalho(b, pedido(41));
  const c = coordenarTrabalho(b, pedido(42));
  assert.equal(a.ok && a.codigo, 'rede-empresa.reserva-criada');
  assert.equal(c.ok, false);
  if (!c.ok) assert.deepEqual([c.codigo, c.existente?.titular.inscricaoId, c.existente?.titular.loginAtual,
    c.existente?.projectKey, c.existente?.titular.fase],
  ['rede-empresa.reserva-existente', 'inscricao-41', 'login-41', projectKey, 'GO']);
  assert.equal(b.listas, 2, 'uma enumeração em lote por tentativa');
});

test('B1: adulterar o titular no JSON coletivo invalida a reserva em vez de transferi-la', () => {
  const b = new Branch();
  const criada = coordenarTrabalho(b, pedido(41)); assert.ok(criada.ok);
  const caminho = [...b.arquivos.keys()].find((k) => k.startsWith('coordenacao/'))!;
  const adulterada = JSON.parse(b.arquivos.get(caminho)!) as Record<string, unknown>;
  adulterada.titular = { inscricaoId: 'inscricao-42', accountId: 42, loginAtual: 'login-42', fase: 'GO' };
  b.arquivos.set(caminho, JSON.stringify(adulterada));
  const r = coordenarTrabalho(b, pedido(42));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.codigo, 'rede-empresa.documento-remoto-invalido');
});

test('B5: falha ao enumerar a snapshot da forja nunca vira lista vazia', () => {
  const b = new Branch();
  const ler = b.ler.bind(b);
  b.ler = () => ({ ...ler(), listar: () => { throw new Error('falha de leitura simulada'); } });
  const r = coordenarTrabalho(b, pedido(41));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.codigo, 'rede-empresa.forja-indisponivel');
  assert.equal([...b.arquivos.keys()].some((k) => k.startsWith('coordenacao/')), false);
});

test('B3: renovação, colaboração e acordo mudam versão e fingerprint da reserva inteira', () => {
  const b = new Branch();
  const primeira = coordenarTrabalho(b, pedido(41)); assert.ok(primeira.ok);
  const renovada = coordenarTrabalho(b, pedido(41)); assert.ok(renovada.ok);
  const colaborada = coordenarTrabalho(b, pedido(42, 'colaborador')); assert.ok(colaborada.ok);
  const acordada = coordenarTrabalho(b, { ...pedido(42, 'acordo'), atestacao: acordo(colaborada.reserva) });
  assert.ok(acordada.ok);
  assert.deepEqual([primeira.reserva.versao, renovada.reserva.versao, colaborada.reserva.versao, acordada.reserva.versao],
    [1, 2, 3, 4]);
  assert.equal(new Set([primeira.reserva.fingerprint, renovada.reserva.fingerprint, colaborada.reserva.fingerprint,
    acordada.reserva.fingerprint]).size, 4);
});

test('colaboração preserva o titular principal', () => {
  const b = new Branch(); coordenarTrabalho(b, pedido(41));
  const r = coordenarTrabalho(b, pedido(42, 'colaborador'));
  assert.equal(r.ok && r.codigo, 'rede-empresa.colaboracao-registrada');
  if (r.ok) assert.deepEqual([r.reserva.titular.accountId, r.reserva.colaboradores.map((c) => c.accountId)], [41, [42]]);
});

function acordo(reserva: Extract<ReturnType<typeof coordenarTrabalho>, { ok: true }>['reserva'], mudanca: Partial<CorpoDaAtestacao> = {},
  authorId = 41) {
  const corpo: CorpoDaAtestacao = { contrato: CONTRATO_ATESTACAO_ACORDO, projectKey, itemId: 'RM-089',
    reservaVersao: reserva.versao, reservaFingerprint: reserva.fingerprint, emissorAccountId: 41,
    destinatarioAccountId: 42, emitidoEm: '2026-11-11T11:00:00.000Z', expiraEm: '2026-11-12T11:00:00.000Z',
    nonce: 'nonce-abcdef-123456', ...mudanca };
  const body = JSON.stringify(corpo), referencia = { forja: 'github' as const, id: 77,
    endpoint: '/repos/time/rede/issues/comments/77', sha256: createHash('sha256').update(body).digest('hex') };
  const porta: PortaDeAtestacao = { ler: () => ({ id: 77, authorId, body,
    createdAt: '2026-11-11T11:00:00.000Z', updatedAt: '2026-11-11T11:00:00.000Z' }) };
  return { porta, referencia };
}

test('acordo autenticado aceita o destinatário sem substituir a reserva', () => {
  const b = new Branch(), inicial = coordenarTrabalho(b, pedido(41)); assert.ok(inicial.ok);
  const r = coordenarTrabalho(b, { ...pedido(42, 'acordo'), atestacao: acordo(inicial.reserva) });
  assert.equal(r.ok && r.codigo, 'rede-empresa.acordo-aceito');
  if (r.ok) assert.deepEqual([r.reserva.titular.accountId, r.reserva.acordos[0].destinatarioAccountId], [41, 42]);
});

test('acordo forjado, autor errado, destinatário errado, reserva antiga e expiração são recusados', () => {
  const casos: Array<[string, Partial<CorpoDaAtestacao>, number]> = [
    ['rede-empresa.acordo-autor-divergente', {}, 99],
    ['rede-empresa.acordo-destinatario-divergente', { destinatarioAccountId: 99 }, 41],
    ['rede-empresa.acordo-escopo-divergente', { itemId: 'RM-090' }, 41],
    ['rede-empresa.acordo-reserva-divergente', { reservaFingerprint: 'a'.repeat(64) }, 41],
    ['rede-empresa.acordo-expirado', { expiraEm: '2026-11-11T11:30:00.000Z' }, 41],
  ];
  for (const [codigo, alteracao, autor] of casos) {
    const b = new Branch(), inicial = coordenarTrabalho(b, pedido(41)); assert.ok(inicial.ok);
    const r = coordenarTrabalho(b, { ...pedido(42, 'acordo'), atestacao: acordo(inicial.reserva, alteracao, autor) });
    assert.equal(r.ok ? '' : r.codigo, codigo);
  }
});

test('edição do corpo depois do hash é recusada', () => {
  const b = new Branch(), inicial = coordenarTrabalho(b, pedido(41)); assert.ok(inicial.ok);
  const a = acordo(inicial.reserva);
  const original = a.porta.ler(a.referencia, 1)!;
  const porta: PortaDeAtestacao = { ler: () => ({ ...original, body: original.body.replace('RM-089', 'RM-090') }) };
  const r = coordenarTrabalho(b, { ...pedido(42, 'acordo'), atestacao: { porta, referencia: a.referencia } });
  assert.equal(r.ok ? '' : r.codigo, 'rede-empresa.acordo-editado');
});
