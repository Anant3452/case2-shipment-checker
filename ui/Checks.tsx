import type { Evaluation, Finding } from './types';
import { useState } from 'react';

const SEVERITY_ORDER = { Red: 0, Amber: 1 } as const;

export function FindingList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return <p className="muted">No problems found.</p>;
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return (
    <ul className="findings">
      {sorted.map((f, i) => (
        <li key={`${f.ruleId}-${i}`} className={`finding ${f.severity.toLowerCase()}`}>
          <div className="finding-head">
            <span className={`badge ${f.severity.toLowerCase()}`}>{f.severity}</span>
            <strong>{f.ruleId}</strong>
            {f.cells?.length ? <span className="cells">{f.cells.join(', ')}</span> : null}
          </div>
          <p>{f.message}</p>
          <p className="fix"><span>Fix:</span> {f.fix}</p>
        </li>
      ))}
    </ul>
  );
}

export function StatusBadge({ status }: { status: Evaluation['status'] }) {
  const cls = status === 'Blocked' ? 'red' : status === 'Ready' ? 'green' : 'amber';
  return <span className={`status ${cls}`}>{status}</span>;
}

export function CarrierCard({ rec }: { rec: Evaluation['recommendation'] }) {
  return (
    <div className="carrier">
      <h3>Recommended carrier</h3>
      {rec.recommended ? (
        <>
          <p className="carrier-name">{rec.recommended.carrier} · {rec.recommended.service}, £{rec.recommended.totalCost.toLocaleString('en-GB')}</p>
          <p>{rec.reason}</p>
        </>
      ) : (
        <p>{rec.reason}</p>
      )}
      {rec.alternativeLines.length > 0 && (
        <>
          <h4>Alternatives</h4>
          <ul>{rec.alternativeLines.map((l) => <li key={l}>{l}</li>)}</ul>
        </>
      )}
      {rec.excludedLines.length > 0 && (
        <>
          <h4>Excluded</h4>
          <ul className="muted">{rec.excludedLines.map((l) => <li key={l}>{l}</li>)}</ul>
        </>
      )}
    </div>
  );
}

export function Confirmation({ status, confirmation, complete }: { status: Evaluation['status']; confirmation: Evaluation['confirmation']; complete: boolean }) {
  const [copied, setCopied] = useState(false);
  const blocked = status === 'Blocked';
  const copy = async () => {
    await navigator.clipboard.writeText(confirmation.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="confirmation">
      <h3>Booking summary</h3>
      <pre>{confirmation.text}</pre>
      {status === 'Ready with warnings' && (
        <p className="warn">Warnings remain. You can still confirm.</p>
      )}
      <div className="actions">
        <button className="primary" disabled={blocked || !complete} onClick={copy}>
          {copied ? 'Copied' : 'Confirm booking'}
        </button>
        {blocked && <span className="muted">Fix the red checks first.</span>}
      </div>
      {!blocked && complete && (
        <p className="muted">Confirming copies this summary for you to paste. Nothing is sent to a carrier.</p>
      )}
    </div>
  );
}
