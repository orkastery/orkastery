/**
 * Uma CLI da forja falsa para os testes: cada regra casa uma chamada (`ChamadaDaCli`) e devolve a saida. As respostas
 * gravadas (`fixtures/forja/<tipo>/<versao>/<caso>.json`) guardam so o corpo; `http()` as poe no envelope que
 * `gh api -i` e `glab api -i` imprimem: a linha de status com LF, os cabecalhos com CRLF, a linha vazia CRLF e o corpo.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChamadaDaCli, SaidaDaCli } from '../src/forja/executor';

export const FIXTURES = path.resolve(__dirname, '../../test/fixtures/forja');

/** O corpo de uma resposta gravada, como `gravado('gitlab/19.2/metadata')`. */
export function gravado(caso: string): unknown {
  return (JSON.parse(fs.readFileSync(path.join(FIXTURES, `${caso}.json`), 'utf8')) as { corpo: unknown }).corpo;
}

/** Os cabecalhos gravados (nomes em minusculas) de um caso de `*-cabecalhos/`, como `cabecalhosGravados('github/2026-10-cabecalhos/check-runs')`. */
export function cabecalhosGravados(caso: string): Record<string, string> {
  const g = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${caso}.json`), 'utf8')) as { cabecalhos?: Record<string, string> | null };
  if (!g.cabecalhos) throw new Error(`${caso} foi gravado sem cabecalhos`);
  return g.cabecalhos;
}

/**
 * A saida que a CLI imprimiu com `-i` num caso gravado com cabecalhos: o status HTTP, os cabecalhos e o corpo da
 * gravacao, no envelope medido. `trocar` muda ou acrescenta cabecalhos (para a cota esgotada, a proxima pagina).
 */
export function respostaGravada(caso: string, trocar: Record<string, string> = {}): SaidaDaCli {
  const g = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${caso}.json`), 'utf8')) as { status_http?: number; corpo: unknown };
  return http(g.status_http ?? 200, g.corpo, { ...cabecalhosGravados(caso), ...trocar });
}

export function saidaHttp(status: number, corpo: unknown, cabecalhos: Record<string, string> = {}): string {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  const comTipo = Object.keys(cabecalhos).some((k) => k.toLowerCase() === 'content-type') ? cabecalhos : { 'Content-Type': 'application/json', ...cabecalhos };
  const linhas = Object.entries(comTipo).map(([k, v]) => `${k}: ${v}\r\n`).join('');
  return `HTTP/1.1 ${status} ${status < 400 ? 'OK' : 'Erro'}\n${linhas}\r\n${texto}`;
}

/** A saida da CLI para um status HTTP: sai 0 abaixo de 400 e 1 a partir dele, com o envelope no stdout nos dois casos. */
export const http = (status: number, corpo: unknown, cabecalhos?: Record<string, string>): SaidaDaCli =>
  ({ status: status < 400 ? 0 : 1, stdout: saidaHttp(status, corpo, cabecalhos), stderr: status < 400 ? '' : `cli: erro (HTTP ${status})` });
export const ok = (stdout: string): SaidaDaCli => ({ status: 0, stdout, stderr: '' });
export const falhou = (stderr: string): SaidaDaCli => ({ status: 1, stdout: '', stderr });

export const api = (caminho: string) => (c: ChamadaDaCli): boolean => c.args[0] === 'api' && c.args.includes(caminho);
/** A chamada `api` cujo caminho contem o trecho: o caminho paginado ganha `per_page` e `page` no fim. */
export const apiEm = (trecho: string) => (c: ChamadaDaCli): boolean => c.args[0] === 'api' && c.args.some((a) => a.includes(trecho));
export const login = (c: ChamadaDaCli): boolean => c.args[0] === 'auth' && c.args[1] === 'status';
export const versao = (c: ChamadaDaCli): boolean => c.args[0] === '--version';

export interface Regra { quando: (c: ChamadaDaCli) => boolean; responde: SaidaDaCli | ((c: ChamadaDaCli) => SaidaDaCli) }

export function cliFalsa(regras: Regra[]): { rodar: (c: ChamadaDaCli) => SaidaDaCli; chamadas: ChamadaDaCli[] } {
  const chamadas: ChamadaDaCli[] = [];
  return { chamadas, rodar: (c) => {
    chamadas.push(c);
    const r = regras.find((x) => x.quando(c));
    if (!r) return falhou(`sem regra para ${c.cmd} ${c.args.join(' ')}`);
    return typeof r.responde === 'function' ? r.responde(c) : r.responde;
  } };
}
