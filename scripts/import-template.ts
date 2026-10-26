// Reads the template xlsx and writes data/carriers.json, data/rulebook.json and
// data/glossary.json. Usage:
//   npm run import-template                 # real template in repo root, else the DUMMY copy
//   npm run import-template -- path/to.xlsx
// Exits non-zero (and writes nothing) if the rate card is incomplete.

import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

const REAL = path.resolve('Case2_Shipment_Booking_Test_Data_Format.xlsx');
const DUMMY = path.resolve('data/source/Case2_Shipment_Booking_Test_Data_Format.DUMMY.xlsx');
const LANES = ['Germany', 'France', 'Netherlands'];

const file = process.argv[2] ? path.resolve(process.argv[2]) : fs.existsSync(REAL) ? REAL : DUMMY;
const kind = path.basename(file).includes('DUMMY') ? 'dummy' : 'template';

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text).trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).trim();
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%→]+/g, ' ').trim();

/** Rows as arrays of text, with the header row found by a predicate. */
function readTable(ws: ExcelJS.Worksheet, isHeader: (cells: string[]) => boolean) {
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c).value));
    rows.push(cells);
  });
  const h = rows.findIndex((r) => isHeader(r.map(norm)));
  if (h < 0) throw new Error(`Could not find a header row in sheet "${ws.name}"`);
  return { headers: rows[h].map(norm), body: rows.slice(h + 1).filter((r) => r.some((c) => c !== '')) };
}

function findSheet(wb: ExcelJS.Workbook, word: string) {
  const ws = wb.worksheets.find((w) => w.name.toLowerCase().includes(word));
  if (!ws) throw new Error(`No sheet with "${word}" in its name. Sheets: ${wb.worksheets.map((w) => w.name).join(', ')}`);
  return ws;
}

const toNum = (s: string) => {
  const n = Number(s.replace(/[£,%\s]/g, ''));
  return s === '' || Number.isNaN(n) ? null : n;
};

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const problems: string[] = [];

// ---- Carrier options ----
const carrierTable = readTable(findSheet(wb, 'carrier'), (h) => h.some((c) => c.includes('carrier')) && h.some((c) => c.includes('price')));
const col = (pred: (h: string) => boolean) => carrierTable.headers.findIndex(pred);
const idx = {
  carrierService: col((h) => h.includes('carrier') && h.includes('service')),
  carrier: col((h) => h.includes('carrier') && !h.includes('service')),
  service: col((h) => h.includes('service') && !h.includes('carrier')),
  route: col((h) => h.includes('→') || h.includes('route')),
  origin: col((h) => h.includes('origin') && !h.includes('→')),
  destination: col((h) => h.includes('destination') && !h.includes('→')),
  price: col((h) => h.includes('price')),
  transit: col((h) => h.includes('transit')),
  onTime: col((h) => h.includes('on time')),
  maxWeight: col((h) => h.includes('max') && h.includes('weight')),
};

const carriers = carrierTable.body.map((r, i) => {
  const line = `Carrier options data row ${i + 1}`;
  let carrier = idx.carrier >= 0 ? r[idx.carrier] : '';
  let service = idx.service >= 0 ? r[idx.service] : '';
  if (idx.carrierService >= 0) [carrier, service = ''] = r[idx.carrierService].split(/\s*[·\-–]\s*/);
  let originCountry = idx.origin >= 0 ? r[idx.origin] : '';
  let destinationCountry = idx.destination >= 0 ? r[idx.destination] : '';
  if (idx.route >= 0) [originCountry, destinationCountry = ''] = r[idx.route].split(/\s*(?:→|->|to)\s*/);
  const row = {
    carrier, service, originCountry, destinationCountry,
    pricePerPallet: idx.price >= 0 ? toNum(r[idx.price]) : null,
    transitDays: idx.transit >= 0 ? toNum(r[idx.transit]) : null,
    onTimeRate: idx.onTime >= 0 ? toNum(r[idx.onTime]) : null,
    maxWeightPerPalletKg: idx.maxWeight >= 0 ? toNum(r[idx.maxWeight]) : null,
  };
  for (const [k, v] of Object.entries(row)) if (v === '' || v == null) problems.push(`${line}: "${k}" is blank`);
  return row;
});

for (const lane of LANES) {
  if (!carriers.some((c) => c.originCountry === 'United Kingdom' && c.destinationCountry === lane)) {
    problems.push(`No carrier serves United Kingdom → ${lane}`);
  }
}

// ---- Rulebook ----
const ruleTable = readTable(findSheet(wb, 'rule'), (h) => h.some((c) => c.includes('rule id')));
const rules = ruleTable.body.map((r) => ({ ruleId: r[0], rule: r[1], severity: r[2] }));
const ids = rules.map((r) => r.ruleId).join(',');
if (ids !== 'R-01,R-02,R-03,R-04,R-05,R-06,R-07,R-08,R-09,R-10') problems.push(`Rulebook IDs are not R-01..R-10: ${ids}`);

// ---- Glossary (optional) ----
let glossary: { column: string; meaning: string }[] = [];
const gws = wb.worksheets.find((w) => w.name.toLowerCase().includes('gloss'));
if (gws) {
  const g = readTable(gws, (h) => h.length >= 2 && h[0] !== '' && h[1] !== '');
  glossary = g.body.map((r) => ({ column: r[0], meaning: r[1] }));
}

if (problems.length) {
  console.error(`Template ${file} is incomplete. Nothing written.\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const source = { file: path.basename(file), kind, importedAt: new Date().toISOString() };
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/carriers.json', JSON.stringify({ source, carriers }, null, 2) + '\n');
fs.writeFileSync('data/rulebook.json', JSON.stringify({ source, rules }, null, 2) + '\n');
fs.writeFileSync('data/glossary.json', JSON.stringify({ source, glossary }, null, 2) + '\n');
console.log(`Imported ${carriers.length} carrier rows, ${rules.length} rules, ${glossary.length} glossary entries from ${source.file} (${kind}).`);
console.table(carriers);
