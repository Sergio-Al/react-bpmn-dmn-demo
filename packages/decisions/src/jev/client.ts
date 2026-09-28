import { crmQuestions } from './crm-questions.js';
import type { JevErrorKind, JevHttpResponse } from './types.js';

export class JevError extends Error {
  constructor(public readonly kind: JevErrorKind, message: string) { super(message); this.name = 'JevError'; }
}

export async function requestJev(state: Record<string, unknown>, apiKey: string | undefined, model: string, fetchImpl: typeof fetch = fetch): Promise<JevHttpResponse> {
  if (!apiKey) throw new JevError('missing-key', 'Jev API key is not configured');
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, state, questions: crmQuestions }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new JevError('timeout', 'Jev request timed out');
      throw new JevError('network', 'Jev network request failed');
    }
    if ((response.status === 429 || response.status === 529) && attempt === 0) {
      const retryAfter = response.headers.get('retry-after');
      const numericSeconds = retryAfter === null ? NaN : Number(retryAfter);
      const delay = Number.isFinite(numericSeconds) ? numericSeconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
      if (Number.isFinite(delay) && delay > 0) await new Promise(resolve => setTimeout(resolve, Math.min(delay, 2000)));
      continue;
    }
    if (!response.ok) {
      if (response.status === 401) throw new JevError('auth', 'Jev authentication failed');
      if (response.status === 429 || response.status === 529) throw new JevError('rate-limit', 'Jev is temporarily unavailable');
      throw new JevError('http', `Jev returned HTTP ${response.status}`);
    }
    let data: unknown;
    try { data = await response.json(); }
    catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new JevError('timeout', 'Jev response timed out');
      throw new JevError('bad-response', 'Jev returned invalid JSON');
    }
    if (!data || typeof data !== 'object' || typeof (data as JevHttpResponse).model !== 'string' || !((data as JevHttpResponse).answers && typeof (data as JevHttpResponse).answers === 'object')) {
      throw new JevError('bad-response', 'Jev returned an invalid response');
    }
    return data as JevHttpResponse;
  }
  throw new JevError('rate-limit', 'Jev is temporarily unavailable');
}
