// Builds a PLACEHOLDER copy of Case2_Shipment_Booking_Test_Data_Format.xlsx.
//
// The real template was not available when this project was built. This file
// recreates its five sheets so the import script has something to read.
//
// Real values (copied from the two case PDFs):
//   - Bookings row BK-001 (template Bookings PDF)
//   - Items example row MUG-01 (case brief, Sheet 2 example column)
//   - Carrier A · Road economy, UK → Germany, 180 / 5 / 92 / 500 (case brief, Sheet 3 example)
//   - Rulebook R-01 to R-10 (case brief, Sheet 4)
//   - Glossary wording (case brief column descriptions)
// Everything else in "Carrier options" is DUMMY and must be replaced by running
// `npm run import-template -- <path to real xlsx>` once the real file exists.

import ExcelJS from 'exceljs';
import path from 'node:path';

const OUT = path.resolve('data/source/Case2_Shipment_Booking_Test_Data_Format.DUMMY.xlsx');

const bookingHeaders = [
  'Booking ID', 'Seller name', 'Origin city', 'Origin country', 'Destination city',
  'Destination country', 'Destination type', 'Ready to ship date', 'Seller priority',
  'Pallets', 'Cartons', 'Total declared value', 'Currency', 'Total gross weight (kg)',
  'Delivery appointment booked',
];
const bookingExample = [
  'BK-001', 'Northfield Goods', 'Manchester', 'United Kingdom', 'Frankfurt', 'Germany',
  'Warehouse', '05-11-2026', 'Cheapest', 3, 90, 5400, 'GBP', 620, 'Yes',
];

const itemHeaders = [
  'Booking ID', 'SKU', 'Description', 'HS code', 'Quantity (units)', 'Unit price',
  'Units per carton', 'Cartons', 'Unit weight (kg)', 'Country of origin',
];
const itemExample = [
  'BK-001', 'MUG-01', 'Ceramic coffee mug, 350 ml', '691200', 1080, 5.0, 12, 90, 0.5, 'United Kingdom',
];

const carrierHeaders = [
  'Carrier', 'Service', 'Origin country', 'Destination country', 'Price per pallet (GBP)',
  'Transit time (days)', 'On-time rate (%)', 'Max weight per pallet (kg)',
];
// Row 1 is the real example from the case brief. The rest are DUMMY.
const carrierRows: (string | number)[][] = [
  ['Carrier A', 'Road economy', 'United Kingdom', 'Germany', 180, 5, 92, 500],
  ['Carrier B', 'Road express', 'United Kingdom', 'Germany', 240, 3, 95, 600],
  ['Carrier C', 'Groupage standard', 'United Kingdom', 'Germany', 165, 7, 85, 400],
  ['Carrier B', 'Road express', 'United Kingdom', 'France', 230, 2, 94, 600],
  ['Carrier C', 'Groupage standard', 'United Kingdom', 'France', 150, 6, 86, 400],
  ['Carrier A', 'Road economy', 'United Kingdom', 'Netherlands', 175, 4, 93, 500],
  ['Carrier B', 'Road express', 'United Kingdom', 'Netherlands', 235, 2, 96, 600],
  ['Carrier D', 'Ferry freight', 'United Kingdom', 'Netherlands', 155, 5, 88, 450],
];

const rulebook: [string, string, string][] = [
  ['R-01', 'Every item must have an HS code of at least 6 digits', 'Red'],
  ['R-02', 'Total declared value must equal the sum of quantity × unit price across all items (within 1%)', 'Red'],
  ['R-03', 'For each item, units per carton × cartons must equal quantity', 'Red'],
  ['R-04', 'Total cartons on the booking must equal the sum of cartons across all items', 'Red'],
  ['R-05', "Weight per pallet (total gross weight ÷ pallets) must not exceed the chosen carrier's max weight per pallet", 'Red'],
  ['R-06', 'No lithium batteries, aerosols or flammable liquids', 'Red'],
  ['R-07', 'Total gross weight must be at least the sum of unit weight × quantity across all items', 'Amber'],
  ['R-08', 'Shipments to a warehouse must have a delivery appointment booked', 'Amber'],
  ['R-09', 'Every item must have a country of origin', 'Amber'],
  ['R-10', 'Ready to ship date must not be in the past', 'Amber'],
];

const glossary: [string, string][] = [
  ['Booking ID', 'Reference label for each shipment.'],
  ['Seller name', 'Business sending the goods.'],
  ['Origin city / Origin country', 'Where the goods are collected from.'],
  ['Destination city / Destination country', 'Where the goods are delivered.'],
  ['Destination type', 'Kind of site receiving the goods: Warehouse or Business address.'],
  ['Ready to ship date', 'Day the goods will be packed and ready for collection (DD-MM-YYYY).'],
  ['Seller priority', 'What matters most to the seller. Most reliable = highest on-time rate; Balanced = no strong preference, best trade-off of cost, speed and reliability.'],
  ['Pallets', 'Number of pallets, as the seller states it. A pallet is a platform holding many cartons.'],
  ['Cartons', 'Total cartons, as the seller states it. A carton is a box of units.'],
  ['Total declared value', 'Total value of the goods, as the seller states it.'],
  ['Currency', 'Currency of every money value. GBP only.'],
  ['Total gross weight (kg)', 'Weight of everything shipped, including cartons and pallets, as the seller states it.'],
  ['Delivery appointment booked', 'Whether the seller has a delivery time slot booked at the receiving site.'],
  ['SKU / Description', "Seller's product code and a plain description."],
  ['HS code', 'Customs code that classifies the product, as the seller states it. May be blank.'],
  ['Quantity (units)', 'Total units of this product, as the seller states it.'],
  ['Unit price', 'Price of one unit, in GBP.'],
  ['Units per carton', 'Units packed in one carton.'],
  ['Unit weight (kg)', 'Weight of one unit.'],
  ['Country of origin', 'Where the product was made, not where it ships from. May be blank.'],
  ['Carrier / Service', 'Carrier name and its service level.'],
  ['Price per pallet', 'Cost to ship one pallet, in GBP.'],
  ['Transit time (days)', 'Days from collection to delivery.'],
  ['On-time rate (%)', 'Share of shipments that arrive on the promised day.'],
  ['Max weight per pallet (kg)', 'Heaviest pallet the service accepts.'],
];

function addSheet(wb: ExcelJS.Workbook, name: string, caption: string, headers: string[], rows: unknown[][]) {
  const ws = wb.addWorksheet(name);
  ws.addRow([caption]);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
}

const wb = new ExcelJS.Workbook();
addSheet(wb, 'Bookings', 'Bookings — one row per record. Row 3 is an example (grey); enter data from row 4.', bookingHeaders, [bookingExample]);
addSheet(wb, 'Items', 'Items — one row per product in a booking. Row 3 is an example (grey); enter data from row 4.', itemHeaders, [itemExample]);
addSheet(wb, 'Carrier options', 'DUMMY rate card — placeholder until the real template is supplied. Only the first row is real.', carrierHeaders, carrierRows);
addSheet(wb, 'Rulebook', 'Rulebook — fixed rules.', ['Rule ID', 'Rule', 'Severity if broken'], rulebook);
addSheet(wb, 'Glossary', 'Glossary — column definitions.', ['Column', 'What it means'], glossary);

await wb.xlsx.writeFile(OUT);
console.log(`Wrote ${OUT}`);
