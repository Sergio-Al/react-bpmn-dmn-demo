export class ApiError extends Error {
  constructor(readonly status: number, readonly details: unknown) {
    const body = details && typeof details === 'object' ? details as { message?: string; error?: string; code?: string } : {};
    super(body.message ?? body.error ?? body.code ?? `Request failed (${status})`);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!response.ok) {
    const text = await response.text();
    let details: unknown = text;
    try { details = JSON.parse(text); } catch { /* Non-JSON server errors remain readable. */ }
    throw new ApiError(response.status, details);
  }
  return response.json() as Promise<T>;
}
