import { podcastWordBudget, PODCAST_LIMITS, type PodcastBrief, type PodcastHost } from '@scorm/contracts';
import { languageDirective, languageName } from '../generation/prompts.js';

/** Schema JSON delle risposte dell'AI (validate poi con zod). */
/** Idee di puntata: stesso schema di un elenco di puntate (titolo e sintesi). */
export const IDEAS_SCHEMA = {
  type: 'object',
  properties: {
    episodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, summary: { type: 'string' } },
        required: ['title', 'summary'],
      },
    },
  },
  required: ['episodes'],
} as const;

export const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    turns: {
      type: 'array',
      items: {
        type: 'object',
        properties: { host: { type: 'string', enum: ['A', 'B'] }, text: { type: 'string' } },
        required: ['host', 'text'],
      },
    },
  },
  required: ['turns'],
} as const;

const SYSTEM_BASE = [
  'Sei un autore di podcast divulgativi. Scrivi per l\u2019ascolto: tutto ciò che scrivi sarà letto ad alta voce da due conduttori.',
  'Resta fedele alle fonti fornite: non inventare fatti, numeri, nomi, date o citazioni che non vi compaiono. Se le fonti non bastano, resta sul generale o dillo con onestà.',
].join(' ');

const hostLine = (hosts: PodcastHost[]): string =>
  hosts.map((h) => `${h.key} = ${h.name}`).join('; ');

function briefLines(brief: PodcastBrief): string[] {
  return [
    brief.topic ? `Tema della serie: ${brief.topic}` : '',
    brief.audience ? `Pubblico: ${brief.audience}` : '',
    brief.tone ? `Tono: ${brief.tone}` : '',
    brief.objectives.length > 0 ? `Obiettivi:\n- ${brief.objectives.join('\n- ')}` : '',
  ].filter(Boolean);
}

/** Idee per le prossime puntate di una serie già avviata (non crea nulla: l'utente sceglie). */
export function ideasPrompt(input: {
  language: string;
  title: string;
  description: string;
  brief: PodcastBrief;
  hosts: PodcastHost[];
  count: number;
  minutes: number;
  focus?: string;
  /** Titoli delle puntate già presenti: le idee non le ripetono. */
  existing: string[];
  context: string;
}): { system: string; user: string } {
  const system = [
    SYSTEM_BASE,
    'Proponi idee per le prossime puntate di un podcast: ognuna ha un argomento preciso, si distingue dalle altre e interessa il pubblico della serie.',
    'Rispondi SOLO con JSON conforme allo schema.',
  ].join('\n');
  const user = [
    languageDirective(input.language),
    `Titolo del podcast: ${input.title}`,
    input.description ? `Descrizione: ${input.description}` : '',
    ...briefLines(input.brief),
    `Conduttori: ${hostLine(input.hosts)}`,
    input.existing.length > 0 ? `Puntate già pubblicate o in lavorazione (non ripeterle):\n- ${input.existing.join('\n- ')}` : 'La serie non ha ancora puntate.',
    input.focus ? `Orienta le idee su: ${input.focus}` : '',
    `Proponi ESATTAMENTE ${input.count} idee di puntata da circa ${input.minutes} minuti ciascuna.`,
    'Per ogni idea: un titolo breve e accattivante e una sintesi di 2-3 frasi che dice cosa si affronta e con quale taglio.',
    input.context,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system, user };
}

/** Copione di una puntata: dialogo tra i due conduttori. */
export function scriptPrompt(input: {
  language: string;
  title: string;
  brief: PodcastBrief;
  hosts: PodcastHost[];
  episode: { position: number; title: string; summary: string; notes: string; minutes: number };
  previous: Array<{ title: string; summary: string }>;
  context: string;
  /** Se presente: la versione precedente era fuori misura. */
  retry?: { words: number; text: string };
}): { system: string; user: string; budget: ReturnType<typeof podcastWordBudget> } {
  const budget = podcastWordBudget(input.episode.minutes);
  const [a, b] = [input.hosts.find((h) => h.key === 'A')!, input.hosts.find((h) => h.key === 'B')!];
  // La serie cresce una puntata alla volta: non si sa quale sarà l'ultima. Solo la prima presenta la serie.
  const isFirst = input.previous.length === 0;
  const system = [
    SYSTEM_BASE,
    `Scrivi il copione di UNA puntata come dialogo naturale tra due conduttori: ${a.name} (A) e ${b.name} (B), in ${languageName(input.language)}.`,
    'Regole:',
    `- Lunghezza: tra ${budget.min} e ${budget.max} parole in totale, idealmente ${budget.target}. È la regola più importante: la puntata deve durare circa ${input.episode.minutes} minuti.`,
    '- Deve sembrare una conversazione vera tra due persone che si conoscono, non due letture a turno. Ogni conduttore ascolta l\u2019altro e risponde a ciò che ha appena detto, non porta avanti un proprio discorso preparato.',
    `- Ritmo irregolare, come nel parlato reale: alterna battute lunghe (fino a ${Math.floor(PODCAST_LIMITS.maxTurnChars / 3)} caratteri) a battute medie e a reazioni brevissime. Circa una battuta su quattro è una reazione di 1-4 parole di chi ascolta ("Mh.", "Esatto.", "Davvero?", "Ah, certo.", "Eh già.", "Aspetta, in che senso?", "Ok, questa non la sapevo.") inserita come battuta a sé. Non alternare in modo meccanico: lo stesso conduttore può parlare due volte di seguito se l\u2019altro tace.`,
    '- Interruzioni e completamenti: ogni tanto un conduttore interrompe l\u2019altro (la battuta interrotta termina con un trattino lungo "—" e l\u2019altro riprende la frase o la completa) oppure finisce la frase dell\u2019altro. Usa questo trucco con misura, 2-4 volte per puntata.',
    '- Linguaggio parlato, non scritto: frasi spezzate, "Allora", "Beh", "Cioè", "Ecco", "Senza dubbio", "Dai", ripartenze ("No, aspetta, mi correggo"), esitazioni rare e credibili, domande dirette all\u2019altro, un po\u2019 di ironia e d\u2019accordo/disaccordo educato. Contrazioni e forme colloquiali della lingua. Niente frasi da articolo o da manuale.',
    '- Evita i tic dei podcast finti: nessuna lode di rito all\u2019altro ("Bellissima domanda!", "Hai centrato il punto!"), nessun riassunto dopo ogni battuta, nessuna ripetizione a pappagallo di ciò che ha appena detto l\u2019altro, nessun elenco "primo, secondo, terzo" recitato, nessun nome dell\u2019altro in ogni battuta.',
    '- Le due voci hanno personalità diverse: chi spiega e chi fa le domande dello spettatore, ma i ruoli si scambiano. Ogni tanto uno dei due porta un esempio personale o un aneddoto plausibile e generico (senza inventare fatti verificabili).',
    '- Una reazione o una battuta breve non spezza mai una frase a metà in modo innaturale; la punteggiatura (virgole, punti, "…", "—") guida respiro e pause della voce: usala con cura.',
    '- Spiega i concetti con parole semplici e un esempio concreto; evita il gergo non spiegato.',
    '- Se citi un\u2019informazione presa da un articolo, nomina la fonte a voce (es. "secondo un articolo di …").',
    isFirst
      ? '- È la prima puntata della serie: apri con un breve saluto e presenta la serie e i conduttori.'
      : '- Non rifare la presentazione della serie né saluti iniziali lunghi: un saluto breve e si entra nel tema; richiama la puntata precedente solo se serve.',
    '- Chiudi con un breve saluto e un invito a seguire le prossime puntate, senza annunciare contenuti precisi che non conosci.',
    '- Il primo a parlare è A.',
    'Rispondi SOLO con JSON conforme allo schema.',
  ].join('\n');
  const user = [
    languageDirective(input.language),
    `Podcast: ${input.title}`,
    ...briefLines(input.brief),
    `Puntata ${input.episode.position}: ${input.episode.title}`,
    input.episode.summary ? `Taglio della puntata: ${input.episode.summary}` : '',
    input.episode.notes ? `Indicazioni dell'autore (da seguire): ${input.episode.notes}` : '',
    input.previous.length > 0
      ? `Puntate precedenti (non ripeterle):\n${input.previous.map((p) => `- ${p.title}: ${p.summary}`).join('\n')}`
      : '',
    input.context,
    input.retry
      ? `La versione precedente aveva ${input.retry.words} parole: riscrivila in ${budget.target} parole (tra ${budget.min} e ${budget.max}), mantenendo i contenuti.\n${input.retry.text}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system, user, budget };
}
