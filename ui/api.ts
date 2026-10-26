import type { ChatResponse, UploadReport } from './types';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function sendChat(state: unknown, history: { role: 'user' | 'assistant'; text: string }[], message: string): Promise<ChatResponse> {
  return json<ChatResponse>(await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, history, message }),
  }));
}

export async function uploadSheets(bookings: File, items: File): Promise<UploadReport> {
  const form = new FormData();
  form.append('bookings', bookings);
  form.append('items', items);
  return json<UploadReport>(await fetch('/api/upload', { method: 'POST', body: form }));
}
