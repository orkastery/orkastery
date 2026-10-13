/** Spec do suporte a GitLab, seção 5.1: um parser só para as três formas de URL, com porta e subgrupos. */
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const SEGMENTO = /^[A-Za-z0-9_.-]+$/;

export interface EnderecoDoRemoto { protocolo: 'https' | 'http' | 'ssh' | 'scp'; host: string; porta: number | null; caminho: string }

function caminhoValido(bruto: string): string | null {
  const c = bruto.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  const partes = c.split('/');
  return partes.length >= 2 && partes.every((p) => SEGMENTO.test(p) && p !== '.' && p !== '..') ? partes.join('/') : null;
}

export function lerEnderecoDoRemoto(url: string): EnderecoDoRemoto | null {
  const t = url.trim();
  const esquema = /^(https?|ssh|git\+ssh|ssh\+git):\/\/(?:[^@/]*@)?([^/:?#@]+)(?::(\d{1,5}))?\/([^?#\s]+)$/i.exec(t);
  if (esquema) {
    const host = esquema[2].toLowerCase(), caminho = caminhoValido(esquema[4]);
    const porta = esquema[3] ? Number(esquema[3]) : null;
    if (!HOST.test(host) || !caminho || (porta !== null && (porta < 1 || porta > 65535))) return null;
    const p = esquema[1].toLowerCase();
    return { protocolo: p === 'https' ? 'https' : p === 'http' ? 'http' : 'ssh', host, porta, caminho };
  }
  const scp = /^(?:[^@\s/:]+@)?([^:\s/@]+):(?!\/\/)([^\s]+)$/.exec(t);
  if (!scp) return null;
  const host = scp[1].toLowerCase(), caminho = caminhoValido(scp[2]);
  return HOST.test(host) && caminho ? { protocolo: 'scp', host, porta: null, caminho } : null;
}

/** `host` ou `host:porta`, a forma que `--hostname` do `gh` e do `glab` aceita. */
export const hostComPorta = (e: EnderecoDoRemoto): string => (e.porta ? `${e.host}:${e.porta}` : e.host);
