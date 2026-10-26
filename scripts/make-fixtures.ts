// Writes the upload test fixtures in test/fixtures/. Run: npm run make-fixtures
// Each Bookings/Items pair uses the template layout: caption row, header row, grey example row,
// then data from row 4. BK-001 is the clean booking from the brief's PDF sample.

import ExcelJS from 'exceljs';
import path from 'node:path';

const DIR = path.resolve('test/fixtures');

const BOOKING_HEADERS = [
  'Booking ID', 'Seller name', 'Origin city', 'Origin country', 'Destination city', 'Destination country',
  'Destination type', 'Ready to ship date', 'Seller priority', 'Pallets', 'Cartons', 'Total declared value',
  'Currency', 'Total gross weight (kg)', 'Delivery appointment booked',
];
const ITEM_HEADERS = [
  'Booking ID', 'SKU', 'Description', 'HS code', 'Quantity (units)', 'Unit price', 'Units per carton',
  'Cartons', 'Unit weight (kg)', 'Country of origin',
];

type Row = (string | number | null)[];

const EXAMPLE_BOOKING: Row = ['BK-001', 'Northfield Goods', 'Manchester', 'United Kingdom', 'Frankfurt', 'Germany', 'Warehouse', '05-11-2026', 'Cheapest', 3, 90, 5400, 'GBP', 620, 'Yes'];
const EXAMPLE_ITEM: Row = ['BK-001', 'MUG-01', 'Ceramic coffee mug, 350 ml', '691200', 1080, 5, 12, 90, 0.5, 'United Kingdom'];

async function writeSheet(file: string, sheetName: string, caption: string, headers: string[], example: Row, rows: Row[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow([caption]);
  ws.addRow(headers);
  const exampleRow = ws.addRow(example);
  exampleRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    c.font = { italic: true, color: { argb: 'FF666666' } };
  });
  for (const r of rows) ws.addRow(r);
  await wb.xlsx.writeFile(path.join(DIR, file));
  console.log(`wrote ${file} (${rows.length} data rows)`);
}

// ---------------------------------------------------------------------------
// Clean: BK-001 (from the brief) and BK-002 (Birmingham → Paris, business address).

const CLEAN_BOOKINGS: Row[] = [
  EXAMPLE_BOOKING,
  ['BK-002', 'Harbour Kitchen Co', 'Birmingham', 'United Kingdom', 'Paris', 'France', 'Business address', '10-11-2026', 'Balanced', 2, 20, 2880, 'GBP', 300, 'No'],
];
const CLEAN_ITEMS: Row[] = [
  EXAMPLE_ITEM,
  ['BK-002', 'KET-02', 'Electric kettle, 1.7 L', '851660', 240, 12, 12, 20, 1.1, 'China'],
];

// ---------------------------------------------------------------------------
// Planted errors. The grey example row is BK-001 and is skipped. Each booking breaks one rule unless noted. Expected results are in
// test/e2e/upload.test.ts.

const PLANTED_BOOKINGS: Row[] = [
  // BK-101: R-01 (4-digit HS code), R-08 (warehouse, no appointment).
  ['BK-101', 'Oakfield Ceramics', 'Manchester', 'United Kingdom', 'Frankfurt', 'Germany', 'Warehouse', '12-11-2026', 'Cheapest', 3, 90, 5400, 'GBP', 620, 'No'],
  // BK-102: R-02 (declared £1,020 against £1,000 calculated, 2% over).
  ['BK-102', 'Thames Tea Supply', 'London', 'United Kingdom', 'Berlin', 'Germany', 'Business address', '12-11-2026', 'Fastest', 1, 10, 1020, 'GBP', 60, 'No'],
  // BK-103: R-03 (10 per carton × 5 cartons = 50, but quantity is 60).
  ['BK-103', 'Yorkshire Candles', 'Leeds', 'United Kingdom', 'Hamburg', 'Germany', 'Warehouse', '12-11-2026', 'Most reliable', 1, 5, 120, 'GBP', 40, 'Yes'],
  // BK-104: R-04 (items total 10 cartons, booking says 12).
  ['BK-104', 'Brum Bakeware', 'Birmingham', 'United Kingdom', 'Paris', 'France', 'Business address', '12-11-2026', 'Cheapest', 1, 12, 500, 'GBP', 90, 'No'],
  // BK-105: passes R-05 for Carrier A and B, fails it for Carrier C (450 kg per pallet against 400 kg).
  ['BK-105', 'Glasshouse Goods', 'Leeds', 'United Kingdom', 'Berlin', 'Germany', 'Warehouse', '12-11-2026', 'Balanced', 2, 30, 1200, 'GBP', 900, 'Yes'],
  // BK-106: R-05 (pallets = 0, cannot check weight per pallet).
  ['BK-106', 'Montmartre Mugs', 'Birmingham', 'United Kingdom', 'Paris', 'France', 'Business address', '12-11-2026', 'Cheapest', 0, 10, 500, 'GBP', 90, 'No'],
  // BK-107: R-06 (aerosol spray paint).
  ['BK-107', 'Paint Pro', 'London', 'United Kingdom', 'Hamburg', 'Germany', 'Business address', '12-11-2026', 'Cheapest', 1, 17, 612, 'GBP', 90, 'No'],
  // BK-108: R-07 only (gross 40 kg is below the 50 kg the products weigh).
  ['BK-108', 'Ledger Lamps', 'Manchester', 'United Kingdom', 'Amsterdam', 'Netherlands', 'Business address', '12-11-2026', 'Balanced', 1, 50, 500, 'GBP', 40, 'No'],
  // BK-109: R-09 (no country of origin) and R-10 (ready date in the past).
  ['BK-109', 'Canal Candles', 'London', 'United Kingdom', 'Rotterdam', 'Netherlands', 'Business address', '01-10-2026', 'Fastest', 1, 10, 500, 'GBP', 80, 'No'],
  // BK-110: no items at all (R-02 and a sheet-level error).
  ['BK-110', 'Empty Crate Ltd', 'London', 'United Kingdom', 'Rotterdam', 'Netherlands', 'Business address', '12-11-2026', 'Cheapest', 1, 0, 0, 'GBP', 10, 'No'],
  // BK-111: a non-numeric quantity cell (DATA with cell reference), otherwise clean.
  ['BK-111', 'Parcel Pals', 'Leeds', 'United Kingdom', 'Amsterdam', 'Netherlands', 'Business address', '12-11-2026', 'Balanced', 1, 10, 300, 'GBP', 60, 'No'],
];

const PLANTED_ITEMS: Row[] = [
  EXAMPLE_ITEM,
  ['BK-101', 'MUG-01', 'Ceramic coffee mug, 350 ml', '6912', 1080, 5, 12, 90, 0.5, 'United Kingdom'],
  ['BK-102', 'TEA-10', 'Loose leaf tea, 250 g', '090240', 100, 10, 10, 10, 0.5, 'India'],
  ['BK-103', 'CAN-03', 'Soy wax candle', '340600', 60, 2, 10, 5, 0.5, 'United Kingdom'],
  ['BK-104', 'TIN-04', 'Baking tin, 20 cm', '732393', 100, 5, 10, 10, 0.5, 'China'],
  ['BK-105', 'GLS-05', 'Glass tumbler, 300 ml', '701339', 300, 4, 10, 30, 3, 'Vietnam'],
  ['BK-106', 'MUG-06', 'Enamel mug', '691200', 100, 5, 10, 10, 0.5, 'China'],
  ['BK-107', 'SP-07', 'Aerosol spray paint, red', '320910', 204, 3, 12, 17, 0.4, 'Turkey'],
  ['BK-108', 'LMP-08', 'Desk lamp', '940540', 50, 10, 1, 50, 1, 'China'],
  ['BK-109', 'CAN-09', 'Pillar candle', '340600', 100, 5, 10, 10, 0.8, null],
  ['BK-111', 'KET-11', 'Electric kettle', '851660', 'lots', 12, 12, 10, 1.1, 'China'],
  ['BK-999', 'ORPH-01', 'Item with unknown booking', '851660', 10, 5, 5, 2, 0.5, 'China'],
];

(async () => {
  await writeSheet('clean-bookings.xlsx', 'Bookings', 'Bookings — one row per record. Row 3 is an example (grey); enter data from row 4.', BOOKING_HEADERS, EXAMPLE_BOOKING, CLEAN_BOOKINGS);
  await writeSheet('clean-items.xlsx', 'Items', 'Items — one row per product in a booking. Row 3 is an example (grey); enter data from row 4.', ITEM_HEADERS, EXAMPLE_ITEM, CLEAN_ITEMS);
  await writeSheet('planted-errors-bookings.xlsx', 'Bookings', 'Bookings — one row per record. Row 3 is an example (grey); enter data from row 4.', BOOKING_HEADERS, EXAMPLE_BOOKING, PLANTED_BOOKINGS);
  await writeSheet('planted-errors-items.xlsx', 'Items', 'Items — one row per product in a booking. Row 3 is an example (grey); enter data from row 4.', ITEM_HEADERS, EXAMPLE_ITEM, PLANTED_ITEMS.slice(1));
})();
