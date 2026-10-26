// Upload path: join Bookings and Items on Booking ID, then run the same checks as the chat.

import {
  buildConfirmation, recommendCarriers, validateBooking,
  type Booking, type Carrier, type Finding, type Item, type Recommendation, type Confirmation, type BookingStatus,
  computeStatus,
} from '../domain';
import { parseBookingsSheet, parseItemsSheet, type CellProblem, type SheetRow } from './read';

export interface CellFinding extends Finding {
  /** Spreadsheet cell references for the fields this finding is about, e.g. ["Bookings!F7", "Items!E4"]. */
  cells: string[];
}

export interface BookingResult {
  bookingId: string;
  /** Sheet row in Bookings, or null when the booking has no row. */
  bookingRow: number | null;
  status: BookingStatus;
  findings: CellFinding[];
  recommendation: Recommendation;
  confirmation: Confirmation;
  itemCount: number;
}

export interface UploadReport {
  summary: { bookings: number; blocked: number; withWarnings: number; ready: number; itemRows: number };
  results: BookingResult[];
  /** Sheet-level problems that aren't tied to one booking: orphan items, bad headers, skipped rows. */
  errors: { sheet: string; cell: string | null; message: string }[];
  notes: string[];
}

export interface UploadInput {
  bookings: { buffer: Buffer; filename: string };
  items: { buffer: Buffer; filename: string };
  today: string;
  carriers: Carrier[];
}

const cellRef = (sheet: 'Bookings' | 'Items', ref: string) => `${sheet}!${ref}`;

/** Maps a finding's fieldRefs to spreadsheet cells. */
function citeCells(f: Finding, bookingRow: SheetRow | undefined, itemRows: SheetRow[]): string[] {
  const out: string[] = [];
  for (const r of f.fieldRefs) {
    if (r.entity === 'booking') {
      const ref = bookingRow?.cells[r.field as string];
      if (ref) out.push(cellRef('Bookings', ref));
    } else {
      const ref = itemRows[r.index ?? -1]?.cells[r.field as string];
      if (ref) out.push(cellRef('Items', ref));
    }
  }
  return [...new Set(out)];
}

/** Problems from parsing a cell are attached to the booking they belong to, as Red DATA findings. */
function problemFinding(p: CellProblem): CellFinding {
  return {
    ruleId: 'DATA', severity: 'Red',
    message: `${p.sheet} cell ${p.cell}: ${p.message}`,
    fix: 'Correct the cell and upload again.',
    fieldRefs: [],
    cells: [cellRef(p.sheet, p.cell)],
  };
}

export async function checkUpload(input: UploadInput): Promise<UploadReport> {
  const [bParsed, iParsed] = await Promise.all([
    parseBookingsSheet(input.bookings.buffer, input.bookings.filename),
    parseItemsSheet(input.items.buffer, input.items.filename),
  ]);

  const errors: UploadReport['errors'] = [];
  const notes: string[] = [];
  for (const m of bParsed.missingColumns) errors.push({ sheet: 'Bookings', cell: null, message: `Column "${m}" is missing from the Bookings sheet.` });
  for (const m of iParsed.missingColumns) errors.push({ sheet: 'Items', cell: null, message: `Column "${m}" is missing from the Items sheet.` });
  if (bParsed.skippedExampleRows || iParsed.skippedExampleRows) {
    notes.push(`Skipped ${bParsed.skippedExampleRows + iParsed.skippedExampleRows} grey example row(s) from the template.`);
  }

  // Items grouped by Booking ID, keeping each item's sheet row for citations.
  const itemsByBooking = new Map<string, { item: Item; row: SheetRow }[]>();
  const bookingIds = new Set(bParsed.bookings.map((b) => b.bookingId));
  iParsed.items.forEach((item, i) => {
    const row = iParsed.itemRows[i];
    if (!bookingIds.has(item.bookingId)) {
      errors.push({
        sheet: 'Items', cell: row.cells.bookingId ? `Items!${row.cells.bookingId}` : null,
        message: `Item row ${row.row} has Booking ID "${item.bookingId}", which matches no booking in the Bookings sheet.`,
      });
      return;
    }
    const list = itemsByBooking.get(item.bookingId) ?? [];
    list.push({ item, row });
    itemsByBooking.set(item.bookingId, list);
  });

  // Parse problems on items, attached to their booking.
  const problemsByBooking = new Map<string, CellProblem[]>();
  for (const p of [...bParsed.problems, ...iParsed.problems]) {
    if (p.bookingId && bookingIds.has(p.bookingId)) {
      const list = problemsByBooking.get(p.bookingId) ?? [];
      list.push(p);
      problemsByBooking.set(p.bookingId, list);
    } else {
      errors.push({ sheet: p.sheet, cell: `${p.sheet}!${p.cell}`, message: p.message });
    }
  }

  const results: BookingResult[] = bParsed.bookings.map((booking) => {
    const pairs = itemsByBooking.get(booking.bookingId) ?? [];
    const items = pairs.map((p) => p.item);
    const itemRows = pairs.map((p) => p.row);
    const bookingRow = bParsed.bookingRows[booking.bookingId];

    const checks = validateBooking(booking, items, input.today, input.carriers).map((f) => ({
      ...f, cells: citeCells(f, bookingRow, itemRows),
    }));
    const problems = (problemsByBooking.get(booking.bookingId) ?? []).map(problemFinding);
    const findings = [...problems, ...checks] as CellFinding[];
    const sorted = [...findings].sort((a, z) => (a.severity === z.severity ? 0 : a.severity === 'Red' ? -1 : 1));

    const recommendation = recommendCarriers(booking, items, booking.sellerPriority, input.carriers);
    const confirmation = buildConfirmation(booking, items, recommendation, findings);
    return {
      bookingId: booking.bookingId,
      bookingRow: bookingRow?.row ?? null,
      status: computeStatus(findings),
      findings: sorted,
      recommendation,
      confirmation,
      itemCount: items.length,
    };
  });

  // Bookings with no items: the rules report it (R-02); surface it at sheet level too.
  for (const b of bParsed.bookings) {
    if (!itemsByBooking.has(b.bookingId)) errors.push({
      sheet: 'Bookings', cell: bParsed.bookingRows[b.bookingId] ? `Bookings!${bParsed.bookingRows[b.bookingId].cells.bookingId}` : null,
      message: `Booking ${b.bookingId} has no items in the Items sheet.`,
    });
  }

  const count = (s: BookingStatus) => results.filter((r) => r.status === s).length;
  return {
    summary: {
      bookings: results.length,
      blocked: count('Blocked'),
      withWarnings: count('Ready with warnings'),
      ready: count('Ready'),
      itemRows: iParsed.items.length,
    },
    results,
    errors,
    notes,
  };
}
