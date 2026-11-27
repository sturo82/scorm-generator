import { podcastWordBudget, type PodcastBrief, type PodcastHost } from '@scorm/contracts';
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
          mood: { type: 'string', enum: ['excited', 'amused', 'surprised', 'sarcastic', 'warm', 'serious', 'calm', 'frustrated', 'thoughtful', 'laughing', 'shouting', 'scoffing'] },
          energy: { type: 'integer', minimum: 1, maximum: 5 },
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

/**
 * Linee guida di scrittura per testi letti da una voce sintetica: valgono per ogni puntata, da solisti o in gruppo.
 */
const TTS_STYLE_RULES = [
  'REGISTRO E FORMA (il testo sarà letto da una voce sintetica):',
  '- Scrivi per l\u2019ascolto, non per la lettura: deve suonare come una conversazione reale, spontanea, brillante, dal ritmo serrato.',
  '- Linguaggio colloquiale, diretto e moderno, SENZA parolacce, volgarità o espressioni offensive: l\u2019incisività viene dal ritmo e dalla scelta delle parole, non dal turpiloquio.',
  '- Zero tono didattico o giornalistico: niente costruzioni formali o da comunicato ("In conclusione", "Da un lato… dall\u2019altro", "È importante sottolineare che", "Inoltre", "Pertanto").',
  '- Attacchi conversazionali reali all\u2019inizio delle battute: "Cioè", "Aspetta", "Guarda che", "Ma in che senso?", "Sì, però", "Vabbè", "Alla fine", "Tipo", "Il punto è che".',
  '- Forme quotidiane e contratte: "sta cosa" invece di "questa cosa", "un po\u2019", "perché poi", "fatto sta che".',
  '- Riformulazione in corsa: il pensiero si forma mentre si parla e una costruzione si interrompe per chiarirsi subito dopo ("Il vero problema oggi - ma proprio a livello strutturale dico - è che…").',
  '- La punteggiatura è regia della voce, non grammatica. Pochi punti fermi (il punto abbassa il tono e rende la lettura robotica e cadenzata): concatena i concetti con virgole e congiunzioni ("e quindi", "ma poi", "cioè"). Il trattino " - " serve per incisi rapidi, cambi di direzione o frasi troncate. I puntini "..." con parsimonia, solo per una breve esitazione mentre si cerca la parola o prima di una battuta a effetto.',
  '- Numeri, sigle e parole straniere complesse si scrivono per esteso come si pronunciano in italiano (es. "duemilaventisei", "il trenta per cento", "intelligenza artificiale" invece di "AI", "gi-pi-ti" per "GPT"), per evitare errori di lettura.',
  '- Mai elenchi puntati né strutture simmetriche dentro le battute; mai la stessa struttura sintattica per più di due frasi di seguito.',
  '- Mai didascalie teatrali o indicazioni di scena tra parentesi ([ride], [pausa], (sospira)): le risate e le pause si fanno con le parole e la punteggiatura.',
];

/**
 * Coerenza con il comportamento di una persona vera: ogni risata, esitazione, reazione o interruzione deve avere un motivo,
 * nel contesto e nel carattere di chi la fa.
 */
const REALISM_RULES = [
  'COERENZA CON LA REALTÀ (ogni tic, risata o reazione ha un motivo, come farebbe una persona vera con quel carattere):',
  '- Una risata nasce da qualcosa di davvero divertente appena detto (una battuta, un\u2019assurdità, una figuraccia, un paragone azzeccato) e la fa chi lo trova divertente, secondo il suo carattere: chi è serio ride poco, chi ride facilmente ride di più. Mai una risata "di punteggiatura", mai dopo frasi che non fanno ridere, mai due risate vicine. Al massimo una risata ogni 10-12 battute (una ogni 6 nello stile scatenato).',
  '- Esitazioni e riempitivi ("ehm", "cioè", "boh", "mah", "allora") compaiono dove una persona vera esita davvero: quando cerca una parola, quando una domanda la coglie impreparata, quando cambia idea, quando parla di qualcosa che conosce poco, quando è messa alle strette. Chi è esperto di un punto lo spiega con scioltezza, senza balbettare; chi non lo conosce esita. Mai sparsi a caso né in ogni battuta.',
  '- Ogni persona ha uno o due intercalari suoi (uno dice "praticamente", un\u2019altra "cioè", un altro "guarda") e li usa con coerenza; gli altri non li copiano.',
  '- Le reazioni rispondono a ciò che è stato appena detto: "Davvero?" solo davanti a una cosa sorprendente, "Esatto" solo se si è d\u2019accordo, "Mh" per prendere atto, "Boh" per un dubbio. Non si reagisce a ogni frase: chi ascolta spesso tace. Le reazioni di uno scettico sono scettiche, quelle di un entusiasta entusiaste.',
  '- Le interruzioni hanno una ragione: disaccordo, impazienza, la risposta già in mente, una correzione. Una persona pacata o educata interrompe di rado, una impulsiva spesso. Chi viene interrotto reagisce secondo il suo carattere (cede, protesta, riprende il filo).',
  '- Il tono segue ciò che si dice e ciò che è successo prima: nessun cambio di umore senza motivo; le emozioni si mostrano nel modo di parlare, non si dichiarano ("sono entusiasta").',
  '- Le persone vere non spiegano tutto, lasciano cose sottintese, non si fanno complimenti di rito, non ripetono i nomi.',
  '- Prima di consegnare, rileggi ogni risata, esitazione e reazione e chiediti: "una persona vera, con QUEL carattere, qui lo farebbe?". Se no, toglila o cambiala.',
];

/**
 * Ritmo e umore della conversazione: l'energia sale e scende con ciò che succede, e si trasmette da una persona all'altra.
 */
const RHYTHM_RULES = [
  'RITMO E UMORE (campo "energy" da 1 a 5 su OGNI battuta: 1 = disteso, riflessivo, lento; 3 = normale; 5 = concitato, veloce, acceso):',
  '- L\u2019energia NON è costante: segue lo stato d\u2019animo della conversazione. Sale quando si discute, ci si scalda o si ride; scende dopo una risata che si spegne, un momento serio, una riflessione, una domanda difficile.',
  '- È contagiosa: chi risponde a una battuta ad alta energia tende a salire anche lui (di 1 o 2 punti), a meno che il suo carattere non lo porti a frenare per contrasto (lo scettico pacato che resta freddo davanti all\u2019entusiasmo degli altri). Dopo un picco l\u2019energia scende gradualmente, non di colpo.',
  '- Non cambiare di più di 2 punti tra una battuta e la successiva, salvo un evento vero (una notizia sorprendente, uno scherzo che scatena tutti).',
  '- La puntata ha un arco: apertura media, picchi nei punti di disaccordo o di divertimento, momenti calmi di riflessione, chiusura che scende o si chiude con una battuta alta. Usa tutta la scala da 1 a 5: la serie dei valori deve salire e scendere a ondate di 5-10 battute (per esempio 3 3 3 4 4 5 5 4 3 3 2 2 3 3 4 …), NON restare fissa attorno al 3 e NON dipendere da chi parla: è l\u2019umore della conversazione, non il carattere della persona.',
  '- Con energia alta le battute sono più corte e spezzate e le interruzioni più frequenti; con energia bassa le battute sono più distese, con pause e frasi più lunghe.',
];

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

/** Regole di ritmo e registro secondo l'energia scelta per il podcast. */
function energyRules(energy: PodcastBrief['energy']): string[] {
  if (energy === 'relaxed') {
    return [
      'ENERGIA: pacata, da approfondimento tra persone che si ascoltano. Battute un po\u2019 più distese (6-25 parole), meno interruzioni (una battuta su otto con overlap), pause naturali, qualche battuta ma senza gridare.',
    ];
  }
  if (energy === 'wild') {
    return [
      'ENERGIA: SCATENATA, ritmo da talk show tra amici che si sfottono (stile podcast comico italiano). Si va VELOCISSIMI. Queste regole prevalgono su quelle di ritmo scritte sopra:',
      '- Battute brevissime: media 4-8 parole, spesso una sola parola o un\u2019esclamazione ("No!", "Vabbè.", "Ma dai!", "Assurdo!", "Eh, certo."). Rarissime le battute oltre 20 parole.',
      '- Botta e risposta serrato: ci si interrompe di continuo, si finiscono le frasi a vicenda, si risponde prima che l\u2019altro finisca. Almeno UNA battuta su due ha un overlap (molte "reaction" e "cut_in", diverse "over").',
      '- Si sfottono con affetto (roast): prese in giro sui difetti, sulle manie, sulle figuracce di ciascuno; esagerazioni, iperboli, paragoni assurdi, tormentoni che tornano, aneddoti improbabili, finti litigi. Chi viene preso in giro si difende e rilancia.',
      '- Risate, urla di entusiasmo, scandalo finto, usa "laughing", "shouting", "sarcastic", "scoffing", "excited" su circa una battuta su tre, dove il tono cambia davvero (non sulle reazioni di una parola). Risate scritte "ah ah ah", "ahahah".',
      '- Cambi di argomento continui e divagazioni, poi si torna al tema ("vabbè, dicevamo").',
      '- Registro popolare e irriverente ma SENZA parolacce né volgarità: sfottò, ironia, slang, esclamazioni. L\u2019incisività viene dal ritmo e dalla scelta delle parole.',
    ];
  }
  return [];
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
    solo
      ? isFirst
        ? '- È la prima puntata della serie: apri con un breve saluto e presenta la serie, in modo naturale.'
        : '- Non rifare la presentazione della serie né saluti iniziali lunghi: un saluto breve e si entra nel tema; richiama la puntata precedente solo se serve.'
      : isFirst
        ? '- È la prima puntata della serie: chi ascolta capisce chi sono i partecipanti e di cosa parla il podcast strada facendo, tra battute e saluti, senza presentazioni formali.'
        : '- Non è la prima puntata: un saluto veloce e si entra nel tema; richiama la puntata precedente solo se serve.',
    solo
      ? '- Chiudi con un breve saluto e un invito a seguire le prossime puntate, senza annunciare contenuti precisi che non conosci.'
      : '- Chiudi senza riassumere: una battuta, un saluto affrettato e un invito a seguire il podcast, senza annunciare contenuti precisi che non conosci.',
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
        ...TTS_STYLE_RULES,
        ...REALISM_RULES,
        ...personaLines(hosts),
      ].join('\n')
    : [
        SYSTEM_BASE,
        `Scrivi la TRASCRIZIONE di UNA puntata di un podcast in cui chiacchierano ${hosts.length} persone: ${names}, in ${languageName(input.language)}.`,
        'NON è un copione pulito e NON è una spiegazione a turni. È la trascrizione di una conversazione registrata dal vivo tra persone che si conoscono, che parlano a ruota libera di un argomento: si sovrappongono, si perdono, ridono, tornano indietro. Deve sembrare DAVVERO parlato, con le imperfezioni naturali del discorso improvvisato (ma il linguaggio resta pulito, senza parolacce), non scritto da un autore.',
        'Partecipanti (rispetta ruolo, storia, carattere e modo di parlare di ciascuno; si deve sentire chi è chi anche senza leggere il nome):',
        ...personaLines(hosts),
        'Regole:',
        ...common,
        '- "beats": scaletta di 5-8 punti, ma la conversazione NON la segue in modo ordinato: ci sono deviazioni, ritorni ("dicevo…"), un punto che resta in sospeso, una battuta che porta fuori strada, un disaccordo non risolto. Chi sa di più su un punto ne parla, ma gli altri lo interrompono, lo mettono in dubbio o lo trascinano su un esempio loro.',
        '- I fatti e i dati delle fonti restano CORRETTI e non inventati: ciò che è sporco è la forma, non il contenuto. Emergono a pezzi dentro la conversazione (uno cita, un altro obietta, un terzo lo applica a un caso), mai come lezione.',
        '',
        ...TTS_STYLE_RULES,
        '',
        ...REALISM_RULES,
        '',
        ...RHYTHM_RULES,
        '',
        'FORMA DEL DIALOGO (la parte più importante):',
        '- Turni brevi (micro-dialogo): al massimo 1-3 frasi per battuta. La maggior parte ha 2-14 parole, qualcuna 15-30, raramente di più. Un\u2019esposizione si spezza in più battute con interventi in mezzo.',
        '- Frasi lasciate a metà o finite da un altro: "Cioè il punto è che se tu—" / "—lo deleghi, sì, e poi non sai più chi ha deciso." Chi viene interrotto si ferma con un trattino lungo "—" senza punto.',
        '- Falsi inizi, ripetizioni e ripensamenti: "è… è un po\u2019 come, no, aspetta, non è come, è che…", "Cioè, cioè, io dico", "No ma, no, nel senso—".',
        '- Intercalari e riempitivi veri, diversi per persona: "cioè", "tipo", "praticamente", "boh", "eh", "mah", "ehm", "mmh", "insomma", "diciamo", "dai", "figurati", "no?", "capito?", "senti", "guarda", "allora", "ecco". Non tutti nella stessa battuta, non sempre.',
        '- Verso e rumore: risate scritte come "ah ah", "ahah", sospiri come "eh…", "mmh", "uff", un "oh!" o un "ah!" di sorpresa. Mai tra parentesi, mai descrizioni di scena.',
        '- Reazioni brevissime degli altri mentre uno parla ("mh", "eh sì", "ma va", "davvero?", "ah ecco", "esatto", "boh") con overlap "reaction". Anche a metà di un pensiero lungo: spezza la battuta lunga, metti la reazione in mezzo e fai continuare chi parlava (stessa persona, battuta successiva, che riprende senza ricominciare).',
        '- Si parla sopra, si anticipa la parola dell\u2019altro, si risponde a una domanda con un\u2019altra domanda, si cambia discorso a metà e si torna indietro: "scusate, divago, comunque—".',
        '- Registro colloquiale e a volte scorretto come nel parlato: "c\u2019è un sacco di gente che…", "che poi", "e niente", "sta cosa", "ma no dai", "figurati", frasi senza verbo, soggetti ripetuti. Niente subordinate lunghe e perfette, niente "Inoltre", "Pertanto", "In conclusione", niente elenchi ordinati.',
        '- Niente apertura da presentatore ("Benvenuti alla puntata di oggi in cui parleremo di…"): si entra già dentro, con un saluto veloce e una battuta, e il tema emerge. Niente chiusura riassuntiva: si chiude con una battuta, un saluto affrettato, magari tagliato.',
        '- Il tono cambia: chi si scalda accelera e accorcia le frasi, chi è scettico sbuffa, chi ride perde il filo. Usa il campo "mood" (excited, amused, surprised, sarcastic, warm, serious, calm, frustrated, thoughtful) su circa una battuta su tre, dove il tono cambia in modo evidente, coerente con il carattere.',
        '',
        ...energyRules(input.brief.energy),
        '',
        'SOVRAPPOSIZIONI (campo "overlap" di una battuta, rispetto alla precedente di un\u2019altra persona):',
        '- "cut_in": interrompe (la battuta PRECEDENTE deve finire a metà frase con "—", senza punto).',
        '- "reaction": brevissima reazione (1-4 parole) sopra le ultime parole dell\u2019altro.',
        '- "over": si parlano sopra per un momento (entusiasmo, battibecco, risata comune), battuta breve e viva.',
        '- Almeno UNA battuta su tre ha un overlap: tante reazioni, parecchie interruzioni (almeno 8 in una puntata di 10 minuti), qualche "over". Le battute dello stesso parlante di seguito non hanno overlap.',
        '',
        'ESEMPIO DI REGISTRO (solo come stile; l\u2019argomento è un altro e non va copiato):',
        'A: Allora, ehm, ma voi l\u2019avete provato, sì? Quello nuovo.',
        'B (reaction): Mmh.',
        'A: No perché io tipo l\u2019ho aperto e—',
        'C (cut_in): —e hai chiuso dopo due minuti, ah ah, lo so, ti conosco.',
        'A (over): Ma no! Cioè, sì, ma non è quello, è che—',
        'B: Boh, a me non è dispiaciuto, eh. Cioè, non è che…',
        'B: …non lo so, mi sembra uno di quei casi in cui, praticamente, fa tutto lui.',
        'C (reaction): Eh.',
        'B: E tu dici "ok", e intanto non capisci più chi—',
        'A (cut_in): Ecco, quello! Quello è il punto, no?',
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

/** Risposta del controllo di realismo: le battute riviste. */
export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    turns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          host: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
          text: { type: 'string' },
          overlap: { type: 'string', enum: ['cut_in', 'reaction', 'over'] },
          mood: { type: 'string', enum: ['excited', 'amused', 'surprised', 'sarcastic', 'warm', 'serious', 'calm', 'frustrated', 'thoughtful', 'laughing', 'shouting', 'scoffing'] },
          energy: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['host', 'text'],
      },
    },
  },
  required: ['turns'],
} as const;

/**
 * Secondo passaggio: un "regista" rilegge il copione e toglie o sposta ciò che una persona vera non farebbe
 * (risate senza motivo, esitazioni a caso, reazioni fuori posto, intercalari identici per tutti).
 */
export function reviewPrompt(input: {
  language: string;
  hosts: PodcastHost[];
  brief: PodcastBrief;
  script: Array<{ host: string; text: string; overlap?: string; mood?: string }>;
}): { system: string; user: string } {
  const system = [
    'Sei il regista di un podcast parlato: il tuo lavoro è rendere il dialogo indistinguibile da una conversazione registrata tra persone vere.',
    'Ricevi il copione di una puntata. Rileggilo battuta per battuta e correggi SOLO ciò che una persona vera, con quel carattere, in quel punto, non direbbe o non farebbe.',
    ...REALISM_RULES,
    'Cosa puoi fare: togliere o spostare una risata ("ah ah") non motivata; togliere o cambiare riempitivi ed esitazioni a caso; cancellare reazioni che non rispondono a ciò che è stato detto; dare a ciascuno intercalari propri e coerenti; correggere un overlap illogico; togliere o cambiare un "mood" incoerente con la battuta o con il carattere; sistemare una battuta che suona scritta invece che parlata.',
    'Cosa NON devi fare: cambiare i contenuti, i fatti, i numeri o le fonti; aggiungere parolacce; allungare o accorciare il copione di più del 8%; cambiare chi parla in modo da perdere il carattere di ciascuno; aggiungere indicazioni di scena tra parentesi.',
    'Se una battuta va bene, lasciala IDENTICA. Mantieni i campi "overlap", "mood" e "energy" quando sono coerenti; se l\u2019energia di una battuta non segue lo stato d\u2019animo della conversazione (salti bruschi, contagio mancante), correggila. Una battuta interrotta resta a metà con il trattino e chi risponde ha overlap "cut_in".',
    'Rispondi SOLO con JSON conforme allo schema: l\u2019elenco COMPLETO delle battute riviste, nello stesso ordine.',
  ].join('\n');
  const user = [
    languageDirective(input.language),
    ...briefLines(input.brief),
    `Partecipanti: ${hostLine(input.hosts)}`,
    'Carattere di ciascuno:',
    ...personaLines(input.hosts),
    'Copione da rivedere (JSON):',
    JSON.stringify({ turns: input.script }),
  ].join('\n\n');
  return { system, user };
}
