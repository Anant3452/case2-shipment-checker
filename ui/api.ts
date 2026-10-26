import type { ChatResponse, UploadReport } from './types';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function sendChat(state: unknown, history: { role: 'user' | 'assistant'; text: string }[], message: string): Promise<ChatResponse> {
  // Free hosting can take a while to wake; give up after 45 s rather than showing "Checking..." forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    return await json<ChatResponse>(await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, history, message }),
      signal: controller.signal,
    }));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('The check is taking too long. Please send your message again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadSheets(bookings: File, items: File): Promise<UploadReport> {
  const form = new FormData();
  form.append('bookings', bookings);
  form.append('items', items);
  return json<UploadReport>(await fetch('/api/upload', { method: 'POST', body: form }));
}
