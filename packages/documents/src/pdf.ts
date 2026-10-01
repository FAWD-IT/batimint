/**
 * Socle PDF : polices Geist embarquées (licence OFL dans fonts/), mise en page A4, rendu
 * déterministe (date de création fixée) pour que l'empreinte SHA-256 d'un document signé
 * soit reproductible.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

export type Pdf = PDFKit.PDFDocument;

const FONT_FILES = {
  regular: 'Geist-Regular.ttf',
  semibold: 'Geist-SemiBold.ttf',
  bold: 'Geist-Bold.ttf',
} as const;

let fontCache: Record<keyof typeof FONT_FILES, Buffer> | null | undefined;

/** Polices : à côté des sources (dev, tests) ou copiées dans l'image (DOCUMENT_FONTS_DIR). */
function loadFonts(): Record<keyof typeof FONT_FILES, Buffer> | null {
  if (fontCache !== undefined) return fontCache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env['DOCUMENT_FONTS_DIR'],
    path.join(here, '../fonts'),
    path.join(process.cwd(), 'packages/documents/fonts'),
    path.join(process.cwd(), '../../packages/documents/fonts'),
  ].filter((d): d is string => Boolean(d));
  const dir = candidates.find((d) => existsSync(path.join(d, FONT_FILES.regular)));
  fontCache = dir
    ? {
        regular: readFileSync(path.join(dir, FONT_FILES.regular)),
        semibold: readFileSync(path.join(dir, FONT_FILES.semibold)),
        bold: readFileSync(path.join(dir, FONT_FILES.bold)),
      }
    : null;
  return fontCache;
}

export const PAGE = { width: 595.28, height: 841.89, margin: 48, footer: 40 } as const;
export const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

export const INK = '#111111';
export const MUTED = '#6B6B6B';
export const LINE = '#E4E2DC';
export const SOFT = '#F4F3EF';

export function createPdf(options: { title: string; author: string; createdAt: Date }): Pdf {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: options.title,
      Author: options.author,
      Creator: 'Batimint',
      Producer: 'Batimint',
      CreationDate: options.createdAt,
      ModDate: options.createdAt,
    },
  });
  const fonts = loadFonts();
  if (fonts) {
    doc.registerFont('regular', fonts.regular);
    doc.registerFont('semibold', fonts.semibold);
    doc.registerFont('bold', fonts.bold);
  } else {
    doc.registerFont('regular', 'Helvetica');
    doc.registerFont('semibold', 'Helvetica-Bold');
    doc.registerFont('bold', 'Helvetica-Bold');
  }
  doc.font('regular').fontSize(9).fillColor(INK);
  return doc;
}

export function renderToBuffer(doc: Pdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Couleur d'accent lisible sur fond blanc (repli sur l'encre). */
export function safeAccent(hex: string | null | undefined): string {
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : INK;
}

export function formatDateFr(d: Date): string {
  return new Intl.DateTimeFormat('fr-BE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Brussels',
  }).format(d);
}

export function formatDateTimeFr(d: Date): string {
  return new Intl.DateTimeFormat('fr-BE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  }).format(d);
}
