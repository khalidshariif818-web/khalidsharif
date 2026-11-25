/**
 * Parses an HTTP Range header (RFC 9110 single byte range) and produces
 * 200 OK, 206 Partial Content, 416 Range Not Satisfiable, or HEAD responses.
 */
export function buildRangePdfResponse(params: {
  rangeHeader: string | undefined;
  method: string;
  pdfBytes: Uint8Array;
  headers: Record<string, string>;
}): Response {
  const total = params.pdfBytes.byteLength;
  const isHead = params.method.toUpperCase() === 'HEAD';
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/pdf',
    'Accept-Ranges': 'bytes',
    ...params.headers,
  };

  if (!params.rangeHeader || !params.rangeHeader.trim()) {
    baseHeaders['Content-Length'] = String(total);
    return new Response(isHead ? null : Buffer.from(params.pdfBytes), {
      status: 200,
      headers: baseHeaders,
    });
  }

  const raw = params.rangeHeader.trim();
  const match = /^bytes=(\d*)-(\d*)$/i.exec(raw);
  if (!match || total === 0) {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes */${total}`,
      },
    });
  }

  const startStr = match[1];
  const endStr = match[2];
  let start = 0;
  let end = total - 1;

  if (startStr === '' && endStr === '') {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes */${total}`,
      },
    });
  } else if (startStr === '') {
    // Suffix byte range: bytes=-N
    const suffixLen = Number(endStr);
    if (!Number.isInteger(suffixLen) || suffixLen <= 0) {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${total}` },
      });
    }
    start = Math.max(0, total - suffixLen);
    end = total - 1;
  } else if (endStr === '') {
    // Open-ended byte range: bytes=N-
    start = Number(startStr);
    end = total - 1;
  } else {
    start = Number(startStr);
    end = Math.min(Number(endStr), total - 1);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= total || start > end) {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes */${total}`,
      },
    });
  }

  const chunk = params.pdfBytes.subarray(start, end + 1);
  return new Response(isHead ? null : Buffer.from(chunk), {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(chunk.byteLength),
    },
  });
}
