/**
 * Sanitizzazione dell'HTML del rich-text (Requisito 7.1 / 12.3). Previene XSS
 * all'interno dell'LMS rimuovendo tag ed attributi non sicuri tramite un
 * approccio allowlist. Non dipende da un DOM: opera su stringa, in modo
 * deterministico e adatto sia all'editor sia al packaging.
 *
 * Nota: è un sanitizer conservativo pensato per il sottoinsieme di HTML prodotto
 * dai contenuti didattici. Non è un sostituto di una libreria DOM completa per
 * input arbitrari da fonti non fidate di qualunque forma.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre',
  'a', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption', 'sup', 'sub', 'hr',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  span: new Set(['class']),
  div: new Set(['class']),
  code: new Set(['class']),
  th: new Set(['scope']),
  td: new Set(['colspan', 'rowspan']),
};

/** Schemi URL ammessi negli href. */
const SAFE_URL = /^(https?:|mailto:|tel:|#|\/)/i;

export function sanitizeHtml(input: string): string {
  // 1. Rimuove interi blocchi pericolosi (script/style/iframe/… e contenuto).
  let html = input.replace(
    /<\s*(script|style|iframe|object|embed|form|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
    '',
  );
  // Rimuove eventuali tag di apertura orfani degli stessi elementi.
  html = html.replace(/<\s*(script|style|iframe|object|embed|form|svg|math)\b[^>]*>/gi, '');

  // 2. Elabora ogni tag: tiene solo quelli in allowlist e ne filtra gli attributi.
  html = html.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (match, rawName: string, rawAttrs: string) => {
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    const isClosing = match.startsWith('</');
    if (isClosing) return `</${name}>`;
    const attrs = filterAttributes(name, rawAttrs);
    const selfClose = name === 'br' || name === 'hr' ? ' /' : '';
    return `<${name}${attrs}${selfClose}>`;
  });

  return html;
}

function filterAttributes(tag: string, rawAttrs: string): string {
  const allowed = ALLOWED_ATTRS[tag];
  if (!allowed) return '';
  const out: string[] = [];
  const attrRe = /([a-zA-Z0-9-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(rawAttrs)) !== null) {
    const attr = (m[1] ?? '').toLowerCase();
    const value = m[3] ?? m[4] ?? '';
    if (!allowed.has(attr)) continue;
    // Blocca gestori di eventi e valori con javascript:.
    if (attr.startsWith('on')) continue;
    if ((attr === 'href' || attr === 'src') && !SAFE_URL.test(value.trim())) continue;
    out.push(`${attr}="${escapeAttr(value)}"`);
  }
  // Forza rel sicuro sui link che aprono in nuova scheda.
  if (tag === 'a' && /target\s*=\s*["']_blank["']/i.test(rawAttrs)) {
    out.push('rel="noopener noreferrer"');
  }
  return out.length > 0 ? ' ' + out.join(' ') : '';
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
