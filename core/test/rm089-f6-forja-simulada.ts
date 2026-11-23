import { strict as assert } from 'node:assert';
import { commitar, projetoTemporario, type ProjetoDeTeste } from './apoio';
import { exec } from '../src/util';

export interface ProjetoComOrigemAdotavel extends ProjetoDeTeste {
  origem: string;
  sourceHead: string;
  commitsDaOrigem: string[];
}

export function projetoComOrigemAdotavel(nome: string): ProjetoComOrigemAdotavel {
  const p = projetoTemporario(nome, true);
  commitar(p.dir, 'docs/roadmap/RM-089-adocao.md', '# RM-089\n', 'roadmap da adoção');
  const origem = 'trabalho-externo';
  assert.equal(exec('git', ['switch', '-q', '-c', origem], p.dir).ok, true);
  const primeiro = commitar(p.dir, 'externo/um.txt', 'um\n', 'externo um');
  const segundo = commitar(p.dir, 'externo/dois.txt', 'dois\n', 'externo dois');
  assert.equal(exec('git', ['switch', '-q', 'main'], p.dir).ok, true);
  return { ...p, origem, sourceHead: segundo, commitsDaOrigem: [primeiro, segundo] };
}
