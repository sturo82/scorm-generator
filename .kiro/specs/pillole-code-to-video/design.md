# Design — Cartoon pillole via Code-to-Video (Remotion)

## Panoramica

Motore code-to-video deterministico per i mini-cartoon delle scene pillola.
Sostituisce i modelli neurali (Luma, ~$1.50/s) con una pipeline a codice: LLM →
`VideoSpec` JSON → voiceover TTS con word-timings → composizione Remotion/SVG →
rendering MP4. Costo per pillola da ~$52 a pochi centesimi, qualità vettoriale,
sync voce↔grafica al millisecondo.

Il motore si innesta come **nuovo `TextToVideoProvider`** (`id: 'remotion'`): il
resto del sistema cartoon (polling, salvataggio, player, gate scelte, metering)
resta invariato.

## Flusso

```
startJob(input: { prompt, durationSec?, language?, aspectRatio? })
  │
  ├─ 1) LLM: videoSpecPrompt(prompt, language) ──► VideoSpec (validato Zod)
  ├─ 2) Polly: synthesizeWithMarks(voiceover.text, lang) ──► mp3 + WordMark[]
  ├─ 3) persiste job (spec+audio+words) → jobRef
  │
fetchJob(jobRef)
  ├─ se non pronto → { status: 'processing' }
  ├─ 4) bundle Remotion (cache) + render MP4 (h264)
  └─ → { status: 'completed', bytes, contentType, durationSec }
         │
         ▼  (INVARIATO)
  MediaService.pollCartoonJob → applyCartoonResult → storageKey nella scena
```

## Componenti e file

### 1. Contratti — `packages/contracts/src/video-spec.ts` (nuovo)
Schema Zod `VideoSpec` + tipi `WordMark`, `Anchor`, `AnimSpec`, e la lista dei
nomi di componente consentiti (whitelist condivisa con il registry).

```ts
export const Anchor = z.union([
  z.object({ word: z.number().int().nonnegative() }),
  z.literal('sceneStart'),
  z.literal('sceneEnd'),
]);
export const AnimSpec = z.object({
  at: Anchor,
  anim: z.enum(['fadeUp', 'fadeOut', 'popIn', 'slideIn', 'none']).default('fadeUp'),
  ms: z.number().int().positive().max(5000).default(400),
});
export const ComponentName = z.enum([
  'TextReveal', 'Caption', 'BulletList', 'ChainDiagram', 'IconStat', 'ArrowFlow',
]);
export const Layer = z.object({
  id: z.string(),
  component: ComponentName,
  props: z.record(z.unknown()).default({}),
  enter: AnimSpec,
  exit: AnimSpec.partial({ anim: true, ms: true }).optional(),
});
export const Scene = z.object({
  id: z.string(),
  durationHint: z.union([z.literal('auto'), z.number().int().positive()]).default('auto'),
  background: z.object({ kind: z.enum(['solid']).default('solid'), color: z.string() }).optional(),
  layers: z.array(Layer).default([]),
});
export const VideoSpec = z.object({
  version: z.literal(1),
  canvas: z.object({ width: z.number().default(1920), height: z.number().default(1080), fps: z.number().default(30) }),
  theme: z.object({ palette: z.array(z.string()), bg: z.string(), fontFamily: z.string().default('Inter') }),
  voiceover: z.object({ text: z.string(), lang: z.string(), voiceId: z.string().optional() }),
  scenes: z.array(Scene).min(1),
});
export type VideoSpec = z.infer<typeof VideoSpec>;
export interface WordMark { word: string; startMs: number; endMs: number; }
```

La whitelist `ComponentName` è la **fonte di verità** sia per la validazione del
VideoSpec sia per il prompt LLM sia per il registry Remotion: un componente non
in whitelist viene rifiutato in validazione.

### 2. Polly word marks — `packages/domain/src/ports/speech-provider.ts` (estensione)
Aggiunta additiva al port: un metodo opzionale `synthesizeWithMarks` che ritorna
MP3 + `WordMark[]`. Gli adapter che non lo implementano restano validi.

```ts
export interface SpeechProvider {
  readonly id: string;
  synthesize(input: SynthesizeInput): Promise<SynthesizeResult>;         // esistente
  synthesizeWithMarks?(input: SynthesizeInput): Promise<{
    audio: Uint8Array; contentType: string; marks: WordMark[];
  }>;
}
```

`PollySpeechProvider` lo implementa facendo DUE chiamate `SynthesizeSpeech`:
una `OutputFormat=mp3` (audio) e una `OutputFormat=json` con
`SpeechMarkTypes=['word']` (marks, una riga JSON per parola con `time`/`value`).
Il metering Polly esistente si applica a entrambe.

### 3. Prompt LLM — `apps/api/src/generation/prompts.ts` (nuovo `videoSpecPrompt`)
Dato `scenePrompt` (lo storyboard della scena) + lingua, chiede un `VideoSpec`:
testo voiceover nella lingua del corso, scene con layer che usano SOLO i
componenti della whitelist, ancore a parole. L'output è validato con lo schema; su
fallimento, un retry con messaggio d'errore in pancia (self-repair) e, se persiste,
`failed`.

### 4. Libreria Remotion — `packages/video/` (nuovo package) o `apps/video-renderer/`
Contiene la root composition e i componenti. Isolata dal resto perché dipende da
React/Remotion (runtime browser) e serve bundling.

```
packages/video/src/
  registry.ts            # { TextReveal, Caption, BulletList, ChainDiagram, IconStat, ArrowFlow }
  PillolaVideo.tsx       # composition root: interpreta VideoSpec + audio + words
  AnimatedLayer.tsx      # entrate/uscite generiche (fade/slide/pop)
  timing.ts              # resolveFrame(anchor, sceneBounds, words, fps)
  components/
    TextReveal.tsx
    Caption.tsx          # karaoke: evidenzia la parola corrente dai WordMark
    BulletList.tsx
    ChainDiagram.tsx
    IconStat.tsx
    ArrowFlow.tsx
```

`timing.ts` è **puro** (nessuna dipendenza da Remotion) → testabile a unità: data
una lista di WordMark e un Anchor, ritorna il frame. Questa è la logica critica del
sync ed è il focus dei test.

### 5. Provider — `packages/adapters/src/remotion/remotion-cartoon-provider.ts` (nuovo)
Implementa `TextToVideoProvider`. `startJob` esegue LLM+TTS e mette in coda il job;
`fetchJob` fa bundle (cache) + render e ritorna i byte. L'LLM e il TTS sono iniettati
(non li istanzia l'adapter) per restare testabile e coerente con la DI del progetto.

### 6. Wiring — `apps/api/src/generation/generation.module.ts` + `configuration.ts`
La factory del provider cartoon aggiunge il ramo `remotion`. La config espone
risoluzione/fps/voce default e il flag provider.

## Decisioni di design

### D1 — Timing logico (word anchors) invece di secondi
L'LLM non sa quanto dura il parlato. Ancorare gli eventi alle **parole**
(`{ word: N }`) e risolvere i frame dai WordMark reali del TTS garantisce sync
esatto e rende la durata scena/video sempre coerente con l'audio. Alternativa
(secondi espliti dall'LLM) scartata: fragile e desincronizzata.

### D2 — Whitelist di componenti, non codice generato
L'LLM **compone** componenti esistenti e parametri; non genera JSX/codice. Questo
elimina rischi di sicurezza (no eval di codice LLM) e rende i risultati
prevedibili e on-brand. La whitelist è un enum Zod condiviso.

### D3 — Dove gira il rendering (infra)
Remotion rende via Chromium headless + FFmpeg. Due opzioni:
- **A) In-process nell'immagine API**: aggiungere Chromium/deps all'immagine App
  Runner. Semplice; ma i render (secondi-minuti) competono con l'API per CPU e
  memoria, e App Runner non è ideale per burst CPU.
- **B) Runner dedicato**: un servizio/worker separato o `@remotion/lambda`.
  Isola la CPU di rendering, scala indipendentemente, non rallenta l'API.

**Raccomandazione:** iniziare con **A** per un MVP verificabile (dietro
`PROVIDER_CARTOON_VIDEO=remotion`, attivabile solo quando pronto), poi migrare a
**B** (preferibilmente Lambda) per la produzione. Il port non cambia tra A e B:
cambia solo l'implementazione interna di `fetchJob`. La scelta è reversibile.

### D4 — Il provider ritorna byte, non S3
Coerente con il contratto `GenerateCartoonJobResult.completed.bytes`. L'adapter
rende l'MP4 su file temporaneo, ne legge i byte, pulisce, e li consegna. Il
servizio li salva nella key canonica come già fa per Luma. Nessuna gestione
bucket/region lato servizio.

### D5 — Asincronia e coda
`startJob` NON renderizza (sarebbe lungo): prepara spec+audio e registra il job.
`fetchJob` esegue (o verifica) il render. Si riusa il **polling sequenziale**
esistente (una scena alla volta) già introdotto per evitare race sul JSON
condiviso `lesson.blocks` — quindi al massimo un render alla volta per pillola,
che è anche gentile sulla CPU.

## Modello dati

Nessuna modifica a schema DB o al `branching_scenario`. Il `VideoSpec` è un
artefatto transitorio del provider (non persistito nella scena): nella scena
resta solo lo `storageKey` dell'MP4, come oggi. Opzionale (fase 2): salvare il
`VideoSpec` accanto al media per futura rigenerazione/editing — non richiesto ora.

## Gestione errori

- VideoSpec LLM non valido → retry con self-repair → `failed` con motivo chiaro.
- TTS fallito → `failed`.
- Render fallito (Chromium/FFmpeg) → `failed`, file temporanei ripuliti.
- Tutti gli stati `failed` passano per `writeCartoonError` esistente → la scena
  mostra l'errore e resta rigenerabile (il filtro candidate riprende le scene
  senza storageKey).

## Metering

Nuova voce di costo per scena cartoon remotion = **TTS Polly** (già una voce
esistente, `POLLY`) + un costo di **rendering** (tempo CPU, stimato per secondo
di video o per job). Si rimuove l'uso del listino $/s neurale per questo provider.
Il dettaglio delle unità/tariffe è un sotto-task del piano (va deciso un prezzo
interno di rendering o si traccia solo Polly all'inizio).

## Strategia di test

- **timing.ts**: unit test della conversione anchor→frame con WordMark noti
  (inizio/fine scena, parola N, parola oltre il range → clamp).
- **VideoSpec schema**: validazione (accetta spec valido, rifiuta component fuori
  whitelist, rifiuta ancore malformate).
- **Polly marks**: parsing delle righe JSON degli speech marks → WordMark[].
- **Provider**: con LLM e TTS mockati, `startJob`/`fetchJob` producono stati
  coerenti (mock del render per non dipendere da Chromium nei test).
- **Non-regressione**: `mock` e `none` invariati; gate verde (build+test+lint).

## Rollout

1. Implementare dietro `PROVIDER_CARTOON_VIDEO=remotion`, lasciando `none` in prod.
2. Verificare in dev (render reale locale) su una pillola di prova.
3. Decidere infra rendering (A→B) e predisporre l'immagine/worker.
4. Attivare in prod solo quando render e costi sono confermati.
