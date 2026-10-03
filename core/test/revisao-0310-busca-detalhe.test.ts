/**
 * Revisao das entregas da madrugada de 03/10 (thread ork-revisaodasen), RM-038: o id do FTS fora do
 * universo da busca e descartado e "dito, nunca escondido", no `detalhe`. O texto de
 * `ork memory search --texto` so mostrava o detalhe junto de um motivo; na busca que deu certo
 * (motivo nulo), a contagem sumia e so o `--json` a trazia.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buscarPorSignificado, textoDaBuscaPorSignificado } from '../src/busca-semantica';
import { universoDaBusca } from '../src/indice-vetorial';
import { DriverEmMemoria } from '../src/orkmind';
import { EntradaDeMemoria } from '../src/types';

test('revisao 03/10: o texto da busca por significado mostra o detalhe mesmo sem motivo', () => {
  const entrada = (id: string, conteudo: string) =>
    ({ id, collection: 'decision', content: conteudo, tags: { project: ['t1'] }, priority: 'normal' }) as unknown as EntradaDeMemoria;
  const driver = new DriverEmMemoria([entrada('d1', 'alpha beta'), entrada('d2', 'alpha gamma')]);
  const r = buscarPorSignificado({ raiz: '/tmp', tenant: 't1', dsn: 'x', config: { provider: 'none' } as never,
    universo: universoDaBusca(driver, 't1'), texto: 'alpha', modo: 'fts', limite: 5,
    buscarTexto: () => ['d1', 'zz-alheio'] } as never);
  assert.equal(r.motivo, null, 'a busca deu certo');
  assert.equal(r.ftsForaDoUniverso, 1);
  assert.match(r.detalhe, /fora do universo/);
  const texto = textoDaBuscaPorSignificado(r);
  assert.ok(texto.includes(r.detalhe), texto);
  assert.match(texto, /1\. \[decision\] d1/);
});
