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
    // FORMATO PER-LEZIONE: ogni lezione dell'outline porta un campo "format"
    // (pillola | video_first | standard). Se il brief forza un formato globale,
    // tutte le lezioni ricevono quello; altrimenti l'LLM consiglia il formato
    // più adatto lezione per lezione secondo la natura del contenuto.
    brief.format === 'pillole'
      ? 'FORMATO FORZATO: PILLOLE. Imposta "format": "pillola" su OGNI lezione. Ogni pillola è una ' +
        'micro-lezione (2-4 min) su UN singolo concetto: hook video breve, spiegazione sintetica, una ' +
        'verifica rapida, takeaway. Progetta lezioni brevi e focalizzate, non teoriche e ampie.'
      : brief.format === 'video_first' || brief.videoFirst
        ? 'FORMATO FORZATO: VIDEO-FIRST. Imposta "format": "video_first" su OGNI lezione: ciascuna è ' +
          'incentrata su un video portante con capitoli, verifiche intermedie e quiz affiancati.'
        : [
            'FORMATO PER-LEZIONE (consiglia tu): imposta il campo "format" di OGNI lezione al valore più ' +
              'adatto alla sua natura didattica, scegliendo tra:',
            '  - "pillola": concetto singolo e pratico, "sapere fare subito", ripasso veloce o consiglio ' +
              'operativo (micro-lezione 2-4 min con mini-video di aggancio);',
            '  - "video_first": argomento articolato che beneficia di una dimostrazione/screencast/caso ' +
              'reale guidato passo-passo (lezione 8-15 min con video portante);',
            '  - "standard": teoria, definizioni, normative, checklist, contenuto da studiare anche senza ' +
              'audio/video (testo + immagini + interazioni).',
            'Usa un MIX equilibrato e coerente con la progressione: non forzare tutto a un unico formato. ' +
              'In dubbio, scegli "standard".',
            // Preferenza di DEFAULT indicata dall'autore nell'onboarding: è un
            // orientamento, non un obbligo; se una lezione è chiaramente di altra
            // natura, scegli il formato più adatto.
            brief.lessonFormatDefault
              ? `L'autore preferisce come DEFAULT il formato "${brief.lessonFormatDefault}": usalo per le ` +
                'lezioni per cui non è indicata un\'eccezione, salvo quando un altro formato è chiaramente più adatto.'
              : '',
            // Eccezioni per TITOLO: formato richiesto esplicitamente dall'autore
            // per specifiche lezioni suggerite. Vanno rispettate quando il titolo
            // della lezione dell'outline corrisponde a quello indicato.
            Object.keys(brief.lessonFormatHints ?? {}).length > 0
              ? 'ECCEZIONI richieste dall\'autore (formato per titolo di lezione): ' +
                Object.entries(brief.lessonFormatHints)
                  .map(([title, fmt]) => `«${title}» → ${fmt}`)
                  .join('; ') +
                '. Applica questi formati alle lezioni il cui titolo corrisponde (anche se rifinisci il titolo).'
              : '',
          ]
            .filter((s) => s !== '')
            .join('\n'),
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
    'La lezione VIDEO-FIRST (deep dive, 8-15 min) ruota attorno a UN video PORTANTE che scompone un ' +
      'argomento articolato, con contenuto a lato organizzato per CAPITOLI e verifiche INTERMEDIE ' +
      '(non solo a fine lezione). Il video è UNO solo e lungo: è un segnaposto che l\'autore riempirà ' +
      '(screencast/presentazione/dimostrazione). NON va prodotto come cartoon. Produci i block in questo ordine:',
    '1) UN block "video_checkpoint" come PRIMO block: payload { video: { kind: "video", ' +
      `alt: "<descrizione del video in ${languageName(input.language)}>", placeholderPrompt: "<cosa mostra il video portante>" }, ` +
      'checkpoints: [], transcript: [], transcriptStatus: "none", ' +
      'sections: [ { id: "<slug>", title: "<titolo tab>", content: { format: "html", html: "<p>…</p>" } }, … ] }. ' +
      'NON inventare storageKey/URL: il video è un segnaposto vuoto. Lascia transcript VUOTO (generata dal file). ' +
      'POPOLA "sections" come i CAPITOLI della lezione, affiancati al video (stile Brain Bites), in questo schema: ' +
      '(a) "Introduzione & contesto" (1 min: dove siamo nel percorso e perché conta); ' +
      '(b) "Capitolo A — Teoria / modello mentale"; (c) "Capitolo B — Dimostrazione / esempio reale"; ' +
      '(d) "Capitolo C — Errori da evitare / eccezioni"; (e) "Conclusione & collegamento" (sintesi + aggancio alla lezione dopo). ' +
      'Ogni section ha un title breve e content in HTML semplice (<p>, <ul><li>, <strong>), 80-150 parole.',
    '2) Un block "rich_text" BREVE (60-120 parole) subito dopo: introduce il video, ne dichiara gli obiettivi e ' +
      'sintetizza i punti chiave in un elenco puntato.',
    '3) VERIFICHE INTERMEDIE (retrieval distribuito, TRA i capitoli, non solo a fine): inserisci 1-2 micro-interazioni ' +
      'LEGGERE che fanno riflettere su un capitolo appena visto, tra gli elementi a lato — es. una "flashcard" ' +
      '(concetto da ricordare dopo il Capitolo A) o un "click_reveal" (una domanda-aggancio che rivela la risposta). ' +
      'Tienile leggere: servono a consolidare, non sono il test finale.',
    '4) ELEMENTI DINAMICI di approfondimento affiancati al video: 1-2 tra "accordion_tabs" (dettagli secondari), ' +
      '"timeline" (fasi/procedura mostrata), "flashcard" (termini chiave). Rinforzano il contenuto dei capitoli.',
    '5) VERIFICA FINALE: 1-2 block interattivi valutativi coerenti col video ("dragdrop_match", "dragdrop_order", ' +
      '"sorting_categories" o "branching_scenario"). Verificano quanto mostrato; non introdurre concetti nuovi.',
    '',
    `Regole media: le immagini eventuali sono placeholder (alt + placeholderPrompt in ${languageName(input.language)}), ` +
      'MAI URL reali. Il testo resta comprensibile anche senza il video, ma è pensato per accompagnarlo.',
    input.context,
  ];
  return parts.filter((p) => p !== '').join('\n');
}

/**
 * Prompt per una "pillola" (micro-learning / fast track): genera una SEQUENZA
 * di block piatti con la struttura didattica Hook → Core → (micro-richiamo) →
 * Checkpoint → Takeaway. Mix a BASSO COSTO: UN solo mini-video (code-to-video)
 * per l'Hook, il resto testo+immagini e interattivi leggeri. Un solo concetto.
 * Richiamo attivo distribuito: un micro-richiamo nel mezzo, oltre al checkpoint.
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
    `Genera UNA "pillola" di micro-learning in ${lang}: veloce, sintetica, UN SOLO concetto, 2-4 minuti.`,
    `Corso: ${input.courseTitle}`,
    `Modulo: ${input.moduleTitle}`,
    `Pillola (lezione): ${input.lessonTitle}`,
    input.objectives.length > 0 ? `Obiettivi: ${input.objectives.join('; ')}` : '',
    input.courseFocus
      ? `TAGLIO DEL CORSO (vincolo): ${input.courseFocus}. Resta in questa angolazione.`
      : '',
    input.toneInstruction ? `Indicazione aggiuntiva: ${input.toneInstruction}` : '',
    '',
    'La pillola è una SEQUENZA di block piatti (NON un libro-game, NON un branching_scenario). '
      + 'Produci i block NELL\'ORDINE qui sotto, uno per ciascuna fase. Resta su UN SOLO concetto: '
      + 'la pillola spiega/risolve una cosa sola, in modo essenziale.',
    '',
    'STRUTTURA OBBLIGATORIA (in questo ordine):',
    '',
    '1) HOOK & OBIETTIVO — UN block "video_checkpoint" come PRIMO block. È un mini-video (cartoon '
      + 'code-to-video) breve che aggancia con il problema o la promessa di apprendimento. Payload: '
      + `{ video: { kind: "video", alt: "<descrizione breve in ${lang}>", placeholderPrompt: "<STORYBOARD del mini-cartoon: soggetto/personaggio, azione, ambientazione, 1 sola idea, stile explainer illustrato, in ${lang}>" }, checkpoints: [], sections: [] }. `
      + 'NON inventare storageKey/URL: il video è un SEGNAPOSTO che verrà prodotto a parte dallo storyboard. '
      + 'Lascia sections VUOTO (l\'hook è solo il video). UN SOLO video in tutta la pillola: è l\'unico costo video.',
    '',
    '2) CONCETTO CORE — UN block "rich_text" (80-140 parole) che spiega il concetto in modo ultra-sintetico: '
      + 'il "cosa" e il "perché", con un elenco puntato dei punti chiave e i termini importanti in grassetto. '
      + 'Aggiungi UN media immagine a supporto: '
      + `media: [{ kind: "image", alt: "<descrizione in ${lang}>", placeholderPrompt: "<scena da illustrare, senza testo nell'immagine, in ${lang}>" }]. `
      + 'Resta su un solo concetto/step: niente digressioni.',
    '',
    '3) MICRO-RICHIAMO (retrieval distribuito, LEGGERO) — UN block "flashcard" con UNA sola card: '
      + 'sul fronte una domanda-lampo sul concetto appena spiegato, sul retro la risposta sintetica. '
      + 'Serve a fissare subito l\'idea (richiamo attivo nel mezzo, non solo alla fine). Tienilo leggero.',
    '',
    '4) CHECKPOINT — UN block interattivo LEGGERO di verifica, a scelta tra "flashcard" (2-3 card domanda/risposta) '
      + 'oppure "dragdrop_match" semplice (2-3 abbinamenti) oppure "sorting_categories" con 2 categorie. '
      + 'Verifica il concetto spiegato; NON introdurre nozioni nuove. Niente quiz pesante.',
    '',
    '5) TAKEAWAY — UN block "rich_text" BREVE (40-70 parole): il concetto chiave da ricordare, '
      + 'idealmente con 1-3 bullet "da portare a casa". Chiude la pillola.',
    '',
    'REGOLE:',
    `- Scrivi TUTTO in ${lang} (testi, alt, placeholderPrompt, domande/risposte).`,
    '- ESATTAMENTE 5 block nell\'ordine indicato: video_checkpoint (hook), rich_text (core), flashcard (micro-richiamo), un interattivo leggero (checkpoint), rich_text (takeaway).',
    '- UN SOLO block video (l\'hook). NON generare altri video: per il resto usa testo e immagini (costo basso).',
    '- I media sono SEMPRE segnaposto descrittivi (alt + placeholderPrompt), MAI URL o storageKey reali.',
    '- Tono diretto e pratico: la pillola fa "sapere fare subito", non è una lezione lunga.',
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
    'FORMATO STANDARD (testuale & interattivo, self-paced): lettura + pratica attiva, pensato anche ' +
      'per lo studio SENZA audio/video (accessibilità). NIENTE VIDEO: non inserire block "video_checkpoint". ' +
      'La lezione deve essere VISIVA e scorrevole, NON un muro di testo: spezza il contenuto in più CONCETTI ' +
      'brevi, ciascuno con supporto grafico. Testi concisi (60-120 parole per block), elenchi puntati e ' +
      'grassetti strategici sui termini chiave.',
    '',
    'STRUTTURA DIDATTICA della lezione, in questo ordine:',
    '1) TESTO GUIDA a CONCETTI: alterna block "rich_text" BREVI (un concetto ciascuno) a elementi visivi. ' +
      'OGNI concetto ha un supporto grafico: aggiungi al rich_text un media immagine ' +
      `(media: [{ kind: "image", alt, placeholderPrompt }]) con placeholderPrompt descrittivo in ${languageName(input.language)} ` +
      'della scena da illustrare (senza testo nell\'immagine). Usa BOX EVIDENZIATI dentro l\'HTML del rich_text per ' +
      'richiamare l\'attenzione, con questo markup: <div class="callout callout-tip">…</div> (consiglio pratico), ' +
      '<div class="callout callout-warning">…</div> (attenzione/errore comune), ' +
      '<div class="callout callout-def">…</div> (definizione di un termine). Inserisci i box dove servono davvero.',
    '2) ALMENO UN block "carousel_steps" come SEQUENZA DI SLIDE: 3-5 step, ognuno con title, testo breve (content) ' +
      'e un media immagine (placeholderPrompt). Ideale per procedure, fasi, confronti o esempi passo-passo.',
    '3) VISUAL & SCHEMI quando aiutano: "timeline" per sequenze/procedure, "image_hotspot" per spiegare ' +
      'un\'immagine con punti cliccabili, "accordion_tabs" per dettagli secondari espandibili.',
    '4) WIDGET INTERATTIVI VICINO AL CONTENUTO (non ammassati in fondo): subito dopo il concetto a cui si ' +
      'riferiscono inserisci un richiamo attivo LEGGERO — es. una "flashcard" (termine/definizione appena vista) ' +
      'o un "dragdrop_match" breve. È il retrieval distribuito: si ricorda meglio con richiami nel mezzo.',
    '5) QUIZ / TEST FINALE: 1-2 block interattivi valutativi (flashcard per memorizzare, dragdrop_match per ' +
      'abbinamenti, dragdrop_order per sequenze, sorting_categories per classificare, branching_scenario a scelte) ' +
      'con feedback immediato. Verificano quanto spiegato; non introdurre concetti nuovi qui.',
    '',
    `Regole sui media: i media sono SEMPRE placeholder descrittivi (alt + placeholderPrompt in ` +
      `${languageName(input.language)}), MAI URL reali. NIENTE block video. Le immagini sono illustrative: il contenuto ` +
      'informativo resta comprensibile anche senza di esse (accessibilità). Punta a più immagini distribuite ' +
      '(indicativamente una per concetto) oltre alle slide del carousel.',
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
    `Progetta UNA SOLA scena breve di un VIDEO esplicativo ILLUSTRATO stile "explainer animato" (tipo Brain Bites), in ${lang}.`,
    `SCENA (storyboard): ${input.scenePrompt}`,
    '',
    'IMPORTANTE: l\'array "scenes" deve contenere ESATTAMENTE UN elemento (una sola scena). Il clip è breve e ' +
      'con un UNICO voiceover: NON spezzare in più scene.',
    'La scena è un\'ILLUSTRAZIONE 2D cartoon a tutto schermo (un personaggio/soggetto in una situazione) che fa da sfondo animato, con un breve titolo e i sottotitoli sincronizzati con la voce sopra.',
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
    '- descrivi un aspetto chiaro e coerente del personaggio principale (genere, capelli, abbigliamento, età);',
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
