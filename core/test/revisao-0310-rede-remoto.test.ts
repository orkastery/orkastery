/**
 * Revisao das entregas da madrugada de 03/10 (thread ork-revisaodasen): a RM-053 mesclou depois do
 * endurecimento da RM-047 e voltou a passar o `fabrica.remoto` do manifesto versionado cru ao git
 * (`git remote get-url <remoto>`, sem validar e sem `--`), em `ork network status` e no projeto do
 * diretorio do retrato. Com uma URL com credencial no lugar do nome, o `ork network status` repetia a
 * credencial na lacuna, no texto e no JSON (que o OpenClaw e o Hermes repassam ao canal).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoDoDiretorio } from '../src/rede-projetos';
import { dirTemporario, projetoTemporario } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');
const SEGREDO = 'SEGREDO-0310-xyz';

function comRemotoNoManifesto(dir: string, remoto: string): void {
  const arquivo = path.join(dir, 'orkastery.yaml');
  const texto = fs.readFileSync(arquivo, 'utf8');
  assert.ok(!/^fabrica:/m.test(texto), 'o manifesto do teste nasce sem bloco fabrica');
  fs.writeFileSync(arquivo, `${texto}\nfabrica:\n  remoto: ${JSON.stringify(remoto)}\n`);
}

test('revisao 03/10: ork network status nao repete a credencial de um fabrica.remoto com URL', () => {
  const p = projetoTemporario('rev0310-rede-cred', true);
  const home = dirTemporario('rev0310-rede-home');
  try {
    comRemotoNoManifesto(p.dir, `https://eu:${SEGREDO}@github.com/dono/repo.git`);
    const rodar = (json: boolean) => spawnSync(process.execPath, [ORK, 'network', 'status', '--sem-remoto', ...(json ? ['--json'] : [])],
      { cwd: p.dir, encoding: 'utf8', env: { ...process.env, HOME: home, ORK_PROJETO_EXPLICITO: '0', ORK_MAQUINA: 'pc-a' } });
    const texto = rodar(false), json = rodar(true);
    assert.equal(texto.status, 0, texto.stderr);
    assert.equal(json.status, 0, json.stderr);
    assert.ok(!texto.stdout.includes(SEGREDO), `a credencial vazou no texto:\n${texto.stdout}`);
    assert.ok(!json.stdout.includes(SEGREDO), 'a credencial vazou no JSON');
    const lacuna = (JSON.parse(json.stdout) as { lacunas: { tipo: string; detalhe: string }[] }).lacunas
      .find((l) => l.tipo === 'fabrica.sem-leitura');
    assert.ok(lacuna, 'o projeto sem remoto valido continua sendo uma lacuna');
    assert.match(lacuna!.detalhe, /nao e nome de remoto do git/);
  } finally {
    p.limpar();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('revisao 03/10: o projeto do diretorio nao leva ao git um fabrica.remoto que nao e nome de remoto', () => {
  const p = projetoTemporario('rev0310-rede-opcao');
  const bin = dirTemporario('rev0310-rede-bin');
  const registro = path.join(bin, 'args.log');
  const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${registro}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const path0 = process.env.PATH;
  try {
    comRemotoNoManifesto(p.dir, '--push');
    process.env.PATH = `${bin}${path.delimiter}${path0}`;
    const projeto = projetoDoDiretorio(p.dir);
    assert.ok(projeto, 'o projeto do diretorio continua lido');
    assert.equal(projeto!.remoto, null);
    const chamadas = fs.existsSync(registro) ? fs.readFileSync(registro, 'utf8') : '';
    assert.ok(!/get-url --push/.test(chamadas), `o remoto do manifesto virou opcao do git:\n${chamadas}`);
  } finally {
    process.env.PATH = path0;
    p.limpar();
    fs.rmSync(bin, { recursive: true, force: true });
  }
});
