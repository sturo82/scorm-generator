import { describe, it, expect } from 'vitest';
import { groupBlocksIntoConcepts } from './concepts.js';

const rt = (html: string) => ({ type: 'rich_text', payload: { content: { format: 'html', html } } });
const card = () => ({ type: 'flashcard', payload: { cards: [] } });

describe('groupBlocksIntoConcepts', () => {
  it('un rich_text apre un concetto e i blocchi successivi vi appartengono', () => {
    const concepts = groupBlocksIntoConcepts([
      rt('<h2>Primo concetto</h2>'),
      card(),
      card(),
      rt('<h2>Secondo concetto</h2>'),
      card(),
    ]);
    expect(concepts).toHaveLength(2);
    expect(concepts[0]!.blocks).toHaveLength(3); // rich_text + 2 card
    expect(concepts[1]!.blocks).toHaveLength(2);
  });

  it('deriva il titolo dal primo heading del rich_text e lo RIMUOVE dal corpo', () => {
    const concepts = groupBlocksIntoConcepts([rt('<h2>Che cos\u2019è Git</h2><p>testo</p>')]);
    expect(concepts[0]!.title).toBe('Che cos\u2019è Git');
    // Il blocco di apertura non deve più contenere l'heading (niente doppio titolo).
    const html = (concepts[0]!.blocks[0] as { payload: { content: { html: string } } }).payload.content.html;
    expect(html).not.toContain('<h2>');
    expect(html).toContain('<p>testo</p>');
  });

  it('non altera il blocco originale (copia difensiva)', () => {
    const original = rt('<h2>Titolo</h2><p>x</p>');
    groupBlocksIntoConcepts([original]);
    // L'HTML originale resta intatto.
    expect(original.payload.content.html).toBe('<h2>Titolo</h2><p>x</p>');
  });

  it('se il titolo deriva dalla prima riga (nessun heading) NON rimuove nulla', () => {
    const concepts = groupBlocksIntoConcepts([rt('<p>Solo un paragrafo</p>')]);
    expect(concepts[0]!.title).toBe('Solo un paragrafo');
    const html = (concepts[0]!.blocks[0] as { payload: { content: { html: string } } }).payload.content.html;
    expect(html).toBe('<p>Solo un paragrafo</p>');
  });

  it('apre un concetto implicito se la lezione inizia senza rich_text', () => {
    const concepts = groupBlocksIntoConcepts([card(), card()]);
    expect(concepts).toHaveLength(1);
    expect(concepts[0]!.title).toBeUndefined();
    expect(concepts[0]!.blocks).toHaveLength(2);
  });

  it('ritorna array vuoto senza blocchi', () => {
    expect(groupBlocksIntoConcepts([])).toEqual([]);
    expect(groupBlocksIntoConcepts(undefined)).toEqual([]);
  });

  it('tronca titoli lunghi', () => {
    const long = 'A'.repeat(120);
    const concepts = groupBlocksIntoConcepts([rt(`<p>${long}</p>`)]);
    expect(concepts[0]!.title!.length).toBeLessThanOrEqual(80);
    expect(concepts[0]!.title!.endsWith('\u2026')).toBe(true);
  });
});
