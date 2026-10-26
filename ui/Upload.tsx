import { useState } from 'react';
import { uploadSheets } from './api';
import { CarrierCard, Confirmation, FindingList, StatusBadge } from './Checks';
import type { BookingResult, UploadReport } from './types';

export function Upload() {
  const [bookings, setBookings] = useState<File | null>(null);
  const [items, setItems] = useState<File | null>(null);
  const [report, setReport] = useState<UploadReport | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    if (!bookings || !items) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await uploadSheets(bookings, items));
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload">
      <section className="card">
        <h2>Upload your sheets</h2>
        <p className="muted">Bookings and Items, in the template format (.xlsx or .csv). Files are checked in memory and not kept.</p>
        <div className="pickers">
          <label>Bookings sheet
            <input type="file" accept=".xlsx,.csv" onChange={(e) => setBookings(e.target.files?.[0] ?? null)} />
          </label>
          <label>Items sheet
            <input type="file" accept=".xlsx,.csv" onChange={(e) => setItems(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <button className="primary" disabled={!bookings || !items || busy} onClick={check}>
          {busy ? 'Checking…' : 'Check bookings'}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {report && (
        <section className="card">
          <h2>Results</h2>
          <p>
            {report.summary.bookings} booking{report.summary.bookings === 1 ? '' : 's'}:{' '}
            <strong>{report.summary.blocked}</strong> blocked, <strong>{report.summary.withWarnings}</strong> with warnings,{' '}
            <strong>{report.summary.ready}</strong> ready.
          </p>
          {report.notes.map((n) => <p key={n} className="muted">{n}</p>)}
          {report.errors.length > 0 && (
            <div className="sheet-errors">
              <h3>Sheet problems</h3>
              <ul>{report.errors.map((e, i) => <li key={i}>{e.cell ? <code>{e.cell}</code> : null} {e.message}</li>)}</ul>
            </div>
          )}
          <ul className="booking-list">
            {report.results.map((b) => <BookingRow key={b.bookingId} b={b} open={open === b.bookingId} onToggle={() => setOpen(open === b.bookingId ? null : b.bookingId)} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

function BookingRow({ b, open, onToggle }: { b: BookingResult; open: boolean; onToggle: () => void }) {
  return (
    <li className="booking">
      <button className="booking-head" aria-expanded={open} onClick={onToggle}>
        <span className="booking-id">{b.bookingId}</span>
        <StatusBadge status={b.status} />
        <span className="muted">{b.itemCount} item{b.itemCount === 1 ? '' : 's'}</span>
      </button>
      {open && (
        <div className="booking-body">
          <h3>Checks</h3>
          <FindingList findings={b.findings} />
          <CarrierCard rec={b.recommendation} />
          <Confirmation status={b.status} confirmation={b.confirmation} complete={true} />
        </div>
      )}
    </li>
  );
}
