import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, TestContext } from 'node:test';
import { PROFUNDIDADE_MAXIMA_DAS_REPRESENTACOES_JSON } from '../src/policies';
import { arquivosDoPromptNoNode, prepararPrompt } from '../src/telemetria-prompt';

function fixture(t: TestContext, conteudo: string | Buffer) {
  const raizProjeto = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-telemetria-prompt-'));
  t.after(() => fs.rmSync(raizProjeto, { recursive: true, force: true }));
  const raizPrompts = path.join(raizProjeto, '.orkastery', 'threads', 'ork-teste', 'prompts');
  fs.mkdirSync(raizPrompts, { recursive: true });
  const arquivo = path.join(raizPrompts, 'go.md');
  fs.writeFileSync(arquivo, conteudo);
  const bytes = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo);
  return { raizProjeto, raizPrompts, arquivo, promptPath: path.relative(raizProjeto, arquivo),
    sha: createHash('sha256').update(bytes).digest('hex') };
}

const privado = (texto: string) => ({ ok: true, texto: texto.replaceAll('CLIENTE_SIMULADO', '[dado omitido]') });

test('remove o catálogo no texto, JSON, separadores, Base64 e Base64URL antes de dado privado', (t) => {
  const literal = 'sk-' + 'A'.repeat(32);
  const separado = 'sk-' + 'B'.repeat(16) + '\n' + 'B'.repeat(16);
  const base64 = Buffer.from('sk-' + 'C'.repeat(32)).toString('base64');
  const base64url = Buffer.from('sk-' + 'D'.repeat(32)).toString('base64url');
  const jsonLiteral = JSON.stringify({ externo: { token: 'sk-' + 'E'.repeat(32) } });
  const jsonEscapado = '{"externo":{"token":"sk-' + '\\u0046'.repeat(32) + '"}}';
  const f = fixture(t, [literal, separado, base64, base64url, jsonLiteral, jsonEscapado,
    'CLIENTE_SIMULADO', 'texto restante'].join('\n'));
  const r = prepararPrompt({ ...f, promptSha256: f.sha, redigirPrivado: privado });
  assert.equal(r.estado, 'conteudo');
  if (r.estado !== 'conteudo') return;
  assert.match(r.texto, /texto restante/);
  assert.match(r.texto, /\[dado omitido\]/);
  for (const marcador of [literal, separado, base64, base64url, 'sk-' + 'E'.repeat(32), 'sk-' + 'F'.repeat(32),
    'CLIENTE_SIMULADO']) assert.equal(r.texto.includes(marcador), false, marcador.slice(0, 24));
  assert.equal(r.versaoDaRemocao, 'ork.telemetria-redacao/v1');
});

test('representação JSON de segredo com escape inválido falha fechada', (t) => {
  const texto = 'prefixo "sk-' + '\\u00G0'.repeat(32) + '" sufixo';
  const f = fixture(t, texto);
  const r = prepararPrompt({ ...f, promptSha256: f.sha, redigirPrivado: privado });
  assert.deepEqual(r, { estado: 'bloqueio', motivo: 'prompt_redaction_failed' });
  assert.equal(JSON.stringify(r).includes('sk-'), false);
});

test('remove marcador sintético em cada nível JSON declarado e falha fechada além do limite', (t) => {
  const tokenEscapado = ['\\u0073', '\\u006b', '\\u002d', ...Array(32).fill('\\u0041')].join('');
  const aninhar = (niveis: number) => {
    let representacao = `"${tokenEscapado}"`;
    for (let nivel = 1; nivel < niveis; nivel += 1) representacao = JSON.stringify(representacao);
    return representacao;
  };
  for (let nivel = 1; nivel <= PROFUNDIDADE_MAXIMA_DAS_REPRESENTACOES_JSON; nivel += 1) {
    const f = fixture(t, `nivel-${nivel}: ${aninhar(nivel)}`);
    const r = prepararPrompt({ ...f, promptSha256: f.sha, redigirPrivado: privado });
    assert.equal(r.estado, 'conteudo', `nível ${nivel}`);
    if (r.estado !== 'conteudo') continue;
    assert.match(r.texto, /\[segredo omitido\]/u, `marcador do nível ${nivel}`);
    assert.equal(r.texto.includes('u0073'), false, `escapes do nível ${nivel}`);
  }

  const excedente = fixture(t, aninhar(PROFUNDIDADE_MAXIMA_DAS_REPRESENTACOES_JSON + 1));
  assert.deepEqual(prepararPrompt({ ...excedente, promptSha256: excedente.sha, redigirPrivado: privado }),
    { estado: 'bloqueio', motivo: 'prompt_redaction_failed' });
});

test('todas as conferências usam o mesmo descritor e uma troca do nome é recusada', (t) => {
  const f = fixture(t, 'conteúdo original');
  const novo = path.join(f.raizPrompts, 'novo.md');
  fs.writeFileSync(novo, 'conteúdo trocado');
  let abriu = 0;
  const io = { ...arquivosDoPromptNoNode, abrir(caminho: string, flags: number) {
    const fd = arquivosDoPromptNoNode.abrir(caminho, flags);
    abriu += 1;
    fs.renameSync(caminho, `${caminho}.anterior`);
    fs.renameSync(novo, caminho);
    return fd;
  } };
  const r = prepararPrompt({ ...f, promptSha256: f.sha, redigirPrivado: privado, arquivos: io });
  assert.equal(abriu, 1);
  assert.deepEqual(r, { estado: 'lacuna', motivo: 'unsafe_path' });
});

test('recusa symlink final e ancestral sem abrir conteúdo externo', (t) => {
  const f = fixture(t, 'original');
  const fora = path.join(f.raizProjeto, 'fora.md');
  fs.writeFileSync(fora, 'fora');
  fs.unlinkSync(f.arquivo);
  fs.symlinkSync(fora, f.arquivo);
  const final = prepararPrompt({ ...f, promptSha256: f.sha, redigirPrivado: privado });
  assert.deepEqual(final, { estado: 'lacuna', motivo: 'unsafe_path' });

  fs.unlinkSync(f.arquivo);
  const real = path.join(f.raizPrompts, 'real');
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, 'prompt.md'), 'fora');
  const link = path.join(f.raizPrompts, 'link');
  fs.symlinkSync(real, link);
  const ancestral = prepararPrompt({ raizProjeto: f.raizProjeto, raizPrompts: f.raizPrompts,
    promptPath: path.relative(f.raizProjeto, path.join(link, 'prompt.md')), promptSha256: f.sha,
    redigirPrivado: privado });
  assert.deepEqual(ancestral, { estado: 'lacuna', motivo: 'unsafe_path' });
});

test('classifica metadado, ausência, tipo, teto, UTF-8 e hash sem ecoar entrada', (t) => {
  const f = fixture(t, 'conteúdo');
  const casos = [
    prepararPrompt({ ...f, promptPath: undefined, promptSha256: f.sha, redigirPrivado: privado }),
    prepararPrompt({ ...f, promptPath: 'ausente.md', promptSha256: f.sha, redigirPrivado: privado }),
    prepararPrompt({ ...f, promptPath: path.relative(f.raizProjeto, f.raizPrompts), promptSha256: f.sha,
      redigirPrivado: privado }),
    prepararPrompt({ ...f, promptSha256: f.sha, redigirPrivado: privado, teto: 2 }),
    prepararPrompt({ ...f, promptSha256: '0'.repeat(64), redigirPrivado: privado }),
  ];
  assert.deepEqual(casos.map((r) => r.estado === 'lacuna' ? r.motivo : r.estado),
    ['metadata_missing', 'unsafe_path', 'invalid_type', 'too_large', 'hash_mismatch']);

  const invalido = fixture(t, Buffer.from([0xc3, 0x28]));
  const r = prepararPrompt({ ...invalido, promptSha256: invalido.sha, redigirPrivado: privado });
  assert.deepEqual(r, { estado: 'lacuna', motivo: 'invalid_encoding' });
  const serializado = JSON.stringify([...casos, r]);
  assert.equal(serializado.includes(f.arquivo), false);
  assert.equal(serializado.includes(f.sha), false);
});

test('erro transitório e recusa de dado privado permanecem antes do evento', (t) => {
  const f = fixture(t, 'texto');
  const erro = Object.assign(new Error('falha simulada'), { code: 'EIO' });
  const io = { ...arquivosDoPromptNoNode, ler() { throw erro; } };
  assert.deepEqual(prepararPrompt({ ...f, promptSha256: f.sha, redigirPrivado: privado, arquivos: io }),
    { estado: 'bloqueio', motivo: 'prompt_io_transient' });
  assert.deepEqual(prepararPrompt({ ...f, promptSha256: f.sha, redigirPrivado: () => ({ ok: false, erro: 'termo' }) }),
    { estado: 'bloqueio', motivo: 'prompt_redaction_failed' });
});
