import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const raizDoRepositorio = resolve(__dirname, '../../..');
const ler = (caminho: string): string => readFileSync(resolve(raizDoRepositorio, caminho), 'utf8');

test('o guia pt-BR prova cada cláusula operacional do preflight coletivo', () => {
  const guia = ler('docs/guias/rede-da-empresa.pt-BR.md');
  assert.match(guia, /ork\.rede-empresa-publicacao\/v2[\s\S]*ork\.rede-empresa-publicacao\/v3[\s\S]*mesma transação/, 'v2 e v3');
  assert.match(guia, /globs de caminho se intersectam/, 'globs');
  assert.match(guia, /segmentos literais, `\*`, `\?` e o segmento `\*\*`/, 'gramática dos globs');
  assert.match(guia, /primeira aparição[\s\S]*primeiro pai[\s\S]*ponta carimbada/, 'ordem histórica');
  assert.match(guia, /até 64 padrões[\s\S]*até 4096[\s\S]*no máximo 2000 commits/, 'tetos');
  assert.match(guia, /história rasa, truncada ou maior que o teto produz `inconclusivo`/, 'lacunas históricas');
  assert.match(guia, /`ork network empresa status`/, 'status coletivo');
  assert.match(guia, /`ork ship publicar` e[\s\S]*`ork ship pista`/, 'publicação e Pista');
  assert.match(guia, /`ork ci run`/, 'CI');
  assert.match(guia, /`ork_thread_status` antes de `ork_ship`/, 'thread status e MCP');
  assert.match(guia, /antes do `ork ship` direto/, 'SHIP direto');
  assert.match(guia, /ORK_REDE_EMPRESA_READ_TOKEN[\s\S]*somente de leitura/, 'credencial');
  assert.match(guia, /consultiva nos níveis `observar`, `avisar` e `exigir`/, 'caráter consultivo');
  assert.match(guia, /não altera `ok`, autorização, policy, verify, CI, lease,[\s\S]*merge ou push/, 'entrega inalterada');
});

test('the English guide proves every operational collective-preflight clause', () => {
  const guide = ler('docs/guias/rede-da-empresa.md');
  assert.match(guide, /ork\.rede-empresa-publicacao\/v2[\s\S]*ork\.rede-empresa-publicacao\/v3[\s\S]*one transaction/, 'v2 and v3');
  assert.match(guide, /path globs intersect/, 'globs');
  assert.match(guide, /literal segments, `\*`, `\?`, and a standalone `\*\*` segment/, 'glob grammar');
  assert.match(guide, /first appearance[\s\S]*first-parent path[\s\S]*stamped tip/, 'historical order');
  assert.match(guide, /up\s+to 64 patterns[\s\S]*up to 4096[\s\S]*at most 2000 first-parent commits/, 'caps');
  assert.match(guide, /Shallow,[\s\S]*truncated, or over-limit history produces `inconclusivo`/, 'history gaps');
  assert.match(guide, /`ork network empresa status`/, 'collective status');
  assert.match(guide, /`ork ship publicar`, `ork ship pista`/, 'publication and delivery lane');
  assert.match(guide, /`ork ci run`/, 'CI');
  assert.match(guide, /`ork_thread_status` before `ork_ship`/, 'thread status and MCP');
  assert.match(guide, /before direct `ork ship`/, 'direct SHIP');
  assert.match(guide, /ORK_REDE_EMPRESA_READ_TOKEN[\s\S]*read-only access/, 'credential');
  assert.match(guide, /advisory under[\s\S]*`observar`, `avisar`, and `exigir`/, 'advisory behavior');
  assert.match(guide, /does not change `ok`, authorization, policy, verify, CI, leases, merge, or[\s\S]*push/, 'unchanged delivery');
});

test('o guia da Pista descreve a superfície e mantém entrega e CI inalterados', () => {
  const guia = ler('docs/guias/pista-de-entrega.md');
  assert.match(guia, /uma pista por thread aberta[\s\S]*Cada pista tem oito etapas/, 'descrição da Pista');
  assert.match(guia, /`ork ship pista` mostra o aviso/, 'aviso na Pista');
  assert.match(guia, /`ork ship publicar`[\s\S]*inclui no corpo do PR antes do push/, 'aviso no PR antes do efeito');
  assert.match(guia, /ORK_REDE_EMPRESA_READ_TOKEN[\s\S]*limitado a leitura/, 'credencial opcional do CI');
  assert.match(guia, /nenhuma etapa, ação,[\s\S]*autorização ou resultado da pista muda/, 'preflight não muda a entrega');
  assert.match(guia, /`ok` do CI e a política de recibo não[\s\S]*mudam/, 'preflight não muda o CI');
});

test('as políticas de recibo preservam ok, decisão e código de saída nos dois idiomas', () => {
  const pt = ler('docs/guias/politica-de-recibo-da-empresa.pt-BR.md');
  assert.match(pt, /preflight coletivo consultivo/, 'preflight pt-BR');
  assert.match(pt, /ORK_REDE_EMPRESA_READ_TOKEN[\s\S]*somente leitura/, 'credencial pt-BR');
  assert.match(pt, /não muda `ok`/, 'ok pt-BR');
  assert.match(pt, /decisão desta política de recibo/, 'decisão pt-BR');
  assert.match(pt, /código de saída/, 'código de saída pt-BR');

  const en = ler('docs/guias/politica-de-recibo-da-empresa.md');
  assert.match(en, /advisory collective preflight/, 'English preflight');
  assert.match(en, /ORK_REDE_EMPRESA_READ_TOKEN[\s\S]*read-only access/, 'English credential');
  assert.match(en, /does not change `ok`/, 'English ok');
  assert.match(en, /receipt-policy decision/, 'English decision');
  assert.match(en, /exit[\s\S]*code/, 'English exit code');
});

test('as referências CLI cobrem status, Pista, SHIP, corpo do PR e CI nos dois idiomas', () => {
  const pt = ler('docs/referencia/cli.md');
  assert.match(pt, /grava os contratos v2 e v3 na mesma transação/, 'v2 e v3 pt-BR');
  assert.match(pt, /`ork network empresa status[\s\S]*preflight coletivo/, 'status pt-BR');
  assert.match(pt, /`ork ship pista[\s\S]*mesmo preflight coletivo consultivo/, 'Pista pt-BR');
  assert.match(pt, /`ork ship <thread>[\s\S]*Imprime primeiro o preflight coletivo consultivo/, 'SHIP pt-BR');
  assert.match(pt, /`ork ship publicar[\s\S]*aviso entra no corpo do PR/, 'corpo do PR pt-BR');
  assert.match(pt, /`ork ci run[\s\S]*ORK_REDE_EMPRESA_READ_TOKEN[\s\S]*sem mudar `ok` ou a política/, 'CI pt-BR');

  const en = ler('docs/referencia/cli.en.md');
  assert.match(en, /writes v2 and v3 in one transaction/, 'English v2 and v3');
  assert.match(en, /`ork network empresa status[\s\S]*collective preflight/, 'English status');
  assert.match(en, /`ork ship pista[\s\S]*same collective advisory preflight/, 'English delivery lane');
  assert.match(en, /`ork ship <thread>[\s\S]*Prints collective advisory preflight first/, 'English SHIP');
  assert.match(en, /`ork ship publicar[\s\S]*warning enters the PR body/, 'English PR body');
  assert.match(en, /`ork ci run[\s\S]*ORK_REDE_EMPRESA_READ_TOKEN[\s\S]*leaves `ok` and policy unchanged/, 'English CI');
});

test('o contrato da forja mantém o preflight consultivo em todas as superfícies', () => {
  const contrato = ler('docs/referencia/contratos/forja.md');
  assert.match(contrato, /`ork ship publicar` e `ork ship pista`/, 'publicação e Pista');
  assert.match(contrato, /`ork_thread_status` apresenta a fotografia antes de `ork_ship`/, 'status e MCP');
  assert.match(contrato, /SHIP direto a imprime antes do merge/, 'SHIP direto');
  assert.match(contrato, /consultivo nos três níveis da política/, 'três níveis');
  assert.match(contrato, /não altera `ok`, autorização, verify, CI, lease, merge ou push/, 'entrega inalterada');
  assert.match(contrato, /ORK_REDE_EMPRESA_READ_TOKEN[\s\S]*somente de leitura/, 'credencial');
  assert.match(contrato, /ambiente `http\.extraHeader` do Git, não por argv/, 'transporte da credencial');
  assert.match(contrato, /Ausência da credencial e PR de fork[\s\S]*sem mudar o resultado do CI/, 'credencial ausente e fork');
});
