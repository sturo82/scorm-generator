import type { Brief, BrandVoice } from '@scorm/contracts';
import type { RetrievedChunk } from '../knowledge/retrieval.service.js';

/**
 * Costruzione dei prompt per la generazione AI (Requisito 4). I prompt sono a
 * livelli: regole di dominio (system) + tono di brand + brief + contesto RAG.
 * Il tono di brand ha precedenza sul tono del brief (Requisito 7.4).
 */

const SYSTEM_BASE =
  'Sei un instructional designer esperto e un divulgatore. Il tuo compito è INSEGNARE in ' +
  'profondità, non elencare obiettivi. Principi didattici da rispettare sempre: ' +
  '(1) PRIMA spiega il concetto in modo completo e autosufficiente — definizioni chiare, ' +
  'il "perché" oltre al "cosa", meccanismi, contesto, terminologia; ' +
  '(2) POI consolida con esempi concreti, casi reali e analogie; ' +
  '(3) SOLO ALLA FINE proponi interazioni o verifiche. ' +
  'Il contenuto testuale deve essere sostanzioso e discorsivo: paragrafi veri che spiegano, ' +
  'non frasi-slogan o semplici elenchi di "cosa imparerai". Chi legge deve poter imparare ' +
  "l'argomento dal testo stesso, anche senza fonti esterne. " +
  'Rispetta rigorosamente lo schema di output richiesto. Non inventare fatti: usa il ' +
  'contesto fornito quando disponibile e cita le fonti; se il contesto è assente, basati su ' +
  'conoscenza di dominio accurata.';

export function systemPrompt(voice?: BrandVoice): string {
  if (!voice) return SYSTEM_BASE;
  const parts = [SYSTEM_BASE, `Tono di voce del brand: ${voice.tone}.`];
  if (voice.dosAndDonts && voice.dosAndDonts.length > 0) {
    parts.push(`Regole di stile: ${voice.dosAndDonts.join('; ')}.`);
  }
  return parts.join(' ');
}

/** Formatta il contesto RAG con riferimenti numerati alle fonti. */
export function formatContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '';
  const lines = chunks.map((c, i) => {
    const src = c.citation.section
      ? `${c.citation.documentName} — ${c.citation.section}`
      : c.citation.documentName;
    return `[${i + 1}] (${src})\n${c.text}`;
  });
  return `Contesto di riferimento (knowledge base):\n${lines.join('\n\n')}`;
}

/** Prompt per generare l'outline del corso dal brief (fase 1, Requisito 4.1). */
export function outlinePrompt(brief: Brief, context: string): string {
  const parts = [
    'Genera la struttura (outline) di un corso e-learning basato sul brief seguente.',
    `Titolo: ${brief.title}`,
    `Obiettivi di apprendimento: ${brief.learningObjectives.join('; ')}`,
    `Pubblico: ${brief.targetAudience}`,
    `Livello: ${brief.level}`,
    `Durata stimata: ${brief.estimatedDurationMinutes} minuti`,
    `Lingua: ${brief.language}`,
    brief.desiredLessonCount ? `Numero lezioni desiderato: ${brief.desiredLessonCount}` : '',
    brief.requestedAssessments.length > 0
      ? `Test richiesti: ${brief.requestedAssessments.join(', ')}`
      : '',
    brief.constraints.length > 0 ? `Vincoli: ${brief.constraints.join('; ')}` : '',
    brief.videoFirst
      ? 'MODALITÀ VIDEO-FIRST: il corso è basato su video. Imposta videoFirst=true su OGNI ' +
        'lezione dell\'outline: ciascuna lezione sarà incentrata su un video con quiz ed ' +
        'elementi dinamici affiancati.'
      : 'Se una specifica lezione trae forte beneficio da una dimostrazione video, puoi ' +
        'impostare videoFirst=true SOLO su quella lezione (usa con parsimonia, dove ha senso).',
    '',
    'Organizza il corso con una progressione didattica reale: dai fondamenti e dalle ' +
      'definizioni verso i concetti avanzati e l\'applicazione pratica. Le prime lezioni ' +
      'costruiscono le basi, le successive approfondiscono e applicano. Ogni lezione deve ' +
      'coprire un concetto insegnabile in modo autosufficiente (non solo un titolo-argomento). ' +
      'Per ogni lezione indica obiettivi specifici e i tipi di interazione suggeriti per la ' +
      'fase di verifica. Imposta hasIntermediateAssessment e hasFinalAssessment secondo i test ' +
      'richiesti: i test valutano DOPO che il contenuto è stato insegnato.',
    context,
  ];
  return parts.filter((p) => p !== '').join('\n');
}

/**
 * Prompt per una lezione VIDEO-FIRST: il video è il protagonista, affiancato da
 * elementi dinamici e quiz (stile "micro-learning" video + attività laterali).
 * Il video è SEMPRE un segnaposto vuoto (l'autore caricherà il file).
 */
export function lessonVideoFirstPrompt(input: {
  courseTitle: string;
  moduleTitle: string;
  lessonTitle: string;
  objectives: string[];
  language: string;
  context: string;
  toneInstruction?: string;
}): string {
  const parts = [
    `Genera i contenuti di una lezione VIDEO-FIRST (incentrata su un video), in lingua ${input.language}.`,
    `Corso: ${input.courseTitle}`,
    `Modulo: ${input.moduleTitle}`,
    `Lezione: ${input.lessonTitle}`,
    input.objectives.length > 0 ? `Obiettivi: ${input.objectives.join('; ')}` : '',
    input.toneInstruction ? `Indicazione aggiuntiva: ${input.toneInstruction}` : '',
    '',
    'La lezione ruota attorno a UN video dimostrativo. Produci i block in questo ordine:',
    '1) UN block "video_checkpoint" come PRIMO block: payload { video: { kind: "video", ' +
      'alt: "<descrizione del video in italiano>", placeholderPrompt: "<cosa mostra il video>" }, ' +
      'checkpoints: [], transcript: [], transcriptStatus: "none", ' +
      'sections: [ { id: "<slug>", title: "<titolo tab>", content: { format: "html", html: "<p>…</p>" } }, … ] }. ' +
      'NON inventare storageKey/URL: il video è un segnaposto vuoto che l\'autore riempirà. ' +
      'Lascia transcript VUOTO: verrà generata automaticamente dal file caricato. ' +
      'POPOLA invece "sections" con 2-3 TAB di contenuto affiancate al video (stile Brain Bites): ' +
      'es. "Punti chiave" (elenco puntato dei concetti del video), "Approfondimento" (spiegazione ' +
      'discorsiva 80-150 parole che integra il video) ed eventualmente "Risorse" o "Note". ' +
      'Ogni section ha un title breve e content in HTML semplice (<p>, <ul><li>, <strong>). Il video è il fulcro.',
    '2) Un block "rich_text" BREVE (60-120 parole) subito dopo: introduce il video e ne sintetizza ' +
      'i punti chiave, con un elenco puntato dei concetti mostrati.',
    '3) ELEMENTI DINAMICI affiancati al video (il player li mostra accanto): 1-2 tra ' +
      '"accordion_tabs" (approfondimenti), "flashcard" (concetti da ricordare), "timeline" ' +
      '(fasi mostrate nel video), "click_reveal" (dettagli). Devono rinforzare il contenuto del video.',
    '4) QUIZ di verifica alla fine: 1-2 block interattivi valutativi coerenti col video ' +
      '("dragdrop_match", "dragdrop_order", "sorting_categories" o "branching_scenario"). ' +
      'Verificano quanto mostrato nel video; non introdurre concetti nuovi.',
    '',
    'Regole media: le immagini eventuali sono placeholder (alt + placeholderPrompt in italiano), ' +
      'MAI URL reali. Il testo resta comprensibile anche senza il video, ma è pensato per accompagnarlo.',
    input.context,
  ];
  return parts.filter((p) => p !== '').join('\n');
}

/** Prompt per generare i Block (interazioni) di una lezione (Requisito 4.2). */
export function lessonContentPrompt(input: {
  courseTitle: string;
  moduleTitle: string;
  lessonTitle: string;
  objectives: string[];
  language: string;
  context: string;
  /** Istruzione di rigenerazione mirata (es. "tono più formale"). */
  toneInstruction?: string;
  /** Lezione incentrata su un video (segnaposto) con quiz/elementi dinamici. */
  videoFirst?: boolean;
}): string {
  if (input.videoFirst) return lessonVideoFirstPrompt(input);
  const parts = [
    `Genera i contenuti didattici completi per la lezione seguente, in lingua ${input.language}.`,
    `Corso: ${input.courseTitle}`,
    `Modulo: ${input.moduleTitle}`,
    `Lezione: ${input.lessonTitle}`,
    input.objectives.length > 0 ? `Obiettivi: ${input.objectives.join('; ')}` : '',
    input.toneInstruction ? `Indicazione aggiuntiva: ${input.toneInstruction}` : '',
    '',
    'OBIETTIVO DI FRUIZIONE: la lezione deve essere VISIVA e scorrevole, NON un lungo muro ' +
      'di testo. Spezza il contenuto in più CONCETTI brevi, ciascuno con un supporto grafico. ' +
      'Testi concisi e chiari (preferibilmente 60-120 parole per block di testo), con elenchi ' +
      'puntati e grassetti sui termini chiave quando aiutano la comprensione.',
    '',
    'STRUTTURA DIDATTICA della lezione, in questo ordine:',
    '1) SPIEGAZIONE a CONCETTI: alterna block "rich_text" BREVI (un concetto ciascuno) a ' +
      'elementi visivi. OGNI concetto deve avere un supporto grafico: aggiungi al rich_text ' +
      'un media immagine (campo media: [{ kind: "image", alt, placeholderPrompt }]) con un ' +
      'placeholderPrompt descrittivo in italiano della scena da illustrare (senza testo nell\'immagine). ' +
      'Il testo spiega il "perché" e i meccanismi; l\'immagine aiuta a capire. Il lettore impara ' +
      'da testo + immagine insieme, non da paragrafi lunghissimi.',
    '2) ALMENO UN block "carousel_steps" usato come SEQUENZA DI SLIDE: 3-5 step, ognuno con ' +
      'title, un testo breve (content) e un media immagine (placeholderPrompt). Ideale per ' +
      'procedure, fasi, confronti o esempi passo-passo. Rende la lezione dinamica e visiva.',
    '3) APPROFONDIMENTO quando utile: accordion/tabs per dettagli secondari, timeline per ' +
      'sequenze storiche/procedurali, image_hotspot per spiegare un\'immagine con punti.',
    '3b) VIDEO (placeholder, opzionale ma consigliato quando la lezione beneficia di una ' +
      'DIMOSTRAZIONE pratica, una procedura da mostrare, un\'intervista o un caso reale): ' +
      'inserisci UN block "video_checkpoint" con un video placeholder VUOTO — ' +
      'payload: { video: { kind: "video", alt: "<descrizione del video in italiano>", ' +
      'placeholderPrompt: "<cosa dovrebbe mostrare il video>" }, checkpoints: [] }. ' +
      'NON inventare uno storageKey/URL: il video resta un placeholder che l\'autore riempirà ' +
      'caricando un proprio file. Inseriscilo al massimo una volta per lezione e solo se ha ' +
      'reale valore didattico (non forzarlo in lezioni puramente teoriche).',
    '4) VERIFICA (solo alla fine): 1-2 block interattivi coerenti (flashcard per memorizzare, ' +
      'dragdrop_match per abbinamenti, dragdrop_order per sequenze, sorting_categories per ' +
      'classificare in categorie, branching_scenario a scelte) che mettono alla prova quanto ' +
      'spiegato. Non introdurre concetti nuovi qui.',
    '',
    'Regole sui media: i media sono SEMPRE placeholder descrittivi (alt + placeholderPrompt in ' +
      'italiano), MAI URL reali. Le immagini sono illustrative: il contenuto informativo deve ' +
      'restare comprensibile anche senza di esse. Punta ad avere più immagini distribuite nella ' +
      'lezione (indicativamente una per concetto) oltre alle slide del carousel.',
    input.context,
  ];
  return parts.filter((p) => p !== '').join('\n');
}

/** Prompt per generare un assessment (Requisito 6). */
export function assessmentPrompt(input: {
  courseTitle: string;
  scope: 'intermediate' | 'final';
  focus: string;
  language: string;
  context: string;
}): string {
  const scopeLabel = input.scope === 'final' ? 'finale di corso' : 'intermedio di modulo';
  const parts = [
    `Genera un test ${scopeLabel} per il corso "${input.courseTitle}", in lingua ${input.language}.`,
    `Argomenti su cui valutare: ${input.focus}`,
    '',
    'Includi domande di tipologie diverse (scelta singola/multipla, vero/falso, abbinamento, ' +
      'riordino, completamento). Imposta risposte corrette, punteggi e feedback. ' +
      'Definisci una soglia di superamento (mastery) adeguata.',
    input.context,
  ];
  return parts.filter((p) => p !== '').join('\n');
}
