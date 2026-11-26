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
    // Scaletta della discussione, scritta prima delle battute: aiuta a non fare un elenco di spiegazioni.
    beats: { type: 'array', items: { type: 'string' } },
    turns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          host: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
          text: { type: 'string' },
          overlap: { type: 'string', enum: ['cut_in', 'reaction', 'over'] },
          mood: { type: 'string', enum: ['excited', 'amused', 'surprised', 'sarcastic', 'warm', 'serious', 'calm', 'frustrated', 'thoughtful'] },
        },
        required: ['host', 'text'],
      },
    },
  },
  required: ['beats', 'turns'],
} as const;
const SYSTEM_BASE = [
  'Sei un autore di podcast divulgativi. Scrivi per l\u2019ascolto: tutto ciò che scrivi sarà letto ad alta voce da due conduttori.',
  'Resta fedele alle fonti fornite: non inventare fatti, numeri, nomi, date o citazioni che non vi compaiono. Se le fonti non bastano, resta sul generale o dillo con onestà.',
].join(' ');

const hostLine = (hosts: PodcastHost[]): string =>
  hosts.map((h) => `${h.key} = ${h.name}`).join('; ');

/** Scheda di un partecipante per il copione: chi è e come parla. */
function personaLines(hosts: PodcastHost[]): string[] {
  return hosts.map((h) => {
    const p = h.persona;
    const parts = [
      p?.role ? `ruolo: ${p.role}` : '',
      p?.background ? `chi è: ${p.background}` : '',
      p?.personality ? `carattere: ${p.personality}` : '',
      p?.speech ? `modo di parlare: ${p.speech}` : '',
    ].filter(Boolean);
    return `- ${h.name} (${h.key})${parts.length > 0 ? `: ${parts.join('; ')}` : ': nessuna indicazione, dagli un carattere tuo, coerente e diverso dagli altri'}`;
  });
}

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

/** Copione di una puntata: un monologo (un solo partecipante) o una discussione vera (da due in su). */
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
  const hosts = input.hosts;
  const solo = hosts.length === 1;
  const names = hosts.map((h) => `${h.name} (${h.key})`).join(', ');
  // La serie cresce una puntata alla volta: non si sa quale sarà l'ultima. Solo la prima presenta la serie.
  const isFirst = input.previous.length === 0;
  const common = [
    `- Lunghezza: tra ${budget.min} e ${budget.max} parole in totale, idealmente ${budget.target}. È la regola più importante: la puntata deve durare circa ${input.episode.minutes} minuti.`,
    '- Solo parlato: niente markdown, elenchi, simboli, emoji, indicazioni di scena tra parentesi, né riferimenti a elementi visivi.',
    '- Se citi un\u2019informazione presa da un articolo, nomina la fonte a voce (es. "secondo un articolo di …").',
    isFirst
      ? '- È la prima puntata della serie: apri con un breve saluto e presenta la serie e i partecipanti, in modo naturale, non da elenco.'
      : '- Non rifare la presentazione della serie né saluti iniziali lunghi: un saluto breve e si entra nel tema; richiama la puntata precedente solo se serve.',
    '- Chiudi con un breve saluto e un invito a seguire le prossime puntate, senza annunciare contenuti precisi che non conosci.',
    `- Il primo a parlare è ${hosts[0]!.key}.`,
    '- Prima delle battute scrivi "beats": la scaletta di 5-8 punti della puntata (vedi sotto). Poi scrivi "turns".',
    'Rispondi SOLO con JSON conforme allo schema.',
  ];
  const system = solo
    ? [
        SYSTEM_BASE,
        `Scrivi il copione di UNA puntata di un podcast raccontata da una sola voce, ${hosts[0]!.name}, in ${languageName(input.language)}.`,
        'Regole:',
        ...common,
        '- È un monologo parlato: ritmo vario, frasi brevi e frasi più lunghe, domande retoriche rivolte a chi ascolta, esempi concreti, un po\u2019 di ironia dove ci sta. Niente tono da lezione o da articolo.',
        '- Tutte le battute hanno host uguale al partecipante; spezza il discorso in paragrafi parlati (battute di 2-5 frasi). Non usare "overlap".',
        '- "beats": i passaggi della puntata (apertura, tesi, esempi, obiezione e risposta, conclusione).',
        ...personaLines(hosts),
      ].join('\n')
    : [
        SYSTEM_BASE,
        `Scrivi il copione di UNA puntata di un podcast in cui discutono ${hosts.length} persone: ${names}, in ${languageName(input.language)}.`,
        'NON è una spiegazione a turni. È una DISCUSSIONE su un argomento, tra persone con caratteri e opinioni diverse che si ascoltano, si contraddicono e si interrompono.',
        'Partecipanti (rispetta ruolo, storia, carattere e modo di parlare di ciascuno, e fai sentire la differenza tra le voci):',
        ...personaLines(hosts),
        'Regole:',
        ...common,
        '- "beats": prima di scrivere, pianifica la discussione come una scaletta di 5-8 punti: per ciascuno chi lo introduce, chi non è d\u2019accordo o aggiunge una sfumatura, dove c\u2019è una divagazione, un aneddoto, una battuta, un cambio di direzione. La discussione NON procede in linea retta: ci sono deviazioni, ritorni, correzioni ("no, aspetta, non è proprio così"), punti su cui restano in disaccordo.',
        '- Ogni partecipante porta il proprio punto di vista, in base a ciò che è (studi, esperienza, carattere). Nessuno fa da spalla che dice solo "interessante": ognuno ha opinioni, dubbi, esempi suoi. Chi sa di più su un punto lo spiega, ma gli altri lo mettono in discussione o lo riportano su esempi concreti.',
        '- I contenuti delle fonti emergono dalla conversazione (qualcuno cita un dato, un altro obietta, un terzo lo applica a un caso), non come lezione a puntate. Mai due battute lunghe di spiegazione di fila.',
        `- Ritmo da conversazione vera: battute di lunghezza molto diversa. Molte brevi (1-2 frasi), qualcuna media, rare le lunghe (fino a ${Math.floor(PODCAST_LIMITS.maxTurnChars / 3)} caratteri). Chi parla non segue un turno fisso: uno può intervenire due volte di seguito, un altro restare in silenzio per un po\u2019. Con più di due persone, tutti intervengono in modo non ordinato.`,
        '- Sovrapposizioni: usa il campo "overlap" di una battuta per dire come si innesta sulla precedente. "cut_in": interrompe l\u2019altro (la battuta INTERROTTA, quella precedente, deve finire a metà frase con un trattino lungo "—" e senza punto finale; poi chi interrompe parla). "reaction": breve reazione di 1-4 parole di chi ascolta ("Mh.", "Esatto.", "Davvero?", "Ah, certo.") mentre l\u2019altro sta ancora parlando. "over": si parlano sopra un momento, per entusiasmo o battibecco (battuta breve e vivace). Usali con naturalezza: 1 battuta su 5 circa ha un overlap; le reazioni sono le più frequenti, le interruzioni 3-6 per puntata. Le altre battute non hanno "overlap".',
        '- Tono: usa il campo "mood" (excited, amused, surprised, sarcastic, warm, serious, calm, frustrated, thoughtful) sulle battute dove il tono cambia in modo evidente: non su tutte, circa una su quattro, coerente con il carattere di chi parla.',
        '- Linguaggio parlato, non scritto: frasi spezzate, "Allora", "Beh", "Cioè", "Ecco", ripartenze ("No, aspetta, mi correggo"), esitazioni rare e credibili, domande dirette, ironia, accordi e disaccordi educati ma veri. Ognuno ha i suoi intercalari: non farli parlare tutti nello stesso modo.',
        '- Evita i tic dei podcast finti: nessuna lode di rito ("Bellissima domanda!", "Hai centrato il punto!"), nessun riassunto dopo ogni battuta, nessuna ripetizione a pappagallo di ciò che ha appena detto l\u2019altro, nessun elenco "primo, secondo, terzo" recitato, nessun nome dell\u2019altro in ogni battuta.',
        '- La punteggiatura (virgole, punti, "…", "—") guida respiro e pause della voce: usala con cura. Mai una battuta spezzata a metà senza motivo.',
      ].join('\n');
  const user = [
    languageDirective(input.language),
    `Podcast: ${input.title}`,
    ...briefLines(input.brief),
    `Partecipanti: ${hostLine(hosts)}`,
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
