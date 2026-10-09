/**
 * Template HTML dell'entrypoint di uno SCO (pagina di un modulo). Carica il
 * tema del brand e gli asset del runtime, poi avvia il player sul modulo
 * indicato. Nessuna risorsa esterna: tutto è relativo al pacchetto (offline,
 * Requisito 9.4).
 */
export interface PageTemplateInput {
  courseTitle: string;
  language: string;
}

export function renderScoPage(input: PageTemplateInput): string {
  const title = escapeHtml(input.courseTitle);
  return `<!doctype html>
<html lang="${escapeHtml(input.language)}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <link rel="stylesheet" href="../assets/theme/theme.css"/>
  <link rel="stylesheet" href="../assets/player.css"/>
  <link rel="stylesheet" href="../assets/interactions.css"/>
</head>
<body>
  <div id="root" role="application" aria-label="${title}">
    <!-- Loader iniziale: visibile subito mentre gli script del runtime caricano;
         il player svuota #root al primo render e il loader scompare. -->
    <div class="course-loader" role="status" aria-live="polite">
      <span class="course-loader-spinner" aria-hidden="true"></span>
      <span class="course-loader-text">Caricamento del corso…</span>
    </div>
  </div>
  <script src="../runtime/scorm-api.js"></script>
  <script src="../runtime/scoring.js"></script>
  <script src="../runtime/render-core.js"></script>
  <script src="../runtime/renderers.js"></script>
  <script src="../runtime/player.js"></script>
  <script src="../content/course.js"></script>
  <script src="../runtime/semantic-runtime.js"></script>
  <script src="../runtime/rag.js"></script>
  <script>
    (function () {
      var course = window.__COURSE__;
      var player = new window.Player(course, { scorm: window.SCORM, root: document.getElementById('root') });
      // Esposto per il widget RAG "Chiedi al corso" (salto alla lezione).
      window.__player__ = player;
      // Fruizione a step con gating: il player gestisce l'intera sequenza
      // (lezioni + test) e il bookmark ripristina l'ultimo step raggiunto.
      player.start();
    })();
  </script>
</body>
</html>`;
}

/**
 * Stylesheet di base del player (layout, header, nav, quiz). I colori/font
 * vengono dal tema brand (theme.css). Le micro-interazioni dei block (flashcard,
 * hotspot, accordion, ecc.) sono in interactions.css, caricato DOPO, che quindi
 * ha la precedenza sulle regole condivise. Qui si cura la cornice premium:
 * tipografia, spaziatura, superfici, ombre a più livelli.
 */
export const PLAYER_CSS = `/* player.css — cornice del player; i colori/font vengono dal tema brand */
:root {
  --pl-surface: var(--brand-surface, #ffffff);
  --pl-on-surface: var(--brand-on-surface, #1a2130);
  --pl-primary: var(--brand-primary, #4f46e5);
  --pl-on-primary: var(--brand-on-primary, #ffffff);
  /* Accento del brand (secondary); fallback al primario se non definito. */
  --pl-accent: var(--brand-secondary, var(--pl-primary));
  --pl-bg: color-mix(in srgb, var(--pl-on-surface) 4%, var(--pl-surface));
  --pl-border: color-mix(in srgb, var(--pl-on-surface) 14%, transparent);
  --pl-muted: color-mix(in srgb, var(--pl-on-surface) 60%, transparent);
  --pl-radius: 16px;
  --pl-shadow-sm: 0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.1);
  --pl-shadow-md: 0 8px 24px rgba(16,24,40,0.1), 0 2px 6px rgba(16,24,40,0.06);
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0; line-height: 1.65;
  color: var(--pl-on-surface);
  font-family: var(--brand-font-body, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
  -webkit-font-smoothing: antialiased;
  /* Ambiente brandizzato: sfumatura morbida derivata dal colore primario, così
     anche palette neutre non risultano piatte. */
  background:
    radial-gradient(1200px 420px at 50% -140px, color-mix(in srgb, var(--pl-primary) 16%, transparent), transparent),
    var(--pl-bg);
  background-attachment: fixed;
  min-height: 100vh;
}
h1, h2, h3, h4 { font-family: var(--brand-font-heading, inherit); line-height: 1.25; letter-spacing: -0.01em; }
/* padding-bottom ampio: lascia spazio alla barra di navigazione fissa in basso. */
#root { max-width: none; margin: 0; padding: 2rem clamp(1.25rem, 4vw, 4rem) 7rem; }

/* Loader iniziale premium: spinner brandizzato centrato finché il player monta. */
.course-loader {
  position: fixed; inset: 0; z-index: 60;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem;
  background: var(--pl-bg);
}
.course-loader-spinner {
  width: 46px; height: 46px; border-radius: 50%;
  border: 4px solid color-mix(in srgb, var(--pl-primary) 22%, transparent);
  border-top-color: var(--pl-primary);
  animation: course-spin 0.8s linear infinite;
}
.course-loader-text { font-size: 0.9rem; font-weight: 600; color: var(--pl-muted); letter-spacing: 0.02em; }
@keyframes course-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .course-loader-spinner { animation-duration: 2s; } }

/* Barra di avanzamento */
.course-progress { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.75rem; font-size: 0.78rem; font-weight: 600; color: var(--pl-muted); }
.course-progress-bar { flex: 1; height: 8px; background: color-mix(in srgb, var(--pl-on-surface) 10%, transparent); border-radius: 999px; overflow: hidden; }
.course-progress-fill { height: 100%; background: linear-gradient(90deg, var(--pl-primary), var(--pl-accent)); border-radius: 999px; transition: width 0.45s cubic-bezier(0.4,0,0.2,1); }

/* Header + hero */
.course-header { margin-bottom: 1.75rem; }
.course-header h1 { font-size: 1.9rem; margin: 0 0 0.4rem; font-weight: 800; }
.course-header p { margin: 0; color: var(--pl-primary); font-weight: 600; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.04em; }
.course-hero { display: block; width: 100%; max-height: 340px; object-fit: cover; border-radius: var(--pl-radius); margin-bottom: 1.5rem; box-shadow: var(--pl-shadow-md); }

/* Card principale del contenuto */
.course-main {
  background: var(--pl-surface);
  color: var(--pl-on-surface);
  border: 1px solid var(--pl-border);
  border-radius: var(--pl-radius);
  padding: 2rem;
  box-shadow: var(--pl-shadow-sm);
}
.course-main > :first-child { margin-top: 0; }

/* Audio della lezione */
.lesson-audio { margin: 0 0 1.5rem; padding: 0.9rem 1.1rem; border: 1px solid var(--pl-border); border-radius: 12px; background: color-mix(in srgb, var(--pl-primary) 5%, transparent); }
.lesson-audio p { margin: 0 0 0.5rem; font-size: 0.82rem; font-weight: 700; color: var(--pl-primary); text-transform: uppercase; letter-spacing: 0.04em; }
.lesson-audio audio { width: 100%; }
.scroll-sentinel { height: 1px; }

/* Navigazione */
/* Navigazione Avanti/Precedente SEMPRE visibile: barra fissa in basso (premium),
   con sfondo sfumato e ombra. Il contenuto ha padding-bottom per non finirci
   sotto (vedi #root). */
.course-nav {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
  display: flex; justify-content: space-between; align-items: center; gap: 1rem;
  margin: 0; padding: 0.75rem clamp(1rem, 4vw, 2rem);
  background: color-mix(in srgb, var(--pl-surface) 90%, transparent);
  border-top: 1px solid var(--pl-border);
  box-shadow: 0 -6px 20px rgba(16,24,40,0.08);
  backdrop-filter: saturate(140%) blur(8px);
  -webkit-backdrop-filter: saturate(140%) blur(8px);
}
.course-nav button {
  background: var(--pl-primary); color: var(--pl-on-primary); border: 0;
  padding: 0.8rem 1.6rem; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 0.95rem;
  box-shadow: var(--pl-shadow-sm);
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}
.course-nav button:hover:not(:disabled) { transform: translateY(-2px); box-shadow: var(--pl-shadow-md); }
.course-nav button:active:not(:disabled) { transform: translateY(0); }
.course-nav button:disabled { opacity: 0.4; cursor: not-allowed; }
.nav-hint { font-size: 0.8rem; color: var(--pl-muted); text-align: center; flex: 1; }

/* Assessment / quiz */
.assessment-title { font-size: 1.35rem; margin: 0 0 1rem; font-weight: 800; }
.assessment-intro { background: color-mix(in srgb, var(--pl-primary) 8%, transparent); border-left: 4px solid var(--pl-primary); padding: 0.8rem 1.1rem; border-radius: 0 10px 10px 0; font-size: 0.92rem; }
.question { border: 1px solid var(--pl-border); border-radius: 14px; padding: 1.25rem; margin: 1.25rem 0; background: var(--pl-surface); }
.question legend { font-weight: 700; padding: 0 0.4rem; }
.question-input { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.75rem; }
.question-input .opt { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.8rem; cursor: pointer; }
.assessment-submit {
  margin-top: 1.25rem; background: var(--pl-primary); color: var(--pl-on-primary); border: 0;
  padding: 0.8rem 1.6rem; border-radius: 10px; cursor: pointer; font-weight: 700; box-shadow: var(--pl-shadow-sm);
}
.assessment-submit:disabled { opacity: 0.5; cursor: default; }
.assessment-feedback { margin-top: 1.25rem; padding: 0.9rem 1.1rem; border-radius: 12px; font-weight: 600; }
.assessment-feedback.is-pass { background: color-mix(in srgb, #16a34a 14%, transparent); color: #15803d; }
.assessment-feedback.is-fail { background: color-mix(in srgb, #dc2626 12%, transparent); color: #b91c1c; }
.course-done { text-align: center; padding: 3.5rem 1rem; }

/* Block generici */
.block { margin: 1.5rem 0; }
.block-rich { color: var(--pl-on-surface); }
.block-media {
  display: block; max-width: 100%; height: auto; margin: 0.85rem 0;
  border-radius: 12px;
}
.carousel-view .block-media { max-width: 36rem; }
.block-media-figure { margin: 0.85rem 0; }
.block-media-figure .block-media { margin: 0; }
.block-media-credit {
  margin: 0.3rem 0 0; font-size: 0.75rem; color: var(--pl-on-surface-variant, #666);
}
.block-media-credit a { color: inherit; text-decoration: underline; }
.accordion-head, .reveal-trigger {
  display: flex; width: 100%; text-align: left; padding: 0.85rem 1rem;
  border: 1px solid var(--pl-border); border-radius: 12px;
  background: var(--pl-surface); color: var(--pl-on-surface);
  cursor: pointer; font-weight: 600; margin-top: 0.5rem;
}
.accordion-body, .reveal-body { padding: 0.5rem 1rem 1rem; }
/* NB: geometria e popover dell'image_hotspot sono in INTERACTIONS_CSS (foglio
   condiviso con l'anteprima web), caricato dopo questo: non duplicare qui. */

/* Video (block video_checkpoint): player 16:9 pulito, segnaposto se non caricato */
.block.video .video-frame {
  position: relative; width: 100%; aspect-ratio: 16 / 9;
  border-radius: 14px; overflow: hidden; background: #000;
  box-shadow: var(--pl-shadow-md, 0 8px 24px rgba(0,0,0,0.18));
}
.block.video .video-frame video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
.block.video .video-placeholder {
  display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  width: 100%; aspect-ratio: 16 / 9; border-radius: 14px;
  border: 1px dashed var(--pl-border); background: var(--pl-surface);
  color: var(--pl-muted); font-weight: 600; text-align: center; padding: 1rem;
}
.block.video .video-alt { margin-top: 0.5rem; font-size: 0.85rem; color: var(--pl-muted); }

/* Carousel / scenario: superfici coerenti */
.carousel-nav { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.75rem; }
.carousel-nav button { border: 1px solid var(--pl-border); background: var(--pl-surface); color: var(--pl-on-surface); border-radius: 8px; padding: 0.3rem 0.7rem; cursor: pointer; }
.carousel-status { font-size: 0.8rem; color: var(--pl-muted); }
.scenario-choice { display: block; width: 100%; text-align: left; margin-top: 0.5rem; padding: 0.7rem 0.9rem; border: 1px solid var(--pl-border); border-radius: 10px; background: var(--pl-surface); color: var(--pl-on-surface); cursor: pointer; }

/* ====== Header corso sempre visibile (sticky) ====== */
.course-topbar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; gap: 0.9rem;
  margin-bottom: 1.25rem; padding: 0.7rem 1rem;
  border: 1px solid var(--pl-border); border-radius: var(--pl-radius);
  background: color-mix(in srgb, var(--pl-surface) 88%, transparent);
  box-shadow: var(--pl-shadow-sm);
  backdrop-filter: saturate(140%) blur(8px);
  -webkit-backdrop-filter: saturate(140%) blur(8px);
}
.topbar-cover { width: 52px; height: 52px; border-radius: 10px; object-fit: cover; box-shadow: var(--pl-shadow-sm); flex-shrink: 0; }
.topbar-info { min-width: 0; flex: 1; }
.topbar-title { margin: 0; font-weight: 800; font-size: 1.05rem; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.topbar-instructor { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.15rem; font-size: 0.82rem; color: var(--pl-muted); }
/* Avatar docente: anello brandizzato (primario→accento) con foto CONTENUTA
   (object-contain) su sfondo neutro, così i ritratti PNG restano interi/visibili. */
.topbar-avatar-ring { display: inline-grid; place-items: center; width: 1.6rem; height: 1.6rem; border-radius: 50%; padding: 2px; background: linear-gradient(135deg, var(--pl-primary), var(--pl-accent)); flex-shrink: 0; }
.topbar-avatar-ring .topbar-avatar { width: 100%; height: 100%; object-fit: contain; background: radial-gradient(circle at 50% 32%, #f4f4f5, #d4d4d8); }
.topbar-avatar { width: 1.25rem; height: 1.25rem; border-radius: 50%; object-fit: cover; }
.topbar-avatar-mono { display: inline-grid; place-items: center; background: var(--pl-primary); color: var(--pl-on-primary); font-size: 0.65rem; font-weight: 700; }
.topbar-logo { display: inline-flex; align-items: center; padding: 0.4rem 0.7rem; border-radius: 8px; background: var(--pl-primary); flex-shrink: 0; }
.topbar-logo img { height: 24px; width: auto; max-width: 140px; object-fit: contain; }
.course-subtitle { margin: 0; color: var(--pl-primary); font-weight: 600; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.04em; }

/* ====== Fruizione a concetti ====== */
/* Toggle modalità di visualizzazione */
.view-toggle { display: inline-flex; gap: 0.25rem; padding: 0.25rem; margin-bottom: 1rem; background: color-mix(in srgb, var(--pl-on-surface) 6%, transparent); border-radius: 999px; }
.view-toggle-btn { border: 0; background: transparent; color: var(--pl-muted); font-weight: 600; font-size: 0.82rem; padding: 0.4rem 0.9rem; border-radius: 999px; cursor: pointer; transition: background 0.18s, color 0.18s; }
.view-toggle-btn.is-active { background: var(--pl-surface); color: var(--pl-on-surface); box-shadow: var(--pl-shadow-sm); }

/* Stepper dei concetti */
.concept-stepper { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1.25rem; }
.concept-dot { width: 2rem; height: 2rem; border-radius: 50%; border: 1px solid var(--pl-border); background: var(--pl-surface); color: var(--pl-muted); font-weight: 700; font-size: 0.8rem; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: transform 0.15s, background 0.15s, color 0.15s, box-shadow 0.15s; }
.concept-dot.is-reached { color: var(--pl-on-surface); border-color: color-mix(in srgb, var(--pl-accent) 55%, var(--pl-border)); }
.concept-dot.is-current { background: var(--pl-primary); color: var(--pl-on-primary); border-color: var(--pl-primary); box-shadow: var(--pl-shadow-sm); transform: scale(1.08); }
.concept-dot.is-locked { opacity: 0.45; cursor: not-allowed; }

/* Palco dei concetti */
.concept { animation: concept-in 0.32s cubic-bezier(0.4,0,0.2,1); }
.concept-title { font-size: 1.3rem; font-weight: 800; margin: 0 0 1rem; }
@keyframes concept-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

/* Navigazione intra-lezione (slide/hybrid) */
.concept-nav { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: 1.75rem; padding-top: 1.25rem; border-top: 1px solid var(--pl-border); }
.concept-nav button { background: var(--pl-surface); color: var(--pl-on-surface); border: 1px solid var(--pl-border); padding: 0.65rem 1.1rem; border-radius: 10px; cursor: pointer; font-weight: 600; transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s; }
.concept-nav button:hover:not(:disabled) { transform: translateY(-2px); box-shadow: var(--pl-shadow-sm); }
.concept-nav button:disabled { opacity: 0.4; cursor: not-allowed; }
.concept-nav .concept-next { background: var(--pl-primary); color: var(--pl-on-primary); border-color: var(--pl-primary); }
.concept-status { font-size: 0.8rem; color: var(--pl-muted); font-weight: 600; }

/* Modalità SCROLL: le sezioni si impilano con spazio generoso e snap morbido */
.concept-stage[data-view="scroll"] { scroll-behavior: smooth; }
.concept-stage[data-view="scroll"] .concept { padding: 1.25rem 0; border-bottom: 1px solid var(--pl-border); }
.concept-stage[data-view="scroll"] .concept:last-child { border-bottom: 0; }

/* Modalità HYBRID: come slide ma consente scroll interno a una slide lunga */
.concept-stage[data-view="hybrid"] .concept { max-height: none; }

/* ====== Drag & drop premium: match ====== */
.dnd-prompt { font-weight: 600; margin: 0 0 0.75rem; }
.dnd-pool { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
.dnd-chip { border: 1px solid var(--pl-border); background: var(--pl-surface); color: var(--pl-on-surface); border-radius: 999px; padding: 0.4rem 0.85rem; font-size: 0.9rem; font-weight: 600; cursor: grab; transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s; }
.dnd-chip:hover { transform: translateY(-2px); box-shadow: var(--pl-shadow-sm); }
.dnd-chip.is-picked { border-color: var(--pl-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--pl-primary) 40%, transparent); }
.dnd-chip.is-used { opacity: 0.4; cursor: default; }
.dnd-slots { display: flex; flex-direction: column; gap: 0.6rem; }
.dnd-row { display: flex; align-items: center; gap: 0.75rem; }
.dnd-left { flex: 1; font-size: 0.95rem; }
.dnd-slot { min-width: 12rem; border: 2px dashed var(--pl-border); border-radius: 10px; padding: 0.55rem 0.85rem; text-align: left; background: transparent; color: var(--pl-muted); cursor: pointer; font-size: 0.9rem; transition: border-color 0.15s, background 0.15s; }
.dnd-slot:hover { border-color: var(--pl-primary); }
.dnd-slot.is-filled { border-style: solid; background: color-mix(in srgb, var(--pl-primary) 8%, transparent); color: var(--pl-on-surface); font-weight: 600; }

/* ====== Riordino premium: order ====== */
.order-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.order-row { display: flex; align-items: center; gap: 0.75rem; border: 1px solid var(--pl-border); background: var(--pl-surface); border-radius: 10px; padding: 0.55rem 0.75rem; box-shadow: var(--pl-shadow-sm); }
.order-handle { color: var(--pl-muted); cursor: grab; }
.order-num { display: inline-grid; place-items: center; width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--pl-primary); color: var(--pl-on-primary); font-size: 0.75rem; font-weight: 700; }
.order-label { flex: 1; }
.order-actions { display: flex; gap: 0.25rem; }
.order-btn { border: 1px solid var(--pl-border); background: var(--pl-surface); color: var(--pl-on-surface); border-radius: 6px; padding: 0.1rem 0.5rem; cursor: pointer; }
.order-btn:disabled { opacity: 0.3; cursor: default; }

/* ====== Sorting categories ====== */
.sorting-pool { padding: 0.75rem; border: 1px dashed var(--pl-border); border-radius: 12px; margin-bottom: 1rem; min-height: 3rem; }
.sorting-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.9rem; }
.sorting-bucket { border: 2px dashed var(--pl-border); border-radius: 12px; padding: 0.75rem; transition: border-color 0.15s; }
.sorting-bucket:hover { border-color: var(--pl-primary); }
.sorting-bucket-title { font-weight: 700; margin: 0 0 0.5rem; }
.sorting-zone { display: flex; flex-wrap: wrap; gap: 0.5rem; min-height: 2.25rem; }
.dnd-chip.is-placed { cursor: pointer; }
.dnd-chip.is-correct { border-color: #16a34a; background: color-mix(in srgb, #16a34a 14%, transparent); color: #15803d; }
.dnd-chip.is-wrong { border-color: #dc2626; background: color-mix(in srgb, #dc2626 12%, transparent); color: #b91c1c; }

/* ====== Indice del corso (sommario navigabile) ====== */
/* Layout del corpo: 'top' = colonna singola (indice espandibile sopra); 'side'
   = griglia a 2 colonne con indice sidebar a sinistra. Su schermi stretti (LMS
   in iframe), la sidebar si impila sopra il contenuto. */
.course-body[data-nav="side"] { display: grid; grid-template-columns: 260px 1fr; gap: 1.5rem; align-items: start; }
.course-body[data-nav="side"] .course-content { min-width: 0; }
.course-body[data-nav="side"] .course-index-side { position: sticky; top: 5rem; margin-bottom: 0; }
.course-index-side { padding-bottom: 0.5rem; }
.course-index-title { margin: 0; padding: 0.9rem 1.1rem 0.4rem; font-weight: 700; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--pl-accent); }
@media (max-width: 860px) {
  .course-body[data-nav="side"] { grid-template-columns: 1fr; }
  .course-body[data-nav="side"] .course-index-side { position: static; }
}
.course-index { margin-bottom: 1.5rem; border: 1px solid var(--pl-border); border-top: 3px solid var(--pl-accent); border-radius: var(--pl-radius); background: var(--pl-surface); overflow: hidden; }
.course-index summary { cursor: pointer; padding: 0.9rem 1.1rem; font-weight: 700; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--pl-accent); list-style: none; display: flex; align-items: center; justify-content: space-between; }
.course-index summary::after { content: "▾"; transition: transform 0.2s; }
.course-index[open] summary::after { transform: rotate(180deg); }
.course-index ol { list-style: none; margin: 0; padding: 0 0.6rem 0.8rem; }
.course-index .ci-module { padding: 0.5rem 0.5rem 0.2rem; font-weight: 700; font-size: 0.9rem; }
.course-index .ci-lesson { display: flex; width: 100%; align-items: center; gap: 0.5rem; text-align: left; border: 0; background: transparent; color: var(--pl-muted); border-radius: 8px; padding: 0.45rem 0.6rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s, color 0.15s; }
.course-index .ci-lesson:hover:not(:disabled) { background: color-mix(in srgb, var(--pl-primary) 8%, transparent); }
.course-index .ci-lesson.is-current { background: var(--pl-primary); color: var(--pl-on-primary); font-weight: 600; }
.course-index .ci-lesson.is-done { color: var(--pl-on-surface); }
.course-index .ci-lesson.is-locked { opacity: 0.5; cursor: not-allowed; }
.course-index .ci-badge { width: 1.3rem; height: 1.3rem; display: inline-grid; place-items: center; border-radius: 50%; font-size: 0.7rem; background: color-mix(in srgb, var(--pl-on-surface) 10%, transparent); }
.course-index .ci-lesson.is-current .ci-badge { background: rgba(255,255,255,0.25); }

/* ====== Widget "Chiedi al corso" (RAG offline) ====== */
.rag-fab {
  position: fixed; right: 1.25rem; bottom: 1.25rem; z-index: 50;
  display: inline-flex; align-items: center; gap: 0.5rem;
  background: var(--pl-primary); color: var(--pl-on-primary); border: 0;
  border-radius: 999px; padding: 0.75rem 1.15rem; font-weight: 700; font-size: 0.9rem;
  cursor: pointer; box-shadow: var(--pl-shadow-md);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.rag-fab:hover { transform: translateY(-2px); }
.rag-panel[hidden] { display: none !important; }
.rag-fab[hidden] { display: none !important; }
.rag-panel {
  position: fixed; right: 1.25rem; bottom: 1.25rem; z-index: 51;
  width: min(380px, calc(100vw - 2.5rem)); max-height: min(560px, calc(100vh - 2.5rem));
  display: flex; flex-direction: column;
  background: var(--pl-surface); color: var(--pl-on-surface);
  border: 1px solid var(--pl-border); border-radius: 16px; box-shadow: var(--pl-shadow-md);
  overflow: hidden;
}
.rag-head { display: flex; align-items: center; justify-content: space-between; padding: 0.9rem 1rem; border-bottom: 1px solid var(--pl-border); }
.rag-title { font-weight: 800; }
.rag-close { border: 0; background: transparent; font-size: 1.4rem; line-height: 1; cursor: pointer; color: var(--pl-muted); }
.rag-form { display: flex; gap: 0.5rem; padding: 0.85rem 1rem; }
.rag-input { flex: 1; border: 1px solid var(--pl-border); border-radius: 10px; padding: 0.55rem 0.75rem; font-size: 0.9rem; background: var(--pl-bg); color: var(--pl-on-surface); }
.rag-submit { border: 0; background: var(--pl-primary); color: var(--pl-on-primary); border-radius: 10px; padding: 0 0.95rem; font-weight: 700; cursor: pointer; }
.rag-results { flex: 1; overflow-y: auto; padding: 0 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
.rag-result { border: 1px solid var(--pl-border); border-radius: 12px; padding: 0.75rem 0.9rem; background: var(--pl-bg); }
.rag-result-text { margin: 0 0 0.5rem; font-size: 0.9rem; line-height: 1.5; }
.rag-result-src { margin: 0; font-size: 0.75rem; font-weight: 700; color: var(--pl-primary); }
.rag-result-link { display: inline-block; border: 0; background: transparent; cursor: pointer; padding: 0; text-align: left; font: inherit; }
.rag-result-link:hover { text-decoration: underline; }
.rag-answer { border: 1px solid color-mix(in srgb, var(--pl-primary) 40%, transparent); background: color-mix(in srgb, var(--pl-primary) 6%, transparent); border-radius: 12px; overflow: hidden; }
.rag-answer-head { display: flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.75rem; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--pl-primary); background: color-mix(in srgb, var(--pl-primary) 12%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--pl-primary) 20%, transparent); }
.rag-answer-body { padding: 0.75rem 0.9rem; }
.rag-answer-text { margin: 0; font-size: 0.92rem; line-height: 1.55; }
.rag-answer-disclaimer { margin: 0.5rem 0 0; font-size: 0.7rem; font-style: italic; color: var(--pl-muted); }
.rag-sources-head { display: flex; align-items: center; gap: 0.4rem; margin: 0.25rem 0 -0.2rem; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--pl-muted); }
.rag-answer-note { margin: 0; font-size: 0.75rem; color: var(--pl-muted); }
.rag-answer-loading, .rag-model-loading { margin: 0; display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.78rem; color: var(--pl-muted); padding: 0.4rem 0; }
.rag-typing { display: inline-flex; align-items: center; gap: 3px; }
.rag-typing .rag-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--pl-primary); opacity: 0.35; animation: ragBlink 1.2s infinite ease-in-out both; }
.rag-typing .rag-dot:nth-child(2) { animation-delay: 0.18s; }
.rag-typing .rag-dot:nth-child(3) { animation-delay: 0.36s; }
@keyframes ragBlink { 0%, 80%, 100% { opacity: 0.3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) {
  .rag-typing .rag-dot { animation: ragFade 1.2s infinite ease-in-out both; }
  @keyframes ragFade { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }
}
.rag-empty { font-size: 0.9rem; color: var(--pl-muted); }
.rag-hint { padding: 0.6rem 1rem 0.9rem; margin: 0; font-size: 0.72rem; color: var(--pl-muted); display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
.rag-mode-badge { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.62rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.15rem 0.5rem; border-radius: 99px; background: color-mix(in srgb, var(--pl-muted) 18%, transparent); color: var(--pl-muted); }
.rag-mode-badge.is-neural { background: color-mix(in srgb, var(--pl-primary) 14%, transparent); color: var(--pl-primary); }
.rag-mode-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

/* ====== Lezione VIDEO-FIRST (legacy a 2 colonne, mantenuto per compat) ====== */
.lesson-videofirst { display: grid; grid-template-columns: 1.6fr 1fr; gap: 1.25rem; align-items: start; }
.lesson-videofirst .vf-main { min-width: 0; }
.lesson-videofirst .vf-side {
  min-width: 0; border: 1px solid var(--pl-border); border-radius: var(--pl-radius);
  background: var(--pl-surface); padding: 1rem; position: sticky; top: 1rem;
  max-height: calc(100vh - 2rem); overflow-y: auto;
}
.lesson-videofirst .vf-side-title { margin: 0 0 0.75rem; font-size: 0.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: var(--pl-muted); }
@media (max-width: 860px) { .lesson-videofirst { grid-template-columns: 1fr; } .lesson-videofirst .vf-side { position: static; max-height: none; } }

/* ====== Lezione VIDEO-FIRST v2 (Brain Bites): video+trascrizione in alto, attività sotto ====== */
.lesson-videofirst-v2 { display: flex; flex-direction: column; gap: 1.25rem; }
.lesson-videofirst-v2 .vf-activities { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
@media (max-width: 720px) { .lesson-videofirst-v2 .vf-activities { grid-template-columns: 1fr; } }

/* Block video con pannello trascrizione/tab a fianco */
.block.video.video-withpanel { display: grid; grid-template-columns: 1.6fr 1fr; gap: 1rem; align-items: start; }
.block.video .video-col { min-width: 0; }
.block.video .video-frame { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: var(--pl-radius); overflow: hidden; }
.block.video .video-frame video, .block.video .video-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.block.video .video-placeholder { display: grid; place-items: center; aspect-ratio: 16 / 9; width: 100%; border: 1px dashed var(--pl-border); border-radius: var(--pl-radius); background: color-mix(in srgb, var(--pl-muted) 12%, var(--pl-surface)); color: var(--pl-muted); font-size: 0.85rem; }
.block.video .video-alt { margin: 0.4rem 0 0; font-size: 0.8rem; color: var(--pl-muted); }

/* Pannello a tab (trascrizione + sezioni) */
.block.video .video-panel { min-width: 0; border: 1px solid var(--pl-border); border-radius: var(--pl-radius); background: var(--pl-surface); overflow: hidden; display: flex; flex-direction: column; max-height: 420px; }
.block.video .video-tabs { display: flex; flex-wrap: wrap; gap: 0.25rem; padding: 0.4rem 0.4rem 0; border-bottom: 1px solid var(--pl-border); background: color-mix(in srgb, var(--pl-muted) 8%, var(--pl-surface)); }
.block.video .video-tab { border: 0; border-bottom: 2px solid transparent; background: transparent; padding: 0.4rem 0.7rem; font-size: 0.78rem; font-weight: 700; color: var(--pl-muted); cursor: pointer; border-radius: 6px 6px 0 0; }
.block.video .video-tab.is-active { color: var(--pl-text); border-bottom-color: var(--pl-accent); background: var(--pl-surface); }
.block.video .video-panel-body { padding: 0.6rem; overflow-y: auto; }
.block.video .video-transcript { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.block.video .transcript-cue { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 0.3rem 0.5rem; border-radius: 6px; font-size: 0.88rem; line-height: 1.5; color: var(--pl-muted); cursor: pointer; }
.block.video .transcript-cue:hover { background: color-mix(in srgb, var(--pl-primary) 8%, transparent); }
.block.video .transcript-cue.is-active { background: color-mix(in srgb, var(--pl-primary) 14%, transparent); color: var(--pl-text); font-weight: 600; }
.block.video .cue-time { margin-right: 0.5rem; font-size: 0.66rem; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--pl-primary) 70%, var(--pl-muted)); }
.block.video .cue-speaker { font-weight: 700; margin-right: 0.25rem; }
.block.video .video-transcript-empty { margin: 0; font-size: 0.8rem; color: var(--pl-muted); }
@media (max-width: 720px) { .block.video.video-withpanel { grid-template-columns: 1fr; } .block.video .video-panel { max-height: 300px; } }

/* ====== Pagine riepilogative (overview) corso e modulo ====== */
.overview-page { max-width: none; }
.overview-hero { display: block; width: 100%; max-height: 300px; object-fit: cover; border-radius: var(--pl-radius); margin-bottom: 1.5rem; box-shadow: var(--pl-shadow-md); }
.overview-page h1 { font-size: 2rem; font-weight: 800; margin: 0 0 0.75rem; line-height: 1.15; }
.overview-desc { font-size: 1.05rem; line-height: 1.6; color: var(--pl-muted); margin: 0 0 1.5rem; }
.overview-section-title { font-size: 0.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--pl-muted); margin: 1.75rem 0 0.75rem; }
.overview-stats { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0 0 1rem; }
.overview-stat {
  display: flex; flex-direction: column; align-items: center; min-width: 92px;
  padding: 0.85rem 1.1rem; border-radius: var(--pl-radius); border: 1px solid var(--pl-border);
  background: color-mix(in srgb, var(--pl-primary) 6%, var(--pl-surface));
}
.overview-stat-value { font-size: 1.6rem; font-weight: 800; line-height: 1; color: var(--pl-primary); }
.overview-stat-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--pl-muted); margin-top: 0.3rem; }
.overview-instructor { display: flex; align-items: center; gap: 0.75rem; margin: 1rem 0 0; padding: 0.75rem 1rem; border: 1px solid var(--pl-border); border-radius: var(--pl-radius); background: var(--pl-surface); width: max-content; max-width: 100%; }
.overview-instructor-avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; }
.overview-instructor-info { display: flex; flex-direction: column; }
.overview-instructor-info strong { font-size: 0.95rem; }
.overview-instructor-info span { font-size: 0.8rem; color: var(--pl-muted); }
.overview-module-list, .overview-lesson-list { margin: 0; padding-left: 1.4rem; display: flex; flex-direction: column; gap: 0.5rem; }
.overview-module-list li, .overview-lesson-list li { font-size: 0.95rem; line-height: 1.5; }
.overview-module-list li span, .overview-lesson-list li span { color: var(--pl-muted); }
.overview-objectives { margin: 0; padding-left: 1.4rem; display: flex; flex-direction: column; gap: 0.4rem; }
.overview-objectives li { font-size: 0.95rem; line-height: 1.5; }
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
