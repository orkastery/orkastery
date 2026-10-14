/** Um parser só para as três formas de URL, com porta e subgrupos. */
/** O host que o parser aceita: minusculas, rotulos sem hifen na ponta (nunca comeca por `-`). */
export const HOST_DO_REMOTO = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const HOST = HOST_DO_REMOTO;
const SEGMENTO = /^[A-Za-z0-9_.-]+$/;

export interface EnderecoDoRemoto { protocolo: 'https' | 'http' | 'ssh' | 'scp' | 'git'; host: string; porta: number | null; caminho: string }
/** O que se lê de qualquer URL de remoto sem julgar o caminho: `caminhoBruto` vem como escrito, sem a barra inicial. */
export interface HostDoRemoto { protocolo: EnderecoDoRemoto['protocolo']; host: string; porta: number | null; caminhoBruto: string }

function caminhoValido(bruto: string): string | null {
  const c = bruto.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  const partes = c.split('/');
  return partes.length >= 2 && partes.every((p) => SEGMENTO.test(p) && p !== '.' && p !== '..') ? partes.join('/') : null;
}

/** Protocolo, host e porta de uma URL de remoto (https, http, ssh, git ou scp), com o caminho sem validar. */
export function lerHostDoRemoto(url: string): HostDoRemoto | null {
  const t = url.trim();
  const esquema = /^(https?|ssh|git|git\+ssh|ssh\+git):\/\/(?:[^@/]*@)?([^/:?#@]+)(?::(\d+))?\/([^?#\s]+)$/i.exec(t);
  if (esquema) {
    const host = esquema[2].toLowerCase();
    if (!HOST.test(host)) return null;
    const p = esquema[1].toLowerCase();
    const protocolo = p === 'https' ? 'https' : p === 'http' ? 'http' : p === 'git' ? 'git' : 'ssh';
    return { protocolo, host, porta: esquema[3] ? Number(esquema[3]) : null, caminhoBruto: esquema[4].replace(/^\/+/, '') };
  }
  const scp = /^(?:[^@\s/:]+@)?([^:\s/@]+):(?!\/\/)([^\s]+)$/.exec(t);
  if (!scp) return null;
  const host = scp[1].toLowerCase();
  return HOST.test(host) ? { protocolo: 'scp', host, porta: null, caminhoBruto: scp[2].replace(/^\/+/, '') } : null;
}

export function lerEnderecoDoRemoto(url: string): EnderecoDoRemoto | null {
  const lido = lerHostDoRemoto(url);
  const caminho = lido ? caminhoValido(lido.caminhoBruto) : null;
  if (!lido || !caminho || (lido.porta !== null && (lido.porta < 1 || lido.porta > 65535))) return null;
  return { protocolo: lido.protocolo, host: lido.host, porta: lido.porta, caminho };
}

/** `host` ou `host:porta`, a forma que `--hostname` do `gh` e do `glab` aceita. */
export const hostComPorta = (e: EnderecoDoRemoto): string => (e.porta ? `${e.host}:${e.porta}` : e.host);
