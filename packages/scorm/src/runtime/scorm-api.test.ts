import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { loadRuntimeAsset } from './load-asset.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { ScormApi, findAPI, clamp } = loadRuntimeAsset('scorm-api.js') as any;

/** Simula l'API SCORM 2004 dell'LMS registrando le SetValue. */
function fakeApi2004() {
  const store: Record<string, string> = {};
  return {
    store,
    API_1484_11: {
      Initialize: () => 'true',
      Terminate: () => 'true',
      GetValue: (k: string) => store[k] ?? '',
      SetValue: (k: string, v: string) => {
        store[k] = v;
        return 'true';
      },
      Commit: () => 'true',
    },
  };
}

describe('scorm-api findAPI', () => {
  it('trova l API nella finestra corrente', () => {
    const win = fakeApi2004();
    const found = findAPI(win, ['API_1484_11'], 5);
    expect(found).toBeTruthy();
    expect(found.name).toBe('API_1484_11');
  });

  it('restituisce null se l API non c è', () => {
    expect(findAPI({}, ['API_1484_11'], 2)).toBeNull();
  });
});

describe('clamp', () => {
  it('limita tra 0 e 1', () => {
    expect(clamp(1.5, 0, 1)).toBe(1);
    expect(clamp(-0.2, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe('ScormApi 2004', () => {
  it('discover rileva la versione 2004 e initialize funziona', () => {
    const win = fakeApi2004();
    const api = new ScormApi();
    expect(api.discover(win)).toBe('2004');
    expect(api.initialize()).toBe(true);
  });

  it('setScore e setOutcome scrivono gli elementi corretti del data model', () => {
    const win = fakeApi2004();
    const api = new ScormApi();
    api.discover(win);
    api.initialize();
    api.setScore(0.9, 9, 0, 10);
    api.setOutcome(true, true);
    expect(win.store['cmi.score.scaled']).toBe('0.9');
    expect(win.store['cmi.score.raw']).toBe('9');
    expect(win.store['cmi.completion_status']).toBe('completed');
    expect(win.store['cmi.success_status']).toBe('passed');
  });

  it('saveBookmark scrive location e suspend_data e committa', () => {
    const win = fakeApi2004();
    const api = new ScormApi();
    api.discover(win);
    api.initialize();
    api.saveBookmark('3', '{"index":3}');
    expect(win.store['cmi.location']).toBe('3');
    expect(win.store['cmi.suspend_data']).toBe('{"index":3}');
  });

  it('degrada senza errori se l API non è presente', () => {
    const api = new ScormApi();
    const dom = new JSDOM('<!doctype html><html></html>');
    expect(api.discover(dom.window)).toBeNull();
    expect(api.initialize()).toBe(false);
    expect(() => api.setOutcome(true, false)).not.toThrow();
  });
});
