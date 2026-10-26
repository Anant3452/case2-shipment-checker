// Reads Bookings and Items sheets (.xlsx or .csv) in the template structure.
// Never throws on bad cells: they become problems with a cell reference, and the field is left null.

import ExcelJS from 'exceljs';
import { parseDMY, parseNaturalDate, parseNumber, parseWeightKg } from '../domain';
import type { Booking, DestinationType, Item, SellerPriority, YesNo } from '../domain';

export interface CellProblem {
  sheet: 'Bookings' | 'Items';
  /** e.g. "F7" */
  cell: string;
  /** Booking ID, when known. */
  bookingId: string | null;
  message: string;
}

export interface SheetRow {
  /** 1-based sheet row number. */
  row: number;
  /** Cell address per field, e.g. { sellerName: "B4" }. */
  cells: Record<string, string>;
}

export interface ParsedBookings {
  bookings: Booking[];
  /** Keyed by Booking ID. */
  bookingRows: Record<string, SheetRow>;
  problems: CellProblem[];
  /** Columns that could not be found in the header. */
  missingColumns: string[];
  skippedExampleRows: number;
}

export interface ParsedItems {
  items: Item[];
  itemRows: SheetRow[];
  problems: CellProblem[];
  missingColumns: string[];
  skippedExampleRows: number;
}

/** Header label → field. Labels are matched case-insensitively after removing punctuation. */
const BOOKING_COLUMNS: Record<string, keyof Booking> = {
  'booking id': 'bookingId',
  'seller name': 'sellerName',
  'origin city': 'originCity',
  'origin country': 'originCountry',
  'destination city': 'destinationCity',
  'destination country': 'destinationCountry',
  'destination type': 'destinationType',
  'ready to ship date': 'readyToShipDate',
  'seller priority': 'sellerPriority',
  pallets: 'pallets',
  cartons: 'cartons',
  'total declared value': 'totalDeclaredValue',
  currency: 'currency',
  'total gross weight kg': 'totalGrossWeightKg',
  'delivery appointment booked': 'deliveryAppointmentBooked',
};

const ITEM_COLUMNS: Record<string, keyof Item> = {
  'booking id': 'bookingId',
  sku: 'sku',
  description: 'description',
  'sku description': 'sku', // combined "SKU · Description" column from the case brief
  'hs code': 'hsCode',
  'quantity units': 'quantity',
  quantity: 'quantity',
  'unit price': 'unitPrice',
  'units per carton': 'unitsPerCarton',
  cartons: 'cartons',
  'unit weight kg': 'unitWeightKg',
  'country of origin': 'countryOfOrigin',
};

const NUMERIC: Set<string> = new Set(['pallets', 'cartons', 'totalDeclaredValue', 'totalGrossWeightKg', 'quantity', 'unitPrice', 'unitsPerCarton', 'unitWeightKg']);

/** Column letters for 1-based index. */
export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Raw grids. Each row is an array of cell text plus whether it is a grey example row.

interface Grid {
  rows: { n: number; values: string[]; grey: boolean; raw: unknown[] }[];
}

const GREY = /^(D9D9D9|E7E6E6|F2F2F2|EDEDED|DDDDDD|E0E0E0|F0F0F0|EEEEEE|D8D8D8)$/i;

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text).trim();
    if ('hyperlink' in v) return String((v as { text?: unknown }).text ?? '').trim();
    return '';
  }
  return String(v).trim();
}

function isGreyRow(ws: ExcelJS.Worksheet, row: ExcelJS.Row): boolean {
  let grey = false;
  row.eachCell({ includeEmpty: false }, (cell) => {
    const f = cell.fill as ExcelJS.FillPattern | undefined;
    const argb = f && f.type === 'pattern' && f.pattern === 'solid' ? String((f.fgColor as { argb?: string })?.argb ?? '') : '';
    if (argb && GREY.test(argb.slice(-6))) grey = true;
  });
  return grey && ws.rowCount > 0;
}

async function xlsxGrid(buffer: Buffer, sheetWord: string): Promise<Grid | null> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((w) => w.name.toLowerCase().includes(sheetWord.toLowerCase())) ?? wb.worksheets[0];
  if (!ws) return null;
  const rows: Grid['rows'] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const width = Math.max(ws.columnCount, row.cellCount);
    const values: string[] = [];
    const raw: unknown[] = [];
    for (let c = 1; c <= width; c++) {
      const v = row.getCell(c).value;
      raw.push(v);
      values.push(cellText(v));
    }
    rows.push({ n: row.number, values, grey: isGreyRow(ws, row), raw });
  });
  return { rows };
}

/** RFC 4180 CSV. Handles quoted fields with commas and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field.trim()); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some((c) => c !== '')) out.push(row);
      row = []; field = '';
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some((c) => c !== '')) out.push(row);
  return out;
}

function csvGrid(text: string): Grid {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  return {
    rows: rows.map((values, i) => ({ n: i + 1, values, grey: false, raw: values })),
  };
}

/** xlsx or csv from a buffer and filename. */
export async function readGrid(buffer: Buffer, filename: string, sheetWord: string): Promise<Grid> {
  if (/\.xlsx$/i.test(filename) || (buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    const g = await xlsxGrid(buffer, sheetWord);
    if (!g) throw new Error(`No sheet found in ${filename}`);
    return g;
  }
  if (/\.csv$/i.test(filename) || /^[\x09\x0a\x0d\x20-\x7e -￿]*$/.test(buffer.subarray(0, 200).toString('utf8'))) {
    return csvGrid(buffer.toString('utf8'));
  }
  throw new Error(`${filename} is not an .xlsx or .csv file`);
}

// ---------------------------------------------------------------------------

/** Finds the header row: the first row whose cells include "Booking ID". */
function findHeader(grid: Grid): { index: number } {
  const idx = grid.rows.findIndex((r) => r.values.some((v) => norm(v) === 'booking id'));
  return { index: idx };
}

function mapColumns(headers: string[], dict: Record<string, string>): { map: Record<string, number>; missing: string[] } {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const key = norm(h);
    const field = dict[key];
    if (field && map[field] == null) map[field] = i;
    // Combined "SKU · Description" column: the sku field points at it, and the parser splits it.
    if (key === 'sku description') map.description = i;
  });
  const required = ['bookingId'];
  const missing = required.filter((f) => map[f] == null);
  return { map, missing };
}

/** Parses one cell by field. Returns the value, or null and a problem message. */
function parseCell(field: string, raw: string, rawObj: unknown): { value: unknown; error?: string } {
  if (raw === '') return { value: null };
  if (field === 'readyToShipDate') {
    if (rawObj instanceof Date) return { value: rawObj.toISOString().slice(0, 10) };
    const iso = parseDMY(raw) ?? (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null);
    return iso ? { value: iso } : { value: null, error: `"${raw}" is not a date. Use DD-MM-YYYY.` };
  }
  if (field === 'totalGrossWeightKg' || field === 'unitWeightKg') {
    const w = parseWeightKg(raw);
    return w ? { value: w.value } : { value: null, error: `"${raw}" is not a weight.` };
  }
  if (NUMERIC.has(field)) {
    if (typeof rawObj === 'number') return { value: rawObj };
    const cleaned = raw.replace(/[£,\s]/g, '');
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) return { value: Number(cleaned) };
    const p = parseNumber(raw);
    return p ? { value: p.value } : { value: null, error: `"${raw}" is not a number.` };
  }
  if (field === 'destinationType' || field === 'sellerPriority' || field === 'deliveryAppointmentBooked') {
    return { value: raw };
  }
  return { value: raw };
}

const normalisePriority = (raw: string): SellerPriority | null => {
  const v = raw.trim().toLowerCase();
  const map: Record<string, SellerPriority> = { cheapest: 'Cheapest', fastest: 'Fastest', 'most reliable': 'Most reliable', balanced: 'Balanced' };
  return map[v] ?? null;
};

export async function parseBookingsSheet(buffer: Buffer, filename: string): Promise<ParsedBookings> {
  const grid = await readGrid(buffer, filename, 'booking');
  const head = findHeader(grid);
  const problems: CellProblem[] = [];
  if (head.index < 0) {
    return { bookings: [], bookingRows: {}, problems: [{ sheet: 'Bookings', cell: 'A1', bookingId: null, message: 'No "Booking ID" header row found.' }], missingColumns: ['Booking ID'], skippedExampleRows: 0 };
  }
  const headers = grid.rows[head.index].values;
  const { map, missing } = mapColumns(headers, Object.fromEntries(Object.entries(BOOKING_COLUMNS).map(([k, v]) => [k, v])));
  const byField = map;
  const bookings: Booking[] = [];
  const bookingRows: Record<string, SheetRow> = {};
  let skippedExampleRows = 0;

  for (const r of grid.rows.slice(head.index + 1)) {
    if (r.values.every((v) => v === '')) continue;
    if (r.grey) { skippedExampleRows++; continue; }
    const cells: Record<string, string> = {};
    const b: Record<string, unknown> = {
      bookingId: '', sellerName: null, originCity: null, originCountry: null, destinationCity: null,
      destinationCountry: null, destinationType: null, readyToShipDate: null, sellerPriority: null,
      pallets: null, cartons: null, totalDeclaredValue: null, currency: null, totalGrossWeightKg: null,
      deliveryAppointmentBooked: null,
    };
    const bookingId = (r.values[byField.bookingId] ?? '').trim();
    const idLabel = bookingId || null;
    for (const [field, col] of Object.entries(byField)) {
      const ref = `${colLetter(col + 1)}${r.n}`;
      cells[field] = ref;
      const raw = (r.values[col] ?? '').trim();
      if (field === 'sellerPriority') {
        const p = normalisePriority(raw);
        if (raw !== '' && !p) problems.push({ sheet: 'Bookings', cell: ref, bookingId: idLabel, message: `"${raw}" is not a priority. Use Cheapest, Fastest, Most reliable or Balanced.` });
        b[field] = p; continue;
      }
      if (field === 'destinationType') {
        const t: DestinationType | null = /^warehouse$/i.test(raw) ? 'Warehouse' : /^business address$/i.test(raw) ? 'Business address' : null;
        if (raw !== '' && !t) problems.push({ sheet: 'Bookings', cell: ref, bookingId: idLabel, message: `"${raw}" is not a destination type. Use Warehouse or Business address.` });
        b[field] = t; continue;
      }
      if (field === 'deliveryAppointmentBooked') {
        const v: YesNo | null = /^y(es)?$/i.test(raw) ? 'Yes' : /^no?$/i.test(raw) ? 'No' : null;
        if (raw !== '' && !v) problems.push({ sheet: 'Bookings', cell: ref, bookingId: idLabel, message: `"${raw}" must be Yes or No.` });
        b[field] = v; continue;
      }
      if (field === 'readyToShipDate') {
        const rawObj = r.raw[col];
        const iso = rawObj instanceof Date ? rawObj.toISOString().slice(0, 10) : raw === '' ? null : (parseDMY(raw) ?? parseNaturalDate(raw, '1970-01-01'));
        if (raw !== '' && !iso) problems.push({ sheet: 'Bookings', cell: ref, bookingId: idLabel, message: `"${raw}" is not a date. Use DD-MM-YYYY.` });
        b[field] = iso; continue;
      }
      const { value, error } = parseCell(field, raw, r.raw[col]);
      if (error) problems.push({ sheet: 'Bookings', cell: ref, bookingId: idLabel, message: error });
      b[field] = field === 'bookingId' ? raw : value;
    }
    if (b.currency == null) b.currency = 'GBP';
    if (b.originCountry == null) b.originCountry = 'United Kingdom';
    if (!bookingId) {
      problems.push({ sheet: 'Bookings', cell: cells.bookingId ?? `A${r.n}`, bookingId: null, message: 'Booking ID is blank on this row, so it cannot be matched to items.' });
      continue;
    }
    if (bookingRows[bookingId]) {
      problems.push({ sheet: 'Bookings', cell: cells.bookingId ?? `A${r.n}`, bookingId, message: `Booking ID ${bookingId} appears more than once. Only the first row is checked.` });
      continue;
    }
    bookings.push(b as unknown as Booking);
    bookingRows[bookingId] = { row: r.n, cells };
  }
  return { bookings, bookingRows, problems, missingColumns: missing, skippedExampleRows };
}

export async function parseItemsSheet(buffer: Buffer, filename: string): Promise<ParsedItems> {
  const grid = await readGrid(buffer, filename, 'item');
  const head = findHeader(grid);
  const problems: CellProblem[] = [];
  if (head.index < 0) {
    return { items: [], itemRows: [], problems: [{ sheet: 'Items', cell: 'A1', bookingId: null, message: 'No "Booking ID" header row found.' }], missingColumns: ['Booking ID'], skippedExampleRows: 0 };
  }
  const headers = grid.rows[head.index].values;
  const { map, missing } = mapColumns(headers, Object.fromEntries(Object.entries(ITEM_COLUMNS)));
  const byField = map as Record<string, number>;
  const combinedSkuColumn = headers.findIndex((h) => norm(h) === 'sku description');
  const items: Item[] = [];
  const itemRows: SheetRow[] = [];
  let skippedExampleRows = 0;

  for (const r of grid.rows.slice(head.index + 1)) {
    if (r.values.every((v) => v === '')) continue;
    if (r.grey) { skippedExampleRows++; continue; }
    const cells: Record<string, string> = {};
    const bookingId = (r.values[byField.bookingId] ?? '').trim() || null;
    const item: Record<string, unknown> = {
      bookingId: bookingId ?? '', sku: null, description: null, hsCode: null, quantity: null, unitPrice: null,
      unitsPerCarton: null, cartons: null, unitWeightKg: null, countryOfOrigin: null,
    };
    for (const [field, col] of Object.entries(byField)) {
      const ref = `${colLetter(col + 1)}${r.n}`;
      cells[field] = ref;
      const raw = (r.values[col] ?? '').trim();
      if (field === 'hsCode') { item.hsCode = raw === '' ? null : raw; continue; }
      if (field === 'countryOfOrigin') { item.countryOfOrigin = raw === '' ? null : raw; continue; }
      if (field === 'sku' && combinedSkuColumn === col) {
        // "MUG-01 · Ceramic coffee mug, 350 ml" → sku and description
        const [sku, ...rest] = raw.split(/\s*[·|]\s*/);
        item.sku = sku ? sku.trim() : null;
        item.description = rest.join(' · ').trim() || null;
        continue;
      }
      if (field === 'description' && combinedSkuColumn === col) continue; // already split above
      if (field === 'sku' || field === 'description') { item[field] = raw === '' ? null : raw; continue; }
      if (field === 'bookingId') continue;
      const { value, error } = parseCell(field, raw, r.raw[col]);
      if (error) problems.push({ sheet: 'Items', cell: ref, bookingId, message: error });
      item[field] = value;
    }
    if (!bookingId) {
      problems.push({ sheet: 'Items', cell: cells.bookingId ?? `A${r.n}`, bookingId: null, message: 'Booking ID is blank on this item row.' });
      continue;
    }
    items.push(item as unknown as Item);
    itemRows.push({ row: r.n, cells });
  }
  return { items, itemRows, problems, missingColumns: missing, skippedExampleRows };
}
