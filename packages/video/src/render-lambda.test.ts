import { vi } from 'vitest';
import type { VideoSpec, WordMark } from '@scorm/contracts';

// Mock del client Lambda di Remotion: nessuna chiamata AWS reale.
const renderMediaOnLambda = vi.fn();
const getRenderProgress = vi.fn();
const downloadMedia = vi.fn();

vi.mock('@remotion/lambda', () => ({
  renderMediaOnLambda: (...a: unknown[]) => renderMediaOnLambda(...a),
  getRenderProgress: (...a: unknown[]) => getRenderProgress(...a),
  downloadMedia: (...a: unknown[]) => downloadMedia(...a),
}));

// Mock di fs: downloadMedia "scrive" un file, readFile ritorna byte finti.
vi.mock('node:fs/promises', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    mkdtemp: vi.fn(async () => '/tmp/pillola-lambda-test'),
    readFile: vi.fn(async () => Buffer.from([1, 2, 3, 4])),
    rm: vi.fn(async () => undefined),
  };
});

const SPEC: VideoSpec = {
  version: 1,
  canvas: { width: 1920, height: 1080, fps: 30 },
  theme: { palette: ['#000'], bg: '#fff', fontFamily: 'Inter' },
  voiceover: { text: 'ciao mondo', lang: 'it' },
  scenes: [{ id: 's1', durationHint: 2000, layers: [] }],
};
const WORDS: WordMark[] = [{ word: 'ciao', startMs: 0, endMs: 400 }];
const OPTS = { region: 'eu-west-1', functionName: 'remotion-render-x', serveUrl: 'https://s3/site' };

function input() {
  return { spec: SPEC, audio: new Uint8Array([9]), audioContentType: 'audio/mpeg', words: WORDS };
}

describe('renderPillolaOnLambda', () => {
  beforeEach(() => {
    renderMediaOnLambda.mockReset();
    getRenderProgress.mockReset();
    downloadMedia.mockReset();
  });

  it('avvia il render, attende il done, scarica e ritorna i byte + durata', async () => {
    const { renderPillolaOnLambda } = await import('./render-lambda.js');
    renderMediaOnLambda.mockResolvedValue({ renderId: 'r1', bucketName: 'b1' });
    getRenderProgress
      .mockResolvedValueOnce({ done: false, fatalErrorEncountered: false })
      .mockResolvedValueOnce({ done: true, fatalErrorEncountered: false });
    downloadMedia.mockResolvedValue({ outputPath: '/tmp/out.mp4', sizeInBytes: 4 });

    const r = await renderPillolaOnLambda(input(), { ...OPTS, pollIntervalMs: 1 });
    expect(Array.from(r.bytes)).toEqual([1, 2, 3, 4]);
    // durationHint 2000ms @30fps = 60 frame / 30 = 2s
    expect(r.durationSec).toBe(2);
    expect(renderMediaOnLambda).toHaveBeenCalledOnce();
    expect(downloadMedia).toHaveBeenCalledOnce();
    // Audio passato come data URL negli inputProps.
    const call = renderMediaOnLambda.mock.calls[0]![0] as { inputProps: { audioSrc: string } };
    expect(call.inputProps.audioSrc.startsWith('data:audio/mpeg;base64,')).toBe(true);
  });

  it('lancia se il render segnala un errore fatale', async () => {
    const { renderPillolaOnLambda } = await import('./render-lambda.js');
    renderMediaOnLambda.mockResolvedValue({ renderId: 'r1', bucketName: 'b1' });
    getRenderProgress.mockResolvedValue({
      done: false,
      fatalErrorEncountered: true,
      errors: [{ message: 'boom nella Lambda' }],
    });

    await expect(renderPillolaOnLambda(input(), { ...OPTS, pollIntervalMs: 1 })).rejects.toThrow(/boom nella Lambda/);
    expect(downloadMedia).not.toHaveBeenCalled();
  });
});
