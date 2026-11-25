import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { rodarAuditoria, verificarRodada } from '../src/auditrun';
import { AUDIT_EN, AUDIT_PT_BR } from '../src/locale-audit';
import { projetoTemporario } from './apoio';

test('auditoria sem claim executada termina sem veredito e não aprova', () => {
  const p = projetoTemporario('audit-sem-claims');
  try {
    const rodada = rodarAuditoria(p.carregado, 'clean-code', {
      quando: new Date(2026, 8, 3, 2, 30), dryRun: true,
    });
    const veredito = verificarRodada(p.carregado, rodada.id);
    assert.equal(veredito.resultados.length, 0);
    assert.equal(veredito.ok, false);
    assert.deepEqual(veredito.motivos, ['verify.sem-veredito']);
  } finally { p.limpar(); }
});

test('mensagem pareada e fixture pública não anunciam sustentação sem evidência', () => {
  assert.match(AUDIT_PT_BR.cli.verifyVazio, /nenhuma evidência foi executada/);
  assert.match(AUDIT_EN.cli.verifyVazio, /no evidence was executed/);
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/locale-f3d-pt-BR.json'), 'utf8')) as { audit: Record<string, string> };
  const saida = fixture.audit['cli audit: verify sem achado aberto'];
  assert.match(saida, /^\[saida 1\]/);
  assert.match(saida, /verify\.sem-veredito/);
  assert.doesNotMatch(saida, /ACHADOS SUSTENTADOS/);
});
