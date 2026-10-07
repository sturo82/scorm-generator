import type {
  TranscriptionProvider,
  TranscribeInput,
  TranscribeResult,
} from '@scorm/domain';

/**
 * TranscriptionProvider "no-op" per sviluppo e test: NON esiste un servizio ASR
 * in locale, quindi NON inventa una trascrizione. Ritorna zero segmenti, così
 * lo stato resta onesto ("nessuna trascrizione disponibile") invece di mostrare
 * testo e timing finti che non corrispondono al video reale. La trascrizione va
 * inserita a mano (editor) oppure generata in produzione con un provider ASR
 * reale (es. Amazon Transcribe).
 */
export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'mock';

  async transcribe(_input: TranscribeInput): Promise<TranscribeResult> {
    return { segments: [] };
  }
}
