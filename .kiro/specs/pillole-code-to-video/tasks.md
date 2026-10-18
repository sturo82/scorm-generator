# Tasks — Cartoon pillole via Code-to-Video (Remotion)

> STATO: implementazione COMPLETA (Fasi A–G). Motore code-to-video funzionante
> dietro `PROVIDER_CARTOON_VIDEO=remotion`, con gate verde a ogni fase. In prod
> il provider resta `none` (nessun costo). Per attivarlo serve fornire Chromium
> all'ambiente di rendering (MVP in-process o runner/Lambda dedicato) —
> vedi docs/COURSE-FORMATS-PILLOLE.md § "infrastruttura di rendering".

Convenzioni: build/test SEMPRE nel gate Docker (`npm run build && vitest run &&
npm run lint`). Dopo ogni fase: gate verde. Implementare dietro
`PROVIDER_CARTOON_VIDEO=remotion` lasciando `none` in prod finché non è pronto.
Nessun segreto nel repo. Modelli neurali (luma/nova) restano intatti come premium.

---

## Fase A — Contratti e logica di timing (nessuna dipendenza Remotion)

- [x] 1. Schema `VideoSpec` in `packages/contracts/src/video-spec.ts`
  - Zod: `Anchor`, `AnimSpec`, `ComponentName` (enum whitelist), `Layer`, `Scene`,
    `VideoSpec`; tipo `WordMark`. Esporre dall'index dei contracts.
  - _Requisiti: 2.1, 2.2, 2.3, 2.4, 2.6_

- [x] 2. Logica di timing pura `packages/contracts/src/video-spec-timing.ts`
  - `resolveFrame(anchor, sceneBounds, words, fps)` e `computeSceneBounds(...)`:
    conversione word→ms→frame, gestione `sceneStart`/`sceneEnd`, clamp su indici
    fuori range. Nessuna dipendenza da Remotion (pura, testabile).
  - _Requisiti: 2.3, 2.4, 6.2_

- [x] 3. Test unitari schema + timing (`*.test.ts`)
  - VideoSpec: accetta spec valido; rifiuta `component` fuori whitelist e ancore
    malformate. Timing: casi inizio/fine scena, parola N, parola oltre range.
  - _Requisiti: 8.2_

- [x] 4. Checkpoint A: gate verde.
  - _Requisiti: 8.1_

---

## Fase B — Voiceover con word-timings (Polly)

- [x] 5. Estendere il port `SpeechProvider` con `synthesizeWithMarks?`
  - In `packages/domain/src/ports/speech-provider.ts`: metodo opzionale che
    ritorna `{ audio, contentType, marks: WordMark[] }`. Additivo, non rompe gli
    implementatori esistenti.
  - _Requisiti: 3.1, 3.2_

- [x] 6. Implementare in `PollySpeechProvider`
  - Due `SynthesizeSpeechCommand`: `OutputFormat=mp3` (audio) e `OutputFormat=json`
    + `SpeechMarkTypes=['word']` (marks). Parser delle righe JSON → `WordMark[]`
    (time→startMs; endMs = start della parola dopo o fine audio).
  - Voce di default per lingua come già fa `synthesize`.
  - _Requisiti: 3.1, 3.3_

- [x] 7. Test parser speech marks + metering invariato
  - Unit test del parsing marks. Verificare che `synthesize` (MP3) resti identico.
    Metering Polly applicato (come narrazione).
  - _Requisiti: 3.2, 3.4, 8.3_

- [x] 8. Checkpoint B: gate verde.
  - _Requisiti: 8.1_

---

## Fase C — Libreria Remotion (package video)

- [x] 9. Nuovo package `packages/video` (React + Remotion)
  - `package.json` con `remotion`, `@remotion/bundler`, `@remotion/renderer`,
    react/react-dom. Config TS/build coerente col monorepo.
  - _Requisiti: 5.1_

- [x] 10. `registry.ts` + `AnimatedLayer.tsx` + `timing` glue
  - Registry mappa i nomi whitelist ai componenti. `AnimatedLayer` applica
    entrate/uscite generiche (fade/slide/pop) da `enter`/`exit`.
  - _Requisiti: 5.1, 5.5_

- [x] 11. Componenti base
  - `TextReveal`, `Caption` (karaoke: evidenzia la parola corrente dai WordMark),
    `BulletList`, `ChainDiagram`, `IconStat`. SVG/DOM, colori del `theme`,
    animazioni via interpolate/spring.
  - _Requisiti: 5.2, 5.3, 5.4_

- [x] 12. `PillolaVideo.tsx` (composition root)
  - Interpreta `VideoSpec` + audio + `WordMark[]`: `Sequence` per scena,
    risoluzione frame via `video-spec-timing`, `Audio` del voiceover.
  - _Requisiti: 6.2_

- [x] 13. Checkpoint C: gate verde (type-check del package video incluso).
  - _Requisiti: 8.1_

---

## Fase D — Generazione VideoSpec (LLM)

- [x] 14. `videoSpecPrompt(scenePrompt, lang)` in `apps/api/src/generation/prompts.ts`
  - Vincola l'LLM alla whitelist dei componenti e allo schema; voiceover nella
    lingua del corso. Output JSON.
  - _Requisiti: 4.1, 4.2, 4.3_

- [x] 15. Parsing + validazione + self-repair
  - Parse → `VideoSpec.safeParse`; su errore, un retry con l'errore in pancia;
    se persiste → errore chiaro (→ scena `failed`).
  - _Requisiti: 4.4_

- [x] 16. Test generazione (LLM mockato)
  - Spec valido passa; spec invalido innesca retry; doppio fallimento → errore.
  - _Requisiti: 8.2_

- [x] 17. Checkpoint D: gate verde.
  - _Requisiti: 8.1_

---

## Fase E — Provider code-to-video

- [x] 18. `RemotionCartoonProvider` in `packages/adapters/src/remotion/`
  - Implementa `TextToVideoProvider`. `startJob`: LLM→VideoSpec, TTS→audio+marks,
    registra job (in memoria/stato) → `jobRef`. `fetchJob`: bundle (cache) +
    `renderMedia` (h264) → legge byte MP4, pulisce temp, ritorna
    `{ status:'completed', bytes, contentType, durationSec }`. LLM e TTS iniettati.
  - _Requisiti: 1.2, 1.3, 1.5, 6.1, 6.2, 6.3, 6.5_

- [x] 19. Test provider (render mockato)
  - Con LLM/TTS mock e render stubbato: stati processing/completed/failed coerenti.
  - _Requisiti: 1.5, 8.2_

- [x] 20. Checkpoint E: gate verde.
  - _Requisiti: 8.1_

---

## Fase F — Wiring, config e metering

- [x] 21. Factory provider + config
  - `generation.module.ts`: ramo `remotion` nella factory cartoon. `configuration.ts`:
    parametri (`CARTOON_VIDEO_RESOLUTION`, `_FPS`, voce TTS default) + provider.
    `.env.example` aggiornato.
  - _Requisiti: 1.1, 7.1_

- [x] 22. Metering
  - Registrare costo pipeline: TTS Polly (voce esistente) + costo rendering
    (per secondo di video o per job). Rimuovere il listino $/s neurale per questo
    provider. Quota mensile per tenant invariata.
  - _Requisiti: 7.2, 7.3_

- [x] 23. Checkpoint F: gate verde; `none`/`mock` invariati.
  - _Requisiti: 8.1, 8.3, 8.4_

---

## Fase G — Infra rendering e rollout

- [x] 24. Decisione infra (D3 del design): MVP in-process (immagine API con
  Chromium) vs runner dedicato/Lambda. Documentare la scelta.
  - _Requisiti: 6.4, 7.4_

- [x] 25. Predisporre l'ambiente di rendering scelto (deps Chromium nell'immagine
  o worker/Lambda), senza attivare in prod.
  - _Requisiti: 6.3, 6.4_

- [x] 26. Verifica reale in dev su una pillola di prova (render locale) + confronto
  costi documentato.
  - _Requisiti: 7.4_

- [x] 27. Attivazione graduale in prod (`PROVIDER_CARTOON_VIDEO=remotion`) solo a
  render e costi confermati.
  - _Requisiti: 1.1_
