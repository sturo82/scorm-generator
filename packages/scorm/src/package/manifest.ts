import type { Course } from '@scorm/contracts';

/**
 * Generatore dell'imsmanifest.xml (Requisito 9.1 / 9.2 / 9.8). Supporta SCORM
 * 2004 4th Edition (con sequencing imsss e navigation adlnav) e SCORM 1.2
 * (manifest ridotto). Granularità SCO per-modulo: ogni modulo è un SCO con una
 * pagina HTML entrypoint; le risorse condivise (runtime, contenuto, tema) sono
 * dichiarate come dependency.
 */

export type ScormProfile = 'SCORM_2004_4TH' | 'SCORM_12';

export interface ManifestInput {
  course: Pick<Course, 'id' | 'title' | 'modules'>;
  profile: ScormProfile;
  /** File condivisi referenziati da tutti gli SCO (runtime, content, tema). */
  sharedFiles: string[];
  /** Mastery score 0..1 per il corso (default 0.8). */
  masteryScore?: number;
}

/** Dati di uno SCO (uno per modulo). */
interface Sco {
  identifier: string;
  itemId: string;
  title: string;
  href: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Costruisce la lista degli SCO. L'intero corso è un SINGOLO SCO: la fruizione
 * a step con gating è gestita internamente dal player, quindi un solo item
 * evita che l'LMS sovrapponga la propria navigazione (che bypasserebbe il gate).
 */
export function buildScos(course: Pick<Course, 'title'>): Sco[] {
  return [
    {
      identifier: 'RES-1',
      itemId: 'ITEM-1',
      title: course.title,
      href: 'pages/index.html',
    },
  ];
}

export function generateManifest(input: ManifestInput): string {
  const scos = buildScos(input.course);
  return input.profile === 'SCORM_2004_4TH'
    ? manifest2004(input, scos)
    : manifest12(input, scos);
}

function manifest2004(input: ManifestInput, scos: Sco[]): string {
  const items = scos
    .map(
      (s) => `      <item identifier="${s.itemId}" identifierref="${s.identifier}" isvisible="true">
        <title>${esc(s.title)}</title>
        <adlnav:presentation>
          <adlnav:navigationInterface>
            <adlnav:hideLMSUI>previous</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>continue</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>exit</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>exitAll</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>suspendAll</adlnav:hideLMSUI>
          </adlnav:navigationInterface>
        </adlnav:presentation>
        <imsss:sequencing>
          <imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true"/>
        </imsss:sequencing>
      </item>`,
    )
    .join('\n');

  const resources = scos
    .map(
      (s) => `    <resource identifier="${s.identifier}" type="webcontent" adlcp:scormType="sco" href="${s.href}">
      <file href="${s.href}"/>
      <dependency identifierref="SHARED"/>
    </resource>`,
    )
    .join('\n');

  const sharedFiles = input.sharedFiles.map((f) => `      <file href="${esc(f)}"/>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-${esc(input.course.id)}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
    http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd
    http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd
    http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd
    http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1" adlseq:objectivesGlobalToSystem="false">
      <title>${esc(input.course.title)}</title>
${items}
      <imsss:sequencing>
        <imsss:controlMode choice="true" flow="true"/>
      </imsss:sequencing>
    </organization>
  </organizations>
  <resources>
${resources}
    <resource identifier="SHARED" type="webcontent" adlcp:scormType="asset">
${sharedFiles}
    </resource>
  </resources>
</manifest>`;
}

function manifest12(input: ManifestInput, scos: Sco[]): string {
  const mastery = Math.round((input.masteryScore ?? 0.8) * 100);
  const items = scos
    .map(
      (s) => `      <item identifier="${s.itemId}" identifierref="${s.identifier}" isvisible="true">
        <title>${esc(s.title)}</title>
        <adlcp:masteryscore>${mastery}</adlcp:masteryscore>
      </item>`,
    )
    .join('\n');

  const resources = scos
    .map(
      (s) => `    <resource identifier="${s.identifier}" type="webcontent" adlcp:scormtype="sco" href="${s.href}">
      <file href="${s.href}"/>
      <dependency identifierref="SHARED"/>
    </resource>`,
    )
    .join('\n');

  const sharedFiles = input.sharedFiles.map((f) => `      <file href="${esc(f)}"/>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-${esc(input.course.id)}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
    http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>${esc(input.course.title)}</title>
${items}
    </organization>
  </organizations>
  <resources>
${resources}
    <resource identifier="SHARED" type="webcontent" adlcp:scormtype="asset">
${sharedFiles}
    </resource>
  </resources>
</manifest>`;
}
