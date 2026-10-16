import type {
  VideoGenerationProvider,
  GenerateVideoInput,
  GenerateVideoJobResult,
  AvatarOption,
  VoiceOption,
  Page,
  ListAvatarsInput,
  ListVoicesInput,
  CreateAvatarInput,
  CreateAvatarResult,
  AvatarLookStatus,
} from '@scorm/domain';

/**
 * VideoGenerationProvider di sviluppo/test: NON chiama HeyGen e NON consuma
 * quota. Simula il ciclo asincrono (startJob → fetchJob) completando
 * immediatamente con un video "finto" veicolato come data: URL, così il
 * servizio può scaricarne i byte senza rete. Utile a testare l'intero flusso
 * (storage, metering, aggiornamento del block) in locale.
 *
 * Il "video" è un piccolo blob MP4 segnaposto (header ftyp minimale): non è
 * riproducibile come contenuto reale, ma è sufficiente a verificare il percorso
 * di download/salvataggio. In produzione si usa HeyGenVideoProvider.
 */
export class MockVideoGenerationProvider implements VideoGenerationProvider {
  readonly id = 'mock';

  // Un MP4 minimale (box ftyp "isom"): byte segnaposto per i test del flusso.
  private static readonly FAKE_MP4_BASE64 =
    'AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAAhmcmVlAAAAAG1kYXQ=';

  async startJob(_input: GenerateVideoInput): Promise<{ jobRef: string }> {
    const jobRef = `mock-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return { jobRef };
  }

  // SRT segnaposto (data: URL) per esercitare il percorso sottotitoli→cue.
  private static readonly FAKE_SRT =
    '1\n00:00:00,000 --> 00:00:02,000\nCiao, questo è un video demo.\n\n2\n00:00:02,000 --> 00:00:05,000\nI sottotitoli diventano la trascrizione karaoke.\n';

  async fetchJob(_jobRef: string): Promise<GenerateVideoJobResult> {
    const srt = Buffer.from(MockVideoGenerationProvider.FAKE_SRT, 'utf8').toString('base64');
    return {
      status: 'completed',
      videoUrl: `data:video/mp4;base64,${MockVideoGenerationProvider.FAKE_MP4_BASE64}`,
      durationSec: 30,
      subtitleUrl: `data:text/plain;base64,${srt}`,
    };
  }

  async listAvatarsPage(input?: ListAvatarsInput): Promise<Page<AvatarOption>> {
    const source = input?.source ?? 'stock';
    const q = (input?.query ?? '').toLowerCase();
    const all: AvatarOption[] =
      source === 'mine'
        ? [{ id: 'mock-mine-1', name: 'Il mio avatar (demo)', gender: 'male', source: 'mine', group: 'Jack', groupType: 'PHOTO' }]
        : [
            { id: 'mock-avatar-1', name: 'Avatar demo (donna)', gender: 'female', source: 'stock', groupType: 'PUBLIC' },
            { id: 'mock-avatar-2', name: 'Avatar demo (uomo)', gender: 'male', source: 'stock', groupType: 'PUBLIC' },
          ];
    const items = q ? all.filter((a) => a.name.toLowerCase().includes(q)) : all;
    return { items };
  }

  async listVoicesPage(input?: ListVoicesInput): Promise<Page<VoiceOption>> {
    const q = (input?.query ?? '').toLowerCase();
    const all: VoiceOption[] = [
      { id: 'mock-voice-it', name: 'Voce demo IT', language: 'Italian', gender: 'female' },
      { id: 'mock-voice-en', name: 'Voce demo EN', language: 'English', gender: 'male' },
    ];
    const items = q ? all.filter((v) => v.name.toLowerCase().includes(q)) : all;
    return { items };
  }

  // --- Creazione / gestione avatar (simulata, nessun costo né rete) -----------

  async createAvatar(input: CreateAvatarInput): Promise<CreateAvatarResult> {
    const id = `mock-look-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const groupId = `mock-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      avatarId: id,
      groupId,
      name: input.name,
      // Completa subito: il mock non ha un vero processing asincrono.
      status: 'completed',
      previewUrl: undefined,
      supportedEngines: ['avatar_iii', 'avatar_iv', 'avatar_v'],
    };
  }

  async getAvatarLook(_lookId: string): Promise<AvatarLookStatus> {
    return {
      status: 'completed',
      supportedEngines: ['avatar_iii', 'avatar_iv', 'avatar_v'],
    };
  }

  async deleteAvatar(_groupId: string): Promise<void> {
    // no-op nel mock
  }
}
