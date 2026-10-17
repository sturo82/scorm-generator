import type {
  TextToVideoProvider,
  GenerateCartoonInput,
  GenerateCartoonJobResult,
} from '@scorm/domain';

/**
 * TextToVideoProvider di sviluppo/test: NON chiama Bedrock/Nova Reel e NON
 * consuma quota. Simula il ciclo asincrono completando subito con un video
 * "finto" veicolato come data: URI nel campo s3Uri. Il servizio riconosce lo
 * schema `data:` e ne salva i byte su storage senza passare da S3, così si può
 * testare l'intero flusso (storage, metering, aggiornamento del node) in locale.
 */
export class MockTextToVideoProvider implements TextToVideoProvider {
  readonly id = 'mock';

  // Un MP4 minimale (box ftyp "isom"): byte segnaposto per i test del flusso.
  private static readonly FAKE_MP4_BASE64 =
    'AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAAhmcmVlAAAAAG1kYXQ=';

  async startJob(_input: GenerateCartoonInput): Promise<{ jobRef: string }> {
    const jobRef = `mock-cartoon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return { jobRef };
  }

  async fetchJob(_jobRef: string): Promise<GenerateCartoonJobResult> {
    return {
      status: 'completed',
      s3Uri: `data:video/mp4;base64,${MockTextToVideoProvider.FAKE_MP4_BASE64}`,
      durationSec: 6,
    };
  }
}
