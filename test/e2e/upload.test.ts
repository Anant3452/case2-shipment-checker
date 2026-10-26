// End-to-end: upload the fixtures through the real API and assert status and rule IDs per booking.
// Expected results are written out below so they can be read in the test file.

import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';

const FIX = path.resolve('test/fixtures');
const read = (name: string) => fs.readFileSync(path.join(FIX, name));
const app = createApp({ uiDist: path.resolve('test/no-ui-here') });

async function upload(bookings: string, items: string) {
  const res = await request(app)
    .post('/api/upload')
    .attach('bookings', read(bookings), { filename: bookings, contentType: 'application/octet-stream' })
    .attach('items', read(items), { filename: items, contentType: 'application/octet-stream' });
  expect(res.status).toBe(200);
  return res.body as {
    summary: Record<string, number>;
    results: { bookingId: string; status: string; findings: { ruleId: string; severity: string; cells: string[] }[]; recommendation: { recommended: { carrier: string } | null; excluded: { carrier: { carrier: string } }[] } }[];
    errors: { sheet: string; message: string }[];
  };
}

type Result = Awaited<ReturnType<typeof upload>>['results'][number];
const byId = (report: { results: Result[] }): Record<string, Result> =>
  Object.fromEntries(report.results.map((r) => [r.bookingId, r]));

describe('clean fixture (BK-001 from the brief, plus BK-002)', () => {
  it('both bookings end Ready with no findings', async () => {
    const report = await upload('clean-bookings.xlsx', 'clean-items.xlsx');
    expect(report.results.map((r) => [r.bookingId, r.status, r.findings.length])).toEqual([
      ['BK-001', 'Ready', 0],
      ['BK-002', 'Ready', 0],
    ]);
    expect(report.results[0].recommendation.recommended?.carrier).toBe('Carrier C');
    expect(report.errors).toEqual([]);
  });

  it('skips the grey example row, so BK-001 is not duplicated', async () => {
    const report = await upload('clean-bookings.xlsx', 'clean-items.xlsx');
    expect(report.results.filter((r) => r.bookingId === 'BK-001')).toHaveLength(1);
  });
});

/**
 * Planted-error fixture. Expected results (status, rule IDs in order, the carrier recommended):
 *
 * | Booking | Status                | Rules          | Why                                               |
 * |---------|-----------------------|----------------|---------------------------------------------------|
 * | BK-101  | Blocked               | R-01, R-08     | HS code 6912 has 4 digits; no appointment         |
 * | BK-102  | Blocked               | R-02           | declared £1,020 vs £1,000 calculated (2%)         |
 * | BK-103  | Blocked               | R-03           | 10 per carton × 5 cartons = 50, quantity is 60    |
 * | BK-104  | Blocked               | R-04           | items total 10 cartons, booking says 12           |
 * | BK-105  | Ready                 | (none)         | 450 kg per pallet: Carrier C (400) excluded, A/B pass |
 * | BK-106  | Blocked               | R-05           | pallets = 0                                       |
 * | BK-107  | Blocked               | R-06           | aerosol spray paint                               |
 * | BK-108  | Ready with warnings   | R-07           | gross 40 kg is below the 50 kg of products        |
 * | BK-109  | Ready with warnings   | R-09, R-10     | no country of origin; ready date 1 Oct 2026       |
 * | BK-110  | Blocked               | R-02           | no items (also a sheet-level error)               |
 * | BK-111  | Blocked               | DATA           | "lots" in the quantity cell (cell reference shown)|
 */
describe('planted-error fixture', () => {
  const expected: [string, string, string[]][] = [
    ['BK-101', 'Blocked', ['R-01', 'R-08']],
    ['BK-102', 'Blocked', ['R-02']],
    ['BK-103', 'Blocked', ['R-03']],
    ['BK-104', 'Blocked', ['R-04']],
    ['BK-105', 'Ready', []],
    ['BK-106', 'Blocked', ['R-05']],
    ['BK-107', 'Blocked', ['R-06']],
    ['BK-108', 'Ready with warnings', ['R-07']],
    ['BK-109', 'Ready with warnings', ['R-09', 'R-10']],
    ['BK-110', 'Blocked', ['R-02']],
    ['BK-111', 'Blocked', ['DATA']],
  ];

  it.each(expected)('%s is %s with %j', async (bookingId, status, rules) => {
    const report = byId(await upload('planted-errors-bookings.xlsx', 'planted-errors-items.xlsx'));
    expect(report[bookingId].status).toBe(status);
    expect([...new Set(report[bookingId].findings.map((f) => f.ruleId))]).toEqual(rules);
  });

  it('BK-105 passes R-05 for two carriers, fails it for one, and the failing one is excluded', async () => {
    const report = byId(await upload('planted-errors-bookings.xlsx', 'planted-errors-items.xlsx'));
    expect(report['BK-105'].recommendation.excluded.map((e) => e.carrier.carrier)).toEqual(['Carrier C']);
    expect(report['BK-105'].recommendation.recommended).not.toBeNull();
  });

  it('BK-111 points the DATA finding at the bad cell', async () => {
    const report = byId(await upload('planted-errors-bookings.xlsx', 'planted-errors-items.xlsx'));
    const cells = report['BK-111'].findings.flatMap((f) => f.cells);
    expect(cells).toContain('Items!E13');
  });

  it('reports the orphan item row and the booking with no items', async () => {
    const report = await upload('planted-errors-bookings.xlsx', 'planted-errors-items.xlsx');
    const messages = report.errors.map((e) => e.message).join('\n');
    expect(messages).toContain('BK-999');
    expect(messages).toContain('BK-110 has no items');
  });
});

describe('upload API validation', () => {
  it('rejects a request without both files', async () => {
    const res = await request(app).post('/api/upload').attach('bookings', read('clean-bookings.xlsx'), 'clean-bookings.xlsx');
    expect(res.status).toBe(400);
  });

  it('rejects a non-spreadsheet file', async () => {
    const res = await request(app)
      .post('/api/upload')
      .attach('bookings', Buffer.from('%PDF-1.4'), 'bookings.pdf')
      .attach('items', read('clean-items.xlsx'), 'clean-items.xlsx');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/xlsx or .csv/);
  });
});
