/**
 * Leitor de YAML do subconjunto que o `orkastery.yaml` usa.
 *
 * Deliberadamente pequeno e sem dependencia externa: mapas aninhados por indentacao
 * de 2 espacos, listas em bloco (`- item`) e listas inline (`[a, b]`), escalares
 * string/numero/booleano/nulo, comentarios com `#`. Qualquer construcao fora disso
 * levanta erro com numero de linha, em vez de adivinhar.
 */

export type ValorYaml = string | number | boolean | null | ValorYaml[] | { [k: string]: ValorYaml };

interface LinhaUtil {
  numero: number;
  indent: number;
  conteudo: string;
}

function tirarComentario(linha: string): string {
  let dentroDeAspas: string | null = null;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (dentroDeAspas) {
      if (c === dentroDeAspas) dentroDeAspas = null;
    } else if (c === '"' || c === "'") {
      dentroDeAspas = c;
    } else if (c === '#' && (i === 0 || /\s/.test(linha[i - 1]))) {
      return linha.slice(0, i);
    }
  }
  return linha;
}

/** Converte um escalar YAML para o tipo JavaScript correspondente. */
export function escalar(bruto: string): ValorYaml {
  const t = bruto.trim();
  if (t === '' || t === '~' || t === 'null') return null;
  if (t === '{}') return {};
  if (t === 'true' || t === 'yes') return true;
  if (t === 'false' || t === 'no') return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d*\.\d+$/.test(t)) return Number(t);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (t.startsWith('[') && t.endsWith(']')) {
    const dentro = t.slice(1, -1).trim();
    if (dentro === '') return [];
    return dentro.split(',').map((item) => escalar(item));
  }
  return t;
}

function preparar(texto: string): LinhaUtil[] {
  const linhas: LinhaUtil[] = [];
  texto.split('\n').forEach((original, i) => {
    const semComentario = tirarComentario(original).replace(/\s+$/, '');
    if (semComentario.trim() === '') return;
    if (semComentario.trim() === '---') return;
    const indent = semComentario.length - semComentario.trimStart().length;
    linhas.push({ numero: i + 1, indent, conteudo: semComentario.trim() });
  });
  return linhas;
}

function parseBloco(linhas: LinhaUtil[], inicio: number, indent: number): [ValorYaml, number] {
  let i = inicio;
  if (i >= linhas.length) return [null, i];

  if (linhas[i].conteudo.startsWith('- ') || linhas[i].conteudo === '-') {
    const lista: ValorYaml[] = [];
    while (i < linhas.length && linhas[i].indent === indent && linhas[i].conteudo.startsWith('-')) {
      const resto = linhas[i].conteudo.slice(1).trim();
      lista.push(escalar(resto));
      i++;
    }
    return [lista, i];
  }

  const mapa: { [k: string]: ValorYaml } = {};
  while (i < linhas.length && linhas[i].indent === indent) {
    const linha = linhas[i];
    const sep = linha.conteudo.indexOf(':');
    if (sep < 0) {
      throw new Error(`YAML invalido na linha ${linha.numero}: esperado "chave: valor"`);
    }
    const chave = linha.conteudo.slice(0, sep).trim().replace(/^["']|["']$/g, '');
    const resto = linha.conteudo.slice(sep + 1).trim();
    i++;
    if (resto !== '') {
      mapa[chave] = escalar(resto);
      continue;
    }
    if (i < linhas.length && linhas[i].indent > indent) {
      const [filho, proximo] = parseBloco(linhas, i, linhas[i].indent);
      mapa[chave] = filho;
      i = proximo;
    } else {
      mapa[chave] = null;
    }
  }
  return [mapa, i];
}

/** Le um documento YAML do subconjunto suportado. */
export function lerYaml(texto: string): ValorYaml {
  const linhas = preparar(texto);
  if (linhas.length === 0) return {};
  const [valor] = parseBloco(linhas, 0, linhas[0].indent);
  return valor;
}
