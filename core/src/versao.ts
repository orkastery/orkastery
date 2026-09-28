/**
 * A versao do `ork`, lida do package.json que viaja com o pacote.
 *
 * Havia um literal por superficie (CLI, servidor MCP, recibo de instalacao de adaptador), e cada
 * um precisava lembrar da publicacao seguinte. O package.json e a unica fonte: no repositorio ele
 * fica em `core/`, e no pacote npm ao lado de `dist/`, sempre um nivel acima do arquivo compilado.
 * A arvore de teste (`dist-test/src/`) fica dois niveis abaixo, por isso o segundo candidato.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const NOME_DO_PACOTE = '@orkastery/cli';

function lerVersao(): string {
  for (const candidato of [path.join(__dirname, '..', 'package.json'), path.join(__dirname, '..', '..', 'package.json')]) {
    try {
      const pacote = JSON.parse(fs.readFileSync(candidato, 'utf8')) as { name?: unknown; version?: unknown };
      if (pacote.name === NOME_DO_PACOTE && typeof pacote.version === 'string') return pacote.version;
    } catch { /* tenta o proximo candidato */ }
  }
  return '0.0.0-desconhecida';
}

/** A versao publicada em `@orkastery/cli`, a mesma do `version` do package.json. */
export const VERSAO_DO_ORK: string = lerVersao();
