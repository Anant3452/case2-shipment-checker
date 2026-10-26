import { useEffect, useRef, useState } from 'react';
import { sendChat } from './api';
import { CarrierCard, Confirmation, FindingList, StatusBadge } from './Checks';
import type { ChatResponse } from './types';

interface Turn { role: 'user' | 'assistant'; text: string }

const EXAMPLE = 'I need to send about 3 pallets of mugs from Manchester to Frankfurt next Thursday. It is a warehouse.';

export function Chat() {
  const [state, setState] = useState<unknown>(undefined);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [latest, setLatest] = useState<ChatResponse | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [turns]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setTurns((t) => [...t, { role: 'user', text: message }]);
    setInput('');
    try {
      const res = await sendChat(state, turns, message);
      setState(res.state);
      setLatest(res);
      setTurns((t) => [...t, { role: 'assistant', text: res.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-layout">
      <section className="chat-pane" aria-label="Conversation">
        <div className="log" ref={logRef}>
          {turns.length === 0 && (
            <div className="intro">
              <p>Describe the shipment in your own words. I'll ask for anything missing, then check the booking.</p>
              <button className="ghost" onClick={() => setInput(EXAMPLE)}>Try an example</button>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`bubble ${t.role}`}>{t.text}</div>
          ))}
          {busy && <div className="bubble assistant muted">Checking…</div>}
        </div>
        {latest?.notice && <p className="notice">{latest.notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <label htmlFor="msg" className="sr-only">Message</label>
          <textarea id="msg" rows={2} value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. 3 pallets of mugs from London to Lyon" disabled={busy} />
          <button className="primary" type="submit" disabled={busy || !input.trim()}>Send</button>
        </form>
      </section>

      <aside className="checks-pane" aria-label="Booking checks">
        {latest ? (
          <>
            <div className="status-row">
              <StatusBadge status={latest.evaluation.status} />
              {!latest.evaluation.complete && <span className="muted">Still missing details</span>}
            </div>
            {latest.evaluation.missing.length > 0 && (
              <p className="missing">Next: {latest.evaluation.missing[0].text}</p>
            )}
            <h3>Checks</h3>
            <FindingList findings={latest.evaluation.findings} />
            <CarrierCard rec={latest.evaluation.recommendation} />
            <Confirmation status={latest.evaluation.status} confirmation={latest.evaluation.confirmation} complete={latest.evaluation.complete} />
            <p className="engine muted">Assistant: {latest.engine === 'gemini' ? 'Gemini' : 'rule-based (no AI key)'}</p>
          </>
        ) : (
          <p className="muted">The checks appear here as you describe the shipment.</p>
        )}
      </aside>
    </div>
  );
}
