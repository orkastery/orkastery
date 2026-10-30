/** RM-061 F3e: snapshot agregado das rotas que faltavam na lista de locale. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { msg, type Locale } from '../src/locale';

const snapshot = (locale: Locale) => {
  const m = msg(locale);
  return {
    doctor: m.doctor.modoUso('classic|maestro|auto|fast'),
    onboardingSync: m.onboarding.syncResultado('files', 'orkmind.indisponivel', 2, 0, 0, 1),
    experienciaUninstall: m.onboarding.experienciaUninstallUso,
    masterAudit: m.cli.manifestoNaoEncontrado('orkastery.yaml', '/repo'),
    masterDigest: m.cli.masterDigestUso,
    masterMigrar: m.cli.manifestoNaoEncontrado('orkastery.yaml', '/repo'),
    masterRatificar: m.cli.masterRatificarUso,
    masterPropor: m.master.complementar.usoScore,
    mcpServe: m.operacao.restante.mcp.uso,
    mcpDesconhecido: m.operacao.restante.mcp.uso,
    brain: m.cli.manifestoNaoEncontrado('orkastery.yaml', '/repo'),
    activation: m.cli.activationUso,
    receiptVerifiers: m.cli.receiptVerifiersUso,
    projetoAlvo: m.projetos.comandoNaoLeProjeto('doctor'),
  };
};

test('locale F3e snapshot agregado pt-BR', () => {
  assert.deepEqual(snapshot('pt-BR'), {
    doctor: 'uso: ork doctor --modo classic|maestro|auto|fast',
    onboardingSync: 'files (orkmind.indisponivel): Entrevista preservada em arquivos; publicação semântica não concluída. Consulte ork memory status.',
    experienciaUninstall: 'uso: ork experiencia uninstall claude-code|codex [--dry-run] [--json]',
    masterAudit: 'manifesto orkastery.yaml nao encontrado a partir de /repo. Rode: ork init',
    masterDigest: 'uso: ork master digest <enviar|preview|responder>',
    masterMigrar: 'manifesto orkastery.yaml nao encontrado a partir de /repo. Rode: ork init',
    masterRatificar: 'resposta deve ser ratificar <thread> <assinatura> <classe>',
    masterPropor: 'uso: ork master <thread-id> --score 0-5 --justificativa "<texto>" --por <seu-nome>',
    mcpServe: msg('pt-BR').operacao.restante.mcp.uso,
    mcpDesconhecido: msg('pt-BR').operacao.restante.mcp.uso,
    brain: 'manifesto orkastery.yaml nao encontrado a partir de /repo. Rode: ork init',
    activation: 'uso: ork activation plan|status|enable|disable',
    receiptVerifiers: 'uso: ork receipt-verifiers --json',
    projetoAlvo: 'uso: ork doctor não lê projeto; tire --projeto',
  });
});

test('locale F3e snapshot agregado en', () => {
  assert.deepEqual(snapshot('en'), {
    doctor: 'usage: ork doctor --modo classic|maestro|auto|fast',
    onboardingSync: 'files (orkmind.indisponivel): Interview preserved in files; semantic publication did not finish. See ork memory status.',
    experienciaUninstall: 'usage: ork experiencia uninstall claude-code|codex [--dry-run] [--json]',
    masterAudit: '`orkastery.yaml` not found in /repo or any parent directory; run `ork init` first.',
    masterDigest: 'usage: ork master digest <enviar|preview|responder>',
    masterMigrar: '`orkastery.yaml` not found in /repo or any parent directory; run `ork init` first.',
    masterRatificar: 'the response must be ratificar <thread> <signature> <class>',
    masterPropor: 'usage: ork master <thread-id> --score 0-5 --justificativa "<text>" --por <your-name>',
    mcpServe: msg('en').operacao.restante.mcp.uso,
    mcpDesconhecido: msg('en').operacao.restante.mcp.uso,
    brain: '`orkastery.yaml` not found in /repo or any parent directory; run `ork init` first.',
    activation: 'usage: ork activation plan|status|enable|disable',
    receiptVerifiers: 'usage: ork receipt-verifiers --json',
    projetoAlvo: 'usage: ork doctor does not read a project; remove --projeto',
  });
});

