import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './html-sanitizer.js';

describe('sanitizeHtml', () => {
  it('mantiene i tag di formattazione consentiti', () => {
    const html = '<p>Testo <strong>grassetto</strong> e <em>corsivo</em></p>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('rimuove i tag script e il loro contenuto', () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>');
    expect(out).toContain('<p>ok</p>');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('script');
  });

  it('rimuove gli handler di evento inline', () => {
    const out = sanitizeHtml('<a href="https://x.com" onclick="steal()">link</a>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('href="https://x.com"');
  });

  it('blocca href con schema javascript:', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });

  it('rimuove i tag non in allowlist mantenendo il testo', () => {
    const out = sanitizeHtml('<div><marquee>testo</marquee></div>');
    expect(out).toContain('testo');
    expect(out).not.toContain('marquee');
    expect(out).toContain('<div>');
  });

  it('aggiunge rel sicuro ai link con target _blank', () => {
    const out = sanitizeHtml('<a href="https://x.com" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('rimuove iframe e contenuto', () => {
    const out = sanitizeHtml('<p>a</p><iframe src="evil"></iframe>');
    expect(out).not.toContain('iframe');
    expect(out).toContain('<p>a</p>');
  });

  it('filtra gli attributi non consentiti', () => {
    const out = sanitizeHtml('<p style="x" class="y">t</p>');
    // p non ammette attributi: entrambi rimossi.
    expect(out).toBe('<p>t</p>');
  });
});
