import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { atualizarAgentsMd, FIM_AGENTS_ORK, INICIO_AGENTS_ORK } from '../src/agents-md';

test('AGENTS.md preserva texto humano e atualiza somente um bloco gerenciado', () => {
  const p = projetoTemporario('agents-md');
  try {
    const file = path.join(p.dir, 'AGENTS.md');
    fs.writeFileSync(file, '# Regras humanas\n\nNunca apagar.\n');
    const primeira = atualizarAgentsMd(p.dir, p.carregado.manifesto);
    assert.equal(primeira.estado, 'atualizado');
    const texto = fs.readFileSync(file, 'utf8');
    assert.ok(texto.startsWith('# Regras humanas\n\nNunca apagar.\n'));
    assert.equal(texto.split(INICIO_AGENTS_ORK).length - 1, 1);
    assert.equal(texto.split(FIM_AGENTS_ORK).length - 1, 1);
    assert.match(texto, /GOAL → PLAN → GO → CHECK → SHIP → MASTER/);
    assert.equal(atualizarAgentsMd(p.dir, p.carregado.manifesto).estado, 'inalterado');
  } finally { p.limpar(); }
});

test('AGENTS.md ambiguo e recusado sem alterar bytes', () => {
  const p = projetoTemporario('agents-md-ambiguo');
  try {
    const file = path.join(p.dir, 'AGENTS.md');
    const original = `humano\n${INICIO_AGENTS_ORK}\nsem fim\n`;
    fs.writeFileSync(file, original);
    assert.throws(() => atualizarAgentsMd(p.dir, p.carregado.manifesto), /marcadores.*ambiguos/);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  } finally { p.limpar(); }
});
