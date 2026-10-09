/*
 * player.js — Player runtime del corso SCORM (Requisito 9.3 / 5.4 / 6 / 7.2).
 * Fruizione a step con gating: le lezioni e gli assessment sono presentati uno
 * alla volta. Il passaggio allo step successivo è consentito solo quando lo step
 * corrente è "completato":
 *   - lezione senza test: completata dopo aver scrollato il contenuto fino in fondo;
 *   - assessment intermedio: completato SOLO se superato (scaled >= masteryScore)
 *     — è il gate che blocca l'accesso al modulo successivo;
 *   - assessment finale: valutato e riportato all'LMS.
 * Riporta completamento/punteggio all'LMS via la Run-Time API (window.SCORM).
 *
 * Dipende da: window.SCORM (scorm-api.js), window.Renderers (renderers.js),
 * window.Scoring (scoring.js).
 */
(function (global) {
  'use strict';

  function Player(course, options) {
    this.course = course;
    this.scorm = (options && options.scorm) || global.SCORM;
    this.renderers = (options && options.renderers) || global.Renderers;
    this.root = (options && options.root) || null;
    // Brand del corso (logo/nome) esposto dal builder come window.__BRAND__.
    // Usato per mostrare il logo nell'header sempre visibile (parità anteprima).
    this.brand = (options && options.brand) || global.__BRAND__ || null;
    // Sequenza step dalla struttura CONDIVISA (window.RenderCore): stessa logica
    // dell'anteprima. Fallback alla copia locale se il bundle non è caricato.
    this.steps =
      global.RenderCore && global.RenderCore.buildCourseSteps
        ? global.RenderCore.buildCourseSteps(course)
        : buildSteps(course);
    this.index = 0;
    // Stato di completamento per step (per id).
    this.completed = {};
    // Esito dei test per id (per l'aggregazione del completamento/score finale).
    this._assessmentResults = {};
  }

  /**
   * FALLBACK della sequenza di step (usato solo se window.RenderCore non è
   * caricato). La fonte di verità è buildCourseSteps nel renderer condiviso
   * (@scorm/contracts/render-core); questa copia resta come rete di sicurezza
   * offline e DEVE restare allineata alla versione condivisa.
   */
  function buildSteps(course) {
    var steps = [];
    var assessments = course.assessments || [];
    var intermediateByModule = {};
    var finals = [];
    assessments.forEach(function (a) {
      if (a.scope === 'final') finals.push(a);
      else if (a.moduleId) {
        (intermediateByModule[a.moduleId] = intermediateByModule[a.moduleId] || []).push(a);
      }
    });

    // Primo step: panoramica del corso (hero, descrizione, conteggi).
    steps.push({ kind: 'course_overview', id: 'overview:course', course: course });

    (course.modules || []).forEach(function (m, mi) {
      // Panoramica del modulo prima delle sue lezioni.
      steps.push({ kind: 'module_overview', id: 'overview:mod:' + m.id, module: m, moduleIndex: mi, moduleTitle: m.title });
      (m.lessons || []).forEach(function (l) {
        steps.push({ kind: 'lesson', id: 'lesson:' + l.id, moduleTitle: m.title, lesson: l });
      });
      (intermediateByModule[m.id] || []).forEach(function (a) {
        steps.push({ kind: 'assessment', id: 'assess:' + a.id, moduleTitle: m.title, assessment: a, gate: true });
      });
    });
    finals.forEach(function (a) {
      steps.push({ kind: 'assessment', id: 'assess:' + a.id, moduleTitle: 'Valutazione finale', assessment: a, gate: false });
    });
    return steps;
  }

  Player.prototype.start = function (root) {
    if (root) this.root = root;
    if (this.scorm && this.scorm.discover) {
      this.scorm.discover(global);
      this.scorm.initialize();
      // Stato iniziale esplicito: evita che l'LMS resti su "unknown" se la
      // sessione si chiude presto. Non sovrascrive un completamento già salvato.
      var existing = this.scorm.getValue('completion');
      if (existing !== 'completed') {
        this.scorm.setValue('completion', 'incomplete');
        this.scorm.commit();
      }
      var loc = this.scorm.getValue('location');
      var parsed = parseInt(loc, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed < this.steps.length) this.index = parsed;
      // Termina la sessione alla chiusura della finestra/scheda, così l'LMS
      // persiste i dati (commit+terminate). Molti LMS scartano i valori di una
      // sessione non terminata correttamente.
      var self = this;
      var onUnload = function () {
        try {
          if (self.scorm && self.scorm.initialized) {
            self.scorm.commit();
            self.scorm.terminate();
          }
        } catch (e) { /* best effort */ }
      };
      if (global.addEventListener) {
        global.addEventListener('pagehide', onUnload);
        global.addEventListener('beforeunload', onUnload);
      }
    }
    this.render();
  };

  Player.prototype.isStepComplete = function (i) {
    var step = this.steps[i];
    if (!step) return false;
    return Boolean(this.completed[step.id]);
  };

  Player.prototype.render = function () {
    if (!this.root) return;
    this.root.innerHTML = '';
    var step = this.steps[this.index];
    if (!step) return;
    var self = this;

    // Stile delle micro-interazioni del corso: pilota il CSS condiviso
    // (interactions.css) tramite data-motion. 'sober' è il default sicuro.
    var motion = this.course.interactionStyle === 'lively' ? 'lively' : 'sober';
    this.root.setAttribute('data-motion', motion);

    // Barra di avanzamento complessiva.
    // Header del corso SEMPRE VISIBILE (sticky): copertina + titolo + docente +
    // logo del brand. Resta in cima durante tutta la fruizione.
    this.root.appendChild(this.buildCourseTopbar());

    this.root.appendChild(this.buildProgress());

    // Posizione del menu: 'top' (barra espandibile in alto) o 'side' (sidebar).
    var navPos = this.course.navPosition === 'top' ? 'top' : 'side';

    // Contenitore del corpo: in modalità 'side' è una griglia a 2 colonne
    // (indice a sinistra + contenuto a destra); in 'top' è una colonna singola
    // con l'indice espandibile sopra il contenuto.
    var body = el('div', 'course-body');
    body.setAttribute('data-nav', navPos);

    // Indice del corso (sommario navigabile): moduli → lezioni/test.
    body.appendChild(this.buildCourseIndex(navPos));

    // Colonna del contenuto (in 'side' è la seconda colonna della griglia).
    var contentCol = el('div', 'course-content');

    var header = document.createElement('header');
    header.className = 'course-header';
    // Hero grande della copertina solo sul primo step, MA non quando lo step è
    // la panoramica del corso: renderCourseOverview mostra già la copertina
    // (overview-hero), altrimenti comparirebbe due volte.
    if (this.index === 0 && this.course.coverImageKey && step.kind !== 'course_overview') {
      var hero = document.createElement('img');
      hero.className = 'course-hero';
      hero.setAttribute('src', this.course.coverImageKey);
      hero.setAttribute('alt', this.course.title);
      header.appendChild(hero);
    }
    var subtitle;
    // Breadcrumb di contesto: mostrato SOLO per lezioni e test (dove dà
    // orientamento "Modulo — Titolo"). Nelle panoramiche è ridondante col titolo
    // grande, quindi omesso: niente etichetta/badge superflua in testa.
    if (step.kind === 'lesson') subtitle = step.moduleTitle + ' — ' + step.lesson.title;
    else if (step.kind === 'assessment') subtitle = step.moduleTitle + ' — ' + (step.assessment.title || 'Test');
    else subtitle = '';
    if (subtitle) {
      var subEl = textEl('p', subtitle);
      subEl.className = 'course-subtitle';
      header.appendChild(subEl);
    }
    contentCol.appendChild(header);

    // Selettore della modalità di fruizione (slide/scroll/ibrido) per le lezioni.
    // Non si applica alle lezioni video-first (layout dedicato a 2 colonne).
    if (step.kind === 'lesson' && !(step.lesson && step.lesson.videoFirst)) {
      contentCol.appendChild(this.buildViewModeToggle());
    }

    var main = document.createElement('main');
    main.className = 'course-main';
    main.setAttribute('role', 'main');

    if (step.kind === 'lesson') {
      this.renderLesson(step, main);
    } else if (step.kind === 'course_overview') {
      this.renderCourseOverview(step, main);
    } else if (step.kind === 'module_overview') {
      this.renderModuleOverview(step, main);
    } else {
      this.renderAssessmentStep(step, main);
    }
    contentCol.appendChild(main);
    contentCol.appendChild(this.buildNav());

    body.appendChild(contentCol);
    this.root.appendChild(body);

    // In modalità 'scroll', il completamento avanza osservando quale concetto
    // entra in vista (reveal + sblocco progressivo).
    if (step.kind === 'lesson' && this.viewMode() === 'scroll') {
      this.watchConceptScroll(step);
    }
  };

  /** Toggle delle 3 modalità di fruizione, con stato persistito. */
  Player.prototype.buildViewModeToggle = function () {
    var self = this;
    var current = this.viewMode();
    var wrap = el('div', 'view-toggle');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Modalità di visualizzazione');
    var modes = [
      { id: 'slide', label: 'Slide' },
      { id: 'scroll', label: 'Scorrimento' },
      { id: 'hybrid', label: 'Ibrido' },
    ];
    modes.forEach(function (m) {
      var btn = textEl('button', m.label);
      btn.className = 'view-toggle-btn' + (current === m.id ? ' is-active' : '');
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-pressed', current === m.id ? 'true' : 'false');
      btn.addEventListener('click', function () { if (self.viewMode() !== m.id) self.setViewMode(m.id); });
      wrap.appendChild(btn);
    });
    return wrap;
  };

  /** Scroll a sezioni: quando l'ultima sezione visibile entra in vista, sblocca
   *  la successiva e la aggiunge; raggiunto l'ultimo concetto, completa. */
  Player.prototype.watchConceptScroll = function (step) {
    var self = this;
    var concepts = step._concepts || [];
    if (typeof global.IntersectionObserver !== 'function') {
      // Fallback: senza observer, considera raggiunti tutti i concetti.
      step._reached = concepts.length - 1;
      self.markComplete(step);
      self.updateNav();
      return;
    }
    var sections = this.root.querySelectorAll('.concept');
    var lastShown = sections[sections.length - 1];
    if (!lastShown) return;
    var obs = new global.IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        obs.disconnect();
        if (step._reached < concepts.length - 1) {
          step._reached++;
          step._sub = step._reached;
          self.render(); // aggiunge la sezione successiva e ri-osserva
        } else {
          self.markComplete(step);
          self.updateNav();
        }
      });
    });
    obs.observe(lastShown);
  };

  /**
   * FALLBACK del raggruppamento a concetti (usato solo se window.RenderCore non
   * è caricato). La fonte di verità è groupConcepts/groupBlocksIntoConcepts del
   * renderer condiviso; questa copia resta come rete di sicurezza offline.
   */
  function groupConcepts(blocks) {
    var list = blocks || [];
    var concepts = [];
    var current = null;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.type === 'rich_text' || current === null) {
        current = { title: b.type === 'rich_text' ? conceptTitle(b) : null, blocks: [b] };
        concepts.push(current);
      } else {
        current.blocks.push(b);
      }
    }
    return concepts;
  }
  function conceptTitle(block) {
    var p = block.payload || {};
    var html = p.content && p.content.html;
    if (!html || typeof html !== 'string') return null;
    var h = html.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
    var raw = h ? h[1] : html;
    var text = raw.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return text.length > 80 ? text.slice(0, 77) + '…' : text;
  }

  /**
   * Panoramica del CORSO: hero con copertina, descrizione, conteggio moduli/
   * lezioni, e docente se presente. Step auto-completante (solo informativo).
   */
  Player.prototype.renderCourseOverview = function (step, main) {
    var c = step.course;
    var wrap = el('div', 'overview-page overview-course');

    // Hero con copertina (se presente).
    if (c.coverImageKey) {
      var hero = document.createElement('img');
      hero.className = 'overview-hero';
      hero.setAttribute('src', c.coverImageKey);
      hero.setAttribute('alt', c.title);
      wrap.appendChild(hero);
    }

    wrap.appendChild(textEl('h1', c.title));
    if (c.description) wrap.appendChild(textEl('p', c.description)).className = 'overview-desc';

    // Conteggi: moduli, lezioni totali.
    var modules = c.modules || [];
    var totalLessons = 0;
    modules.forEach(function (m) { totalLessons += (m.lessons || []).length; });
    var stats = el('div', 'overview-stats');
    stats.appendChild(statBadge(modules.length, modules.length === 1 ? 'Modulo' : 'Moduli'));
    stats.appendChild(statBadge(totalLessons, totalLessons === 1 ? 'Lezione' : 'Lezioni'));
    wrap.appendChild(stats);

    // Docente.
    if (c.instructor && c.instructor.name) {
      var instr = el('div', 'overview-instructor');
      if (c.instructor.avatarKey) {
        var av = document.createElement('img');
        av.className = 'overview-instructor-avatar';
        av.setAttribute('src', c.instructor.avatarKey);
        av.setAttribute('alt', c.instructor.name);
        instr.appendChild(av);
      }
      var info = el('div', 'overview-instructor-info');
      info.appendChild(textEl('strong', c.instructor.name));
      if (c.instructor.role) info.appendChild(textEl('span', c.instructor.role));
      instr.appendChild(info);
      wrap.appendChild(instr);
    }

    // Indice dei moduli.
    if (modules.length > 0) {
      wrap.appendChild(textEl('h2', 'Programma del corso')).className = 'overview-section-title';
      var ol = document.createElement('ol');
      ol.className = 'overview-module-list';
      modules.forEach(function (m) {
        var li = document.createElement('li');
        li.appendChild(textEl('strong', m.title));
        if (m.summary) li.appendChild(textEl('span', ' — ' + m.summary));
        var count = (m.lessons || []).length;
        li.appendChild(textEl('span', ' (' + count + (count === 1 ? ' lezione)' : ' lezioni)')));
        ol.appendChild(li);
      });
      wrap.appendChild(ol);
    }

    main.appendChild(wrap);
    this.markComplete(step);
  };

  /**
   * Panoramica di un MODULO: copertina, titolo, sommario, obiettivi, elenco
   * lezioni con i loro titoli. Step auto-completante.
   */
  Player.prototype.renderModuleOverview = function (step, main) {
    var m = step.module;
    var wrap = el('div', 'overview-page overview-module');

    // Hero con copertina modulo (se presente).
    if (m.coverImageKey) {
      var hero = document.createElement('img');
      hero.className = 'overview-hero';
      hero.setAttribute('src', m.coverImageKey);
      hero.setAttribute('alt', m.title);
      wrap.appendChild(hero);
    }

    wrap.appendChild(textEl('h1', 'Modulo ' + (step.moduleIndex + 1) + ': ' + m.title));
    if (m.summary) wrap.appendChild(textEl('p', m.summary)).className = 'overview-desc';

    // Conteggio lezioni.
    var lessons = m.lessons || [];
    var stats = el('div', 'overview-stats');
    stats.appendChild(statBadge(lessons.length, lessons.length === 1 ? 'Lezione' : 'Lezioni'));
    wrap.appendChild(stats);

    // Obiettivi del modulo.
    var objectives = m.objectives || [];
    if (objectives.length > 0) {
      wrap.appendChild(textEl('h2', 'Obiettivi')).className = 'overview-section-title';
      var ul = document.createElement('ul');
      ul.className = 'overview-objectives';
      objectives.forEach(function (obj) {
        ul.appendChild(textEl('li', obj));
      });
      wrap.appendChild(ul);
    }

    // Elenco lezioni.
    if (lessons.length > 0) {
      wrap.appendChild(textEl('h2', 'Lezioni')).className = 'overview-section-title';
      var ol = document.createElement('ol');
      ol.className = 'overview-lesson-list';
      lessons.forEach(function (l) {
        var li = document.createElement('li');
        li.appendChild(textEl('strong', l.title));
        if (l.objectives && l.objectives.length > 0) {
          li.appendChild(textEl('span', ' — ' + l.objectives.join(', ')));
        }
        ol.appendChild(li);
      });
      wrap.appendChild(ol);
    }

    main.appendChild(wrap);
    this.markComplete(step);
  };

  /** Badge statistico per le pagine riepilogative (conteggio + etichetta). */
  function statBadge(count, label) {
    var badge = el('div', 'overview-stat');
    badge.appendChild(textEl('span', String(count))).className = 'overview-stat-value';
    badge.appendChild(textEl('span', label)).className = 'overview-stat-label';
    return badge;
  }

  Player.prototype.renderLesson = function (step, main) {
    var self = this;
    var lesson = step.lesson;

    if (lesson.narrationKey) {
      var audioWrap = el('div', 'lesson-audio');
      audioWrap.appendChild(textEl('p', 'Ascolta la lezione'));
      var audio = document.createElement('audio');
      audio.setAttribute('controls', 'controls');
      audio.setAttribute('src', lesson.narrationKey);
      audioWrap.appendChild(audio);
      main.appendChild(audioWrap);
    }

    // Lezione VIDEO-FIRST: layout a 2 colonne. Video (e testo introduttivo) a
    // sinistra; elementi dinamici e quiz a destra (stile Brain-Bites).
    if (lesson.videoFirst) {
      this.renderVideoFirstLesson(step, main);
      return;
    }

    // Concetti della lezione (gruppi di blocchi), dalla struttura CONDIVISA.
    var concepts =
      global.RenderCore && global.RenderCore.groupConcepts
        ? global.RenderCore.groupConcepts(lesson.blocks || [])
        : groupConcepts(lesson.blocks || []);
    step._concepts = concepts;
    if (concepts.length === 0) {
      main.appendChild(el('div', 'scroll-sentinel'));
      this.markComplete(step);
      return;
    }

    // Stato di avanzamento intra-lezione: fin dove è arrivato l'utente.
    if (typeof step._reached !== 'number') step._reached = 0;
    if (typeof step._sub !== 'number') step._sub = 0;
    if (step._sub > concepts.length - 1) step._sub = concepts.length - 1;

    var mode = this.viewMode(); // 'slide' | 'scroll' | 'hybrid'

    // Stepper dei concetti (lineare): passati accessibili, corrente evidenziato,
    // futuri visibili ma bloccati (B1: visualizzare sblocca il successivo).
    if (concepts.length > 1) {
      main.appendChild(this.buildConceptStepper(step, concepts));
    }

    var stage = el('div', 'concept-stage');
    stage.setAttribute('data-view', mode);
    main.appendChild(stage);

    if (mode === 'scroll') {
      // Scroll a sezioni: mostra tutti i concetti RAGGIUNTI come sezioni, con
      // reveal all'ingresso; l'ultimo raggiunto porta avanti il completamento.
      for (var s = 0; s <= step._reached && s < concepts.length; s++) {
        stage.appendChild(this.buildConceptSection(step, concepts[s], s));
      }
    } else {
      // Slide / hybrid: un concetto per volta.
      stage.appendChild(this.buildConceptSection(step, concepts[step._sub], step._sub));
      main.appendChild(this.buildConceptNav(step, concepts));
    }

    // Completamento lezione (B1): raggiunto l'ultimo concetto.
    if (step._reached >= concepts.length - 1) this.markComplete(step);
  };

  /**
   * Lezione VIDEO-FIRST (stile Brain Bites): in cima il video a tutta larghezza
   * con il suo pannello trascrizione/tab a fianco (gestito dal renderer
   * video_checkpoint); sotto, le attività (elementi dinamici e quiz) in griglia.
   * Su mobile tutto si impila (CSS). La lezione si completa alla visualizzazione.
   */
  Player.prototype.renderVideoFirstLesson = function (step, main) {
    var lesson = step.lesson;
    var blocks = lesson.blocks || [];
    var self = this;

    // Trova il video (primo video_checkpoint); il resto sono le attività.
    var videoBlock = null;
    var rest = [];
    blocks.forEach(function (block) {
      if (!videoBlock && block.type === 'video_checkpoint') { videoBlock = block; return; }
      rest.push(block);
    });

    var wrap = el('div', 'lesson-videofirst-v2');

    // Video + trascrizione/tab a tutta larghezza in cima.
    if (videoBlock) {
      wrap.appendChild(self.renderers.renderBlock(videoBlock));
    }

    // Attività e approfondimenti sotto, in griglia responsive.
    if (rest.length > 0) {
      var activities = el('div', 'vf-activities');
      rest.forEach(function (block) { activities.appendChild(self.renderers.renderBlock(block)); });
      wrap.appendChild(activities);
    }

    main.appendChild(wrap);

    // Completa alla visualizzazione (lezione senza gate di test).
    this.markComplete(step);
  };

  /** Modalità di fruizione scelta dall'utente (persistita). Default 'slide'. */
  Player.prototype.viewMode = function () {
    if (this._viewMode) return this._viewMode;
    var saved = null;
    try { saved = global.localStorage && global.localStorage.getItem('scorm.viewMode'); } catch (e) { /* no-op */ }
    this._viewMode = (saved === 'scroll' || saved === 'hybrid' || saved === 'slide') ? saved : 'slide';
    return this._viewMode;
  };
  Player.prototype.setViewMode = function (mode) {
    this._viewMode = mode;
    try { global.localStorage && global.localStorage.setItem('scorm.viewMode', mode); } catch (e) { /* no-op */ }
    this.render();
  };

  /** Card di un singolo concetto: titolo + blocchi che lo compongono. */
  Player.prototype.buildConceptSection = function (step, concept, idx) {
    var section = el('section', 'concept');
    section.setAttribute('data-concept-index', String(idx));
    if (concept.title) {
      var h = textEl('h2', concept.title);
      h.className = 'concept-title';
      section.appendChild(h);
    }
    (concept.blocks || []).forEach(function (block) {
      section.appendChild(this.renderers.renderBlock(block));
    }, this);
    return section;
  };

  /** Stepper lineare dei concetti: pastiglie cliccabili (solo verso i raggiunti). */
  Player.prototype.buildConceptStepper = function (step, concepts) {
    var self = this;
    var wrap = el('div', 'concept-stepper');
    wrap.setAttribute('role', 'tablist');
    wrap.setAttribute('aria-label', 'Concetti della lezione');
    for (var i = 0; i < concepts.length; i++) {
      (function (i) {
        var dot = el('button', 'concept-dot');
        var reached = i <= step._reached;
        var isCurrent = i === step._sub;
        dot.setAttribute('type', 'button');
        dot.setAttribute('role', 'tab');
        dot.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
        dot.setAttribute('aria-label', 'Concetto ' + (i + 1) + (concepts[i].title ? ': ' + concepts[i].title : ''));
        if (isCurrent) dot.className += ' is-current';
        if (reached) dot.className += ' is-reached';
        else { dot.className += ' is-locked'; dot.disabled = true; }
        dot.appendChild(textEl('span', String(i + 1)));
        dot.addEventListener('click', function () {
          if (i <= step._reached) { step._sub = i; self.render(); }
        });
        wrap.appendChild(dot);
      })(i);
    }
    return wrap;
  };

  /** Navigazione intra-lezione (slide/hybrid): precedente/successivo concetto. */
  Player.prototype.buildConceptNav = function (step, concepts) {
    var self = this;
    var nav = el('div', 'concept-nav');

    var prev = textEl('button', '‹ Concetto precedente');
    prev.className = 'concept-prev';
    prev.disabled = step._sub === 0;
    prev.addEventListener('click', function () {
      if (step._sub > 0) { step._sub--; self.render(); }
    });

    var atLast = step._sub >= concepts.length - 1;
    var next = textEl('button', atLast ? 'Concetto completato' : 'Concetto successivo ›');
    next.className = 'concept-next';
    next.disabled = atLast;
    next.addEventListener('click', function () {
      if (step._sub < concepts.length - 1) {
        step._sub++;
        if (step._sub > step._reached) step._reached = step._sub;
        self.render();
      }
    });

    var status = el('span', 'concept-status');
    status.textContent = 'Concetto ' + (step._sub + 1) + ' di ' + concepts.length;

    nav.appendChild(prev);
    nav.appendChild(status);
    nav.appendChild(next);
    return nav;
  };

  Player.prototype.renderAssessmentStep = function (step, main) {
    var self = this;
    var assessment = step.assessment;
    // Assessment senza domande: non è un gate valido. Lo auto-completiamo (con
    // avviso) per non bloccare l'avanzamento in un vicolo cieco.
    if (!assessment.questions || assessment.questions.length === 0) {
      var warn = el('p', 'assessment-intro');
      warn.textContent = 'Questo test non ha ancora domande: nessuna valutazione richiesta.';
      main.appendChild(warn);
      this.markComplete(step);
      return;
    }
    var mastery = typeof assessment.masteryScore === 'number' ? assessment.masteryScore : 0.8;
    var intro = el('p', 'assessment-intro');
    intro.textContent = step.gate
      ? 'Supera questo test (soglia ' + Math.round(mastery * 100) + '%) per sbloccare il modulo successivo.'
      : 'Completa il test finale del corso.';
    main.appendChild(intro);

    var view = this.renderers.renderAssessment(assessment, {
      onSubmit: function (answers, feedbackEl, submitBtn) {
        var result = global.Scoring.gradeAssessment(assessment, answers);
        feedbackEl.removeAttribute('hidden');
        feedbackEl.className = 'assessment-feedback ' + (result.passed ? 'is-pass' : 'is-fail');
        feedbackEl.textContent =
          'Punteggio: ' + Math.round(result.scaled * 100) + '%. ' +
          (result.passed ? 'Superato!' : 'Non superato: riprova.');
        // Report del punteggio all'LMS.
        if (self.scorm && self.scorm.setScore) {
          self.scorm.setScore(result.scaled, result.raw, 0, result.max);
          self.scorm.setOutcome(result.completed, result.passed);
          self.scorm.commit();
        }
        // Memorizza l'esito del test per l'aggregazione finale (completamento
        // e score riportati all'LMS a fine corso).
        if (!self._assessmentResults) self._assessmentResults = {};
        self._assessmentResults[step.id] = { scaled: result.scaled, passed: result.passed };
        // Un assessment è "completato" ai fini del gating solo se superato.
        if (result.passed) {
          self.completed[step.id] = true;
          submitBtn.disabled = true;
          self.updateNav();
        }
      },
    });
    main.appendChild(view);
  };

  /** Osserva lo scroll: la lezione è completa quando la sentinella è visibile. */
  Player.prototype.watchScrollCompletion = function (step) {
    var self = this;
    var sentinel = this.root.querySelector('.scroll-sentinel');
    if (!sentinel) { this.markComplete(step); return; }
    // Se il contenuto è più corto della viewport, è già tutto visibile.
    if (sentinel.getBoundingClientRect().top <= (global.innerHeight || 800)) {
      this.markComplete(step);
      return;
    }
    if (typeof global.IntersectionObserver === 'function') {
      var obs = new global.IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) {
          obs.disconnect();
          self.markComplete(step);
        }
      });
      obs.observe(sentinel);
    } else {
      // Fallback senza IntersectionObserver: completa al primo scroll in fondo.
      var onScroll = function () {
        if (sentinel.getBoundingClientRect().top <= (global.innerHeight || 800)) {
          global.removeEventListener('scroll', onScroll);
          self.markComplete(step);
        }
      };
      global.addEventListener('scroll', onScroll);
    }
  };

  Player.prototype.markComplete = function (step) {
    if (this.completed[step.id]) return;
    this.completed[step.id] = true;
    this.updateNav();
  };

  Player.prototype.buildProgress = function () {
    var total = this.steps.length;
    var doneCount = 0;
    for (var i = 0; i < total; i++) if (this.isStepComplete(i)) doneCount++;
    var pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    var wrap = el('div', 'course-progress');
    var bar = el('div', 'course-progress-bar');
    var fill = el('div', 'course-progress-fill');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    wrap.appendChild(textEl('span', 'Passo ' + (this.index + 1) + ' di ' + total));
    wrap.appendChild(bar);
    return wrap;
  };

  /**
   * Header del corso sempre visibile (sticky): copertina (miniatura) + titolo +
   * docente a sinistra, logo del brand a destra. Costruito a ogni render ma con
   * contenuto costante, resta ancorato in cima via CSS (position: sticky).
   */
  Player.prototype.buildCourseTopbar = function () {
    var instructor = this.course.instructor || null;
    var bar = el('div', 'course-topbar');

    // Copertina come miniatura.
    if (this.course.coverImageKey) {
      var thumb = document.createElement('img');
      thumb.className = 'topbar-cover';
      thumb.setAttribute('src', this.course.coverImageKey);
      thumb.setAttribute('alt', '');
      bar.appendChild(thumb);
    }

    var info = el('div', 'topbar-info');
    var title = textEl('p', this.course.title);
    title.className = 'topbar-title';
    info.appendChild(title);
    if (instructor && instructor.name) {
      var who = el('div', 'topbar-instructor');
      if (instructor.avatarKey) {
        // Avatar su anello brandizzato: la foto è CONTENUTA (object-contain)
        // dentro il cerchio, senza tagli e con sfondo neutro per i PNG chiari.
        var ring = el('span', 'topbar-avatar-ring');
        var av = document.createElement('img');
        av.className = 'topbar-avatar';
        av.setAttribute('src', instructor.avatarKey);
        av.setAttribute('alt', '');
        ring.appendChild(av);
        who.appendChild(ring);
      } else {
        var mono = textEl('span', (instructor.name.charAt(0) || '?').toUpperCase());
        mono.className = 'topbar-avatar topbar-avatar-mono';
        who.appendChild(mono);
      }
      var label = instructor.role ? instructor.name + ' · ' + instructor.role : instructor.name;
      who.appendChild(textEl('span', label));
      info.appendChild(who);
    }
    bar.appendChild(info);

    // NB: nessun badge/logo del brand nell'header dell'export (richiesta UX):
    // il brand pilota comunque colori/font del tema. Il logo resta disponibile
    // in __BRAND__ per usi futuri, ma non viene mostrato nella topbar.

    return bar;
  };

  /**
   * Indice del corso navigabile. Raggruppa gli step per modulo e consente il
   * salto solo verso step già completati o lo step "frontiera" (il primo non
   * completo), coerente col gating di go(). Gli step futuri sono visibili ma
   * bloccati; il corrente è evidenziato.
   */
  Player.prototype.buildCourseIndex = function (navPos) {
    var self = this;
    navPos = navPos === 'top' ? 'top' : 'side';
    // Frontiera: indice del primo step non completo (fin lì si può navigare).
    var frontier = 0;
    while (frontier < this.steps.length && this.isStepComplete(frontier)) frontier++;

    // In 'top' l'indice è un <details> espandibile; in 'side' è una sidebar
    // sempre visibile (<nav>), come l'anteprima web.
    var container;
    var closeAfterClick = false;
    if (navPos === 'top') {
      container = el('details', 'course-index');
      container.open = false;
      var summary = document.createElement('summary');
      summary.textContent = 'Programma del corso';
      container.appendChild(summary);
      closeAfterClick = true;
    } else {
      container = el('nav', 'course-index course-index-side');
      container.setAttribute('aria-label', 'Programma del corso');
      var heading = textEl('p', 'Programma del corso');
      heading.className = 'course-index-title';
      container.appendChild(heading);
    }

    var ol = document.createElement('ol');
    var lastModule = null;
    for (var i = 0; i < this.steps.length; i++) {
      var step = this.steps[i];
      // Skip overview steps from the module grouping headers.
      if (step.kind === 'course_overview' || step.kind === 'module_overview') continue;
      var moduleTitle = step.moduleTitle || '';
      if (moduleTitle !== lastModule) {
        lastModule = moduleTitle;
        ol.appendChild(textEl('li', moduleTitle)).className = 'ci-module';
      }
      (function (i, step) {
        var label;
        if (step.kind === 'lesson') label = step.lesson.title;
        else if (step.kind === 'course_overview') label = 'Panoramica del corso';
        else if (step.kind === 'module_overview') label = step.moduleTitle + ' — Panoramica';
        else label = (step.assessment.title || 'Test');
        var reachable = i <= frontier;
        var isCurrent = i === self.index;
        var isDone = self.isStepComplete(i);
        var btn = el('button', 'ci-lesson' + (isCurrent ? ' is-current' : '') + (isDone ? ' is-done' : '') + (reachable ? '' : ' is-locked'));
        btn.setAttribute('type', 'button');
        btn.setAttribute('aria-current', isCurrent ? 'true' : 'false');
        var badge = textEl('span', isDone ? '✓' : (step.kind === 'assessment' ? '?' : String(i + 1)));
        badge.className = 'ci-badge';
        var text = textEl('span', label);
        text.className = 'ci-text';
        btn.appendChild(badge);
        btn.appendChild(text);
        if (!reachable) btn.disabled = true;
        btn.addEventListener('click', function () {
          if (i <= frontier) {
            if (closeAfterClick) container.open = false;
            self.go(i);
          }
        });
        var li = document.createElement('li');
        li.appendChild(btn);
        ol.appendChild(li);
      })(i, step);
    }
    container.appendChild(ol);
    return container;
  };

  Player.prototype.buildNav = function () {
    var nav = el('nav', 'course-nav');
    var self = this;

    var prev = textEl('button', 'Precedente');
    prev.disabled = this.index === 0;
    prev.addEventListener('click', function () { self.go(self.index - 1); });

    var last = this.index === this.steps.length - 1;
    var next = textEl('button', last ? 'Completa corso' : 'Avanti');
    next.className = 'nav-next';
    next.disabled = !this.isStepComplete(this.index);
    next.addEventListener('click', function () {
      if (!self.isStepComplete(self.index)) return;
      if (last) self.complete();
      else self.go(self.index + 1);
    });

    var hint = el('span', 'nav-hint');
    if (!this.isStepComplete(this.index)) {
      var step = this.steps[this.index];
      hint.textContent = step && step.kind === 'assessment'
        ? 'Supera il test per proseguire.'
        : 'Scorri fino in fondo per proseguire.';
    }

    nav.appendChild(prev);
    nav.appendChild(hint);
    nav.appendChild(next);
    this._nav = nav;
    return nav;
  };

  /** Aggiorna lo stato del pulsante "Avanti" e la barra senza ri-renderizzare. */
  Player.prototype.updateNav = function () {
    if (!this.root) return;
    var oldNav = this.root.querySelector('.course-nav');
    if (oldNav) this.root.replaceChild(this.buildNav(), oldNav);
    var oldProg = this.root.querySelector('.course-progress');
    if (oldProg) this.root.replaceChild(this.buildProgress(), oldProg);
  };

  Player.prototype.go = function (index) {
    if (index < 0 || index >= this.steps.length) return;
    // Gating: non si avanza se lo step corrente non è completo.
    if (index > this.index && !this.isStepComplete(this.index)) return;
    this.index = index;
    if (this.scorm && this.scorm.saveBookmark) {
      this.scorm.saveBookmark(String(index), JSON.stringify({ index: index }));
    }
    if (global.scrollTo) global.scrollTo(0, 0);
    this.render();
  };

  /**
   * Salto a una lezione per id (usato dal widget "Chiedi al corso"). Rispetta il
   * gating: se tra la posizione attuale e la lezione c'è un test non superato,
   * si ferma a quel test. Se la lezione è già raggiungibile, ci va direttamente.
   */
  Player.prototype.goToLesson = function (lessonId) {
    if (!lessonId) return;
    var target = -1;
    for (var i = 0; i < this.steps.length; i++) {
      if (this.steps[i].kind === 'lesson' && this.steps[i].lesson && this.steps[i].lesson.id === lessonId) {
        target = i;
        break;
      }
    }
    if (target < 0) return;
    // Trova il primo gate (assessment non completo) prima del target.
    var dest = target;
    for (var j = 0; j < target; j++) {
      var s = this.steps[j];
      if (s.kind === 'assessment' && s.gate && !this.isStepComplete(j)) { dest = j; break; }
    }
    this.index = dest;
    if (this.scorm && this.scorm.saveBookmark) {
      this.scorm.saveBookmark(String(dest), JSON.stringify({ index: dest }));
    }
    if (global.scrollTo) global.scrollTo(0, 0);
    this.render();
  };

  /**
   * Aggrega l'esito dei test del corso per riportarlo all'LMS. Il successo del
   * corso dipende dal superamento di TUTTI i test (intermedi + finale); lo score
   * riportato è quello del test FINALE se presente, altrimenti la media di tutti
   * i test. Ritorna { hasAssessments, allPassed, scaled|null }.
   */
  Player.prototype.aggregateOutcome = function () {
    var steps = this.steps || [];
    var assessmentSteps = [];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].kind === 'assessment' && steps[i].assessment &&
          steps[i].assessment.questions && steps[i].assessment.questions.length > 0) {
        assessmentSteps.push(steps[i]);
      }
    }
    if (assessmentSteps.length === 0) {
      return { hasAssessments: false, allPassed: true, scaled: null };
    }
    var allPassed = true;
    var finalScore = null;
    var sum = 0;
    var n = 0;
    for (var j = 0; j < assessmentSteps.length; j++) {
      var s = assessmentSteps[j];
      var r = this._assessmentResults && this._assessmentResults[s.id];
      var scaled = r ? r.scaled : 0;
      var passed = r ? r.passed : false;
      if (!passed) allPassed = false;
      sum += scaled;
      n += 1;
      if (s.gate === false) finalScore = scaled; // il test finale
    }
    var scaled = finalScore != null ? finalScore : (n > 0 ? sum / n : null);
    return { hasAssessments: true, allPassed: allPassed, scaled: scaled };
  };

  Player.prototype.complete = function () {
    var outcome = this.aggregateOutcome();
    if (this.scorm) {
      // Score complessivo (test finale o media dei test), se ci sono test.
      if (outcome.scaled != null && this.scorm.setScore) {
        this.scorm.setScore(outcome.scaled, null, 0, 1);
      }
      if (this.scorm.setOutcome) {
        // Completato solo se tutti i test sono superati; pass/fail riportato
        // all'LMS. Senza test, il corso è completato (passed non applicabile).
        if (outcome.hasAssessments) {
          this.scorm.setOutcome(outcome.allPassed, outcome.allPassed);
        } else {
          this.scorm.setOutcome(true, null);
        }
        this.scorm.commit();
        this.scorm.terminate();
      }
    }
    if (this.root) {
      this.root.innerHTML = '';
      var done = el('div', 'course-done');
      if (outcome.hasAssessments && !outcome.allPassed) {
        done.appendChild(textEl('h1', 'Corso terminato'));
        done.appendChild(textEl('p', 'Hai raggiunto la fine, ma non tutti i test risultano superati.'));
      } else {
        done.appendChild(textEl('h1', 'Corso completato'));
        done.appendChild(textEl('p', 'Hai completato tutti i passi del corso.'));
      }
      this.root.appendChild(done);
    }
  };

  function el(tag, className) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    return n;
  }
  function textEl(tag, text) {
    var n = document.createElement(tag);
    n.textContent = text;
    return n;
  }

  global.Player = Player;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Player: Player, buildSteps: buildSteps };
  }
})(typeof window !== 'undefined' ? window : this);
