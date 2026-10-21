import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comLocale, msg } from '../src/locale';
import { ErroDeProjeto } from '../src/projeto-alvo';
import { linhasEmPortugues } from './locale-apoio';

test('F3d: registro e recusas de projeto têm moldura completa nas duas línguas', () => {
  const render = (locale: 'pt-BR' | 'en') => comLocale(locale, () => {
    const e = new ErroDeProjeto('projeto.ambiguo', msg().projetos.ambiguo('app', 2), [
      { nome: 'app', abbrev: 'app', raiz: '/srv/app', remoto: null, presente: false },
    ], msg().projetos.escolhaRaiz);
    return [msg().projetos.cli.titulo('~/.orkastery/projetos.json'), e.texto,
      msg().projetos.cli.registrado('app', 'app', '/srv/app', msg().projetos.cli.semRemoto),
      msg().projetos.cli.esquecido('app', '/srv/app')].join('\n');
  });
  const pt = render('pt-BR'), en = render('en');
  assert.match(pt, /Projetos conhecidos desta maquina/);
  assert.match(pt, /Candidatos:/);
  assert.match(en, /Projects known on this machine/);
  assert.match(en, /Candidates:/);
  assert.match(en, /nothing was deleted from disk/);
  assert.deepEqual(linhasEmPortugues(en), []);
});
