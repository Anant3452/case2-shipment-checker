// Booking state shared by the chat, the form and the upload path, plus the
// deterministic evaluation (rules + carriers + confirmation) run after every change.

import {
  DESTINATIONS, DESTINATION_TYPES, ITEM_ORIGIN_COUNTRIES, ORIGIN_CITIES, ORIGIN_COUNTRY, SELLER_PRIORITIES,
  buildConfirmation, calculatedValue, computeStatus, recommendCarriers, validateBooking,
  type Booking, type BookingStatus, type Carrier, type Confirmation, type Finding, type Item, type Recommendation,
} from '../domain';
import { missingQuestions, type Question } from './questions';

export interface ChatMeta {
  /** Fields the seller hedged on ("about 3 pallets"): "booking.pallets", "item:MUG-01.quantity". */
  approximate: string[];
  /** Fields the seller said they don't know; not asked again. Same key format. */
  unknown: string[];
  /** Unit conversions to mention, e.g. "1.2 t = 1,200 kg". */
  conversions: string[];
  /** Seller said there are no more products. */
  itemsDone: boolean;
  /** Seller explicitly chose "no preference" → Balanced. */
  priorityDefaulted: boolean;
  /** The question the assistant asked last (fallback uses it to read yes/no answers). */
  pendingQuestion: string | null;
}

export interface ChatState {
  booking: Booking;
  items: Item[];
  meta: ChatMeta;
}

export interface Evaluation {
  /** Findings to show. While the booking is incomplete, findings that only concern
   *  details not yet asked for are held back (they're in `missing` instead). */
  findings: Finding[];
  /** Every finding, including held-back ones. `status` is computed from these. */
  allFindings: Finding[];
  status: BookingStatus;
  recommendation: Recommendation;
  confirmation: Confirmation;
  /** Still-missing details, most blocking first. Empty when the booking is complete. */
  missing: Question[];
  complete: boolean;
  /** Item sums, for "your items add up to …" prompts. */
  computed: { cartons: number | null; declaredValue: number | null };
}

export function emptyBooking(bookingId = 'CHAT-1'): Booking {
  return {
    bookingId, sellerName: null, originCity: null, originCountry: ORIGIN_COUNTRY,
    destinationCity: null, destinationCountry: null, destinationType: null, readyToShipDate: null,
    sellerPriority: null, pallets: null, cartons: null, totalDeclaredValue: null, currency: 'GBP',
    totalGrossWeightKg: null, deliveryAppointmentBooked: null,
  };
}

export function emptyItem(bookingId: string): Item {
  return {
    bookingId, sku: null, description: null, hsCode: null, quantity: null, unitPrice: null,
    unitsPerCarton: null, cartons: null, unitWeightKg: null, countryOfOrigin: null,
  };
}

export function emptyState(): ChatState {
  return {
    booking: emptyBooking(),
    items: [],
    meta: { approximate: [], unknown: [], conversions: [], itemsDone: false, priorityDefaulted: false, pendingQuestion: null },
  };
}

/** Accepts partial or old client state and fills the gaps, so a bad payload never crashes a turn. */
export function normaliseState(raw: unknown): ChatState {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<ChatState>;
  const booking = { ...base.booking, ...(r.booking ?? {}) };
  const items = Array.isArray(r.items) ? r.items.map((i) => ({ ...emptyItem(booking.bookingId), ...i, bookingId: booking.bookingId })) : [];
  return { booking, items, meta: { ...base.meta, ...(r.meta ?? {}) } };
}

export function itemKey(item: Item, index: number): string {
  return `item:${item.sku || item.description || index + 1}`;
}

export function evaluate(state: ChatState, today: string, carriers: Carrier[]): Evaluation {
  const { booking, items } = state;
  const findings = validateBooking(booking, items, today, carriers);
  const recommendation = recommendCarriers(booking, items, booking.sellerPriority, carriers);
  const confirmation = buildConfirmation(booking, items, recommendation, findings);
  const missing = missingQuestions(state);
  const missingKeys = new Set(missing.map((q) => q.key));
  if (missingKeys.has('booking.totals')) ['booking.cartons', 'booking.totalDeclaredValue'].forEach((k) => missingKeys.add(k));
  const refKey = (r: Finding['fieldRefs'][number]) => (r.entity === 'booking'
    ? `booking.${r.field}`
    : `${itemKey(items[r.index ?? 0] ?? emptyItem(''), r.index ?? 0)}.${r.field}`);
  const notYetAsked = (f: Finding) => (f.ruleId === 'R-02' && items.length === 0)
    || (f.fieldRefs.length > 0 && f.fieldRefs.every((r) => missingKeys.has(refKey(r))));
  const cartonsKnown = items.length > 0 && items.every((i) => i.cartons != null);
  return {
    findings: missing.length ? findings.filter((f) => !notYetAsked(f)) : findings,
    allFindings: findings,
    status: computeStatus(findings),
    recommendation,
    confirmation,
    missing,
    complete: missing.length === 0,
    computed: {
      cartons: cartonsKnown ? items.reduce((s, i) => s + (i.cartons as number), 0) : null,
      declaredValue: items.length ? calculatedValue(items) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Canonicalising values that come from the model, the slot-filler or the form.

function canon<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return allowed.find((a) => a.toLowerCase() === v) ?? null;
}

const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'United Kingdom', 'u.k.': 'United Kingdom', britain: 'United Kingdom', 'great britain': 'United Kingdom',
  england: 'United Kingdom', gb: 'United Kingdom', de: 'Germany', fr: 'France', nl: 'Netherlands',
  holland: 'Netherlands', 'the netherlands': 'Netherlands', prc: 'China',
};

export function canonCountry(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim().toLowerCase();
  if (COUNTRY_ALIASES[v]) return COUNTRY_ALIASES[v];
  const all = [...new Set([...ITEM_ORIGIN_COUNTRIES, ...Object.keys(DESTINATIONS), ORIGIN_COUNTRY])];
  return all.find((c) => c.toLowerCase() === v) ?? null;
}

export function destinationCountryFor(city: string): string | null {
  return Object.entries(DESTINATIONS).find(([, cities]) => cities.some((c) => c.toLowerCase() === city.toLowerCase()))?.[0] ?? null;
}

export class InputError extends Error {}

export type BookingPatch = Partial<Record<keyof Booking, unknown>>;

/** Applies validated booking fields. Throws InputError with a seller-safe message on bad values. */
export function applyBookingPatch(state: ChatState, patch: BookingPatch): string[] {
  const b = state.booking;
  const changed: string[] = [];
  const set = <K extends keyof Booking>(k: K, v: Booking[K]) => {
    if (b[k] !== v) { b[k] = v; changed.push(k); }
  };
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === undefined) continue;
    const k = key as keyof Booking;
    if (raw === null) { if (k !== 'bookingId') set(k, null as never); continue; }
    switch (k) {
      case 'originCity': {
        const city = canon(raw, ORIGIN_CITIES);
        if (!city) throw new InputError(`"${raw}" is not a supported collection city. Use ${ORIGIN_CITIES.join(', ')}.`);
        set('originCity', city);
        set('originCountry', ORIGIN_COUNTRY);
        break;
      }
      case 'originCountry':
        if (canonCountry(raw) !== ORIGIN_COUNTRY) throw new InputError('Shipments must start in the United Kingdom.');
        set('originCountry', ORIGIN_COUNTRY);
        break;
      case 'destinationCity': {
        const country = destinationCountryFor(String(raw));
        if (!country) throw new InputError(`"${raw}" is not a supported destination. ${lanesText()}`);
        const city = DESTINATIONS[country].find((c) => c.toLowerCase() === String(raw).toLowerCase())!;
        // An appointment is booked with one site; a new site needs its own.
        if (b.destinationCity && b.destinationCity !== city && b.deliveryAppointmentBooked != null) set('deliveryAppointmentBooked', null);
        set('destinationCity', city);
        set('destinationCountry', country);
        break;
      }
      case 'destinationCountry': {
        const c = canonCountry(raw);
        if (!c || !DESTINATIONS[c]) throw new InputError(`"${raw}" is not a supported destination country. ${lanesText()}`);
        set('destinationCountry', c);
        if (b.destinationCity && !DESTINATIONS[c].includes(b.destinationCity)) set('destinationCity', null);
        break;
      }
      case 'destinationType': {
        const t = canon(raw, DESTINATION_TYPES) ?? (/business|office|shop|store|customer/i.test(String(raw)) ? 'Business address' : /warehouse|fulfil|fc\b|dc\b/i.test(String(raw)) ? 'Warehouse' : null);
        if (!t) throw new InputError('Destination type must be Warehouse or Business address.');
        set('destinationType', t);
        break;
      }
      case 'sellerPriority': {
        const p = canon(raw, SELLER_PRIORITIES);
        if (!p) throw new InputError(`Priority must be one of ${SELLER_PRIORITIES.join(', ')}.`);
        set('sellerPriority', p);
        break;
      }
      case 'deliveryAppointmentBooked': {
        const v = raw === true || /^(yes|y|true|booked)$/i.test(String(raw)) ? 'Yes' : raw === false || /^(no|n|false|not booked)$/i.test(String(raw)) ? 'No' : null;
        if (!v) throw new InputError('Delivery appointment must be Yes or No.');
        set('deliveryAppointmentBooked', v);
        break;
      }
      case 'readyToShipDate': {
        const s = String(raw);
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : /^(\d{1,2})-(\d{1,2})-(\d{4})$/.test(s) ? s.replace(/^(\d{1,2})-(\d{1,2})-(\d{4})$/, (_, d, m, y) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`) : null;
        if (!iso || Number.isNaN(Date.parse(iso))) throw new InputError(`"${s}" is not a date. Use DD-MM-YYYY.`);
        set('readyToShipDate', iso);
        break;
      }
      case 'currency':
        if (String(raw).toUpperCase() !== 'GBP') throw new InputError('Only GBP is supported. Give the value in pounds.');
        set('currency', 'GBP');
        break;
      case 'pallets': case 'cartons': case 'totalDeclaredValue': case 'totalGrossWeightKg': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[£,\s]/g, ''));
        if (!Number.isFinite(n) || n < 0) throw new InputError(`${key} must be a positive number.`);
        set(k, n as never);
        break;
      }
      case 'sellerName':
        set('sellerName', String(raw).trim() || null);
        break;
      case 'bookingId':
        break;
      default:
        throw new InputError(`Unknown booking field "${key}".`);
    }
  }
  return changed;
}

export type ItemPatch = Partial<Record<keyof Item, unknown>>;

const ITEM_NUMBERS: (keyof Item)[] = ['quantity', 'unitPrice', 'unitsPerCarton', 'cartons', 'unitWeightKg'];

/** Finds an item by SKU or a word in its description ("the kettles" → "Electric kettle"). */
export function findItem(items: Item[], ref: string | number | null | undefined): number {
  if (ref == null || ref === '') return -1;
  if (typeof ref === 'number') return ref >= 0 && ref < items.length ? ref : -1;
  const r = ref.toLowerCase().replace(/^the\s+/, '').trim();
  const stem = r.replace(/(es|s)$/, '');
  const bySku = items.findIndex((i) => i.sku?.toLowerCase() === r);
  if (bySku >= 0) return bySku;
  return items.findIndex((i) => {
    const d = (i.description ?? '').toLowerCase();
    return d === r || (stem.length >= 3 && d.includes(stem));
  });
}

/** Adds an item, or merges into the one `match` (or the SKU) points at. Returns the item index. */
export function upsertItem(state: ChatState, patch: ItemPatch, match?: string | null): number {
  let idx = findItem(state.items, match ?? null);
  if (idx < 0 && typeof patch.sku === 'string') idx = findItem(state.items, patch.sku);
  if (idx < 0) {
    state.items.push(emptyItem(state.booking.bookingId));
    idx = state.items.length - 1;
    state.meta.itemsDone = false;
  }
  const item = state.items[idx];
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === undefined) continue;
    const k = key as keyof Item;
    if (raw === null) { if (k !== 'bookingId') (item as unknown as Record<string, unknown>)[k] = null; continue; }
    if (ITEM_NUMBERS.includes(k)) {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[£,\s]/g, ''));
      if (!Number.isFinite(n) || n < 0) throw new InputError(`${key} must be a positive number.`);
      (item as unknown as Record<string, unknown>)[k] = n;
    } else if (k === 'countryOfOrigin') {
      const c = canonCountry(raw);
      if (!c || !(ITEM_ORIGIN_COUNTRIES as readonly string[]).includes(c)) {
        throw new InputError(`"${raw}" is not in the supported country-of-origin list: ${ITEM_ORIGIN_COUNTRIES.join(', ')}.`);
      }
      item.countryOfOrigin = c;
    } else if (k === 'hsCode') {
      const code = String(raw).trim();
      if (!/\d/.test(code)) throw new InputError(`"${code}" is not an HS code. Ask for the number from the UK Trade Tariff; do not guess one.`);
      item.hsCode = code;
    } else if (k === 'sku' || k === 'description') {
      item[k] = String(raw).trim() || null;
    } else if (k !== 'bookingId') {
      throw new InputError(`Unknown item field "${key}".`);
    }
  }
  return idx;
}

export function removeItem(state: ChatState, ref: string | number): Item | null {
  const idx = findItem(state.items, ref);
  if (idx < 0) return null;
  const [removed] = state.items.splice(idx, 1);
  return removed;
}

export function lanesText(): string {
  return `Supported lanes are UK to ${Object.entries(DESTINATIONS).map(([c, cities]) => `${c} (${cities.join(', ')})`).join(', ')}.`;
}
