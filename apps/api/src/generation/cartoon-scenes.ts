/*
 * cartoon-scenes.ts — Astrazione AGNOSTICA al tipo di block per la pipeline
 * code-to-video ("cartoon"). Il motore cartoon ha bisogno, da una lezione, di
 * una lista uniforme di "scene da rendere": ciascuna con uno storyboard
 * (prompt) e un MediaRef video vivo su cui scrivere stato/risultato.
 *
 * Due sorgenti di scene, stessa forma di MediaRef (kind/storageKey/
 * videoGenStatus/videoGenJobRef/videoGenError/placeholderPrompt/alt):
 *  - `branching_scenario`  → UNA scena per node  (media = node.media)
 *  - `video_checkpoint`    → UNA scena singola   (media = payload.video)
 *
 * Le funzioni NON clonano: ritornano riferimenti VIVI dentro l'array `blocks`
 * passato, così chi muta la `media` e poi persiste `lesson.blocks` salva le
 * modifiche. Type-light per lavorare sul JSON non tipizzato dei block.
 */

/** MediaRef "vivo" dentro il JSON dei block (mutabile in place). */
export type CartoonMedia = Record<string, unknown>;

/** Una scena cartoon normalizzata, con riferimento vivo alla sua media. */
export interface CartoonScene {
  /** Id del block che ospita la scena. */
  blockId: string;
  /** Id della scena: per gli scenari è l'id del node; per i video è l'id del block. */
  sceneId: string;
  /** Storyboard/testo da usare come prompt text-to-video. */
  prompt: string;
  /** Riferimento VIVO al MediaRef video (mutare qui scrive nel JSON dei block). */
  media: CartoonMedia;
}

type BlockLike = { id?: unknown; type?: string; payload?: unknown };

/** True se la media è un video segnaposto (kind video, senza storageKey). */
export function isPlaceholderVideo(media: CartoonMedia): boolean {
  return String(media.kind) === 'video' && !media.storageKey;
}

/** Storyboard della scena: placeholderPrompt, poi alt come fallback. */
function scenePrompt(media: CartoonMedia): string {
  return String(media.placeholderPrompt || media.alt || '').trim();
}

/**
 * Raccoglie TUTTE le scene cartoon di una lezione (riferimenti vivi), da
 * entrambi i tipi di block. Se `blockId` è dato, limita a quel block; se
 * `sceneId` è dato, limita a quella scena. Non filtra per stato: il chiamante
 * decide quali sono candidate (placeholder, non già in elaborazione).
 */
export function collectCartoonScenes(
  blocks: unknown[],
  blockId?: string,
  sceneId?: string,
): CartoonScene[] {
  const list = (Array.isArray(blocks) ? blocks : []) as BlockLike[];
  const out: CartoonScene[] = [];
  for (const b of list) {
    const bid = typeof b?.id === 'string' ? b.id : '';
    if (!bid) continue;
    if (blockId && bid !== blockId) continue;

    if (b.type === 'branching_scenario') {
      const payload = (b.payload ?? {}) as Record<string, unknown>;
      const nodes = Array.isArray(payload.nodes) ? (payload.nodes as Array<Record<string, unknown>>) : [];
      for (const n of nodes) {
        const nid = typeof n?.id === 'string' ? n.id : String(n?.id ?? '');
        if (!nid) continue;
        if (sceneId && nid !== sceneId) continue;
        const media = (n.media ?? {}) as CartoonMedia;
        if (String(media.kind) !== 'video') continue;
        // Garantisce che la media esista come oggetto vivo sul node.
        n.media = media;
        out.push({ blockId: bid, sceneId: nid, prompt: scenePrompt(media), media });
      }
    } else if (b.type === 'video_checkpoint') {
      // Il video_checkpoint ha UNA scena: la sceneId coincide col block id.
      if (sceneId && sceneId !== bid) continue;
      const payload = (b.payload ?? {}) as Record<string, unknown>;
      const media = (payload.video ?? {}) as CartoonMedia;
      if (String(media.kind) !== 'video') continue;
      payload.video = media;
      b.payload = payload;
      out.push({ blockId: bid, sceneId: bid, prompt: scenePrompt(media), media });
    }
  }
  return out;
}

/**
 * Localizza UNA scena cartoon (riferimento vivo) per block+scene, o null se
 * assente. Usata dai metodi che scrivono stato/risultato su una singola scena.
 */
export function findCartoonScene(
  blocks: unknown[],
  blockId: string,
  sceneId: string,
): CartoonScene | null {
  const scenes = collectCartoonScenes(blocks, blockId, sceneId);
  return scenes[0] ?? null;
}
