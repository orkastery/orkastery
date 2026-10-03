/** S8: contrato publico da transicao do legado, sem depender dos artefatos privados da thread. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const raiz = path.resolve(__dirname, '../../..');
const ler = (arquivo: string) => fs.readFileSync(path.join(raiz, arquivo), 'utf8');
const paginas = ['docs/produto/FEAT-007-worktree-e-leases.md', 'docs/produto/FEAT-029-conducao-multicanal.md',
  'docs/roadmap/RM-036-maestro-multicanal.md'];

test('rm036 docs: R4 verificacao escala retomada insegura ao humano', () => {
  const texto = ler('docs/guias/verificacao.md').split('## 3.')[1].split('## 4.')[0];
  const linha = texto.split('\n').find((l) => l.startsWith('| `lease.resume-unavailable`'));
  assert.ok(linha, 'motivo consta da tabela publica');
  assert.match(linha, /\| escalar-humano \| \*\*não\*\* \|/);
  assert.match(linha, /hard link ou link simbólico/);
  assert.match(linha, /Ausência de `flock` usa retomada portátil/);
  assert.match(linha, /`nlink === 0` é `lease.busy`/);
});

for (const pagina of paginas) {
  test(`rm036 docs: ${pagina} explica janela e fila sem prometer migracao`, () => {
    const texto = ler(pagina);
    assert.match(texto, /janela de 30 minutos/);
    assert.match(texto, /primeira consulta desta versão, mesmo sem legado/);
    assert.match(texto, /janela não reabre/);
    assert.match(texto, /\.orkastery\/leases\/\.legado/);
    assert.match(texto, /[Ff]ila legada não é lida/);
    assert.match(texto, /prova posse canônica/);
    assert.doesNotMatch(texto, /lido até vencer|espera legada entra na fila canônica/);
  });
}

test('rm036 docs: roadmap aponta evidencia publica sem alegacao de mutacao sem origem', () => {
  const texto = ler(paginas[2]);
  assert.doesNotMatch(texto, /está no PLAN da thread|testes caem com o código anterior/);
  for (const arquivo of ['leases.ts', 'portfolio.ts', 'rm036-leases-canonicos.test.ts', 'rm036-leases-gofix.test.ts', 'rm036-leases-mcp.test.ts']) {
    const link = [...texto.matchAll(/\]\(([^)]+)\)/g)].find((m) => m[1].endsWith('/' + arquivo));
    assert.ok(link, `fonte publica para ${arquivo}`);
    assert.equal(fs.existsSync(path.resolve(raiz, path.dirname(paginas[2]), link[1])), true);
  }
});

test('rm036 docs: CLI situa todas as familias e a fila no dominio canonico', () => {
  const texto = ler('docs/referencia/cli.md').split('## Isolamento: worktree e leases')[1].split('\n---')[0];
  assert.match(texto, /Todas as famílias e a fila por colisão moram no\s+estado canônico/);
  assert.match(texto, /janela de 30 minutos/);
  assert.match(texto, /primeira consulta desta versão, mesmo sem legado/);
  assert.match(texto, /janela não reabre/);
  assert.match(texto, /fila legada não é lida/);
  assert.match(texto, /cinco segundos/);
  assert.match(texto, /ork lease release <nome> --forcar/);
  assert.match(texto, /aspas simples com escape/);
  assert.match(texto, /mostra apenas o arquivo/);
  assert.match(texto, /ship --dry-run/);
  assert.match(texto, /flock/);
});

test('rm036 docs: changelog registra endurecimento e fila sem migracao', () => {
  // Antes da versao o item fica em "Nao publicado"; depois, na secao da versao que o publicou.
  const secoes = ler('CHANGELOG.md').split(/\n## /).slice(1);
  const texto = secoes.find((s) => /janela de 30 minutos/.test(s)) ?? '';
  assert.match(texto, /^(Não publicado|\[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2})\n/);
  assert.match(texto, /janela de 30 minutos/);
  assert.match(texto, /primeira consulta\s+desta versão, mesmo sem legado/);
  assert.match(texto, /janela não reabre/);
  assert.match(texto, /fila legada não é lida/);
  assert.match(texto, /vínculo de volta/);
  assert.match(texto, /posse canônica/);
  assert.match(texto, /cinco segundos/);
  assert.doesNotMatch(texto, /espera legada entra na fila canônica/);
});


for (const pagina of [...paginas, 'docs/referencia/cli.md', 'CHANGELOG.md']) {
  test(`rm036 docs: R3 ${pagina} preserva legado e explica retomada indisponivel`, () => {
    const texto = ler(pagina);
    assert.match(texto, /[Ll]egado nunca é apagado/);
    assert.match(texto, /dev:ino:ctime/);
    assert.match(texto, /\.legado-ignorado-<dev>-<ino>-<ctime>/);
    assert.match(texto, /ctimeMs/);
    assert.match(texto, /[Dd]iagnóstico do legado não sugere `release`|[Dd]iagnóstico mostra apenas o arquivo e não sugere `release` para legado/);
    assert.match(texto, /\(legado\)/);
    assert.match(texto, /[Nn]enhuma liberação é anunciada quando nada saiu/);
    assert.match(texto, /lease\.resume-unavailable/);
    assert.match(texto, /ork lease release <nome> --forcar/);
    assert.match(texto, /[Nn]ão há retry automático|sem retry automático/);
    assert.match(texto, /Linux e macOS, inclusive\s+sem `\/usr\/bin\/flock`/);
    assert.match(texto, /tickets/);
    assert.match(texto, /`rename` atômico/);
    assert.match(texto, /`nlink === 0` (é|significa) `lease\.busy`/);
    assert.match(texto, /escalada humana/);
    assert.match(texto, /PID\s+reutilizado/);
    assert.doesNotMatch(texto, /confere dispositivo e inode antes de apagar|[Ss]ó (há|recebem) comando de remoção/);
  });
}

for (const pagina of [...paginas, 'docs/referencia/cli.md', 'CHANGELOG.md']) {
  test(`rm036 docs: R5 ${pagina} explica fila MCP prazo e namespace PID`, () => {
    const texto = ler(pagina).replace(/\s+/g, ' ');
    assert.match(texto, /\.orkastery\/leases\/<lease>\.json\.retomadas/);
    assert.match(texto, /MCP aceita somente diretório real/);
    assert.match(texto, /candidatos regulares de um único vínculo/);
    assert.match(texto, /pasta vazia é removida/);
    assert.match(texto, /`ork lease list` mostra candidatos, PID, ticket, idade e temporários `\.json\.tmp`/);
    assert.match(texto, /`process\.kill\(pid, 0\)` só vale no mesmo namespace de PID/);
    assert.match(texto, /limite de 30 minutos \(`TTL_PADRAO_MS`\)/);
    assert.match(texto, /expirados são recolhidos na próxima tentativa, que retorna `lease.resume-unavailable`/);
    assert.match(texto, /repetir a aquisição, sem apagar o lease/);
    assert.match(texto, /JSON parcial deixado por SIGKILL/);
    assert.match(texto, /perdeu seu candidato não pode prosseguir/);
    assert.match(texto, /reconferidos imediatamente antes de `unlink`/);
    assert.match(texto, /não constituem um CAS atômico/);
    assert.doesNotMatch(texto, /diretório vazio pode permanecer|sem expiração que remova|não há expiração por prazo/);
  });
}

test('rm036 docs: R5 tabela distingue fila expirada de lease inseguro', () => {
  const linha = ler('docs/guias/verificacao.md').split('\n').find((l) => l.startsWith('| `lease.resume-unavailable`'))!;
  assert.match(linha, /Fila de retomada expirada \(30 minutos\)/);
  assert.match(linha, /candidatos e temporários recolhidos/);
  assert.match(linha, /consultar `ork lease list` e repetir a aquisição, sem apagar o lease/);
});
