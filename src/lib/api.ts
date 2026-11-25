export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

let memorySessionToken: string | null = null;

export function getAuthToken(): string | null {
  return memorySessionToken;
}

export function setAuthToken(token: string | null | undefined): void {
  memorySessionToken = token || null;
}

export function clearAuthToken(): void {
  setAuthToken(null);
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = isFormData
    ? { ...(options.headers as Record<string, string>) }
    : { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) };

  const token = getAuthToken();
  if (token && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { error: text || 'Invalid server response' };
  }

  if (!res.ok) {
    throw new ApiError(res.status, String(json.error || `Request failed (${res.status})`), json);
  }

  return json as T;
}

export async function downloadAuthenticatedFile(url: string, fallbackFilename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { credentials: 'include', headers });
  if (!res.ok) {
    throw new ApiError(res.status, `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] || fallbackFilename;
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
