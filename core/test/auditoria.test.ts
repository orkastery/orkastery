/**
 * Testes do bloco B5: os 7 packs, o hardening por estagio, a governanca de custo, o board
 * de divida e o auditor sujeito a claims.
 *
 * Nada aqui despacha sessao de verdade: o que precisa ser provado e o que o `ork` DECIDE
 * antes e depois do despacho (gate de estagio, gate de custo, montagem do prompt, recusa de
 * achado sem proposta, reexecucao das claims do auditor). O despacho em si e o mesmo do
 * `ork phase run`, ja coberto desde o B0.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DESCRICAO_DO_MOTIVO_DE_AUDITORIA,
  ORDEM_DOS_PACKS,
  PACKS,
  POSTURA_DO_ESTAGIO,
  REGRA_CENTRAL_DA_AUDITORIA,
  carregarTemplatesDeAuditoria,
  escopoDaRodada,
  filtrarPelaFonte,
  janelaDeCusto,
  lintTemplateDeAuditoria,
  minutosDoHorario,
  montarPromptDeAuditoria,
  packAtivo,
  packsAtivos,
  parseEstagio,
  parsePack,
  sinceParaGit,
  templateDoPack,
} from '../src/auditoria';
import {
  abrirThreadDoAchado,
  entradaDoBruto,
  ingerirAchados,
  lerRodada,
  registrarAchadoDaRodada,
  relatorioDaRodada,
  rodarAuditoria,
  verificarRodada,
} from '../src/auditrun';
import {
  CAMPOS_DA_PROPOSTA,
  carimbarAchado,
  faltasDaProposta,
  lerBoard,
  parseEstadoDeAchado,
  recorrencias,
  separarArquivoELinha,
} from '../src/divida';
import { lerLedger } from '../src/ledger';
import { lerClaims } from '../src/claims';
import { exigirManifesto } from '../src/manifest';
import { dirThread, lerThread } from '../src/thread';
import { Estagio } from '../src/types';
import { extrairSessionId } from '../src/adapters/claude-bg';
import { commitar, projetoTemporario, ProjetoDeTeste } from './apoio';

/** Meia-noite e meio-dia de um dia fixo, para a janela ociosa ser testavel sem esperar. */
const MADRUGADA = new Date(2026, 8, 3, 2, 30);
const MEIO_DIA = new Date(2026, 8, 3, 12, 0);

/** Projeto de teste com o estagio pedido e a janela ociosa declarada. */
function projetoNoEstagio(nome: string, estagio: Estagio, janela = '22:00-06:00'): ProjetoDeTeste {
  const p = projetoTemporario(nome);
  const yaml = fs
    .readFileSync(p.carregado.caminho, 'utf8')
    .replace('stage: nascente', `stage: ${estagio}`)
    .replace('janela_ociosa: "22:00-06:00"', `janela_ociosa: "${janela}"`);
  fs.writeFileSync(p.carregado.caminho, yaml, 'utf8');
  return { ...p, carregado: exigirManifesto(p.dir) };
}

test('os 7 packs existem, com regras e evidencia declaradas por regra', () => {
  assert.equal(ORDEM_DOS_PACKS.length, 7);
  assert.deepEqual([...ORDEM_DOS_PACKS], [
    'clean-code',
    'reuse',
    'architecture',
    'data-model',
    'ux',
    'security-privacy',
    'process',
  ]);
  for (const id of ORDEM_DOS_PACKS) {
    const p = PACKS[id];
    assert.equal(p.id, id, `o pack ${id} tem id coerente`);
    assert.ok(p.regras.length >= 4, `o pack ${id} declara ao menos 4 regras`);
    assert.ok(p.referencias.length >= 1, `o pack ${id} cita checklist normativa`);
    const ids = p.regras.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, `ids de regra unicos em ${id}`);
    for (const r of p.regras) {
      assert.notEqual(r.regra.trim(), '', `${id}/${r.id} descreve o que audita`);
      assert.notEqual(r.evidencia.trim(), '', `${id}/${r.id} declara a evidencia que precisa`);
    }
  }
  // LGPD e o motivo de o pack security-privacy so entrar no estagio maduro.
  const lgpd = PACKS['security-privacy'].regras.filter((r) => r.regra.startsWith('LGPD:'));
  assert.ok(lgpd.length >= 4, 'o pack security-privacy cobre PII em log, retencao, consentimento e exclusao');
  // O `process` e o unico meta-auditor: ele le o ledger, nao a arvore de codigo.
  assert.equal(PACKS.process.fonte, 'ledger');
  assert.equal(ORDEM_DOS_PACKS.filter((p) => PACKS[p].fonte === 'ledger').length, 1);
});

test('hardening por estagio segue a tabela da visao (secao 5.2)', () => {
  assert.deepEqual(packsAtivos('nascente'), ['clean-code', 'reuse', 'process']);
  assert.deepEqual(packsAtivos('crescendo'), ['clean-code', 'reuse', 'architecture', 'data-model', 'ux', 'process']);
  assert.deepEqual(packsAtivos('maduro'), [...ORDEM_DOS_PACKS]);

  assert.equal(POSTURA_DO_ESTAGIO.nascente, 'warn');
  assert.equal(POSTURA_DO_ESTAGIO.crescendo, 'proposta-prioritaria');
  assert.equal(POSTURA_DO_ESTAGIO.maduro, 'promove-policy');

  assert.equal(packAtivo('security-privacy', 'crescendo'), false);
  assert.equal(packAtivo('security-privacy', 'maduro'), true);
  assert.equal(parsePack('CLEAN-CODE'), 'clean-code');
  assert.equal(parsePack('inexistente'), null);
  assert.equal(parseEstagio('maduro'), 'maduro');
  assert.equal(parseEstagio('adulto'), null);
});

test('governanca de custo: janela ociosa, --since traduzido para o git e Graphify honesto', (t) => {
  const p = projetoNoEstagio('b5-custo', 'nascente');
  t.after(p.limpar);

  const dentro = janelaDeCusto(p.carregado.manifesto, MADRUGADA);
  assert.equal(dentro.declarada, true);
  assert.equal(dentro.dentro, true, '02:30 esta dentro de 22:00-06:00 (janela que cruza a meia-noite)');
  const fora = janelaDeCusto(p.carregado.manifesto, MEIO_DIA);
  assert.equal(fora.dentro, false, '12:00 esta fora de 22:00-06:00');

  // Janela nao declarada nao vira "sempre pode": vira declarada:false, dito em voz alta.
  const semJanela = janelaDeCusto(
    { ...p.carregado.manifesto, audit: { ...p.carregado.manifesto.audit, janela_ociosa: '' } },
    MEIO_DIA
  );
  assert.equal(semJanela.declarada, false);
  assert.ok(semJanela.detalhe.includes('nao declarada'));

  assert.equal(minutosDoHorario('22:00'), 1320);
  assert.equal(minutosDoHorario('24:00'), null);
  assert.equal(minutosDoHorario('nao e horario'), null);

  // MEDIDO: `git log --since=7d` devolve vazio; a traducao evita escopo vazio silencioso.
  assert.equal(sinceParaGit('7d'), '7 days ago');
  assert.equal(sinceParaGit('24h'), '24 hours ago');
  assert.equal(sinceParaGit('2w'), '2 weeks ago');
  assert.equal(sinceParaGit('2026-01-01'), '2026-01-01');

  commitar(p.dir, 'src/app.ts', 'export const x = 1;\n', 'codigo do produto');
  const escopo = escopoDaRodada(p.dir, p.carregado.manifesto, { since: '7d', pack: 'clean-code' });
  assert.equal(escopo.incremental, true);
  assert.ok(escopo.arquivos.includes('src/app.ts'), 'o arquivo tocado entra no escopo incremental');
  assert.ok(['disponivel', 'ausente', 'desligado'].includes(escopo.graphify));

  const total = escopoDaRodada(p.dir, p.carregado.manifesto, { tudo: true, pack: 'clean-code' });
  assert.equal(total.incremental, false);
  assert.ok(total.detalhe.includes('--tudo'));

  // Cada pack le a sua fonte: codigo nao le o estado do motor, e o `process` so le ele.
  const lista = ['src/app.ts', '.orkastery/threads/t/ledger.jsonl', 'docs/audit/x.md'];
  assert.deepEqual(filtrarPelaFonte(lista, 'clean-code'), ['src/app.ts']);
  assert.deepEqual(filtrarPelaFonte(lista, 'process'), [
    '.orkastery/threads/t/ledger.jsonl',
    'docs/audit/x.md',
  ]);
});

test('ork audit run reprova pack inativo no estagio, com motivo tipado e correcao', (t) => {
  const p = projetoNoEstagio('b5-estagio', 'nascente');
  t.after(p.limpar);

  const r = rodarAuditoria(p.carregado, 'security-privacy', { quando: MADRUGADA });
  assert.equal(r.status, 'bloqueada');
  assert.equal(r.motivo, 'pack.inativo-no-estagio');
  assert.ok(r.detalhe.includes('maduro'));
  assert.equal(r.sessionId, null, 'pack inativo nem chega a despachar');
  assert.equal(r.promptSha256, '', 'pack inativo nem chega a montar prompt');

  const eventos = lerLedger(path.join(p.dir, '.orkastery', 'audits', r.id));
  const bloqueio = eventos.find((e) => e.tipo === 'audit_blocked');
  assert.ok(bloqueio, 'a reprovacao fica no ledger da rodada');
  assert.equal(bloqueio?.motivo, 'pack.inativo-no-estagio');
  assert.ok(String(bloqueio?.correcao).includes('project.stage'));

  // O mesmo pack passa no estagio maduro (o roadmap promove, o pack acompanha).
  const maduro = projetoNoEstagio('b5-maduro', 'maduro');
  t.after(maduro.limpar);
  const promovido = rodarAuditoria(maduro.carregado, 'security-privacy', {
    quando: MADRUGADA,
    dryRun: true,
  });
  assert.equal(promovido.status, 'ensaio');
  assert.equal(promovido.postura, 'promove-policy');
});

test('ork audit run reprova fora da janela ociosa e anda com autorizacao nomeada', (t) => {
  const p = projetoNoEstagio('b5-janela', 'nascente');
  t.after(p.limpar);

  const fora = rodarAuditoria(p.carregado, 'clean-code', { quando: MEIO_DIA, dryRun: true });
  assert.equal(fora.status, 'bloqueada');
  assert.equal(fora.motivo, 'custo.fora-da-janela');
  assert.ok(fora.detalhe.includes('FORA da janela'));

  const autorizada = rodarAuditoria(p.carregado, 'clean-code', {
    quando: MEIO_DIA,
    dryRun: true,
    agora: 'Julio',
  });
  assert.equal(autorizada.status, 'ensaio');
  assert.equal(autorizada.custo.autorizadaPor, 'Julio');

  const naJanela = rodarAuditoria(p.carregado, 'clean-code', { quando: MADRUGADA, dryRun: true });
  assert.equal(naJanela.status, 'ensaio');
  assert.equal(naJanela.custo.effort, 'eco', 'o esforco padrao da auditoria e eco');
  assert.equal(naJanela.custo.autorizadaPor, null);
});

test('o prompt do pack carrega regras, escopo, custo e o bloco obrigatorio de propostas', (t) => {
  const p = projetoNoEstagio('b5-prompt', 'crescendo');
  t.after(p.limpar);

  const prompt = montarPromptDeAuditoria(
    {
      pack: 'data-model',
      produto: 'orkastery',
      perfil: 'default',
      estagio: 'crescendo',
      postura: 'proposta-prioritaria',
      rodada: 'ork-data-model-20260903-1',
      dirDaRodada: '.orkastery/audits/ork-data-model-20260903-1',
      escopo: escopoDaRodada(p.dir, p.carregado.manifesto, { since: '7d', pack: 'data-model' }),
      janela: janelaDeCusto(p.carregado.manifesto, MADRUGADA),
      effort: 'eco',
    },
    p.dir
  );
  for (const r of PACKS['data-model'].regras) {
    assert.ok(prompt.includes(r.id), `o prompt cita a regra ${r.id}`);
    assert.ok(prompt.includes(r.evidencia), `o prompt cita a evidencia de ${r.id}`);
  }
  assert.ok(prompt.includes(REGRA_CENTRAL_DA_AUDITORIA), 'a regra central da auditoria esta no prompt');
  assert.ok(prompt.includes('## Bloco OBRIGATORIO de propostas'));
  assert.ok(prompt.includes('ork audit ingest ork-data-model-20260903-1'));
  assert.ok(prompt.includes('esforco desta rodada: eco'));
  assert.ok(prompt.includes('NAO tem direito a self-report'));

  // O lint reprova template de auditoria quebrado ANTES de ele virar despacho.
  const templates = carregarTemplatesDeAuditoria(p.dir);
  assert.deepEqual(templates.flatMap((x) => lintTemplateDeAuditoria(x)), []);
  const quebrado = { ...templateDoPack('ux', p.dir) };
  quebrado.corpo = quebrado.corpo.replace('## Bloco OBRIGATORIO de propostas', '## Achados');
  const problemas = lintTemplateDeAuditoria(quebrado);
  assert.ok(
    problemas.some((x) => x.detalhe.includes('## Bloco OBRIGATORIO de propostas')),
    'template sem o bloco de propostas e reprovado'
  );
});

test('achado sem proposta completa nao entra no board (achado.sem-proposta)', (t) => {
  const p = projetoNoEstagio('b5-proposta', 'nascente');
  t.after(p.limpar);
  const rodada = rodarAuditoria(p.carregado, 'clean-code', { quando: MADRUGADA, dryRun: true });

  const completo = {
    regra: 'CC1',
    severidade: 'maior',
    titulo: 'arquivo grande demais',
    arquivo: 'src/app.ts:1',
    impacto: 'a leitura do arquivo custa caro em toda revisao',
    fix: 'extrair o roteamento para um modulo proprio',
    irreversivel: 'nenhum',
    estimativa: '4h',
    verificar: ['true'],
  };
  assert.deepEqual(faltasDaProposta(entradaDoBruto(rodada, completo)), []);

  for (const campo of ['impacto', 'fix', 'estimativa', 'irreversivel', 'titulo'] as const) {
    const faltando = { ...completo, [campo]: '' };
    assert.throws(
      () => registrarAchadoDaRodada(p.carregado, rodada.id, faltando),
      /achado\.sem-proposta/,
      `achado sem ${campo} e recusado`
    );
  }
  // Regra fora do pack tambem e recusada: achado nao inventa regra.
  assert.throws(
    () => registrarAchadoDaRodada(p.carregado, rodada.id, { ...completo, regra: 'SP1' }),
    /fora do pack clean-code/
  );
  assert.equal(lerBoard(p.dir).length, 0, 'nenhum achado incompleto vazou para o board');

  const achado = registrarAchadoDaRodada(p.carregado, rodada.id, completo);
  assert.equal(achado.id, 'F1');
  assert.equal(achado.proposta.destino, 'roadmap do produto orkastery');
  assert.equal(achado.proposta.regime, 'files', 'o regime declarado e files enquanto nao ha OrkMind');
  assert.equal(achado.estado, 'aberto');
  assert.deepEqual(separarArquivoELinha('src/app.ts:1'), { arquivo: 'src/app.ts', linha: 1 });

  // Rodada bloqueada no gate nao aceita achado pela porta dos fundos.
  const bloqueada = rodarAuditoria(p.carregado, 'security-privacy', { quando: MADRUGADA });
  assert.throws(() => registrarAchadoDaRodada(p.carregado, bloqueada.id, completo), /BLOQUEADA/);
});

test('o auditor esta sujeito a claims: ork audit verify reexecuta no HEAD real', (t) => {
  const p = projetoNoEstagio('b5-claims', 'nascente');
  t.after(p.limpar);
  commitar(
    p.dir,
    'src/grande.ts',
    Array.from({ length: 40 }, (_, i) => `// linha ${i}`).join('\n'),
    'arquivo grande'
  );
  const rodada = rodarAuditoria(p.carregado, 'clean-code', { quando: MADRUGADA, dryRun: true });

  const sustentado = registrarAchadoDaRodada(p.carregado, rodada.id, {
    regra: 'CC1',
    severidade: 'maior',
    titulo: 'src/grande.ts passa de 30 linhas',
    arquivo: 'src/grande.ts:1',
    alegacao: 'src/grande.ts tem mais de 30 linhas',
    verificar: ['test "$(wc -l < src/grande.ts)" -gt 30'],
    impacto: 'arquivo cresce sem dono',
    fix: 'quebrar em dois modulos',
    irreversivel: 'nenhum',
    estimativa: '2h',
  });
  const falso = registrarAchadoDaRodada(p.carregado, rodada.id, {
    regra: 'CC2',
    severidade: 'menor',
    titulo: 'duplicacao que nao existe',
    arquivo: 'src/grande.ts:2',
    alegacao: 'o bloco aparece em src/inexistente.ts',
    verificar: ['test -f src/inexistente.ts'],
    impacto: 'manutencao dobrada',
    fix: 'extrair o bloco',
    irreversivel: 'nenhum',
    estimativa: '1h',
  });
  // Alegacao NEGATIVA sem comando: o caso EvoJ6, agora vindo do proprio auditor.
  const semComando = registrarAchadoDaRodada(p.carregado, rodada.id, {
    regra: 'CC5',
    severidade: 'menor',
    titulo: 'nenhum comentario explica o porque',
    arquivo: 'src/grande.ts:3',
    alegacao: 'nenhum comentario do arquivo explica o porque',
    impacto: 'contexto perdido',
    fix: 'trocar os comentarios de "o que" por "por que"',
    irreversivel: 'nenhum',
    estimativa: '30min',
  });
  assert.equal(semComando.claim.negativa, true);
  assert.equal(semComando.claim.estado, 'nao-verificavel');

  const v = verificarRodada(p.carregado, rodada.id);
  assert.equal(v.ok, false, 'a rodada reprova porque um achado do auditor nao se sustenta');
  assert.ok(v.motivos.includes('claims.failed'));

  const porId = new Map(lerBoard(p.dir).map((a) => [a.id, a]));
  assert.equal(porId.get(sustentado.id)?.claim.estado, 'verificado');
  assert.equal(porId.get(falso.id)?.claim.estado, 'reprovado');
  // Alegacao negativa sem comando REPROVA, igual a de qualquer fase.
  assert.equal(porId.get(semComando.id)?.claim.estado, 'reprovado');

  const eventos = lerLedger(path.join(p.dir, '.orkastery', 'audits', rodada.id));
  assert.ok(eventos.some((e) => e.tipo === 'audit_verified' && e.veredito === 'reprovado'));
  assert.equal(lerRodada(p.dir, rodada.id).veredito?.ok, false);
});

test('o relatorio sempre traz o bloco obrigatorio de propostas, com achado ou sem', (t) => {
  const p = projetoNoEstagio('b5-relatorio', 'crescendo');
  t.after(p.limpar);
  commitar(p.dir, 'db/0001.sql', 'CREATE UNIQUE INDEX i ON t (email);\n', 'migracao');
  const rodada = rodarAuditoria(p.carregado, 'data-model', { quando: MADRUGADA, dryRun: true });

  const vazio = relatorioDaRodada(p.carregado, rodada.id);
  assert.ok(vazio.texto.includes('## PROPOSTAS DE AJUSTE PARA O ROADMAP DE ORKASTERY'));
  assert.ok(vazio.texto.includes('**Nenhuma proposta nesta rodada.**'), 'lacuna publicada como lacuna');
  assert.equal(vazio.propostas, 0);

  registrarAchadoDaRodada(p.carregado, rodada.id, {
    regra: 'DM1',
    severidade: 'critico',
    titulo: 'indice unico ignora soft-delete',
    arquivo: 'db/0001.sql:1',
    descricao: 'a linha apagada continua bloqueando o novo cadastro do mesmo email',
    alegacao: 'db/0001.sql cria indice unico sem considerar soft-delete',
    verificar: ['grep -q "CREATE UNIQUE INDEX" db/0001.sql'],
    impacto: 'usuario que apagou a conta nao consegue se cadastrar de novo',
    fix: 'indice unico parcial com WHERE deleted_at IS NULL',
    irreversivel: 'recriar o indice em producao exige janela de manutencao',
    estimativa: '4h',
  });
  verificarRodada(p.carregado, rodada.id);
  const r = relatorioDaRodada(p.carregado, rodada.id, { publicar: true });

  assert.equal(r.propostas, 1);
  const bloco = r.texto.split('## PROPOSTAS DE AJUSTE PARA O ROADMAP DE ORKASTERY')[1];
  // Os cinco campos obrigatorios da proposta, na propria linha da tabela.
  assert.ok(bloco.includes('db/0001.sql:1'), 'evidencia arquivo:linha');
  assert.ok(bloco.includes('usuario que apagou a conta'), 'impacto');
  assert.ok(bloco.includes('indice unico parcial'), 'fix sugerido');
  assert.ok(bloco.includes('janela de manutencao'), 'passo irreversivel');
  assert.ok(bloco.includes('4h'), 'estimativa');
  assert.ok(bloco.includes('--from-finding F1'), 'o relatorio ja entrega o comando que abre a thread');

  // Achado resolvido sai do bloco de propostas (a fila do roadmap) e fica so nos achados.
  carimbarAchado(p.dir, lerBoard(p.dir)[0], { estado: 'resolvido' });
  const depois = relatorioDaRodada(p.carregado, rodada.id);
  assert.equal(depois.propostas, 0);
  assert.ok(depois.texto.includes('**Nenhuma proposta em aberto.**'));
  assert.ok(depois.texto.includes('F1 (resolvido)'));
  assert.ok(r.texto.includes('regime de memoria declarado: `files`'));
  assert.ok(
    r.texto.includes('colecao `roadmap` do OrkMind: NAO gravada'),
    'degradacao honesta enquanto o B6 nao existe'
  );
  assert.ok(r.texto.includes('ACHADOS SUSTENTADOS'));
  assert.ok(r.publicado && fs.existsSync(r.publicado), 'o --publicar promove o relatorio para docs/audit/');
  assert.ok(fs.existsSync(r.caminho));
});

test('ork thread new --from-finding abre a thread com evidencia, claim e proposta', (t) => {
  const p = projetoNoEstagio('b5-fromfinding', 'nascente');
  t.after(p.limpar);
  commitar(p.dir, 'src/dupe.ts', 'export const a = 1;\nexport const a2 = 1;\n', 'duplicacao');
  const rodada = rodarAuditoria(p.carregado, 'reuse', { quando: MADRUGADA, dryRun: true });

  const achado = registrarAchadoDaRodada(p.carregado, rodada.id, {
    regra: 'RU1',
    severidade: 'maior',
    titulo: 'utilitario duplicado em src/dupe.ts',
    arquivo: 'src/dupe.ts:2',
    alegacao: 'src/dupe.ts declara o mesmo valor duas vezes',
    verificar: ['grep -q "export const a2" src/dupe.ts'],
    impacto: 'duas fontes de verdade para o mesmo valor',
    fix: 'manter uma constante so',
    irreversivel: 'nenhum',
    estimativa: '1h',
  });

  // Antes do verify, o achado NAO vira thread: o auditor nao tem self-report.
  const cedo = abrirThreadDoAchado(p.carregado, achado.id);
  assert.equal(cedo.ok, false);
  assert.equal(cedo.motivo, 'claims.failed');
  assert.ok(cedo.correcao.includes('ork audit verify'));

  assert.equal(verificarRodada(p.carregado, rodada.id).ok, true);

  const r = abrirThreadDoAchado(p.carregado, achado.id, { modo: 'classic' });
  assert.equal(r.ok, true);
  assert.ok(r.thread);
  const thread = lerThread(p.dir, (r.thread as { id: string }).id);
  assert.equal(thread.faseAtual, 'GOAL');

  // A evidencia viaja junto e continua sob verificacao na thread.
  const claims = lerClaims(p.dir, thread.id);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].alegacao, 'src/dupe.ts declara o mesmo valor duas vezes');
  assert.deepEqual(claims[0].verificar, ['grep -q "export const a2" src/dupe.ts']);

  const origem = JSON.parse(
    fs.readFileSync(path.join(dirThread(p.dir, thread.id), 'achado.json'), 'utf8')
  ) as { origem: { achado: string; pack: string }; proposta: { fix: string } };
  assert.equal(origem.origem.achado, achado.id);
  assert.equal(origem.origem.pack, 'reuse');
  assert.equal(origem.proposta.fix, 'manter uma constante so');

  assert.ok(r.pedido.includes('src/dupe.ts:2'), 'o pedido de GOAL ja nasce com a evidencia');
  assert.ok(r.pedido.includes('manter uma constante so'), 'e com o fix proposto');
  assert.ok(r.pedido.includes('proposta do auditor, nao decisao'));
  // O pedido pronto tambem vai para arquivo, para o proximo comando ser um `cat`.
  const pedidoEmDisco = fs.readFileSync(
    path.join(dirThread(p.dir, thread.id), 'pedido-goal.md'),
    'utf8'
  );
  assert.equal(pedidoEmDisco.trim(), r.pedido.trim());

  const eventos = lerLedger(dirThread(p.dir, thread.id));
  assert.ok(eventos.some((e) => e.tipo === 'finding_to_thread' && e.achado === achado.id));

  // Um achado nao abre duas threads.
  const denovo = abrirThreadDoAchado(p.carregado, achado.id);
  assert.equal(denovo.ok, false);
  assert.equal(denovo.motivo, 'achado.ja-virou-thread');
  assert.equal(lerBoard(p.dir)[0].estado, 'virou-thread');
  assert.equal(lerBoard(p.dir)[0].thread, thread.id);
});

test('board de divida: ingestao em lote e a regra mecanica de recorrencia', (t) => {
  const p = projetoNoEstagio('b5-divida', 'maduro');
  t.after(p.limpar);
  const rodada = rodarAuditoria(p.carregado, 'clean-code', { quando: MADRUGADA, dryRun: true });

  const modelo = (n: number, regra: string) => ({
    regra,
    severidade: 'menor',
    titulo: `achado ${n}`,
    arquivo: `src/a${n}.ts:${n}`,
    alegacao: `alegacao ${n}`,
    verificar: ['true'],
    impacto: `impacto ${n}`,
    fix: `fix ${n}`,
    irreversivel: 'nenhum',
    estimativa: '1h',
  });
  const arquivo = path.join(p.dir, 'achados.json');
  fs.writeFileSync(
    arquivo,
    JSON.stringify({
      achados: [modelo(1, 'CC2'), modelo(2, 'CC2'), modelo(3, 'CC1'), { ...modelo(4, 'CC1'), fix: '' }],
    }),
    'utf8'
  );

  const r = ingerirAchados(p.carregado, rodada.id, arquivo);
  assert.equal(r.registrados.length, 3, 'os 3 achados completos entram');
  assert.equal(r.recusados.length, 1, 'o achado sem fix e recusado, com o indice dito');
  assert.ok(r.recusados[0].erro.includes('achado.sem-proposta'));

  // Idempotencia: o proprio prompt manda o auditor rodar `ork audit ingest`, entao a
  // segunda passada sobre o mesmo arquivo nao pode duplicar achado (nem inflar recorrencia).
  const denovo = ingerirAchados(p.carregado, rodada.id, arquivo);
  assert.equal(denovo.registrados.length, 0, 'a segunda ingestao nao registra nada');
  assert.equal(denovo.duplicados.length, 3, 'e diz quais achados ja existiam');
  assert.equal(lerBoard(p.dir).length, 3, 'o board continua com 3 achados');
  assert.throws(
    () => registrarAchadoDaRodada(p.carregado, rodada.id, modelo(1, 'CC2')),
    /achado\.duplicado-na-rodada/
  );

  const board = lerBoard(p.dir);
  assert.equal(board.length, 3);
  const rec = recorrencias(board);
  const cc2 = rec.find((x) => x.regra === 'CC2');
  const cc1 = rec.find((x) => x.regra === 'CC1');
  assert.equal(cc2?.ocorrencias, 2);
  assert.equal(cc2?.promocaoProposta, 'controle', '2 recorrencias PROPOEM controle');
  assert.equal(cc1?.ocorrencias, 1);
  assert.equal(cc1?.promocaoProposta, 'nenhuma');

  // A terceira recorrencia PROPOE bloqueante. Propoe: o `ork` nunca promove policy sozinho.
  registrarAchadoDaRodada(p.carregado, rodada.id, modelo(5, 'CC2'));
  const depois = recorrencias(lerBoard(p.dir)).find((x) => x.regra === 'CC2');
  assert.equal(depois?.ocorrencias, 3);
  assert.equal(depois?.promocaoProposta, 'bloqueante');
  assert.equal(
    p.carregado.manifesto.policies?.provider,
    'block',
    'as policies do manifesto seguem intactas: a promocao e proposta, nao aplicada'
  );
});

test('o id da rodada nao carrega token que o adapter confunda com id de sessao', (t) => {
  const p = projetoNoEstagio('b5-idrodada', 'nascente');
  t.after(p.limpar);
  const r = rodarAuditoria(p.carregado, 'clean-code', { quando: MADRUGADA, dryRun: true });

  assert.match(r.id, /^ork-clean-code-\d{4}-\d{2}-\d{2}-\d+$/);
  // MEDIDO: com `AAAAMMDD` colado, `extrairSessionId` casava a data como id curto de sessao
  // (8 hexadecimais) e a rodada gravava um sessionId inexistente.
  assert.equal(
    extrairSessionId(`Rodada ${r.id} despachada.`),
    null,
    'o nome da rodada nao pode parecer um id de sessao para o adapter'
  );
  assert.equal(r.slug, r.id, 'o id da rodada e o --name que vai ao runtime');
});

test('achado resolvido sai da reexecucao e da conta de recorrencia', (t) => {
  const p = projetoNoEstagio('b5-resolvido', 'nascente');
  t.after(p.limpar);
  commitar(p.dir, 'src/velho.ts', 'export const velho = 1;\n', 'divida');
  const rodada = rodarAuditoria(p.carregado, 'clean-code', { quando: MADRUGADA, dryRun: true });

  registrarAchadoDaRodada(p.carregado, rodada.id, {
    regra: 'CC1',
    severidade: 'menor',
    titulo: 'src/velho.ts existe',
    arquivo: 'src/velho.ts:1',
    alegacao: 'src/velho.ts existe na arvore',
    verificar: ['test -f src/velho.ts'],
    impacto: 'divida',
    fix: 'apagar o arquivo',
    irreversivel: 'nenhum',
    estimativa: '5min',
  });
  assert.equal(verificarRodada(p.carregado, rodada.id).ok, true);

  // A divida e paga: a claim do achado passa a NAO se sustentar, e isso e o certo.
  fs.rmSync(path.join(p.dir, 'src', 'velho.ts'));
  assert.equal(verificarRodada(p.carregado, rodada.id).ok, false, 'sem carimbo, o achado reprova');

  carimbarAchado(p.dir, lerBoard(p.dir)[0], { estado: 'resolvido' });
  const depois = verificarRodada(p.carregado, rodada.id);
  assert.equal(depois.ok, true, 'achado resolvido sai da reexecucao');
  assert.equal(depois.resultados.length, 0);
  assert.deepEqual(recorrencias(lerBoard(p.dir)), [], 'divida paga nao conta como recorrencia');
  assert.equal(parseEstadoDeAchado('resolvido'), 'resolvido');
});

test('o FORMATO.md da rodada e a validacao saem da MESMA lista de campos', (t) => {
  const p = projetoNoEstagio('b5-formato', 'nascente');
  t.after(p.limpar);
  const rodada = rodarAuditoria(p.carregado, 'clean-code', { quando: MADRUGADA, dryRun: true });
  const formato = fs.readFileSync(
    path.join(p.dir, '.orkastery', 'audits', rodada.id, 'FORMATO.md'),
    'utf8'
  );
  // O documento que o auditor le nao pode prometer um formato diferente do que o `ork` aceita.
  for (const c of CAMPOS_DA_PROPOSTA) {
    assert.ok(formato.includes(`\`${c.campo}\``), `o FORMATO.md nao cita o campo ${c.campo}`);
    assert.ok(formato.includes(c.descricao), `o FORMATO.md nao explica o campo ${c.campo}`);
  }
  for (const r of PACKS['clean-code'].regras) {
    assert.ok(formato.includes(r.id), `o FORMATO.md nao lista a regra ${r.id} do pack`);
  }
  assert.ok(formato.includes('nao tem self-report'));
  assert.ok(formato.includes('idempotente'));
  // E as faltas reportadas usam os rotulos da mesma lista.
  const vazio = entradaDoBruto(rodada, {});
  assert.deepEqual(
    faltasDaProposta(vazio).filter((f) => !f.startsWith('regra ')),
    CAMPOS_DA_PROPOSTA.map((c) => c.rotulo)
  );
});

test('os motivos tipados da auditoria herdam o catalogo do gate do B1', () => {
  // O auditor nao tem catalogo proprio de reprovacao: ele herda o do B1 e acrescenta os
  // motivos que so existem em regime de auditoria periodica.
  for (const herdado of ['claims.failed', 'claims.unverifiable', 'policy.violation', 'runtime.unavailable'] as const) {
    assert.ok(DESCRICAO_DO_MOTIVO_DE_AUDITORIA[herdado], `o motivo ${herdado} continua descrito na auditoria`);
  }
  for (const novo of [
    'custo.fora-da-janela',
    'pack.inativo-no-estagio',
    'achado.sem-proposta',
    'achado.ja-virou-thread',
  ] as const) {
    assert.ok(DESCRICAO_DO_MOTIVO_DE_AUDITORIA[novo]);
  }
});
