import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Order } from '../../shared/types.ts';

/**
 * Standard PDF fonts use WinAnsi encoding; replace non-WinAnsi glyphs safely
 * so receipt generation never fails on extended Unicode customer names or titles.
 */
function toPdfSafeText(input: string | null | undefined, fallback = ''): string {
  const raw = (input ?? '').trim() || fallback;
  return raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function formatMoney(cents: number, currency = 'USD'): string {
  return `${(Number(cents || 0) / 100).toFixed(2)} ${toPdfSafeText(currency, 'USD').toUpperCase()}`;
}

function wrapReceiptLine(text: string, maxChars: number): string[] {
  const clean = toPdfSafeText(text);
  if (!clean) return [''];
  const words = clean.split(/\s+/);
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

export async function generateOrderReceiptPdf(params: {
  order: Order;
  libraryName?: string;
}): Promise<Uint8Array> {
  const { order } = params;
  const libraryName = toPdfSafeText(params.libraryName, 'Khalid Sharif Digital Library');

  const doc = await PDFDocument.create();
  doc.setTitle(`Receipt ${toPdfSafeText(order.orderReference)}`);
  doc.setProducer(libraryName);
  doc.setCreator(libraryName);

  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);

  const page = doc.addPage([595, 842]);
  const accent = rgb(0.012, 0.463, 0.722); // #0376B8
  const dark = rgb(0.11, 0.13, 0.16);
  const muted = rgb(0.42, 0.45, 0.49);
  const border = rgb(0.84, 0.85, 0.87);

  // Header band
  page.drawRectangle({ x: 48, y: 744, width: 499, height: 54, color: rgb(0.95, 0.96, 0.98) });
  page.drawText(libraryName.toUpperCase(), {
    x: 64,
    y: 774,
    size: 11,
    font: sansBold,
    color: accent,
  });
  page.drawText('OFFICIAL DIGITAL EDITION RECEIPT / INVOICE', {
    x: 64,
    y: 756,
    size: 10,
    font: sans,
    color: muted,
  });
  page.drawText(toPdfSafeText(order.status).toUpperCase(), {
    x: 455,
    y: 766,
    size: 10,
    font: sansBold,
    color: order.status === 'paid' ? rgb(0.05, 0.45, 0.25) : dark,
  });

  // Order metadata
  let y = 708;
  page.drawText(`Receipt # ${toPdfSafeText(order.orderReference)}`, {
    x: 48,
    y,
    size: 18,
    font: serifBold,
    color: dark,
  });
  y -= 24;

  const issuedDate = toPdfSafeText(order.payment?.verifiedAt || order.createdAt).slice(0, 19).replace('T', ' ');
  const billingName = toPdfSafeText(order.customerName, 'Library Reader');
  const billingEmail = toPdfSafeText(order.billingEmail || order.customerEmail, 'N/A');
  const billingPhone = toPdfSafeText(order.billingPhone, '—');
  const methodLabel =
    order.paymentMethodCode === 'premier_bank_gateway'
      ? 'Mastercard / Visa'
      : order.paymentMethodCode === 'manual_transfer'
        ? 'Direct Bank Transfer'
        : toPdfSafeText(order.paymentMethodCode);

  const metaLeft = [
    `Billed To: ${billingName}`,
    `Email: ${billingEmail}`,
    `Phone: ${billingPhone}`,
  ];
  const metaRight = [
    `Date Issued: ${issuedDate} UTC`,
    `Payment Method: ${methodLabel}`,
    `Transaction Ref: ${toPdfSafeText(order.payment?.transactionReference, '—')}`,
  ];

  metaLeft.forEach((line, idx) => {
    page.drawText(line, { x: 48, y: y - idx * 16, size: 10, font: sans, color: dark });
  });
  metaRight.forEach((line, idx) => {
    page.drawText(line, { x: 315, y: y - idx * 16, size: 10, font: sans, color: dark });
  });

  y -= 66;
  page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 1, color: border });
  y -= 20;

  // Table header
  page.drawText('DIGITAL EDITION', { x: 48, y, size: 9, font: sansBold, color: muted });
  page.drawText('AUTHOR', { x: 315, y, size: 9, font: sansBold, color: muted });
  page.drawText('PRICE', { x: 480, y, size: 9, font: sansBold, color: muted });
  y -= 10;
  page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 0.75, color: border });
  y -= 18;

  for (const item of order.items) {
    if (y < 150) break;
    const titleLines = wrapReceiptLine(item.bookTitleSnapshot, 40);
    const authorText = toPdfSafeText(item.author, 'Khalid Sharif Press').slice(0, 26);
    const priceText = formatMoney(item.unitPriceCents, order.currency);

    titleLines.forEach((tl, idx) => {
      page.drawText(tl, { x: 48, y: y - idx * 14, size: 10, font: sansBold, color: dark });
    });
    page.drawText(authorText, { x: 315, y, size: 10, font: sans, color: muted });
    page.drawText(priceText, { x: 480, y, size: 10, font: sans, color: dark });

    y -= Math.max(22, titleLines.length * 14 + 8);
  }

  y -= 6;
  page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 1, color: border });
  y -= 22;

  // Totals
  page.drawText('Subtotal', { x: 360, y, size: 10, font: sans, color: muted });
  page.drawText(formatMoney(order.subtotalCents, order.currency), { x: 480, y, size: 10, font: sans, color: dark });
  y -= 18;

  if (order.discountCents > 0) {
    page.drawText('Discount', { x: 360, y, size: 10, font: sans, color: muted });
    page.drawText(`-${formatMoney(order.discountCents, order.currency)}`, { x: 480, y, size: 10, font: sans, color: dark });
    y -= 18;
  }

  page.drawRectangle({ x: 350, y: y - 8, width: 197, height: 24, color: rgb(0.95, 0.96, 0.98) });
  page.drawText('TOTAL', { x: 360, y, size: 11, font: sansBold, color: dark });
  page.drawText(formatMoney(order.totalCents, order.currency), { x: 480, y, size: 11, font: sansBold, color: accent });

  if (order.payment?.providerPaymentId || order.payment?.customerSubmittedReference) {
    y -= 42;
    const extRef = order.payment.providerPaymentId || order.payment.customerSubmittedReference;
    page.drawText(`Provider / Transfer Reference: ${toPdfSafeText(extRef)}`, {
      x: 48,
      y,
      size: 9,
      font: sans,
      color: muted,
    });
  }

  // Footer
  page.drawLine({ start: { x: 48, y: 78 }, end: { x: 547, y: 78 }, thickness: 0.5, color: border });
  page.drawText(`${libraryName} — Digital reading access is linked to your registered account.`, {
    x: 48,
    y: 58,
    size: 8.5,
    font: sans,
    color: muted,
  });

  return doc.save();
}
