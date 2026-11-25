import { podcastWordBudget, PODCAST_LIMITS, type PodcastBrief, type PodcastHost } from '@scorm/contracts';
import { languageDirective, languageName } from '../generation/prompts.js';

/** Schema JSON delle risposte dell'AI (validate poi con zod). */
export const PLAN_SCHEMA = {
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
    `Tema della serie: ${brief.topic}`,
    brief.audience ? `Pubblico: ${brief.audience}` : '',
    brief.tone ? `Tono: ${brief.tone}` : '',
    brief.objectives.length > 0 ? `Obiettivi:\n- ${brief.objectives.join('\n- ')}` : '',
  ].filter(Boolean);
}

/** Piano della serie: titolo e taglio di ogni puntata. */
export function planPrompt(input: {
  language: string;
  title: string;
  brief: PodcastBrief;
  hosts: PodcastHost[];
  episodeCount: number;
  minutes: number;
  context: string;
}): { system: string; user: string } {
  const system = [
    SYSTEM_BASE,
    'Pianifichi una serie di puntate: ognuna ha un argomento preciso, le puntate si completano senza ripetersi e hanno un ordine sensato (dalle basi ai temi più specifici).',
    'Rispondi SOLO con JSON conforme allo schema.',
  ].join('\n');
  const user = [
    languageDirective(input.language),
    `Titolo del podcast: ${input.title}`,
    ...briefLines(input.brief),
    `Conduttori: ${hostLine(input.hosts)}`,
    `Pianifica ESATTAMENTE ${input.episodeCount} puntate da circa ${input.minutes} minuti ciascuna.`,
    'Per ogni puntata: un titolo breve e accattivante e una sintesi di 2-3 frasi che dice cosa si affronta e con quale taglio.',
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
  episode: { position: number; total: number; title: string; summary: string; minutes: number };
  previous: Array<{ title: string; summary: string }>;
  context: string;
  /** Se presente: la versione precedente era fuori misura. */
  retry?: { words: number; text: string };
}): { system: string; user: string; budget: ReturnType<typeof podcastWordBudget> } {
  const budget = podcastWordBudget(input.episode.minutes);
  const [a, b] = [input.hosts.find((h) => h.key === 'A')!, input.hosts.find((h) => h.key === 'B')!];
  const isFirst = input.episode.position === 1;
  const isLast = input.episode.position === input.episode.total;
  const system = [
    SYSTEM_BASE,
    `Scrivi il copione di UNA puntata come dialogo naturale tra due conduttori: ${a.name} (A) e ${b.name} (B), in ${languageName(input.language)}.`,
    'Regole:',
    `- Lunghezza: tra ${budget.min} e ${budget.max} parole in totale, idealmente ${budget.target}. È la regola più importante: la puntata deve durare circa ${input.episode.minutes} minuti.`,
    `- Battute brevi e vere, come in una conversazione: di norma 1-3 frasi (10-40 parole), mai oltre ${Math.floor(PODCAST_LIMITS.maxTurnChars / 2)} caratteri. Alterna spesso i due conduttori; ogni tanto uno reagisce con una battuta breve, chiede, riassume o fa un esempio. Evita monologhi lunghi.`,
    '- Solo parlato: niente markdown, elenchi, simboli, emoji, indicazioni di scena tra parentesi, né riferimenti a elementi visivi.',
    '- Spiega i concetti con parole semplici e un esempio concreto; evita il gergo non spiegato.',
    '- Se citi un\u2019informazione presa da un articolo, nomina la fonte a voce (es. "secondo un articolo di …").',
    isFirst
      ? '- È la prima puntata: apri con un breve saluto e presenta la serie e i conduttori.'
      : '- Non rifare presentazioni né saluti iniziali lunghi: richiama in una frase la puntata precedente solo se serve.',
    isLast
      ? '- È l\u2019ultima puntata della serie: chiudi con una sintesi della serie e un saluto finale.'
      : '- Chiudi con un\u2019anticipazione breve della prossima puntata, senza salutare per sempre.',
    '- Il primo a parlare è A.',
    'Rispondi SOLO con JSON conforme allo schema.',
  ].join('\n');
  const user = [
    languageDirective(input.language),
    `Podcast: ${input.title}`,
    ...briefLines(input.brief),
    `Puntata ${input.episode.position} di ${input.episode.total}: ${input.episode.title}`,
    `Taglio della puntata: ${input.episode.summary}`,
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
