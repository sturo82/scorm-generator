import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Protezione anti-SSRF per il fetch di URL forniti dall'utente (feed RSS e
 * pagine articolo). Valida lo schema (solo http/https) e, risolvendo il
 * hostname, blocca gli indirizzi non instradabili pubblicamente: loopback,
 * reti private (RFC1918), link-local, CGNAT, multicast e l'endpoint di metadata
 * cloud (169.254.169.254). Pensata per essere chiamata PRIMA di ogni fetch.
 *
 * Nota: questo riduce drasticamente il rischio SSRF ma non elimina i TOCTOU
 * (DNS rebinding tra il check e la connessione). Per il nostro caso d'uso
 * (import occasionale di feed pubblici) è un compromesso accettabile; un
 * hardening ulteriore richiederebbe un agent HTTP che validi l'IP alla connect.
 */

/** Errore sollevato quando un URL è rifiutato dai controlli anti-SSRF. */
export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

/** True se l'IPv4 (stringa) ricade in un range privato/non pubblico. */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // malformato → blocca per prudenza
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 0) return true; // "this host"
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local + metadata 169.254.169.254
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast/riservati 224.0.0.0+
  return false;
}

/** True se l'IPv6 (stringa) è loopback, link-local, ULA o IPv4-mapped privato. */
function isPrivateIpv6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true; // loopback / unspecified
  if (s.startsWith('fe80')) return true; // link-local
  if (s.startsWith('fc') || s.startsWith('fd')) return true; // ULA fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d): valuta la parte IPv4.
  const m = /::ffff:(\d+\.\d+\.\d+\.\d+)/.exec(s);
  if (m) return isPrivateIpv4(m[1]!);
  return false;
}

function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateIpv4(ip);
  if (v === 6) return isPrivateIpv6(ip);
  return true; // non è un IP valido → blocca
}

/**
 * Valida un URL per il fetch sicuro. Lancia BlockedUrlError se lo schema non è
 * http/https o se l'host risolve (anche) a un indirizzo non pubblico. Ritorna
 * l'oggetto URL normalizzato.
 */
export async function assertSafeUrl(
  rawUrl: string,
  resolver: (host: string) => Promise<string[]> = defaultResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError('URL non valido');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(`Schema non consentito: ${url.protocol} (usa http/https)`);
  }
  const host = url.hostname;
  // Blocca forme ovvie prima ancora della risoluzione DNS.
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new BlockedUrlError('Host non consentito');
  }
  // Se l'host è già un IP, validalo direttamente.
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new BlockedUrlError('Indirizzo IP non consentito (rete privata/loopback)');
    return url;
  }
  // Altrimenti risolvi il DNS e verifica TUTTI gli indirizzi restituiti.
  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    throw new BlockedUrlError('Host non risolvibile');
  }
  if (addresses.length === 0) throw new BlockedUrlError('Host non risolvibile');
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new BlockedUrlError('Host risolve a un indirizzo non pubblico');
    }
  }
  return url;
}

/** Risolve tutti gli IP (v4+v6) di un host. */
async function defaultResolver(host: string): Promise<string[]> {
  const res = await lookup(host, { all: true });
  return res.map((r) => r.address);
}
