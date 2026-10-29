/** RM-061 F3e: rotas restantes do CLI e suas bordas anteriores ao locale. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chaveDoLocale, cobreLocale, msg } from '../src/locale';

test('locale F3e rotas: chaveDoLocale cobre todas as rotas publicas restantes', () => {
  const rotas: Array<[string[], Record<string, unknown>, string]> = [
    [['doctor'], { modo: 'fast' }, 'doctor'],
    [['onboarding', 'sync'], {}, 'onboarding sync'],
    [['experiencia', 'uninstall'], {}, 'experiencia uninstall'],
    ...['audit', 'digest', 'migrar', 'ratificar', 'propor'].map((sub) => [['master', sub], {}, `master ${sub}`] as [string[], {}, string]),
    [['mcp', 'serve'], {}, 'mcp serve'],
    [['mcp', 'desconhecido'], {}, 'mcp ?'],
    [['brain'], {}, 'brain'],
    [['activation'], {}, 'activation'],
  ];
  for (const [argv, opcoes, chave] of rotas) {
    assert.equal(chaveDoLocale(argv, opcoes), chave, argv.join(' '));
    assert.equal(cobreLocale(argv, opcoes), true, argv.join(' '));
    assert.equal(cobreLocale(argv, { ...opcoes, json: true }), false, `${argv.join(' ')} --json`);
  }
});

test('locale F3e rotas: usos restantes saem em pt-BR e ingles', () => {
  const pt = msg('pt-BR'), en = msg('en');
  assert.deepEqual([
    pt.cli.masterDigestUso, pt.cli.activationUso, pt.onboarding.experienciaUninstallUso,
    pt.operacao.restante.mcp.uso, pt.cli.receiptVerifiersUso,
  ], [
    'uso: ork master digest <enviar|preview|responder>',
    'uso: ork activation plan|status|enable|disable',
    'uso: ork experiencia uninstall claude-code|codex [--dry-run] [--json]',
    pt.operacao.restante.mcp.uso,
    'uso: ork receipt-verifiers --json',
  ]);
  assert.match(en.cli.masterDigestUso, /^usage:/);
  assert.match(en.cli.activationUso, /^usage:/);
  assert.match(en.onboarding.experienciaUninstallUso, /^usage:/);
  assert.match(en.operacao.restante.mcp.uso, /^usage:/);
  assert.match(en.cli.receiptVerifiersUso, /^usage:/);
});

test('locale F3e rotas: onboarding sync localiza apenas a moldura humana', () => {
  const pt = msg('pt-BR').onboarding.syncResultado('files', 'orkmind.indisponivel', 2, 0, 0, 1);
  const en = msg('en').onboarding.syncResultado('files', 'orkmind.indisponivel', 2, 0, 0, 1);
  assert.equal(pt, 'files (orkmind.indisponivel): Entrevista preservada em arquivos; publicação semântica não concluída. Consulte ork memory status.');
  assert.equal(en, 'files (orkmind.indisponivel): Interview preserved in files; semantic publication did not finish. See ork memory status.');
});

test('locale F3e rotas: recusas de projeto anteriores ao comando têm snapshots pt-BR e en', () => {
  const pt = msg('pt-BR').projetos, en = msg('en').projetos;
  assert.deepEqual([pt.initNaoLeProjeto, pt.mcpNaoLeProjeto, pt.comandoNaoLeProjeto('doctor')], [
    'uso: ork init cria o projeto no diretório atual; entre nele e rode ork init, sem --projeto',
    'uso: o servidor MCP recebe a raiz por --project <raiz absoluta>, não por --projeto',
    'uso: ork doctor não lê projeto; tire --projeto',
  ]);
  assert.deepEqual([en.initNaoLeProjeto, en.mcpNaoLeProjeto, en.comandoNaoLeProjeto('doctor')], [
    'usage: ork init creates the project in the current directory; enter it and run ork init without --projeto',
    'usage: the MCP server receives its root through --project <absolute root>, not --projeto',
    'usage: ork doctor does not read a project; remove --projeto',
  ]);
});
