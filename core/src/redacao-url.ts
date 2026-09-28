/**
 * Redacao de logs, inclusive userinfo malformado com /?# e varias arrobas.
 * Cada delimitador :// e cada trecho sao percorridos uma vez: O(n) tempo/espaco.
 * Userinfo candidato atravessa :// internos ate o ultimo @ do grupo. Esquemas
 * colados sem separador podem ser senha: nesses casos a URL publica ambigua se
 * perde. Espaco, delimitadores de citacao e , ; )( entre URLs encerram o grupo.
 * URLs publicas sem login: antes de /?# preservam @ no caminho e na query.
 */
export function redigirCredenciaisUrl(texto: string): string {
  const esquemas: Array<{ inicio: number; fim: number }> = [];
  const delimitador = /:\/\//g;
  const caractere = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
    (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46;
  for (let m; (m = delimitador.exec(texto));) {
    let inicio = m.index;
    while (inicio > 0 && caractere(texto.charCodeAt(inicio - 1))) inicio--;
    const c = texto.charCodeAt(inicio);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) esquemas.push({ inicio, fim: m.index + 3 });
  }
  const partes: string[] = [];
  let copiado = 0;
  let inicioCredencial: number | null = null, ultimoAtDoGrupo = -1;
  for (let n = 0; n < esquemas.length; n++) {
    const { fim } = esquemas[n];
    const limite = esquemas[n + 1]?.inicio ?? texto.length;
    let ultimoAt = -1, primeiroAt = -1, separador = limite, colon = -1;
    let terminouTexto = false;
    for (let i = fim; i < limite; i++) {
      const c = texto[i];
      if (/\s|[<>"']/.test(c)) { terminouTexto = true; break; }
      if ('/?#'.includes(c) && separador === limite) separador = i;
      if (c === ':' && colon < 0) colon = i;
      if (c === '@') { ultimoAt = i; if (primeiroAt < 0) primeiroAt = i; }
    }
    const credencial = primeiroAt >= fim && primeiroAt < separador || colon >= fim && colon < separador;
    if (credencial) inicioCredencial ??= fim;
    if (ultimoAt >= fim) ultimoAtDoGrupo = ultimoAt;
    const separacaoExplicita = terminouTexto || /[,;)(]$/.test(texto.slice(Math.max(fim, limite - 1), limite));
    if (separacaoExplicita || n + 1 === esquemas.length) {
      if (inicioCredencial !== null && ultimoAtDoGrupo >= inicioCredencial) {
        partes.push(texto.slice(copiado, inicioCredencial), '[credencial redigida]@');
        copiado = ultimoAtDoGrupo + 1;
      }
      inicioCredencial = null;
      ultimoAtDoGrupo = -1;
    }
  }
  partes.push(texto.slice(copiado));
  return partes.join('');
}
