import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

export interface BookPdfTemplateInput {
  title: string;
  subtitle: string;
  author: string;
  publisher: string;
  year: number | null;
  isbn: string | null;
  chapters: Array<{ heading: string; paragraphs: string[] }>;
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length <= maxChars) {
      current = (current + ' ' + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function generateEditorialBookPdf(input: BookPdfTemplateInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.title);
  doc.setAuthor(input.author);
  doc.setSubject(input.subtitle || input.title);
  doc.setProducer('Khalid Sharif Digital Library Press');

  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await doc.embedFont(StandardFonts.Helvetica);

  // Page 1: Title Page
  const titlePage = doc.addPage([595, 842]);
  titlePage.drawRectangle({ x: 48, y: 48, width: 499, height: 746, borderColor: rgb(0.06, 0.3, 0.23), borderWidth: 1 });
  titlePage.drawText('KHALID SHARIF DIGITAL LIBRARY', {
    x: 78,
    y: 730,
    size: 10,
    font: sans,
    color: rgb(0.06, 0.3, 0.23),
  });

  const titleLines = wrapText(input.title, 34);
  let y = 580;
  for (const line of titleLines) {
    titlePage.drawText(line, { x: 78, y, size: 28, font: serifBold, color: rgb(0.09, 0.09, 0.11) });
    y -= 36;
  }

  if (input.subtitle) {
    const subLines = wrapText(input.subtitle, 52);
    y -= 10;
    for (const line of subLines) {
      titlePage.drawText(line, { x: 78, y, size: 14, font: serifItalic, color: rgb(0.32, 0.32, 0.36) });
      y -= 20;
    }
  }

  titlePage.drawText(input.author, { x: 78, y: 210, size: 16, font: serifBold, color: rgb(0.12, 0.12, 0.14) });
  titlePage.drawText(`${input.publisher}${input.year ? ' · ' + input.year : ''}`, {
    x: 78,
    y: 120,
    size: 11,
    font: sans,
    color: rgb(0.38, 0.38, 0.42),
  });
  if (input.isbn) {
    titlePage.drawText(`ISBN ${input.isbn}`, { x: 78, y: 100, size: 10, font: sans, color: rgb(0.45, 0.45, 0.5) });
  }

  // Page 2: Table of Contents
  const tocPage = doc.addPage([595, 842]);
  tocPage.drawText('Contents', { x: 72, y: 740, size: 22, font: serifBold, color: rgb(0.09, 0.09, 0.11) });
  let tocY = 690;
  input.chapters.forEach((chap, idx) => {
    tocPage.drawText(`${idx + 1}. ${chap.heading}`, {
      x: 72,
      y: tocY,
      size: 13,
      font: serif,
      color: rgb(0.16, 0.16, 0.2),
    });
    tocPage.drawText(`p. ${idx + 3}`, {
      x: 495,
      y: tocY,
      size: 11,
      font: sans,
      color: rgb(0.4, 0.4, 0.45),
    });
    tocY -= 28;
  });

  // Chapter pages
  input.chapters.forEach((chap, idx) => {
    const page = doc.addPage([595, 842]);
    page.drawText(`${input.title} — Chapter ${idx + 1}`, {
      x: 72,
      y: 785,
      size: 9,
      font: sans,
      color: rgb(0.48, 0.48, 0.52),
    });
    page.drawText(chap.heading, {
      x: 72,
      y: 730,
      size: 20,
      font: serifBold,
      color: rgb(0.09, 0.09, 0.11),
    });

    let py = 685;
    for (const para of chap.paragraphs) {
      const lines = wrapText(para, 74);
      for (const line of lines) {
        if (py < 84) break;
        page.drawText(line, {
          x: 72,
          y: py,
          size: 12,
          font: serif,
          color: rgb(0.15, 0.15, 0.18),
        });
        py -= 19;
      }
      py -= 12;
    }

    page.drawText(`${idx + 3}`, {
      x: 292,
      y: 42,
      size: 10,
      font: sans,
      color: rgb(0.45, 0.45, 0.5),
    });
  });

  return doc.save();
}

export const MAX_WATERMARK_PDF_BYTES = 20 * 1024 * 1024;

export async function applyUserWatermark(pdfBytes: Uint8Array, label: string): Promise<Uint8Array> {
  if (pdfBytes.byteLength > MAX_WATERMARK_PDF_BYTES) {
    return pdfBytes;
  }
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  for (const page of pages) {
    const { width, height } = page.getSize();
    page.drawText(label, {
      x: 42,
      y: 22,
      size: 8,
      font,
      color: rgb(0.42, 0.42, 0.46),
      opacity: 0.7,
    });
    page.drawText(label, {
      x: width * 0.18,
      y: height * 0.45,
      size: 16,
      font,
      color: rgb(0.35, 0.35, 0.4),
      opacity: 0.12,
      rotate: degrees(32),
    });
  }

  return doc.save();
}
