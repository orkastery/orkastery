/** The `security scan` check of `ork doctor`: Docker or native binaries, never `fail`. */

import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { checarSecurityScan } from '../src/doctor';
import { comLocale } from '../src/locale';
import type { ManifestoCarregado } from '../src/manifest';
import { loadTools } from '../src/security-scan/tools';
import type { Probe } from '../src/security-scan/executor';
import { projetoTemporario, ProjetoDeTeste } from './apoio';

const SEM_NADA: Probe = { dockerCli: () => false, dockerDaemon: () => false, nativeVersion: () => null };
const COM_DOCKER: Probe = { dockerCli: () => true, dockerDaemon: () => true, nativeVersion: () => null };
const DAEMON_PARADO: Probe = { dockerCli: () => true, dockerDaemon: () => false, nativeVersion: () => null };

function comChave(p: ProjetoDeTeste, ativa: boolean): ManifestoCarregado {
  const base = p.carregado;
  return { ...base, manifesto: { ...base.manifesto, verify: { ...base.manifesto.verify, ...(ativa ? { security_scan: 'ork security-scan' } : {}) } } };
}

test('sem verify.security_scan, o check nao existe', () => {
  const p = projetoTemporario('ss-doctor-sem-chave');
  try { assert.equal(checarSecurityScan(comChave(p, false), SEM_NADA), null); } finally { p.limpar(); }
});

test('com a chave e Docker (CLI e daemon), ok', () => {
  const p = projetoTemporario('ss-doctor-docker');
  try {
    const c = checarSecurityScan(comChave(p, true), COM_DOCKER);
    assert.equal(c?.nome, 'security scan');
    assert.equal(c?.nivel, 'ok');
    assert.equal(c?.correcao, undefined);
  } finally { p.limpar(); }
});

test('com a chave, sem Docker e sem binarios: warn que manda instalar o Docker, nunca fail', () => {
  const p = projetoTemporario('ss-doctor-sem-docker');
  try {
    fs.writeFileSync(path.join(p.dir, 'package.json'), '{"name":"x"}\n');
    for (const probe of [SEM_NADA, DAEMON_PARADO]) {
      const c = checarSecurityScan(comLocale('pt-BR', () => comChave(p, true)), probe);
      assert.equal(c?.nivel, 'warn');
      assert.match(c?.correcao ?? '', /instale o Docker/);
      assert.match(c?.detalhe ?? '', /gitleaks/);
    }
    const en = comLocale('en', () => checarSecurityScan(comChave(p, true), SEM_NADA));
    assert.equal(en?.nivel, 'warn');
    assert.match(en?.correcao ?? '', /install Docker/);
  } finally { p.limpar(); }
});

test('sem Docker, mas com todos os binarios do laco, ok', () => {
  const p = projetoTemporario('ss-doctor-nativo');
  try {
    // Only a repo without stacks: the always-on tools (secret, iac, workflow, ...) must all have an acceptable binary.
    const probe: Probe = { dockerCli: () => false, dockerDaemon: () => false, nativeVersion: bin => loadTools().find(t => t.native?.bin === bin)!.version };
    const c = checarSecurityScan(comChave(p, true), probe);
    assert.ok(c);
    assert.equal(c.nivel, 'ok', c.detalhe);
  } finally { p.limpar(); }
});
