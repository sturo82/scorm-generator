/**
 * Raggruppamento dei blocchi di una lezione in "concetti" (Blocco H, scelta A2).
 *
 * La fruizione moderna presenta un concetto alla volta invece di un lungo
 * elenco scrollabile. Un "concetto" è un gruppo coeso di blocchi: tipicamente
 * un testo esplicativo seguito dalle interazioni che lo accompagnano
 * (immagine/flashcard/quiz, ecc.).
 *
 * EURISTICA (nessuna modifica al modello dati, nessuna rigenerazione dei corsi):
 *  - un blocco `rich_text` apre un NUOVO concetto;
 *  - i blocchi successivi (non rich_text) appartengono al concetto corrente;
 *  - se la lezione inizia con blocchi non-rich_text, si apre un concetto
 *    implicito iniziale;
 *  - il titolo del concetto, se disponibile, è derivato dal primo heading
 *    (h1-h4) o dalla prima riga del rich_text di apertura.
 *
 * È volutamente type-light (lavora su { type, payload }) così da essere usata
 * sia lato server (Block tipati) sia nel runtime del player (JSON semplice).
 */

export interface ConceptBlock {
  type: string;
  payload?: unknown;
  [k: string]: unknown;
}

export interface Concept {
  /** Titolo del concetto, se derivabile dal testo di apertura. */
  title?: string;
  /** Blocchi che compongono il concetto, nell'ordine originale. */
  blocks: ConceptBlock[];
}

/** True se il blocco apre un nuovo concetto (testo esplicativo). */
function opensConcept(block: ConceptBlock): boolean {
  return block.type === 'rich_text';
}

/** Normalizza il testo visibile di un frammento HTML (via tag/entità/spazi). */
function plainText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tronca un titolo a ~80 caratteri senza spezzare brutalmente. */
function shortTitle(text: string): string {
  return text.length > 80 ? text.slice(0, 77).trimEnd() + '…' : text;
}

/**
 * Analizza l'HTML di apertura di un rich_text per derivarne il titolo del
 * concetto. Se il titolo proviene da un heading INIZIALE (h1-h4), ritorna anche
 * l'HTML con quel heading RIMOSSO: così il player/anteprima può mostrare il
 * titolo del concetto senza che lo stesso heading compaia di nuovo nel corpo
 * del blocco (altrimenti si vedrebbe due volte).
 */
function analyzeOpeningRichText(block: ConceptBlock): { title?: string; strippedHtml?: string } {
  const payload = block.payload as { content?: { html?: string } } | undefined;
  const html = payload?.content?.html;
  if (!html || typeof html !== 'string') return {};
  // Heading in TESTA al contenuto (eventuale whitespace iniziale): è quello che
  // il player promuove a titolo del concetto, quindi va tolto dal corpo.
  const leading = html.match(/^\s*<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
  if (leading && leading[1]) {
    const title = plainText(leading[1]);
    if (title) {
      return { title: shortTitle(title), strippedHtml: html.slice(leading[0].length) };
    }
  }
  // Nessun heading iniziale: deriva un titolo dalla prima riga, SENZA rimuovere
  // nulla dal corpo (non è un heading duplicato).
  const text = plainText(html);
  return text ? { title: shortTitle(text) } : {};
}

/**
 * Ritorna una COPIA superficiale del blocco rich_text con l'HTML del contenuto
 * sostituito (payload.content.html). Usata per rimuovere l'heading iniziale già
 * promosso a titolo del concetto, senza alterare il blocco originale.
 */
function withStrippedHtml(block: ConceptBlock, html: string): ConceptBlock {
  const payload = (block.payload ?? {}) as { content?: { html?: string } };
  const content = (payload.content ?? {}) as { html?: string };
  return {
    ...block,
    payload: { ...payload, content: { ...content, html } },
  };
}

/**
 * Raggruppa i blocchi di una lezione in concetti secondo l'euristica A2.
 * Ritorna sempre almeno un concetto se ci sono blocchi; array vuoto se non ce
 * ne sono.
 */
export function groupBlocksIntoConcepts(blocks: ConceptBlock[] | undefined | null): Concept[] {
  const list = Array.isArray(blocks) ? blocks : [];
  const concepts: Concept[] = [];
  let current: Concept | null = null;

  for (const block of list) {
    if (opensConcept(block) || current === null) {
      // Nuovo concetto: su un rich_text, o all'inizio se partiamo da non-testo.
      if (opensConcept(block)) {
        const { title, strippedHtml } = analyzeOpeningRichText(block);
        // Se il titolo proviene da un heading iniziale, usa una COPIA del blocco
        // senza quel heading (così non appare due volte: titolo + corpo). Non
        // mutiamo mai il blocco originale.
        const openingBlock =
          strippedHtml !== undefined ? withStrippedHtml(block, strippedHtml) : block;
        current = { title, blocks: [openingBlock] };
      } else {
        current = { title: undefined, blocks: [block] };
      }
      concepts.push(current);
    } else {
      current.blocks.push(block);
    }
  }

  return concepts;
}
