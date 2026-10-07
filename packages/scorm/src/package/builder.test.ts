import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import type { Brand, Course } from '@scorm/contracts';
import { buildScormPackage, PackageValidationError } from './builder.js';
import { generateManifest } from './manifest.js';
import { validateCourseForExport } from './validation.js';

const brand: Brand = {
  id: 'b1',
  tenantId: 't1',
  name: 'Acme',
  assets: { logoPrimaryUrl: 'logo.svg' },
  colors: {
    primary: '#0055FF',
    onPrimary: '#FFFFFF',
    surface: '#FFFFFF',
    onSurface: '#111111',
    success: '#2E7D32',
    warning: '#ED6C02',
    error: '#D32F2F',
  },
  typography: { fontFamilyHeading: 'Inter', fontFamilyBody: 'Inter' },
};

function course(approved = true): Course {
  const status = approved ? 'approved' : 'draft';
  return {
    id: 'c1',
    tenantId: 't1',
    title: 'Corso Sicurezza',
    description: '',
    language: 'it',
    editorial: { status: 'approved', citations: [] },
    assessments: [],
    modules: [
      {
        id: 'm1',
        title: 'Modulo 1',
        editorial: { status: 'approved', citations: [] },
        lessons: [
          {
            id: 'l1',
            title: 'Lezione 1',
            objectives: [],
            editorial: { status, citations: [] },
            blocks: [
              {
                id: 'blk1',
                type: 'rich_text',
                editorial: { status: 'approved', citations: [] },
                payload: {
                  content: { format: 'html', html: '<p>Testo</p><script>alert(1)</script>' },
                  media: [],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

async function unzip(buf: Buffer): Promise<JSZip> {
  return JSZip.loadAsync(buf);
}

describe('validateCourseForExport', () => {
  it('blocca se una lezione non è approvata', () => {
    const report = validateCourseForExport(course(false));
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => /non è approvata/i.test(e))).toBe(true);
  });

  it('degrada a warning con allowUnapproved', () => {
    const report = validateCourseForExport(course(false), { allowUnapproved: true });
    expect(report.ok).toBe(true);
    expect(report.warnings.length).toBeGreaterThan(0);
  });
});

describe('generateManifest', () => {
  it('SCORM 2004 include schemaversion e sequencing', () => {
    const xml = generateManifest({
      course: course(),
      profile: 'SCORM_2004_4TH',
      sharedFiles: ['runtime/player.js'],
    });
    expect(xml).toContain('2004 4th Edition');
    expect(xml).toContain('imsss:sequencing');
    expect(xml).toContain('adlcp:scormType="sco"');
    // Corso = singolo SCO con pagina index e navigazione LMS nascosta (gating interno).
    expect(xml).toContain('pages/index.html');
    expect(xml).toContain('hideLMSUI');
  });

  it('SCORM 1.2 include masteryscore e schemaversion 1.2', () => {
    const xml = generateManifest({
      course: course(),
      profile: 'SCORM_12',
      sharedFiles: ['runtime/player.js'],
      masteryScore: 0.7,
    });
    expect(xml).toContain('<schemaversion>1.2</schemaversion>');
    expect(xml).toContain('<adlcp:masteryscore>70</adlcp:masteryscore>');
  });
});

describe('buildScormPackage (golden)', () => {
  it('blocca l export se il corso non è approvato', async () => {
    await expect(buildScormPackage({ course: course(false), brand, profile: 'SCORM_2004_4TH' })).rejects.toBeInstanceOf(
      PackageValidationError,
    );
  });

  it('produce uno zip con la struttura attesa', async () => {
    const { zip } = await buildScormPackage({ course: course(), brand, profile: 'SCORM_2004_4TH' });
    const z = await unzip(zip);
    const names = Object.keys(z.files);
    expect(names).toContain('imsmanifest.xml');
    expect(names).toContain('runtime/scorm-api.js');
    expect(names).toContain('runtime/player.js');
    expect(names).toContain('assets/theme/theme.css');
    expect(names).toContain('assets/player.css');
    expect(names).toContain('assets/interactions.css');
    expect(names).toContain('content/course.js');
    expect(names).toContain('pages/index.html');
    expect(names).toContain('sw-course.json');
  });

  it('scrive sw-course.json nella root con i metadati del corso', async () => {
    const c = course();
    c.description = 'Corso introduttivo alla sicurezza.';
    c.instructor = { name: 'Mario Rossi', role: 'Docente' };
    const { zip } = await buildScormPackage({
      course: c,
      brand,
      profile: 'SCORM_2004_4TH',
      descriptor: { durationMinutes: 45, category: 'Sicurezza', languages: ['it', 'en'], masteryScore: 80 },
    });
    const z = await unzip(zip);
    const raw = await z.file('sw-course.json')!.async('string');
    const meta = JSON.parse(raw) as Record<string, unknown>;
    expect(meta.title).toBe('Corso Sicurezza');
    expect(meta.description).toBe('Corso introduttivo alla sicurezza.');
    expect(meta.language).toBe('it');
    expect(meta.languages).toEqual(['it', 'en']);
    expect(meta.category).toBe('Sicurezza');
    expect(meta.duration_minutes).toBe(45);
    expect(meta.author).toBe('Mario Rossi');
    expect(meta.mastery_score).toBe(80);
    // Nessuna cover nel corso di test → chiave omessa.
    expect(meta.cover).toBeUndefined();
  });

  it('normalizza il path della cover a relativo alla root in sw-course.json', async () => {
    const c = course();
    c.coverImageKey = 'cover-s3-key.jpg';
    const { zip } = await buildScormPackage({
      course: c,
      brand,
      profile: 'SCORM_2004_4TH',
      // fetchMedia riscrive coverImageKey → ../media/asset-0.jpg
      fetchMedia: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }),
    });
    const z = await unzip(zip);
    const meta = JSON.parse(await z.file('sw-course.json')!.async('string')) as Record<string, unknown>;
    // Nel JSON la cover è relativa alla ROOT del contenuto (senza ../).
    expect(meta.cover).toBe('media/asset-0.jpg');
  });

  it('include il foglio condiviso delle micro-interazioni e lo referenzia nel manifest', async () => {
    const { zip } = await buildScormPackage({ course: course(), brand, profile: 'SCORM_2004_4TH' });
    const z = await unzip(zip);
    const css = await z.file('assets/interactions.css')!.async('string');
    // Deve contenere il flip 3D e l'interruttore data-motion (fonte di verità condivisa).
    expect(css).toContain('[data-motion="lively"]');
    expect(css).toContain('rotateY(180deg)');
    const manifest = await z.file('imsmanifest.xml')!.async('string');
    expect(manifest).toContain('assets/interactions.css');
  });

  it('propaga interactionStyle del corso in window.__COURSE__', async () => {
    const lively = { ...course(), interactionStyle: 'lively' as const };
    const { zip } = await buildScormPackage({ course: lively, brand, profile: 'SCORM_2004_4TH' });
    const z = await unzip(zip);
    const courseJs = await z.file('content/course.js')!.async('string');
    expect(courseJs).toContain('"interactionStyle":"lively"');
  });

  it('scarica ed embedda la foto del docente (instructor.avatarKey)', async () => {
    const withInstructor: Course = {
      ...course(),
      instructor: { name: 'Mario Rossi', role: 'Docente', avatarKey: 'media/t1/c1/instructor/avatar-x.png' },
    };
    const fetchMedia = async (key: string) =>
      key === 'media/t1/c1/instructor/avatar-x.png'
        ? { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' }
        : null;
    const { zip } = await buildScormPackage({
      course: withInstructor,
      brand,
      profile: 'SCORM_2004_4TH',
      fetchMedia,
    });
    const z = await unzip(zip);
    const courseJs = await z.file('content/course.js')!.async('string');
    // La chiave avatar è stata riscritta a un path relativo embeddato.
    expect(courseJs).toContain('../media/');
    expect(courseJs).not.toContain('media/t1/c1/instructor/avatar-x.png');
    // Il file dell'avatar è presente nel pacchetto.
    const names = Object.keys(z.files);
    expect(names.some((n) => n.startsWith('media/asset-'))).toBe(true);
  });

  it('include il tema del brand nel theme.css', async () => {
    const { zip } = await buildScormPackage({ course: course(), brand, profile: 'SCORM_2004_4TH' });
    const z = await unzip(zip);
    const css = await z.file('assets/theme/theme.css')!.async('string');
    expect(css).toContain('--brand-primary: #0055FF;');
  });

  it('sanifica l HTML del contenuto nel pacchetto', async () => {
    const { zip } = await buildScormPackage({ course: course(), brand, profile: 'SCORM_2004_4TH' });
    const z = await unzip(zip);
    const courseJs = await z.file('content/course.js')!.async('string');
    expect(courseJs).toContain('<p>Testo</p>');
    expect(courseJs).not.toContain('alert');
    expect(courseJs).not.toContain('<script>alert');
  });

  it('stesso corso con brand diversi produce pacchetti distinti', async () => {
    const brandB: Brand = { ...brand, id: 'b2', name: 'Globex', colors: { ...brand.colors, primary: '#FF0000' } };
    const a = await buildScormPackage({ course: course(), brand, profile: 'SCORM_2004_4TH' });
    const b = await buildScormPackage({ course: course(), brand: brandB, profile: 'SCORM_2004_4TH' });
    const za = await unzip(a.zip);
    const zb = await unzip(b.zip);
    const cssA = await za.file('assets/theme/theme.css')!.async('string');
    const cssB = await zb.file('assets/theme/theme.css')!.async('string');
    expect(cssA).toContain('#0055FF');
    expect(cssB).toContain('#FF0000');
    expect(cssA).not.toEqual(cssB);
  });
});
