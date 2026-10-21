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
      : brief.format === 'pillole_interattive'
      ? 'FORMATO FORZATO: PILLOLE INTERATTIVE. Imposta "format": "pillola_interattiva" su OGNI lezione. ' +
        'Ogni lezione è un libro-game: una SITUAZIONE concreta in cui l\'utente sceglie e, per vie diverse, ' +
        'risolve o meno il problema. Progetta situazioni decisionali focalizzate, non teoria estesa.'
      : brief.format === 'video_first' || brief.videoFirst
        ? 'FORMATO FORZATO: VIDEO-FIRST. Imposta "format": "video_first" su OGNI lezione: ciascuna è ' +
          'incentrata su un video portante con capitoli, verifiche intermedie e quiz affiancati.'
        : [
            'FORMATO PER-LEZIONE (consiglia tu): imposta il campo "format" di OGNI lezione al valore più ' +
              'adatto alla sua natura didattica, scegliendo tra:',
            '  - "pillola": concetto singolo e pratico, "sapere fare subito", ripasso veloce o consiglio ' +
              'operativo (micro-lezione 2-4 min con mini-video di aggancio);',
            '  - "pillola_interattiva": una SITUAZIONE DECISIONALE ("cosa faresti?") in cui l\'utente sceglie e, ' +
              'per vie diverse, risolve o meno il problema (libro-game a scene con mini-video). Ideale per casi ' +
              'pratici, dilemmi, procedure con errori tipici da evitare;',
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
    `Genera UNA "pillola" in ${lang}: un VIDEO-LEZIONE illustrato (cartoon) di 3-5 minuti su UN SOLO argomento, `
      + 'che spiega il tema per intero, con accanto un breve takeaway e una verifica leggera.',
    `Corso: ${input.courseTitle}`,
    `Modulo: ${input.moduleTitle}`,
    `Pillola (lezione): ${input.lessonTitle}`,
    input.objectives.length > 0 ? `Obiettivi: ${input.objectives.join('; ')}` : '',
    input.courseFocus
      ? `TAGLIO DEL CORSO (vincolo): ${input.courseFocus}. Resta in questa angolazione.`
      : '',
    input.toneInstruction ? `Indicazione aggiuntiva: ${input.toneInstruction}` : '',
    '',
    'La pillola È UN VIDEO-LEZIONE: un unico video cartoon (explainer illustrato) che spiega da solo '
      + 'l\'intero argomento, della durata di qualche minuto. NON è un hook breve + testo: è il video a '
      + 'fare la lezione, dall\'inizio alla fine. Resta su UN SOLO argomento, ma trattalo per intero.',
    '',
    'STRUTTURA OBBLIGATORIA (in questo ordine):',
    '',
    '1) VIDEO-LEZIONE — UN block "video_checkpoint" come PRIMO e PRINCIPALE block. È il video cartoon '
      + '(code-to-video) che insegna l\'argomento completo (introduzione, spiegazione col "perché", esempi '
      + 'concreti/casi d\'uso aziendali, chiusura col punto chiave). Payload: '
      + `{ video: { kind: "video", alt: "<descrizione breve in ${lang}>", placeholderPrompt: "<STORYBOARD ESTESO del video-lezione: l'ARGOMENTO completo da spiegare, il protagonista/contesto aziendale coerente, i passaggi logici dall'introduzione alla conclusione, in ${lang}. Descrivi COSA deve insegnare il video, non una singola scena: sarà sviluppato in più scene.>" }, checkpoints: [], sections: [] }. `
      + 'NON inventare storageKey/URL: il video è un SEGNAPOSTO che verrà prodotto a parte dallo storyboard. '
      + 'Lascia sections e checkpoints VUOTI. Lo storyboard deve essere RICCO e descrivere l\'intera lezione, '
      + 'perché da esso verrà generato un copione narrato di 3-5 minuti con più scene illustrate.',
    '',
    '2) TAKEAWAY — UN block "rich_text" BREVE (40-70 parole): il concetto chiave da ricordare dopo il video, '
      + 'con 1-3 bullet "da portare a casa". È l\'unico contenuto testuale, a corredo del video.',
    '',
    '3) CHECKPOINT (opzionale ma consigliato) — UN block interattivo LEGGERO di verifica, a scelta tra '
      + '"flashcard" (2-3 card domanda/risposta) oppure "dragdrop_match" semplice (2-3 abbinamenti). '
      + 'Verifica ciò che il video ha spiegato; NON introdurre nozioni nuove.',
    '',
    'REGOLE:',
    `- Scrivi TUTTO in ${lang} (testi, alt, placeholderPrompt, domande/risposte).`,
    '- Il PRIMO block è SEMPRE il video_checkpoint (il video-lezione). Poi il takeaway, poi al più un checkpoint leggero.',
    '- UN SOLO block video: è la lezione. NON generare altri video.',
    '- Lo storyboard (placeholderPrompt del video) descrive l\'INTERA lezione da insegnare, non una singola scena: '
      + 'è il materiale da cui si genera il copione multi-scena. Più è completo e concreto, migliore è il video.',
    '- I media sono SEMPRE segnaposto descrittivi (alt + placeholderPrompt), MAI URL o storageKey reali.',
    '- Tono professionale ed enterprise, chiaro e concreto, per un pubblico aziendale adulto.',
    '',
    input.context,
  ];
  return parts.filter((p) => p !== '').join('\n');
}

/**
 * Prompt per una "pillola INTERATTIVA" (libro-game): genera UN block
 * branching_scenario che rappresenta un mini-percorso a scene con scelte che,
 * per vie diverse, portano alla RISOLUZIONE o meno di una situazione concreta.
 * Ogni scena ha un mini-video (cartoon, segnaposto: lo storyboard va in
 * placeholderPrompt); le scene di verifica hanno scelte valutate (score +
 * feedback) che diramano verso scene/esiti. Struttura teach → quiz → esiti.
 */
export function lessonPillolaInterattivaPrompt(input: {
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
    `Genera UNA "pillola INTERATTIVA" (libro-game) a mini-video in ${lang}: una SITUAZIONE concreta in cui le scelte ` +
      'dell\'utente portano, per vie diverse, a RISOLVERE o NON risolvere la situazione.',
    `Corso: ${input.courseTitle}`,
    `Modulo: ${input.moduleTitle}`,
    `Pillola (lezione): ${input.lessonTitle}`,
    input.objectives.length > 0 ? `Obiettivi: ${input.objectives.join('; ')}` : '',
    input.courseFocus
      ? `TAGLIO DEL CORSO (vincolo): ${input.courseFocus}. Resta in questa angolazione.`
      : '',
    input.toneInstruction ? `Indicazione aggiuntiva: ${input.toneInstruction}` : '',
    '',
    'STRUTTURA del libro-game (un percorso a scene):',
    'FASE 1 — SETUP/SPIEGAZIONE (scene role="teach"): 1-2 scene che presentano la situazione e il concetto. '
      + 'Ogni scena ha UN mini-video e UNA sola scelta "Continua" (nextNodeId verso la scena dopo), NON valutata.',
    'FASE 2 — DECISIONI (scene role="quiz"): 1-3 scene che mettono l\'utente davanti a un bivio concreto, con '
      + '2-3 scelte VALUTATE (score + feedback) che diramano verso scene diverse o verso gli esiti. La scelta '
      + 'giusta avvicina alla risoluzione; quelle sbagliate portano verso un esito negativo o una scena di recupero.',
    'ESITI (scene terminali, choices: []): ALMENO un esito POSITIVO (situazione RISOLTA) e ALMENO uno NEGATIVO '
      + '(situazione NON risolta / conseguenza), ciascuno con un mini-video e un testo che chiarisce cosa è successo e perché.',
    '',
    'Produci ESATTAMENTE UN block "branching_scenario" con questo payload:',
    '{ ',
    '  "startNodeId": "<id della prima scena>", ',
    '  "scored": true, ',
    '  "pillole": true, ',
    '  "gateChoicesOnMedia": true, ',
    '  "nodes": [ ',
    '    { ',
    '      "id": "<slug-scena>", ',
    '      "role": "teach" | "quiz", ',
    '      "content": { "format": "html", "html": "<p>Testo breve (1-3 frasi): teach presenta/spiega; quiz pone la situazione e la domanda.</p>" }, ',
    `      "media": { "kind": "video", "alt": "<descrizione breve della scena in ${lang}>", "placeholderPrompt": "<STORYBOARD del mini-cartoon: soggetto/personaggio coerente, azione, ambientazione, 1 sola idea, stile explainer illustrato, in ${lang}>" }, `,
    '      "choices": [ ',
    '        /* teach: UNA scelta "Continua" con nextNodeId, senza score. */ ',
    '        /* quiz: 2-3 scelte con nextNodeId (scena/esito), score (positivo se avvicina alla soluzione, 0/negativo se errata) e feedback. */ ',
    '        { "id": "<slug-scelta>", "label": "<testo scelta>", "nextNodeId": "<id scena successiva; ASSENTE se porta a un esito terminale>", "score": <numero, solo quiz>, "feedback": "<solo quiz: conseguenza 1-2 frasi>" } ',
    '      ] ',
    '    } ',
    '  ] ',
    '}',
    '',
    'REGOLE:',
    `- Scrivi TUTTO in ${lang} (testi scena, label scelte, feedback, alt e placeholderPrompt).`,
    '- 4-8 scene totali: prima le scene teach, poi le quiz, infine gli esiti terminali (almeno 1 positivo e 1 negativo).',
    '- Imposta SEMPRE "role" su ogni scena. Scene teach: UNA sola scelta "Continua" con nextNodeId; niente score/feedback.',
    '- Scene quiz: 2-3 scelte valutate; conseguenze coerenti e istruttive. Le vie diverse DEVONO poter condurre sia all\'esito positivo sia al negativo.',
    '- Gli esiti terminali hanno "choices": [] e un media video segnaposto con testo che spiega l\'esito.',
    '- Ogni nextNodeId DEVE puntare a un id di nodo esistente; startNodeId DEVE essere la prima scena teach.',
    '- Il media di OGNI scena è un VIDEO SEGNAPOSTO (cartoon): NON inventare storageKey/URL; lo storyboard va in placeholderPrompt. I cartoon verranno prodotti a parte.',
    '- Personaggio/ambientazione COERENTI tra le scene (stesso protagonista), così il percorso sembra un\'unica storia.',
    '- Gli id dei nodi/scelte sono slug brevi univoci (es. "intro-1", "bivio-1", "esito-ok", "esito-ko", "scelta-a").',
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
  /**
   * Formato della lezione: 'pillole' = pillola lineare; 'pillola_interattiva' =
   * libro-game (branching_scenario); 'video_first' = video portante; altrimenti
   * standard.
   */
  format?: 'completo' | 'video_first' | 'pillole' | 'pillola_interattiva';
}): string {
  if (input.format === 'pillola_interattiva') return lessonPillolaInterattivaPrompt(input);
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
  /** Video-lezione multi-scena (il video È la lezione, qualche minuto). */
  multiScene?: boolean;
}): string {
  if (input.multiScene) return videoSpecLongFormPrompt(input);
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

/**
 * Prompt per un VIDEO-LEZIONE multi-scena (il video È la lezione, 3-5 minuti):
 * UN voiceover unico e continuo (script completo che insegna l'argomento), e N
 * scene (6-12) ciascuna con la propria ILLUSTRAZIONE e la FINESTRA DI PAROLE
 * (`wordRange`) del voiceover che copre. La durata segue il voiceover; i
 * sottotitoli karaoke scorrono per tutta la durata.
 */
function videoSpecLongFormPrompt(input: {
  scenePrompt: string;
  language: string;
  palette?: string[];
  bg?: string;
}): string {
  const lang = languageName(input.language);
  const palette = input.palette && input.palette.length > 0 ? input.palette : ['#1e3a5f', '#2563eb', '#0ea5e9', '#111827'];
  const bg = input.bg ?? '#f4f6fb';
  const parts = [
    languageDirective(input.language),
    `Progetta un VIDEO-LEZIONE ILLUSTRATO completo (stile explainer professionale), in ${lang}. ` +
      'Questo video È la lezione intera: deve SPIEGARE l\'argomento in modo autosufficiente, non essere un semplice aggancio.',
    `ARGOMENTO/STORYBOARD della lezione: ${input.scenePrompt}`,
    '',
    'DURATA: il video dura 3-5 minuti. Il "voiceover.text" è UN UNICO copione continuo e discorsivo che insegna ' +
      `l'argomento dall'inizio alla fine (indicativamente 450-750 parole in ${lang}): introduzione, spiegazione dei ` +
      'concetti con il "perché", esempi concreti/casi d\'uso, e una chiusura con il punto chiave. Tono professionale ' +
      'ed enterprise, chiaro e concreto, adatto a un pubblico aziendale adulto.',
    '',
    'SCENE: suddividi il video in 6-12 SCENE, una per ogni passaggio logico del copione. Ogni scena ha la PROPRIA ' +
      'illustrazione e copre una PORZIONE del voiceover, indicata dal campo "wordRange" (indici di PAROLA del ' +
      'voiceover globale, 0-based, "end" ESCLUSIVO). Le finestre devono essere CONTIGUE e coprire tutte le parole: ' +
      'scena 1 da 0, l\'ultima arriva fino al totale delle parole. Conta le parole del voiceover per assegnarle.',
    '',
    'Restituisci ESCLUSIVAMENTE un JSON conforme allo schema VideoSpec:',
    '{',
    '  "version": 1,',
    '  "canvas": { "width": 1920, "height": 1080, "fps": 30 },',
    `  "theme": { "palette": ${JSON.stringify(palette)}, "bg": ${JSON.stringify(bg)}, "fontFamily": "Inter" },`,
    `  "voiceover": { "text": "<COPIONE COMPLETO continuo in ${lang}, 450-750 parole, che spiega tutta la lezione>", "lang": "${input.language}" },`,
    '  "scenes": [',
    '    {',
    '      "id": "<slug-scena>",',
    '      "wordRange": { "start": <indice prima parola>, "end": <indice dopo l\'ultima parola di questa scena> },',
    `      "illustration": { "prompt": "<illustrazione della scena in INGLESE: soggetto/personaggio coerente, azione, ambientazione aziendale>", "kenBurns": "in"|"out"|"left"|"right" },`,
    '      "layers": [ /* opzionale: UN "LowerThird" col titolo della sezione */ ]',
    '    }',
    '    /* … altre scene, wordRange contigui che coprono tutto il voiceover … */',
    '  ]',
    '}',
    '',
    'REGOLE ILLUSTRAZIONI:',
    '- Ogni scena ha SEMPRE un "illustration" con "prompt" in INGLESE, conciso e concreto.',
    '- PERSONAGGIO/AMBIENTAZIONE COERENTI tra le scene (stesso protagonista e stile), così il video sembra un unico racconto.',
    '- Il soggetto combacia col voiceover di QUELLA scena (persona, azione, luogo). Ambientazioni business credibili (ufficio moderno, laptop, dashboard).',
    '- NON includere testo/scritte nell\'immagine.',
    '',
    'REGOLE GENERALI:',
    `- Scrivi voiceover e testi dei layer in ${lang}; SOLO i prompt delle illustrazioni in INGLESE.`,
    '- "wordRange" di scene consecutive: l\'"end" di una scena è lo "start" della successiva (contigui, nessun buco, nessuna sovrapposizione).',
    '- Layer opzionali: al più un "LowerThird" per scena col titolo della sezione. Usa "BulletList"/"ChainDiagram"/"IconStat"/"ArrowFlow" SOLO se la scena mostra davvero dati/elenchi/processi.',
    '- I sottotitoli karaoke (Caption) sono aggiunti automaticamente: NON serve inserirli.',
    '- NON usare componenti fuori dalla whitelist. NON inventare campi. Restituisci SOLO il JSON.',
  ];
  return parts.filter((p) => p !== '').join('\n');
}
