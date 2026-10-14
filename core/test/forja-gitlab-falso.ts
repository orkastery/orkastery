/**
 * Um GitLab falso para os testes da entrega: guarda os MRs na memoria e responde como a API v4, no envelope do `-i`
 * (`forja-cli-falsa.ts`). Cada MR nasce do MR gravado da 19.4, com os campos da branch trocados. `entregaPronta` faz a
 * thread #Auto pronta para publicar: o produto, o verify verde nele, o bundle commitado e o CHECK com PASSOU.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prepararBundleCi } from '../src/ci';
import type { OpcoesDaApi } from '../src/forja/api';
import type { ForjaResolvida } from '../src/forja/contrato';
import type { ChamadaDaCli, SaidaDaCli } from '../src/forja/executor';
import { registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { Modo } from '../src/types';
import { exec } from '../src/util';
import { branchDaWorktree } from '../src/worktree';
import { commitar, ProjetoDeTeste } from './apoio';
import { falhou, gravado, http, ok } from './forja-cli-falsa';

export const GITLAB: ForjaResolvida = { tipo: 'gitlab', host: 'gitlab.empresa.com', porta: null, caminhoBase: '', sshHost: null, sshPorta: null,
  ca: null, repo: 'grupo/sub/app', origem: { tipo: 'manifesto', host: 'manifesto', porta: 'padrao', caminhoBase: 'padrao' } };
export const PROJETO = 'projects/grupo%2Fsub%2Fapp';

export interface MrFalso {
  iid: number; source_branch: string; target_branch: string; sha: string; state: 'opened' | 'merged' | 'closed';
  has_conflicts: boolean; detailed_merge_status: string; source_project_id: number; title: string;
}

export const metodoDe = (c: ChamadaDaCli): string => c.args[c.args.indexOf('--method') + 1];
export const caminhoDe = (c: ChamadaDaCli): string => c.args[c.args.indexOf('--method') + 2];

export function gitlabFalso(pontaDe: (branch: string) => string, opcoes: { listaFalha?: boolean; listaIncompleta?: boolean; criaMasFalha?: boolean } = {}) {
  const modelo = (gravado('gitlab/19.4/mr-list') as Record<string, unknown>[])[0];
  const mrs: MrFalso[] = [];
  const chamadas: ChamadaDaCli[] = [];
  const corpos: Record<string, unknown>[] = [];
  const comoApi = (m: MrFalso) => ({ ...modelo, ...m, id: 1000 + m.iid, project_id: 1, target_project_id: 1, draft: false,
    web_url: `https://gitlab.empresa.com/grupo/sub/app/-/merge_requests/${m.iid}`, merge_commit_sha: null, squash_commit_sha: null,
    merged_at: m.state === 'merged' ? '2026-10-13T12:00:00.000Z' : null });
  const rodar = (c: ChamadaDaCli): SaidaDaCli => {
    chamadas.push(c);
    if (c.args[0] === 'auth' && c.args[1] === 'status') return ok('');
    if (c.args[0] !== 'api') return falhou(`glab falso: ${c.args.join(' ')}`);
    const metodo = metodoDe(c), caminho = caminhoDe(c);
    if (metodo === 'GET' && caminho.startsWith(`${PROJETO}/merge_requests?`)) {
      if (opcoes.listaFalha) return http(502, { message: '502 Bad Gateway' });
      if (opcoes.listaIncompleta) return http(200, [], { 'x-next-page': '2' });
      const branch = new URLSearchParams(caminho.slice(caminho.indexOf('?') + 1)).get('source_branch');
      return http(200, mrs.filter((m) => m.source_branch === branch).map(comoApi));
    }
    if (metodo === 'POST' && caminho === `${PROJETO}/merge_requests`) {
      const corpo = JSON.parse(c.entrada ?? '{}') as Record<string, unknown>;
      corpos.push(corpo);
      const branch = String(corpo.source_branch);
      if (mrs.some((m) => m.source_branch === branch && m.state === 'opened' && m.source_project_id === 1)) {
        return http(409, { message: ['Another open merge request already exists for this source branch: !1'] });
      }
      const mr: MrFalso = { iid: mrs.length + 1, source_branch: branch, target_branch: String(corpo.target_branch), sha: pontaDe(branch),
        state: 'opened', has_conflicts: false, detailed_merge_status: 'mergeable', source_project_id: 1, title: String(corpo.title) };
      mrs.push(mr);
      return opcoes.criaMasFalha ? http(500, { message: '500 Internal Server Error' }) : http(201, comoApi(mr));
    }
    return http(404, { message: '404 Not Found' });
  };
  const api: OpcoesDaApi = { rodar, logins: new Map() };
  const criacoes = () => chamadas.filter((c) => c.args[0] === 'api' && metodoDe(c) === 'POST').length;
  return { mrs, chamadas, corpos, api, criacoes };
}

export function entregaPronta(p: ProjetoDeTeste, nome: string, modo: Modo = 'auto'): { id: string; branch: string; head: string } {
  const { thread } = novaThread(p.carregado, { nome, modo });
  const branch = branchDaWorktree(thread);
  exec('git', ['checkout', '-q', '-b', branch, 'main'], p.dir);
  const produto = commitar(p.dir, `${thread.id}.txt`, 'feito\n', `feat(${thread.id}): ${nome}`);
  registrar(dirThread(p.dir, thread.id), thread.id, TIPOS_DE_EVENTO.verificacao, { commit: produto, veredito: 'verdade sustentada', motivos: [] });
  exec('git', ['add', '--', path.relative(p.dir, prepararBundleCi(p.carregado, thread.id))], p.dir);
  exec('git', ['commit', '-q', '-m', `ci(${thread.id}): bundle`], p.dir);
  const head = exec('git', ['rev-parse', 'HEAD'], p.dir).stdout.trim();
  exec('git', ['checkout', '-q', 'main'], p.dir);
  const doc = path.join(dirThread(p.dir, thread.id), 'docs', 'check.md');
  fs.mkdirSync(path.dirname(doc), { recursive: true });
  fs.writeFileSync(doc, '# CHECK\n\nVeredito: PASSOU\n');
  const depois = new Date(Date.now() + 5000);
  fs.utimesSync(doc, depois, depois);
  return { id: thread.id, branch, head };
}
