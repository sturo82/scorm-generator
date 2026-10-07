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
  /* Bordi e ombre coerenti con il tema. */
  --ix-border: var(--brand-border, rgba(127, 127, 127, 0.22));
  --ix-ring: color-mix(in srgb, var(--ix-primary) 42%, transparent);
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
}

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
  border-color: color-mix(in srgb, var(--ix-primary) 35%, var(--ix-border));
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
  color: var(--ix-primary);
  background: color-mix(in srgb, var(--ix-primary) 12%, transparent);
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
.accordion-head[aria-expanded="true"] { color: var(--ix-primary); }
.accordion-head:hover { background: color-mix(in srgb, var(--ix-primary) 8%, transparent); }
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
.reveal-trigger:hover { background: color-mix(in srgb, var(--ix-primary) 8%, transparent); }
.reveal-body { color: var(--ix-on-surface); animation: mo-reveal var(--mo-dur) var(--mo-ease); }
.reveal-body[hidden] { display: none; }

/* ============================================================================
   IMAGE HOTSPOT — punti pulsanti con "ping" (solo lively) e pop all'attivazione.
   Markup: .hotspot-dot[aria-pressed], box info .hotspot-info
   ========================================================================== */
.hotspot-dot {
  background: var(--ix-primary);
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
.hotspot-info {
  background: var(--ix-surface);
  color: var(--ix-on-surface);
  border: 1px solid var(--ix-border);
  border-radius: var(--ix-radius);
  box-shadow: var(--ix-shadow-md);
  animation: mo-reveal var(--mo-dur) var(--mo-ease);
}
/* Alone pulsante continuo per attirare l'attenzione: solo in 'lively'. */
[data-motion="lively"] .hotspot-dot::before {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 2px solid var(--ix-primary);
  animation: mo-ping 1.8s var(--mo-ease) infinite;
}
[data-motion="lively"] .hotspot-dot[aria-pressed="true"]::before { animation: none; }

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
`;
