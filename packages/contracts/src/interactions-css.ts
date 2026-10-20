/**
 * Foglio di stile UNICO delle micro-interazioni premium (Blocco F).
 *
 * Fonte di verità condivisa tra il player SCORM esportato e l'anteprima web:
 *  - il builder lo scrive in `assets/interactions.css` dentro il pacchetto SCORM;
 *  - l'app web lo inietta tale e quale (stesso identico aspetto, Requisito "same look").
 *
 * Le regole agiscono su CLASSI SEMANTICHE condivise dai due renderer
 * (`.flashcard`, `.accordion-head`, `.hotspot-dot`, `.assessment-feedback`, …)
 * e sono pilotate da un interruttore di contesto `data-motion` sul contenitore:
 *   data-motion="sober"  → transizioni morbide e sobrie (default enterprise)
 *   data-motion="lively" → animazioni più espressive (bounce/pulse/celebrazione)
 *
 * COLORI (fix dark-mode): le superfici NON usano fallback chiari hardcoded, che
 * in dark mode producevano testo bianco su fondo bianco. Si usano token "ponte"
 * (--ix-*) risolti con una catena di fallback che funziona in ENTRAMBI i
 * contesti: prima il token del brand (player SCORM), poi il token del tema web
 * (anteprima, in HSL), infine un valore di sistema sicuro. Ogni superficie
 * imposta SEMPRE la coppia background + colore del testo.
 *
 * Accessibilità: tutto ciò che è movimento viene annullato sotto
 * `prefers-reduced-motion: reduce`, mantenendo gli stati finali leggibili.
 */
export const INTERACTIONS_CSS = `/* interactions.css — micro-interazioni condivise web + SCORM (Blocco F) */

/* ============================================================================
   TOKEN PONTE — risolti da: brand (SCORM) → tema web (HSL) → sistema.
   Impostati sul contenitore [data-motion] così valgono in entrambi i contesti.
   ========================================================================== */
[data-motion] {
  /* Superficie delle card e colore del testo su di essa. */
  --ix-surface: var(--brand-surface, var(--card-rgb, #ffffff));
  --ix-on-surface: var(--brand-on-surface, var(--card-foreground-rgb, #1a1a1a));
  /* Superficie "elevata"/alternativa (header card, facce retro). */
  --ix-surface-2: var(--brand-surface, var(--muted-rgb, #f4f6fb));
  /* Primario e testo su primario. */
  --ix-primary: var(--brand-primary, var(--primary-rgb, #4f46e5));
  --ix-on-primary: var(--brand-on-primary, #ffffff);
  /* Accento del brand (secondary). Fallback: tema web, poi il primario — così
     se il brand non ha un secondary nulla cambia rispetto a prima. Colora link,
     stati attivi (accordion/tab), badge, hotspot e il ring di focus. */
  --ix-accent: var(--brand-secondary, var(--secondary-rgb, var(--ix-primary)));
  /* Bordi e ombre coerenti con il tema. */
  --ix-border: var(--brand-border, rgba(127, 127, 127, 0.22));
  --ix-ring: color-mix(in srgb, var(--ix-accent) 42%, transparent);
  --ix-shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.1);
  --ix-shadow-md: 0 4px 12px rgba(16, 24, 40, 0.1), 0 2px 4px rgba(16, 24, 40, 0.06);
  --ix-shadow-lg: 0 12px 28px rgba(16, 24, 40, 0.14), 0 4px 10px rgba(16, 24, 40, 0.08);
  --ix-radius: 14px;

  /* Movimento. 'sober' è il default anche in assenza di data-motion. */
  --mo-dur: 200ms;
  --mo-ease: cubic-bezier(0.4, 0, 0.2, 1);
  --mo-lift: -3px;
  --mo-pop: 1;
}
[data-motion="lively"] {
  --mo-dur: 280ms;
  --mo-ease: cubic-bezier(0.34, 1.56, 0.64, 1); /* overshoot morbido */
  --mo-lift: -5px;
  --mo-pop: 1.05;
}

/*
 * Ponte verso il tema web (anteprima Next.js): i token Tailwind sono triplette
 * HSL (es. --card: 222 42% 10%). Qui li avvolgo in hsl() così --ix-* li può
 * usare come fallback quando il brand non è presente. Nel player SCORM questi
 * non esistono e vince il token --brand-*; nessun conflitto.
 */
[data-motion] {
  --card-rgb: hsl(var(--card, 0 0% 100%));
  --card-foreground-rgb: hsl(var(--card-foreground, 222 47% 11%));
  --muted-rgb: hsl(var(--muted, 220 16% 95%));
  --primary-rgb: hsl(var(--primary, 243 75% 59%));
  --secondary-rgb: hsl(var(--secondary, 243 75% 59%));
}

/* Link brandizzati con l'accento (secondary). Vale in entrambi i contesti
   (player SCORM e anteprima web) perché INTERACTIONS_CSS è il foglio condiviso.
   Scoping su [data-motion] per non invadere la chrome dell'editor. */
[data-motion] a {
  color: var(--ix-accent);
  text-underline-offset: 2px;
}
[data-motion] a:hover { text-decoration: underline; }

/* ============================================================================
   FLASHCARD — flip 3D a due facce. Il flip avviene SOLO al click (aria-pressed),
   MAI on hover. L'hover applica solo un leggero sollevamento al contenitore.
   Markup: .flashcard[aria-pressed] > .flashcard-inner
             > .flashcard-face.is-front / .flashcard-face.is-back
   ========================================================================== */
.flashcards { display: flex; flex-wrap: wrap; gap: 1rem; }
.flashcard {
  position: relative;
  flex: 1 1 15rem;
  min-height: 10rem;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  perspective: 1200px;
  text-align: left;
  transition: transform var(--mo-dur) var(--mo-ease);
}
/* Sollevamento al passaggio del mouse: sul CONTENITORE, non sulle facce. */
.flashcard:hover { transform: translateY(var(--mo-lift)); }
.flashcard-inner {
  position: relative;
  width: 100%;
  min-height: 10rem;
  transform-style: preserve-3d;
  transition: transform calc(var(--mo-dur) + 120ms) var(--mo-ease);
}
/* La rotazione dipende ESCLUSIVAMENTE da aria-pressed (click). */
.flashcard[aria-pressed="true"] .flashcard-inner { transform: rotateY(180deg); }
.flashcard-face {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  padding: 1.25rem 1.35rem;
  border: 1px solid var(--ix-border);
  border-radius: var(--ix-radius);
  background: var(--ix-surface);
  color: var(--ix-on-surface);
  box-shadow: var(--ix-shadow-sm);
  overflow: auto;
}
.flashcard:hover .flashcard-face { box-shadow: var(--ix-shadow-lg); }
/* Il retro è pre-ruotato e ha una superficie leggermente diversa per gerarchia. */
.flashcard-face.is-back {
  transform: rotateY(180deg);
  background: var(--ix-surface-2);
  border-color: color-mix(in srgb, var(--ix-accent) 35%, var(--ix-border));
}
.flashcard-face-label {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  margin-bottom: 0.5rem;
  padding: 0.15rem 0.5rem;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ix-accent);
  background: color-mix(in srgb, var(--ix-accent) 12%, transparent);
  border-radius: 999px;
}
.flashcard:focus-visible { outline: none; }
.flashcard:focus-visible .flashcard-face { box-shadow: 0 0 0 3px var(--ix-ring), var(--ix-shadow-md); }

/* ============================================================================
   ACCORDION / TABS — espansione fluida con indicatore rotante.
   Markup: .accordion-head[aria-expanded] + .accordion-body[hidden]
   ========================================================================== */
.accordion-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  color: var(--ix-on-surface);
  transition: background var(--mo-dur) var(--mo-ease), color var(--mo-dur) var(--mo-ease);
}
.accordion-head::after {
  content: "";
  width: 0.6rem;
  height: 0.6rem;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(45deg);
  transition: transform var(--mo-dur) var(--mo-ease);
  opacity: 0.6;
}
.accordion-head[aria-expanded="true"]::after { transform: rotate(-135deg); }
.accordion-head[aria-expanded="true"] { color: var(--ix-accent); }
.accordion-head:hover { background: color-mix(in srgb, var(--ix-accent) 8%, transparent); }
.accordion-body {
  overflow: hidden;
  color: var(--ix-on-surface);
  animation: mo-reveal var(--mo-dur) var(--mo-ease);
}
.accordion-body[hidden] { display: none; }

/* TABS: pannelli con fade/slide all'attivazione */
.tabs-panel { animation: mo-reveal var(--mo-dur) var(--mo-ease); }
.tabs-tab { transition: color var(--mo-dur) var(--mo-ease), border-color var(--mo-dur) var(--mo-ease); }

/* ============================================================================
   CLICK REVEAL — stessa meccanica dell'accordion.
   ========================================================================== */
.reveal-trigger { color: var(--ix-on-surface); transition: background var(--mo-dur) var(--mo-ease); }
.reveal-trigger:hover { background: color-mix(in srgb, var(--ix-accent) 8%, transparent); }
.reveal-body { color: var(--ix-on-surface); animation: mo-reveal var(--mo-dur) var(--mo-ease); }
.reveal-body[hidden] { display: none; }

/* ============================================================================
   IMAGE HOTSPOT — punti pulsanti con "ping" (solo lively) e pop all'attivazione.
   Markup: .hotspot-dot[aria-pressed], box info .hotspot-info
   ========================================================================== */
/* GEOMETRIA del hotspot: deve stare qui (foglio condiviso) perché l'anteprima
   web NON carica player.css. Senza queste regole i dot non sono posizionati e
   finiscono in fondo invece che alle coordinate (left/top) impostate. */
/* Immagini illustrative dei block: dimensione contenuta e leggibile (evita che
   immagini native enormi occupino tutta la pagina). Vale in anteprima, editor
   ed export (foglio condiviso). */
.block-media {
  display: block;
  width: auto;
  max-width: min(100%, 32rem);
  max-height: 24rem;
  height: auto;
  object-fit: contain;
  margin: 0.85rem auto;
  border-radius: 12px;
}
.block-media-figure { margin: 0.85rem 0; }
.block-media-figure .block-media { margin: 0.85rem 0 0; }
.carousel-view .block-media { max-width: 100%; }

/* Immagine interattiva: lo stage non deve superare un'altezza fruibile; i dot
   sono posizionati in % quindi restano coerenti con l'immagine ridimensionata. */
.hotspot-stage { position: relative; display: inline-block; max-width: 100%; }
.hotspot-stage img {
  display: block;
  max-width: 100%;
  max-height: 26rem;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 12px;
}
.hotspot-dot {
  position: absolute;
  width: 1.7rem; height: 1.7rem;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.8rem; font-weight: 700; cursor: pointer;
  background: var(--ix-accent);
  color: var(--ix-on-primary);
  border: 2px solid var(--ix-surface);
  box-shadow: var(--ix-shadow-md);
  transition: transform var(--mo-dur) var(--mo-ease), box-shadow var(--mo-dur) var(--mo-ease);
}
.hotspot-dot:hover { transform: translate(-50%, -50%) scale(1.14); }
.hotspot-dot[aria-pressed="true"] {
  transform: translate(-50%, -50%) scale(1.18);
  box-shadow: 0 0 0 5px var(--ix-ring), var(--ix-shadow-md);
}
/* Popover info: posizionato DENTRO lo stage, ancorato al pallino attivo
   (left/top impostati dall'adapter in %). data-pos="below" apre sotto il dot,
   "above" sopra. Larghezza limitata e centrato orizzontalmente sul dot. */
.hotspot-info {
  position: absolute;
  z-index: 5;
  width: max-content;
  max-width: min(20rem, 80%);
  padding: 0.7rem 0.9rem;
  background: var(--ix-surface);
  color: var(--ix-on-surface);
  border: 1px solid var(--ix-border);
  border-radius: var(--ix-radius);
  box-shadow: var(--ix-shadow-lg);
  animation: mo-reveal var(--mo-dur) var(--mo-ease);
}
.hotspot-info[data-pos="below"] { transform: translate(-50%, 1rem); }
.hotspot-info[data-pos="above"] { transform: translate(-50%, calc(-100% - 1rem)); }
/* Freccetta del fumetto verso il dot. */
.hotspot-info::after {
  content: "";
  position: absolute;
  left: 50%;
  width: 10px; height: 10px;
  background: var(--ix-surface);
  border: 1px solid var(--ix-border);
  transform: translateX(-50%) rotate(45deg);
}
.hotspot-info[data-pos="below"]::after { top: -6px; border-right: 0; border-bottom: 0; }
.hotspot-info[data-pos="above"]::after { bottom: -6px; border-left: 0; border-top: 0; }
.hotspot-info .hotspot-title { font-weight: 700; margin: 0 0 0.3rem; }
.hotspot-info > :last-child { margin-bottom: 0; }
/* Alone pulsante continuo per attirare l'attenzione: solo in 'lively'. */
[data-motion="lively"] .hotspot-dot::before {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 2px solid var(--ix-accent);
  animation: mo-ping 1.8s var(--mo-ease) infinite;
}
[data-motion="lively"] .hotspot-dot[aria-pressed="true"]::before { animation: none; }

/* ============================================================================
   DRAG & DROP / SORTING / ORDER / SCENARIO — layout e stato dei block
   interattivi "stateful". DEVE stare qui (foglio condiviso) perché l'anteprima
   web non carica player.css: senza, questi block sono senza stile e sembrano
   non funzionanti.
   ========================================================================== */
.dnd-prompt { font-weight: 600; margin: 0 0 0.75rem; }
.dnd-pool { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
.dnd-chip { border: 1px solid var(--ix-border); background: var(--ix-surface); color: var(--ix-on-surface); border-radius: 999px; padding: 0.4rem 0.85rem; font-size: 0.9rem; font-weight: 600; cursor: grab; transition: transform var(--mo-dur) var(--mo-ease), box-shadow var(--mo-dur) var(--mo-ease), border-color var(--mo-dur) var(--mo-ease); }
.dnd-chip:hover { transform: translateY(var(--mo-lift)); box-shadow: var(--ix-shadow-sm); }
.dnd-chip.is-picked { border-color: var(--ix-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ix-accent) 40%, transparent); }
.dnd-chip.is-used { opacity: 0.4; cursor: default; }
.dnd-slots { display: flex; flex-direction: column; gap: 0.6rem; }
.dnd-row { display: flex; align-items: center; gap: 0.75rem; }
.dnd-left { flex: 1; font-size: 0.95rem; }
.dnd-slot { min-width: 12rem; border: 2px dashed var(--ix-border); border-radius: 10px; padding: 0.55rem 0.85rem; text-align: left; background: transparent; color: var(--ix-on-surface); cursor: pointer; font-size: 0.9rem; transition: border-color var(--mo-dur) var(--mo-ease), background var(--mo-dur) var(--mo-ease); }
.dnd-slot:hover { border-color: var(--ix-accent); }
.dnd-slot.is-filled { border-style: solid; background: color-mix(in srgb, var(--ix-accent) 8%, transparent); color: var(--ix-on-surface); font-weight: 600; }

.order-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.order-row { display: flex; align-items: center; gap: 0.75rem; border: 1px solid var(--ix-border); background: var(--ix-surface); border-radius: 10px; padding: 0.55rem 0.75rem; box-shadow: var(--ix-shadow-sm); }
.order-handle { color: var(--ix-on-surface); opacity: 0.6; cursor: grab; }
.order-num { display: inline-grid; place-items: center; width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--ix-accent); color: var(--ix-on-primary); font-size: 0.75rem; font-weight: 700; }
.order-label { flex: 1; }
.order-actions { display: flex; gap: 0.25rem; }
.order-btn { border: 1px solid var(--ix-border); background: var(--ix-surface); color: var(--ix-on-surface); border-radius: 6px; padding: 0.1rem 0.5rem; cursor: pointer; }
.order-btn:disabled { opacity: 0.3; cursor: default; }

.sorting-pool { padding: 0.75rem; border: 1px dashed var(--ix-border); border-radius: 12px; margin-bottom: 1rem; min-height: 3rem; }
.sorting-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.9rem; }
.sorting-bucket { border: 2px dashed var(--ix-border); border-radius: 12px; padding: 0.75rem; transition: border-color var(--mo-dur) var(--mo-ease); }
.sorting-bucket:hover { border-color: var(--ix-accent); }
.sorting-bucket-title { font-weight: 700; margin: 0 0 0.5rem; }
.sorting-zone { display: flex; flex-wrap: wrap; gap: 0.5rem; min-height: 2.25rem; }
.dnd-chip.is-placed { cursor: pointer; }
.dnd-chip.is-correct { border-color: #16a34a; background: color-mix(in srgb, #16a34a 14%, transparent); color: #15803d; }
.dnd-chip.is-wrong { border-color: #dc2626; background: color-mix(in srgb, #dc2626 12%, transparent); color: #b91c1c; }

/* Libro-game "pillole": PLAYER unico. Il video riempie il "palco" e gli overlay
   (testo, scelte, esito) sono sovrapposti, così l'interazione è tutta nel player.
   FULLSCREEN: va a schermo intero lo STAGE (contenitore), non il <video>: così
   gli overlay (scelte/esito) restano sovrapposti anche in fullscreen. */
.scenario-stage { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: #000; }
.scenario-stage:fullscreen { width: 100vw; height: 100vh; aspect-ratio: auto; border-radius: 0; }
.scenario-stage:-webkit-full-screen { width: 100vw; height: 100vh; border-radius: 0; }
.scenario-video, .scenario-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
.scenario-preload { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; left: -9999px; }
.scenario-video-placeholder { position: absolute; inset: 0; display: grid; place-items: center; padding: 1rem; background: color-mix(in srgb, var(--ix-accent) 10%, #111); color: #fff; font-size: 0.9rem; text-align: center; }
/* Strato overlay a tutta area: non cattura i click dove non serve. Un'unica
   colonna in basso; il blocco scelte ha un tetto d'altezza e scrolla da solo. */
.scenario-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 0.75rem; padding: 1rem clamp(1rem, 4%, 2rem) clamp(1rem, 4%, 1.75rem); pointer-events: none; background: linear-gradient(to bottom, rgba(0,0,0,0) 45%, rgba(0,0,0,0.6) 100%); }
.scenario-overlay .scenario-text { color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,0.55); font-size: clamp(1rem, 2.4vw, 1.4rem); line-height: 1.35; max-width: 70ch; }
/* Scelte in overlay: cliccabili (riattiva pointer-events), impilate in basso.
   Non devono MAI sforare il player: tetto d'altezza + scroll interno elegante,
   così con molte scelte compare uno scroll invece di essere tagliate. */
.scenario-choices--overlay { pointer-events: auto; display: flex; flex-direction: column; gap: 0.5rem; max-height: min(60%, 18rem); overflow-y: auto; padding-right: 0.25rem; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.35) transparent; -webkit-overflow-scrolling: touch; }
.scenario-choices--overlay::-webkit-scrollbar { width: 6px; }
.scenario-choices--overlay::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.35); border-radius: 999px; }
.scenario-stage:fullscreen .scenario-choices--overlay { max-height: min(50vh, 22rem); }
.scenario-choice { display: block; width: 100%; flex: 0 0 auto; text-align: left; padding: 0.6rem 0.9rem; border: 1px solid rgba(255,255,255,0.35); border-radius: 12px; background: rgba(17,24,39,0.72); color: #fff; backdrop-filter: blur(4px); font-size: clamp(0.9rem, 1.6vw, 1.05rem); line-height: 1.3; cursor: pointer; transition: border-color var(--mo-dur) var(--mo-ease), background var(--mo-dur) var(--mo-ease), transform var(--mo-dur) var(--mo-ease); }
.scenario-choice:hover { border-color: var(--ix-accent); background: color-mix(in srgb, var(--ix-accent) 55%, rgba(17,24,39,0.72)); transform: translateY(var(--mo-lift)); }
.scenario-choices.is-gated[hidden] { display: none; }
/* Pulsante FULLSCREEN custom: in alto a destra, va a schermo intero lo stage. */
.scenario-fs-btn { position: absolute; top: 0.6rem; right: 0.6rem; z-index: 2; pointer-events: auto; display: grid; place-items: center; width: 2.25rem; height: 2.25rem; padding: 0; border: 1px solid rgba(255,255,255,0.35); border-radius: 10px; background: rgba(17,24,39,0.6); color: #fff; backdrop-filter: blur(4px); font-size: 1.05rem; line-height: 1; cursor: pointer; transition: background var(--mo-dur) var(--mo-ease), border-color var(--mo-dur) var(--mo-ease); }
.scenario-fs-btn:hover { border-color: var(--ix-accent); background: rgba(17,24,39,0.82); }
/* Esito finale: pannello centrale sopra il video. */
.scenario-outcome { pointer-events: auto; align-self: center; margin-top: auto; margin-bottom: auto; display: grid; gap: 0.75rem; justify-items: center; text-align: center; padding: 1.25rem 1.5rem; border-radius: 14px; background: rgba(17,24,39,0.82); color: #fff; backdrop-filter: blur(6px); max-height: 80%; overflow-y: auto; }
.scenario-outcome .scenario-end { margin: 0; font-size: clamp(1.05rem, 2.6vw, 1.5rem); font-weight: 700; }
.scenario-restart { pointer-events: auto; padding: 0.6rem 1.1rem; border: 1px solid rgba(255,255,255,0.4); border-radius: 999px; background: var(--ix-accent); color: var(--ix-on-primary, #fff); font-weight: 600; cursor: pointer; }
.scenario-restart:hover { transform: scale(var(--mo-pop)); }

/* ============================================================================
   QUIZ / ASSESSMENT — feedback immediato animato.
   Markup: .assessment-feedback.is-pass | .is-fail, .question-input .opt
   ========================================================================== */
.question-input .opt {
  color: var(--ix-on-surface);
  border: 1px solid var(--ix-border);
  border-radius: 10px;
  transition: background var(--mo-dur) var(--mo-ease), border-color var(--mo-dur) var(--mo-ease), transform var(--mo-dur) var(--mo-ease);
}
.question-input .opt:hover {
  transform: translateY(var(--mo-lift));
  border-color: color-mix(in srgb, var(--ix-primary) 45%, var(--ix-border));
  background: color-mix(in srgb, var(--ix-primary) 6%, transparent);
}
.assessment-submit {
  transition: transform var(--mo-dur) var(--mo-ease), opacity var(--mo-dur) var(--mo-ease), box-shadow var(--mo-dur) var(--mo-ease);
}
.assessment-submit:hover:not(:disabled) { transform: scale(var(--mo-pop)); box-shadow: var(--ix-shadow-md); }
.assessment-feedback { animation: mo-reveal var(--mo-dur) var(--mo-ease); }
.assessment-feedback.is-pass { animation: mo-pop var(--mo-dur) var(--mo-ease); }
.assessment-feedback.is-fail { animation: mo-shake var(--mo-dur) var(--mo-ease); }

/* Spunta sul superamento. */
.assessment-feedback.is-pass::before {
  content: "\\2713 ";
  font-weight: 700;
}
[data-motion="lively"] .assessment-feedback.is-pass { animation: mo-bounce 440ms var(--mo-ease); }

/* ============================================================================
   PROGRESS — avanzamento con riempimento fluido.
   ========================================================================== */
.course-progress-fill { transition: width 460ms var(--mo-ease); }

/* ============================================================================
   KEYFRAMES
   ========================================================================== */
@keyframes mo-reveal {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes mo-pop {
  0%   { transform: scale(0.96); }
  60%  { transform: scale(1.03); }
  100% { transform: scale(1); }
}
@keyframes mo-bounce {
  0%   { transform: translateY(0) scale(0.96); }
  40%  { transform: translateY(-6px) scale(1.04); }
  70%  { transform: translateY(0) scale(0.99); }
  100% { transform: translateY(0) scale(1); }
}
@keyframes mo-shake {
  0%, 100% { transform: translateX(0); }
  25%      { transform: translateX(-4px); }
  75%      { transform: translateX(4px); }
}
@keyframes mo-ping {
  0%   { transform: scale(1); opacity: 0.7; }
  80%, 100% { transform: scale(1.9); opacity: 0; }
}

/* ============================================================================
   ACCESSIBILITÀ — rispetta prefers-reduced-motion: niente movimento, stati
   finali leggibili. Il flip diventa un cambio istantaneo di faccia.
   ========================================================================== */
@media (prefers-reduced-motion: reduce) {
  [data-motion] *,
  [data-motion] *::before,
  [data-motion] *::after {
    animation: none !important;
    transition: none !important;
  }
  .flashcard-inner { transition: none !important; }
}

/* ============================================================================
   LEZIONE VIDEO-FIRST a due colonne (condivisa anteprima + SCORM): video grande
   a sinistra, barra a TAB verticale a destra con Contenuto / Attività
   (interazioni) / Trascrizione (karaoke). Scoping [data-motion] così vale in
   entrambi i contesti; usa i token --ix-* (brand → tema web → sistema).
   ========================================================================== */
[data-motion] .block.video.video-withpanel {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 1.25rem;
  align-items: start;
}
[data-motion] .block.video .video-col { min-width: 0; }
[data-motion] .block.video .video-frame {
  position: relative; width: 100%; aspect-ratio: 16 / 9;
  background: #000; border-radius: var(--ix-radius); overflow: hidden;
}
[data-motion] .block.video .video-frame video,
[data-motion] .block.video .video-frame iframe {
  position: absolute; inset: 0; width: 100%; height: 100%; border: 0;
}
[data-motion] .block.video .video-placeholder {
  display: grid; place-items: center; aspect-ratio: 16 / 9; width: 100%;
  border: 1px dashed var(--ix-border); border-radius: var(--ix-radius);
  background: color-mix(in srgb, var(--ix-on-surface) 8%, var(--ix-surface));
  color: var(--ix-on-surface); font-size: 0.9rem;
}
[data-motion] .block.video .video-alt { margin: 0.4rem 0 0; font-size: 0.8rem; opacity: 0.75; }

/* Pannello laterale a tab */
[data-motion] .block.video .video-panel {
  min-width: 0; border: 1px solid var(--ix-border); border-radius: var(--ix-radius);
  background: var(--ix-surface); overflow: hidden; display: flex; flex-direction: column;
}
[data-motion] .block.video.lesson-videofirst-vnext .video-panel { align-self: stretch; }
[data-motion] .block.video .video-tabs {
  display: flex; gap: 0.25rem; padding: 0.4rem 0.4rem 0;
  border-bottom: 1px solid var(--ix-border);
  background: color-mix(in srgb, var(--ix-on-surface) 5%, var(--ix-surface));
}
[data-motion] .block.video .vf-tabs-vertical { flex-wrap: nowrap; overflow-x: auto; }
[data-motion] .block.video .video-tab {
  border: 0; border-bottom: 2px solid transparent; background: transparent;
  padding: 0.45rem 0.7rem; font-size: 0.78rem; font-weight: 700;
  color: color-mix(in srgb, var(--ix-on-surface) 60%, transparent);
  cursor: pointer; border-radius: 6px 6px 0 0; white-space: nowrap;
}
[data-motion] .block.video .video-tab.is-active {
  color: var(--ix-on-surface); border-bottom-color: var(--ix-accent); background: var(--ix-surface);
}
[data-motion] .block.video .video-panel-body { padding: 0.75rem; overflow-y: auto; flex: 1 1 auto; }
[data-motion] .block.video.lesson-videofirst-vnext .video-panel-body { max-height: none; }
[data-motion] .block.video .vf-section-title { margin: 0.75rem 0 0.25rem; font-size: 0.9rem; font-weight: 700; }
[data-motion] .block.video .vf-section-body { font-size: 0.9rem; line-height: 1.55; }
[data-motion] .block.video .vf-section-body:not(:last-child) { margin-bottom: 0.75rem; }

/* Trascrizione karaoke */
[data-motion] .block.video .video-transcript { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
[data-motion] .block.video .transcript-cue {
  display: block; width: 100%; text-align: left; border: 0; background: transparent;
  padding: 0.3rem 0.5rem; border-radius: 6px; font-size: 0.88rem; line-height: 1.5;
  color: color-mix(in srgb, var(--ix-on-surface) 70%, transparent); cursor: pointer;
}
[data-motion] .block.video .transcript-cue:hover { background: color-mix(in srgb, var(--ix-primary) 8%, transparent); }
[data-motion] .block.video .transcript-cue.is-active {
  background: color-mix(in srgb, var(--ix-primary) 14%, transparent); color: var(--ix-on-surface); font-weight: 600;
}
[data-motion] .block.video .cue-time { margin-right: 0.5rem; font-size: 0.66rem; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--ix-primary) 70%, var(--ix-on-surface)); }
[data-motion] .block.video .cue-speaker { font-weight: 700; margin-right: 0.25rem; }
[data-motion] .block.video .video-transcript-empty { margin: 0; font-size: 0.8rem; opacity: 0.7; }

@media (max-width: 860px) {
  [data-motion] .block.video.video-withpanel { grid-template-columns: 1fr; }
}

/* ============================================================================
   PILLOLA — contenitore scorrevole coerente: ogni blocco è una CARD distinta,
   con etichetta di ruolo e stile diverso per CONTENUTO vs AZIONI.
   ========================================================================== */
[data-motion] .lesson-pillola { display: flex; flex-direction: column; gap: 1.1rem; }
[data-motion] .lesson-pillola .pillola-card {
  border: 1px solid var(--ix-border);
  border-radius: calc(var(--ix-radius) + 2px);
  background: var(--ix-surface);
  overflow: hidden;
  box-shadow: var(--ix-shadow-sm, 0 1px 2px rgba(0,0,0,0.06));
}
[data-motion] .lesson-pillola .pillola-card-head {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0.9rem;
  border-bottom: 1px solid var(--ix-border);
  background: color-mix(in srgb, var(--ix-on-surface) 4%, var(--ix-surface));
}
[data-motion] .lesson-pillola .pillola-card-badge {
  font-size: 0.66rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 0.18rem 0.55rem; border-radius: 999px;
  color: var(--ix-on-primary, #fff);
}
[data-motion] .lesson-pillola .pillola-card-body { padding: 1rem 1.1rem; }
[data-motion] .lesson-pillola .pillola-card-body > .block { margin: 0; }
/* CONTENUTO ("impara"): accento neutro/brand, bordo sinistro sobrio. */
[data-motion] .lesson-pillola .pillola-card--content { border-left: 4px solid color-mix(in srgb, var(--ix-primary) 60%, var(--ix-border)); }
[data-motion] .lesson-pillola .pillola-card--content .pillola-card-badge { background: color-mix(in srgb, var(--ix-primary) 70%, var(--ix-on-surface)); }
/* AZIONE ("mettiti alla prova"): accento vivo, stacco visivo netto. */
[data-motion] .lesson-pillola .pillola-card--action { border-left: 4px solid var(--ix-accent); background: color-mix(in srgb, var(--ix-accent) 4%, var(--ix-surface)); }
[data-motion] .lesson-pillola .pillola-card--action .pillola-card-head { background: color-mix(in srgb, var(--ix-accent) 10%, var(--ix-surface)); }
[data-motion] .lesson-pillola .pillola-card--action .pillola-card-badge { background: var(--ix-accent); }

/* ============================================================================
   CALLOUT — box evidenziati nel testo del formato Standard: Consiglio (tip),
   Attenzione (warning), Definizione (def). Markup generato nell'HTML del
   rich_text: <div class="callout callout-tip|callout-warning|callout-def">…</div>.
   Usano i token --ix-* (brand → tema web → sistema), con un colore d'accento
   per tipo ricavato via color-mix così resta leggibile anche in dark mode.
   ========================================================================== */
[data-motion] .callout {
  --cl: var(--ix-primary);
  position: relative;
  margin: 1rem 0;
  padding: 0.85rem 1rem 0.85rem 2.4rem;
  border-radius: var(--ix-radius);
  border: 1px solid color-mix(in srgb, var(--cl) 30%, var(--ix-border));
  border-left: 4px solid var(--cl);
  background: color-mix(in srgb, var(--cl) 8%, var(--ix-surface));
  color: var(--ix-on-surface);
}
[data-motion] .callout > :first-child { margin-top: 0; }
[data-motion] .callout > :last-child { margin-bottom: 0; }
/* Etichetta + icona del tipo, generata via ::before (nessun markup extra). */
[data-motion] .callout::before {
  position: absolute;
  left: 0.8rem;
  top: 0.85rem;
  font-size: 1rem;
  line-height: 1.3;
}
[data-motion] .callout-tip { --cl: var(--ix-accent); }
[data-motion] .callout-tip::before { content: "\\1F4A1"; }      /* 💡 */
[data-motion] .callout-warning { --cl: #d97706; }
[data-motion] .callout-warning::before { content: "\\26A0\\FE0F"; } /* ⚠️ */
[data-motion] .callout-def { --cl: var(--ix-primary); }
[data-motion] .callout-def::before { content: "\\1F4D8"; }      /* 📘 */

/* ============================================================================
   LEZIONE PILLOLA INTERATTIVA (libro-game): lo scenario a tutto riquadro.
   Il player dello scenario (.scenario-stage) è già stilizzato; qui diamo al
   contenitore larghezza piena e un po' di respiro all'eventuale intro.
   ========================================================================== */
[data-motion] .lesson-pillola-interattiva { display: flex; flex-direction: column; gap: 1rem; }
[data-motion] .lesson-pillola-interattiva .pillola-interattiva-intro { max-width: 70ch; }
[data-motion] .lesson-pillola-interattiva .pillola-interattiva-stage { width: 100%; }
[data-motion] .lesson-pillola-interattiva .pillola-interattiva-stage .block.scenario { margin: 0; }
`;
