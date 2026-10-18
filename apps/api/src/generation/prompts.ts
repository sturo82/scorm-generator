import type { Brief, BrandVoice } from '@scorm/contracts';
import type { RetrievedChunk } from '../knowledge/retrieval.service.js';

/**
 * Costruzione dei prompt per la generazione AI (Requisito 4). I prompt sono a
 * livelli: regole di dominio (system) + tono di brand + brief + contesto RAG.
 * Il tono di brand ha precedenza sul tono del brief (Requisito 7.4).
 */

/** Nome leggibile della lingua da un codice ISO (per istruzioni ai prompt). */
const LANGUAGE_NAMES: Record<string, string> = {
  it: 'italiano',
  en: 'inglese',
  es: 'spagnolo',
  fr: 'francese',
  de: 'tedesco',
};

export function languageName(code: string): string {
  const key = (code || '').slice(0, 2).toLowerCase();
  return LANGUAGE_NAMES[key] ?? code;
}

/**
 * Istruzione imperativa sulla lingua di output, da anteporre a OGNI prompt di
 * generazione. Forza la lingua del corso a prescindere dalla lingua del brief,
 * delle fonti (knowledge) o degli input dell'utente: titoli, testi, descrizioni
 * dei media (alt/placeholderPrompt) e qualsiasi contenuto DEVONO essere in questa
 * lingua.
 */
export function languageDirective(code: string): string {
  const name = languageName(code);
  return (
    `LINGUA DI OUTPUT OBBLIGATORIA: ${name} (${code}). ` +
    `Genera TUTTO il contenuto esclusivamente in ${name}: titoli, testi, elenchi, feedback, ` +
    `e anche le descrizioni dei media (alt e placeholderPrompt). Questo vale ANCHE se il brief, ` +
    `gli obiettivi o le fonti di riferimento sono in un'altra lingua: traduci/adatta in ${name}. ` +
    `Non mischiare lingue.`
  );
}

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
    languageDirective(brief.language),
    'Genera la struttura (outline) di un corso e-learning basato sul brief seguente.',
    `Titolo: ${brief.title}`,
    `Obiettivi di apprendimento: ${brief.learningObjectives.join('; ')}`,
    `Pubblico: ${brief.targetAudience}`,
    `Livello: ${brief.level}`,
    `Durata stimata: ${brief.estimatedDurationMinutes} minuti`,
    `Lingua: ${brief.language}`,
    // TAGLIO/SCOPE: vincolo forte sull'angolazione del corso. Tiene l'outline
    // dentro l'obiettivo reale per il pubblico, non solo pertinente al titolo.
    brief.courseFocus
      ? `TAGLIO DEL CORSO (vincolo forte): ${brief.courseFocus}. Ogni modulo e lezione deve servire ` +
        'questo taglio e questo pubblico. ESCLUDI argomenti che, pur attinenti al titolo, escono da ' +
        'questo taglio (es. fondamenti teorici/interni del dominio quando il taglio è pratico-applicativo): ' +
        'includili solo se strettamente indispensabili all\'obiettivo. In caso di dubbio, scegli la ' +
        'prospettiva d\'uso del pubblico, non quella teorica.'
      : '',
    brief.desiredLessonCount ? `Numero lezioni desiderato: ${brief.desiredLessonCount}` : '',
    // Lezioni suggerite dall'anteprima approvata: sono la STRUTTURA DI PARTENZA.
    // Il modello deve rispettarne l'impianto e la progressione, rifinendo titoli
    // e raggruppamento in moduli senza stravolgere né omettere i temi previsti.
    (brief.suggestedLessons?.length ?? 0) > 0
      ? 'Struttura di partenza (lezioni previste, approvate dall\'autore): ' +
        `${brief.suggestedLessons!.map((l, i) => `${i + 1}) ${l}`).join('; ')}. ` +
        'Rispetta questo impianto e questi temi — puoi raggrupparli in moduli, ' +
        'affinare i titoli e aggiungere al più una lezione introduttiva o di sintesi, ' +
        'ma NON eliminare i temi previsti né cambiarne la progressione.'
      : '',
    brief.requestedAssessments.length > 0
      ? `Test richiesti: ${brief.requestedAssessments.join(', ')}`
      : '',
    brief.constraints.length > 0 ? `Vincoli: ${brief.constraints.join('; ')}` : '',
    brief.format === 'pillole'
      ? 'MODALITÀ PILLOLE (libro-game): ogni "lezione" dell\'outline è una PILLOLA ' +
        'autocontenuta — un mini-percorso interattivo a scene con scelte e conseguenze su UN ' +
        'singolo concetto. Progetta lezioni brevi e focalizzate (una pillola = un concetto/' +
        'situazione decisionale), non lezioni teoriche ampie. Ogni pillola sarà resa come ' +
        'scenario a scelte con mini-video.'
      : brief.videoFirst
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
  /** Taglio/scope del corso: vincola la lezione a restare dentro l'angolazione. */
  courseFocus?: string;
}): string {
  const parts = [
    languageDirective(input.language),
    `Genera i contenuti di una lezione VIDEO-FIRST (incentrata su un video), in ${languageName(input.language)}.`,
    `Corso: ${input.courseTitle}`,
    `Modulo: ${input.moduleTitle}`,
    `Lezione: ${input.lessonTitle}`,
    input.objectives.length > 0 ? `Obiettivi: ${input.objectives.join('; ')}` : '',
    input.courseFocus
      ? `TAGLIO DEL CORSO (vincolo): ${input.courseFocus}. Tratta il contenuto SOLO da questa ` +
        'angolazione e per questo pubblico; non deviare verso aspetti fuori taglio.'
      : '',
    input.toneInstruction ? `Indicazione aggiuntiva: ${input.toneInstruction}` : '',
    '',
    'La lezione ruota attorno a UN video dimostrativo. Produci i block in questo ordine:',
    '1) UN block "video_checkpoint" come PRIMO block: payload { video: { kind: "video", ' +
      `alt: "<descrizione del video in ${languageName(input.language)}>", placeholderPrompt: "<cosa mostra il video>" }, ` +
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
    `Regole media: le immagini eventuali sono placeholder (alt + placeholderPrompt in ${languageName(input.language)}), ` +
      'MAI URL reali. Il testo resta comprensibile anche senza il video, ma è pensato per accompagnarlo.',
    input.context,
  ];
  return parts.filter((p) => p !== '').join('\n');
}

/**
 * Prompt per una "pillola" (formato libro-game): genera UN block
 * branching_scenario che rappresenta un mini-percorso interattivo a scene. Ogni
 * scena ha un VIDEO segnaposto (cartoon da produrre: lo storyboard va in
 * placeholderPrompt) e porta a dei bivi; ogni scelta ha una conseguenza
 * (feedback) e un punteggio, e instrada a una scena successiva o a un esito.
 */
export function lessonPillolePrompt(input: {
  courseTitle: string;
  moduleTitle: string;
  lessonTitle: string;
  objectives: string[];
  language: string;
  context: string;
  toneInstruction?: string;
  courseFocus?: string;
}): string {
  const lang = languageName(input.language);
  const parts = [
    languageDirective(input.language),
    `Genera UNA "pillola" didattica a mini-video (cartoon) in ${lang}: PRIMA SPIEGA un concetto, POI VERIFICA l'apprendimento.`,
    `Corso: ${input.courseTitle}`,
    `Modulo: ${input.moduleTitle}`,
    `Pillola (lezione): ${input.lessonTitle}`,
    input.objectives.length > 0 ? `Obiettivi: ${input.objectives.join('; ')}` : '',
    input.courseFocus
      ? `TAGLIO DEL CORSO (vincolo): ${input.courseFocus}. Resta in questa angolazione.`
      : '',
    input.toneInstruction ? `Indicazione aggiuntiva: ${input.toneInstruction}` : '',
    '',
    'STRUTTURA OBBLIGATORIA della pillola in DUE FASI:',
    'FASE 1 — SPIEGAZIONE (scene role="teach"): 2-4 scene che spiegano il concetto passo passo. '
      + 'Ogni scena ha UN mini-video che illustra un\'idea e UNA sola scelta "Continua" che porta alla scena '
      + 'successiva. Le scene di spiegazione NON sono valutate (niente score). L\'ultima scena di spiegazione '
      + 'porta alla PRIMA scena di verifica.',
    'FASE 2 — VERIFICA (scene role="quiz"): 1-3 scene che mettono alla prova quanto spiegato con una '
      + 'situazione concreta e 2-3 scelte VALUTATE (score + feedback) che diramano verso gli esiti. La scelta '
      + 'corretta (score positivo) prosegue verso l\'esito positivo; quelle sbagliate (score 0 o negativo) '
      + 'spiegano l\'errore e portano all\'esito negativo o a una scena di recupero.',
    'ESITI (scene terminali, senza scelte): almeno un esito POSITIVO (hai capito/applicato bene) e almeno '
      + 'uno NEGATIVO (cosa è andato storto), ciascuno con un mini-video e un testo che riepiloga cosa si è imparato.',
    '',
    'Produci ESATTAMENTE UN block "branching_scenario" con questo payload:',
    '{ ',
    '  "startNodeId": "<id della prima scena di SPIEGAZIONE>", ',
    '  "scored": true, ',
    '  "pillole": true, ',
    '  "gateChoicesOnMedia": true, ',
    '  "nodes": [ ',
    '    { ',
    '      "id": "<slug-scena>", ',
    '      "role": "teach" | "quiz", ',
    '      "content": { "format": "html", "html": "<p>Testo breve (1-3 frasi). Per teach: spiega un\'idea. Per quiz: presenta la situazione e la domanda.</p>" }, ',
    `      "media": { "kind": "video", "alt": "<descrizione breve della scena in ${lang}>", "placeholderPrompt": "<STORYBOARD: cosa mostra il mini-cartoon, personaggi, azione, stile cartoon semplice ed efficace, in ${lang}>" }, `,
    '      "choices": [ ',
    '        /* teach: UNA sola scelta "Continua" con nextNodeId verso la scena dopo, senza score. */ ',
    '        /* quiz: 2-3 scelte con nextNodeId (scena/esito), score (positivo se corretta, 0/negativo se errata) e feedback. */ ',
    '        { "id": "<slug-scelta>", "label": "<testo scelta>", "nextNodeId": "<id scena successiva o assente se esito finale>", "score": <numero, solo per quiz>, "feedback": "<solo per quiz: conseguenza 1-2 frasi>" } ',
    '      ] ',
    '    } ',
    '  ] ',
    '}',
    '',
    'REGOLE:',
    `- Scrivi TUTTO in ${lang} (testi scena, label scelte, feedback, alt e placeholderPrompt).`,
    '- 4-8 scene totali: PRIMA tutte le scene teach (spiegazione), POI le scene quiz (verifica), infine gli esiti terminali.',
    '- Imposta SEMPRE "role" su ogni scena: "teach" per le scene di spiegazione, "quiz" per le scene di verifica.',
    '- Scene teach: UNA sola scelta con label tipo "Continua" (o equivalente) e nextNodeId valorizzato; NIENTE score/feedback.',
    '- Scene quiz: 2-3 scelte valutate; conseguenze coerenti e istruttive, senza punire gratuitamente.',
    '- Gli esiti terminali hanno "choices": [] (nessuna scelta) e role coerente (di solito "quiz"). Almeno un esito positivo e uno negativo.',
    '- Ogni nextNodeId DEVE puntare a un id di nodo esistente; startNodeId DEVE essere la prima scena teach.',
    '- Il media di OGNI scena è un VIDEO SEGNAPOSTO (cartoon): NON inventare storageKey/URL; descrivi lo storyboard in placeholderPrompt. I cartoon verranno prodotti a parte.',
    '- Mantieni i mini-video concettualmente brevi (una singola idea/azione per scena), stile cartoon semplice e chiaro.',
    '- Gli id dei nodi e delle scelte sono slug brevi univoci (es. "spiega-1", "verifica-1", "esito-positivo", "scelta-a").',
    '',
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
  /** Taglio/scope del corso: vincola la lezione a restare dentro l'angolazione. */
  courseFocus?: string;
  /** Formato del corso: 'pillole' genera un libro-game (branching_scenario). */
  format?: 'completo' | 'video_first' | 'pillole';
}): string {
  if (input.format === 'pillole') return lessonPillolePrompt(input);
  if (input.videoFirst || input.format === 'video_first') return lessonVideoFirstPrompt(input);
  const parts = [
    languageDirective(input.language),
    `Genera i contenuti didattici completi per la lezione seguente, in ${languageName(input.language)}.`,
    `Corso: ${input.courseTitle}`,
    `Modulo: ${input.moduleTitle}`,
    `Lezione: ${input.lessonTitle}`,
    input.objectives.length > 0 ? `Obiettivi: ${input.objectives.join('; ')}` : '',
    input.courseFocus
      ? `TAGLIO DEL CORSO (vincolo): ${input.courseFocus}. Tratta il contenuto SOLO da questa ` +
        'angolazione e per questo pubblico; non deviare verso aspetti fuori taglio.'
      : '',
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
      `placeholderPrompt descrittivo in ${languageName(input.language)} della scena da illustrare (senza testo nell'immagine). ` +
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
      `payload: { video: { kind: "video", alt: "<descrizione del video in ${languageName(input.language)}>", ` +
      'placeholderPrompt: "<cosa dovrebbe mostrare il video>" }, checkpoints: [] }. ' +
      'NON inventare uno storageKey/URL: il video resta un placeholder che l\'autore riempirà ' +
      'caricando un proprio file. Inseriscilo al massimo una volta per lezione e solo se ha ' +
      'reale valore didattico (non forzarlo in lezioni puramente teoriche).',
    '4) VERIFICA (solo alla fine): 1-2 block interattivi coerenti (flashcard per memorizzare, ' +
      'dragdrop_match per abbinamenti, dragdrop_order per sequenze, sorting_categories per ' +
      'classificare in categorie, branching_scenario a scelte) che mettono alla prova quanto ' +
      'spiegato. Non introdurre concetti nuovi qui.',
    '',
    `Regole sui media: i media sono SEMPRE placeholder descrittivi (alt + placeholderPrompt in ` +
      `${languageName(input.language)}), MAI URL reali. Le immagini sono illustrative: il contenuto informativo deve ` +
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
    languageDirective(input.language),
    `Genera un test ${scopeLabel} per il corso "${input.courseTitle}", in ${languageName(input.language)}.`,
    `Argomenti su cui valutare: ${input.focus}`,
    '',
    'Includi domande di tipologie diverse (scelta singola/multipla, vero/falso, abbinamento, ' +
      'riordino, completamento). Imposta risposte corrette, punteggi e feedback. ' +
      'Definisci una soglia di superamento (mastery) adeguata.',
    input.context,
  ];
  return parts.filter((p) => p !== '').join('\n');
}

/**
 * Prompt per generare un VideoSpec (code-to-video) dallo storyboard di una
 * scena pillola. L'LLM compone SOLO i componenti della whitelist e restituisce
 * JSON conforme allo schema VideoSpec. Il timing è ancorato alle PAROLE del
 * voiceover (campo `at: { word: N }`), non ai secondi.
 */
export function videoSpecPrompt(input: {
  /** Storyboard/descrizione della scena (placeholderPrompt o alt). */
  scenePrompt: string;
  language: string;
  /** Palette e sfondo suggeriti dal brand, se disponibili. */
  palette?: string[];
  bg?: string;
}): string {
  const lang = languageName(input.language);
  const palette = input.palette && input.palette.length > 0 ? input.palette : ['#0ea5e9', '#22c55e', '#f59e0b', '#111827'];
  const bg = input.bg ?? '#f8fafc';
  const parts = [
    languageDirective(input.language),
    `Progetta una breve scena di un VIDEO esplicativo ILLUSTRATO stile "explainer animato" (tipo Brain Bites), in ${lang}.`,
    `SCENA (storyboard): ${input.scenePrompt}`,
    '',
    'Ogni scena è un\'ILLUSTRAZIONE 2D cartoon a tutto schermo (un personaggio/soggetto in una situazione) che fa da sfondo animato, con un breve titolo e i sottotitoli sincronizzati con la voce sopra.',
    '',
    'Restituisci ESCLUSIVAMENTE un JSON conforme allo schema VideoSpec, con questa forma:',
    '{',
    '  "version": 1,',
    '  "canvas": { "width": 1920, "height": 1080, "fps": 30 },',
    `  "theme": { "palette": ${JSON.stringify(palette)}, "bg": ${JSON.stringify(bg)}, "fontFamily": "Inter" },`,
    `  "voiceover": { "text": "<testo COMPLETO della voce fuoricampo in ${lang}, 2-4 frasi che spiegano la scena>", "lang": "${input.language}" },`,
    '  "scenes": [ {',
    '     "id": "<slug>",',
    '     "durationHint": "auto",',
    `     "illustration": { "prompt": "<descrizione dell'illustrazione: SOGGETTO/personaggio, azione, ambientazione, emozione — in INGLESE per il generatore di immagini>", "kenBurns": "in"|"out"|"left"|"right" },`,
    '     "layers": [ /* opzionale: un LowerThird col titolo, e al massimo UN diagramma se serve */ ]',
    '  } ]',
    '}',
    '',
    'CAMPO illustration (OBBLIGATORIO): è il cuore della scena. Nel "prompt" descrivi UN\'immagine cartoon 2D flat coerente:',
    '- il soggetto DEVE combaciare col voiceover: se la voce nomina o implica una persona (nome, genere, ruolo, età),',
    '  l\'immagine raffigura ESATTAMENTE quella persona (stesso genere e aspetto). Es.: voce "Giulia osserva..." → ragazza; "il manager..." → uomo adulto in ufficio.',
    '- descrivi aspetto coerente e RICORRENTE del personaggio principale tra le scene (stesso genere, capelli, abbigliamento, età), così sembra lo stesso personaggio in tutta la pillola;',
    '- mostra l\'AZIONE/emozione concreta della scena e un\'ambientazione riconoscibile;',
    '- scrivi il prompt dell\'immagine in INGLESE (il generatore rende meglio), conciso ma concreto;',
    '- NON includere testo/scritte/fumetti vuoti nell\'immagine.',
    '',
    'COMPONENTI per i "layers" (usa SOLO questi; i layer sono OPZIONALI e vanno SOPRA l\'illustrazione):',
    '- "LowerThird": titolo breve della scena in alto. props: { text, variant: "title" }',
    '- "Caption": sottotitolo karaoke sincronizzato (aggiunto automaticamente, non è obbligatorio metterlo).',
    '- "BulletList" / "ChainDiagram" / "IconStat" / "ArrowFlow": SOLO se la scena mostra davvero dati/elenchi/processi. Evitali se la scena è narrativa.',
    '',
    'REGOLE:',
    `- Scrivi i testi mostrati (voiceover, LowerThird text) in ${lang}; SOLO il prompt dell'illustrazione in INGLESE.`,
    '- Metti SEMPRE un "illustration". Aggiungi di norma UN layer "LowerThird" col titolo della scena.',
    '- Ancora l\'entrata dei layer alle PAROLE del voiceover: "enter": { "at": { "word": N }, "anim": "fadeUp"|"popIn"|"slideIn"|"none", "ms": 400 }.',
    '- Mantieni "durationHint": "auto" (la durata segue il voiceover).',
    '- NON usare componenti fuori dalla lista. NON inventare campi non previsti. Restituisci SOLO il JSON.',
  ];
  return parts.filter((p) => p !== '').join('\n');
}
