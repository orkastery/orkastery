/**
 * I-42 (T5): toda superficie que enumera modos enxerga os vivos, sem repetir a lista aqui.
 *
 * O teste deriva tudo de `ORDEM_DOS_MODOS`. Um modo novo que entre na matriz e falte numa
 * superficie reprova aqui, com o nome da superficie; um modo que saia nao deixa lista
 * esquecida para tras, porque nenhuma lista deste arquivo e escrita a mao.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { creationRequestSchema } from '../src/creation-operation-store';
import { registrarDecisao } from '../src/decisao-autonoma';
import { profundidadeDoModo } from '../src/hitl-contract';
import { exigirModoVivo, MODOS, MODOS_LEGADOS, ORDEM_DOS_MODOS } from '../src/modos';
import { novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

const RAIZ_DO_REPO = path.resolve(__dirname, '..', '..', '..');

/** O enum `mode` do esquema JSON publicado, achado pela chave e nao pela posicao. */
function enumDeModoNoEsquema(): string[] {
  const esquema = JSON.parse(fs.readFileSync(path.join(RAIZ_DO_REPO, 'core/schemas/creation-operation.schema.json'), 'utf8'));
  const achados: string[][] = [];
  const visitar = (no: unknown): void => {
    if (!no || typeof no !== 'object') return;
    const registro = no as Record<string, unknown>;
    const mode = (registro.properties as Record<string, { enum?: string[] }> | undefined)?.mode;
    if (mode?.enum) achados.push(mode.enum);
    for (const v of Object.values(registro)) visitar(v);
  };
  visitar(esquema);
  assert.ok(achados.length > 0, 'o esquema perdeu a propriedade mode');
  return achados[0];
}

test('o esquema JSON, o zod do journal e o canal MCP aceitam todo modo vivo', () => {
  const doEsquema = enumDeModoNoEsquema();
  for (const modo of ORDEM_DOS_MODOS) {
    assert.ok(doEsquema.includes(modo), `core/schemas/creation-operation.schema.json sem ${modo}`);
    assert.equal(creationRequestSchema.innerType().shape.mode.safeParse(modo).success, true, `creation-operation-store sem ${modo}`);
    assert.equal(exigirModoVivo(MODOS[modo].tag), modo, `canal MCP (exigirModoVivo) sem ${modo}`);
    assert.ok(['resumo', 'detalhada', 'profunda'].includes(profundidadeDoModo(modo)), `profundidade de ${modo}`);
  }
  // Leitor: o que ja foi gravado continua valido para sempre (I-43).
  for (const modo of MODOS_LEGADOS) assert.ok(doEsquema.includes(modo), `o esquema esqueceu o legado ${modo}`);
});

test('toda thread viva escreve decisao informada no contrato ork.hitl/v2', () => {
  // O validador v2 tinha a lista literal de modos; uma thread #Fast registrando decisao
  // autonoma quebrava ali. A prova e o caminho real: registrar a decisao numa thread de cada modo.
  const p = projetoTemporario('paridade-hitl-v2');
  try {
    for (const modo of ORDEM_DOS_MODOS) {
      const t = novaThread(p.carregado, { nome: `decide ${modo}`, modo }).thread;
      const { pedido } = registrarDecisao(p.dir, t.id, {
        decidido: 'O texto do aviso ficou em uma linha',
        porque: 'duas linhas quebravam a leitura no celular',
        comoMudar: 'peca para voltar a duas linhas',
        custoDeReverter: { agora: 'uma linha', depois: 'uma linha' },
        criterio: { tipo: 'manifesto', referencia: 'project.name' },
        quemDecidiu: `sessao de teste ${modo}`,
        evidencia: 'leitura do aviso na tela pequena',
      });
      assert.equal(pedido.modo, modo);
    }
  } finally {
    p.limpar();
  }
});
