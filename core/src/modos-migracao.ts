/**
 * Migracao idempotente dos modos aposentados (I-43, T4).
 *
 * DOMICILIO UNICO da migracao. Ela e o unico lugar do produto que REESCREVE estado
 * ja gravado por causa da aposentadoria, e por isso mora sozinha: `setup.ts` nunca
 * foi escritor de YAML, e transforma-lo em um so para caber esta rotina misturaria
 * dois formatos de arquivo no mesmo dono.
 *
 * O que ela faz e estreito de proposito:
 *   - `orkastery.yaml`: tira modo aposentado de `conduction.allowed_modes`, e troca
 *     `conduction.default_mode` aposentado pelo primeiro modo vivo.
 *   - `.orkastery/setup.json`: descarta os blocos dos modos aposentados, que ja eram
 *     inertes desde que `ORDEM_DOS_MODOS` encolheu (`lerSetup` normaliza contra a
 *     matriz VIVA), mas continuavam ocupando o arquivo.
 *
 * O que ela NAO faz, e nao pode fazer: tocar em `thread.json`, `ledger.jsonl`,
 * recibo ou MASTER log. P3 do GOAL e explicita, e e a metade que da sentido a outra
 * metade: NENHUM HISTORICO E MIGRADO. Thread de 02/09 em `#Look` fica em `#Look` em
 * disco para sempre, e e o leitor que continua aceitando (fx-modo-aposentado-leitor).
 *
 * IDEMPOTENTE: rodar de novo num projeto ja migrado nao escreve nada e devolve a
 * lista vazia. Isso importa porque ela vai rodar em tres projetos deste VPS em
 * momentos diferentes, e um deles pode ja ter sido migrado por outra sessao.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { dirEstado, NOME_MANIFESTO } from './manifest';
import { registrar } from './ledger';
import { MODOS_APOSENTADOS, ORDEM_DOS_MODOS, modoAposentado } from './modos';
import { agora } from './util';

/** Uma mudanca proposta ou aplicada, sempre com o antes e o depois visiveis. */
export interface MudancaDeMigracao {
  arquivo: string;
  campo: string;
  de: string;
  para: string;
}

export interface ResultadoMigracaoModos {
  dryRun: boolean;
  /** Vazio quando nao havia nada a migrar: e assim que a idempotencia se mostra. */
  mudancas: MudancaDeMigracao[];
  /** Caminho do backup, ou null quando nada foi escrito. */
  backup: string | null;
}

const MARCA_BACKUP = 'migracao-modos-i43';

/** Le a lista `[a, b, c]` de uma linha de YAML simples, como o manifesto escreve. */
function lerListaInline(linha: string): string[] | null {
  const m = /^\s*allowed_modes:\s*\[(.*)\]\s*$/.exec(linha);
  if (!m) return null;
  return m[1].split(',').map((x) => x.trim()).filter((x) => x.length > 0);
}

/**
 * Planeja a migracao sem escrever nada.
 *
 * Separado de `migrarModosAposentados` pelo mesmo motivo de `planejarMigracaoMaster`:
 * o dono precisa poder ver o diff antes de autorizar, e `--dry-run` nao pode ser um
 * caminho de codigo diferente do que roda de verdade.
 */
export function planejarMigracaoModos(raiz: string): MudancaDeMigracao[] {
  const mudancas: MudancaDeMigracao[] = [];

  const yaml = path.join(raiz, NOME_MANIFESTO);
  if (fs.existsSync(yaml)) {
    for (const linha of fs.readFileSync(yaml, 'utf8').split('\n')) {
      const lista = lerListaInline(linha);
      if (lista) {
        const vivos = lista.filter((m) => !modoAposentado(m));
        if (vivos.length !== lista.length) {
          mudancas.push({ arquivo: NOME_MANIFESTO, campo: 'conduction.allowed_modes',
            de: `[${lista.join(', ')}]`, para: `[${vivos.join(', ')}]` });
        }
        continue;
      }
      const d = /^\s*default_mode:\s*(\S+)\s*$/.exec(linha);
      if (d && modoAposentado(d[1])) {
        mudancas.push({ arquivo: NOME_MANIFESTO, campo: 'conduction.default_mode',
          de: d[1], para: ORDEM_DOS_MODOS[0] });
      }
    }
  }

  const setup = path.join(dirEstado(raiz), 'setup.json');
  if (fs.existsSync(setup)) {
    try {
      const bruto = JSON.parse(fs.readFileSync(setup, 'utf8')) as { modos?: Record<string, unknown> };
      for (const morto of MODOS_APOSENTADOS) {
        if (bruto.modos && Object.hasOwn(bruto.modos, morto)) {
          mudancas.push({ arquivo: 'setup.json', campo: `modos.${morto}`, de: 'bloco inerte', para: '(removido)' });
        }
      }
    } catch { /* setup ilegivel nao e problema desta migracao; `lerSetup` ja reclama */ }
  }

  return mudancas;
}

/**
 * Aplica a migracao, com backup e evento no ledger do projeto.
 *
 * O backup e condicao e nao cortesia: reescrever `orkastery.yaml` de um projeto vivo
 * sem guardar o original seria exatamente o tipo de passo irreversivel silencioso que
 * esta thread existe para remover do produto.
 */
export function migrarModosAposentados(
  raiz: string,
  opcoes: { dryRun?: boolean; por?: string } = {}
): ResultadoMigracaoModos {
  const mudancas = planejarMigracaoModos(raiz);
  if (opcoes.dryRun || mudancas.length === 0) {
    return { dryRun: opcoes.dryRun === true, mudancas, backup: null };
  }

  const estado = dirEstado(raiz);
  fs.mkdirSync(estado, { recursive: true });
  const backup = path.join(estado, MARCA_BACKUP);
  if (fs.existsSync(backup)) throw new Error(`backup anterior exige inspecao: ${backup}`);
  fs.mkdirSync(backup);

  const hashes: Record<string, string> = {};
  const guardar = (nome: string, conteudo: string): void => {
    fs.writeFileSync(path.join(backup, nome), conteudo, { flag: 'wx', encoding: 'utf8' });
    hashes[nome] = createHash('sha256').update(conteudo).digest('hex');
  };

  const yaml = path.join(raiz, NOME_MANIFESTO);
  if (mudancas.some((m) => m.arquivo === NOME_MANIFESTO) && fs.existsSync(yaml)) {
    const original = fs.readFileSync(yaml, 'utf8');
    guardar(NOME_MANIFESTO, original);
    const novo = original.split('\n').map((linha) => {
      const lista = lerListaInline(linha);
      if (lista) {
        const vivos = lista.filter((m) => !modoAposentado(m));
        return vivos.length === lista.length ? linha : linha.replace(/\[.*\]/, `[${vivos.join(', ')}]`);
      }
      const d = /^(\s*default_mode:\s*)(\S+)(\s*)$/.exec(linha);
      return d && modoAposentado(d[2]) ? `${d[1]}${ORDEM_DOS_MODOS[0]}${d[3]}` : linha;
    }).join('\n');
    fs.writeFileSync(yaml, novo, 'utf8');
  }

  const setup = path.join(estado, 'setup.json');
  if (mudancas.some((m) => m.arquivo === 'setup.json') && fs.existsSync(setup)) {
    const original = fs.readFileSync(setup, 'utf8');
    guardar('setup.json', original);
    const bruto = JSON.parse(original) as { modos?: Record<string, unknown>; [k: string]: unknown };
    for (const morto of MODOS_APOSENTADOS) if (bruto.modos) delete bruto.modos[morto];
    bruto.atualizadoEm = agora();
    fs.writeFileSync(setup, JSON.stringify(bruto, null, 2) + '\n', 'utf8');
  }

  registrar(estado, 'projeto', 'modos_migrados', {
    versao: 1,
    por: (opcoes.por ?? 'nucleo ork').trim(),
    mudancas,
    backup,
    hashes,
    razao: 'I-43: modo aposentado sai da configuracao; nenhum historico e migrado (P3)',
  });

  return { dryRun: false, mudancas, backup };
}

/** Texto do `ork modos migrar`, com o antes e o depois de cada campo. */
export function textoDaMigracaoModos(r: ResultadoMigracaoModos): string {
  if (r.mudancas.length === 0) {
    return 'Nada a migrar: nenhum modo aposentado na configuracao deste projeto.';
  }
  const linhas = [r.dryRun ? 'Simulacao (--dry-run), nada foi gravado.' : 'Migracao aplicada.'];
  for (const m of r.mudancas) linhas.push(`  ${m.arquivo}  ${m.campo}`, `    de   ${m.de}`, `    para ${m.para}`);
  if (r.backup) linhas.push(`  backup  ${r.backup}`);
  linhas.push('', 'Nenhum historico foi tocado: thread, ledger e recibo em modo aposentado ficam como estao.');
  return linhas.join('\n');
}
