import { estimateInputTokens } from '@scorm/contracts';
import type { RetrievedChunk } from '../knowledge/retrieval.service.js';
import { formatContext } from './prompts.js';

/**
 * Costruisce il messaggio della chiamata restando entro il limite di token di ingresso del
 * pacchetto: se la stima supera il limite si tolgono gli estratti della knowledge meno pertinenti
 * (gli ultimi), uno alla volta. Il resto del prompt è già limitato (vedi PROMPT_LIMITS).
 */
export function fitContext(
  build: (context: string) => string,
  chunks: RetrievedChunk[],
  fixed: { system: string; schema?: object },
  maxInputTokens: number,
): { content: string; droppedChunks: number; estimatedTokens: number } {
  let kept = chunks.length;
  for (;;) {
    const content = build(formatContext(chunks.slice(0, kept)));
    const estimatedTokens = estimateInputTokens([fixed.system, content], fixed.schema);
    if (estimatedTokens <= maxInputTokens || kept === 0) {
      return { content, droppedChunks: chunks.length - kept, estimatedTokens };
    }
    kept--;
  }
}
