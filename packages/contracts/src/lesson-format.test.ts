import { describe, it, expect } from 'vitest';
import { resolveLessonLayout, lessonFlagsFromFormat, lessonFormatFromFlags } from './course.js';

describe('resolveLessonLayout (format-first)', () => {
  it('usa lesson.format quando presente (fonte di verità)', () => {
    expect(resolveLessonLayout({ format: 'standard' })).toBe('standard');
    expect(resolveLessonLayout({ format: 'video_first' })).toBe('video_first');
    expect(resolveLessonLayout({ format: 'pillola' })).toBe('pillola');
    expect(resolveLessonLayout({ format: 'pillola_interattiva' })).toBe('pillola_interattiva');
  });

  it('format vince sui flag storici anche se incoerenti', () => {
    // pillola_interattiva non setta flag: anche con flag a false resta interattiva.
    expect(resolveLessonLayout({ format: 'pillola_interattiva', videoFirst: false, pillola: false })).toBe(
      'pillola_interattiva',
    );
    // Un format esplicito prevale su un flag storico diverso.
    expect(resolveLessonLayout({ format: 'standard', pillola: true })).toBe('standard');
  });

  it('corsi storici senza format: deriva dai flag (pillola ha precedenza)', () => {
    expect(resolveLessonLayout({ pillola: true })).toBe('pillola');
    expect(resolveLessonLayout({ videoFirst: true })).toBe('video_first');
    expect(resolveLessonLayout({})).toBe('standard');
    expect(resolveLessonLayout({ format: null, videoFirst: true })).toBe('video_first');
  });

  it('format non valido ricade sui flag', () => {
    expect(resolveLessonLayout({ format: 'boh' as unknown as string, pillola: true })).toBe('pillola');
  });
});

describe('lessonFlagsFromFormat', () => {
  it('pillola_interattiva NON attiva flag (layout pilotato da format)', () => {
    expect(lessonFlagsFromFormat('pillola_interattiva')).toEqual({ videoFirst: false, pillola: false });
  });
  it('pillola/video_first attivano il flag corrispondente', () => {
    expect(lessonFlagsFromFormat('pillola')).toEqual({ videoFirst: false, pillola: true });
    expect(lessonFlagsFromFormat('video_first')).toEqual({ videoFirst: true, pillola: false });
    expect(lessonFlagsFromFormat('standard')).toEqual({ videoFirst: false, pillola: false });
  });
});

describe('lessonFormatFromFlags', () => {
  it('pillola ha precedenza, poi video_first, poi standard', () => {
    expect(lessonFormatFromFlags({ pillola: true, videoFirst: true })).toBe('pillola');
    expect(lessonFormatFromFlags({ videoFirst: true })).toBe('video_first');
    expect(lessonFormatFromFlags({})).toBe('standard');
  });
});
