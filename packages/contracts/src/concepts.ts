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

/** Estrae un titolo breve dall'HTML di un rich_text (heading o prima riga). */
function conceptTitleFromRichText(block: ConceptBlock): string | undefined {
  const payload = block.payload as { content?: { html?: string } } | undefined;
  const html = payload?.content?.html;
  if (!html || typeof html !== 'string') return undefined;
  // Preferisci un heading esplicito.
  const heading = html.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
  const raw = (heading && heading[1]) ? heading[1] : html;
  const text = raw
    .replace(/<[^>]+>/g, ' ') // via i tag
    .replace(/&[a-z]+;/gi, ' ') // entità comuni
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  // Un titolo è breve: tronca a ~80 caratteri senza spezzare brutalmente.
  return text.length > 80 ? text.slice(0, 77).trimEnd() + '…' : text;
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
      current = {
        title: opensConcept(block) ? conceptTitleFromRichText(block) : undefined,
        blocks: [block],
      };
      concepts.push(current);
    } else {
      current.blocks.push(block);
    }
  }

  return concepts;
}
