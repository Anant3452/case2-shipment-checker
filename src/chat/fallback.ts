// Rule-based slot-filler: used when ANTHROPIC_API_KEY is unset or the API call fails.
// Regex and keyword matching for cities, countries, numbers, dates, priority and items.
// It writes through the same state functions as the Claude tools, so the checks are identical.

import {
  DESTINATIONS, ITEM_ORIGIN_COUNTRIES, ORIGIN_CITIES, displayDate, kg, money, num,
  parseCount, parseMoneyGBP, parseNaturalDate, parseNumber, parseWeightKg, plural,
  type Carrier, type Item,
} from '../domain';
import {
  InputError, applyBookingPatch, canonCountry, evaluate, findItem, itemKey, lanesText, removeItem, upsertItem,
  type BookingPatch, type ChatState, type Evaluation, type ItemPatch,
} from './state';

export interface TurnResult {
  state: ChatState;
  reply: string;
  evaluation: Evaluation;
}

const UNSUPPORTED_PLACES = [
  'spain', 'madrid', 'barcelona', 'italy', 'rome', 'milan', 'belgium', 'brussels', 'antwerp', 'poland', 'warsaw',
  'ireland', 'dublin', 'usa', 'america', 'new york', 'canada', 'toronto', 'munich', 'cologne', 'stuttgart',
  'marseille', 'nice', 'bordeaux', 'toulouse', 'utrecht', 'the hague', 'eindhoven', 'austria', 'vienna',
  'switzerland', 'zurich', 'geneva', 'sweden', 'stockholm', 'denmark', 'copenhagen', 'portugal', 'lisbon',
  'norway', 'oslo', 'dubai', 'india', 'mumbai', 'delhi', 'china', 'shanghai', 'australia', 'sydney', 'luxembourg',
];
const UK_NON_ORIGIN = ['glasgow', 'edinburgh', 'bristol', 'liverpool', 'cardiff', 'belfast', 'newcastle', 'sheffield', 'nottingham', 'southampton', 'dover'];

const LANGUAGE_HINTS: [string, RegExp][] = [
  ['French', /\b(bonjour|je|nous|envoyer|palettes|entrepôt|merci|vers|depuis)\b/i],
  ['German', /\b(hallo|ich|wir|möchte|paletten|nach|lager|versenden|bitte)\b/i],
  ['Spanish', /\b(hola|quiero|enviar|palés|almacén|gracias|desde)\b/i],
  ['Dutch', /\b(hallo|ik|wil|pallets?|naar|magazijn|versturen|bedankt)\b.*\b(ik|wil|naar|magazijn|versturen)\b/i],
];

const YES = /^\s*(yes|yep|yeah|y|correct|right|that'?s right|sure|ok(ay)?|confirm(ed)?|use (those|that|them)|go ahead|please do)\b/i;
const NO = /^\s*(no|nope|nah|n)\b/i;
const DONT_KNOW = /\b(don'?t know|do not know|not sure|no idea|unknown|dunno)\b/i;
const ITEMS_DONE = /\b(that'?s (all|it|everything)|nothing else|no more( items| products)?|that is (all|everything)|done)\b/i;

function lower(s: string) { return s.toLowerCase(); }

function findOriginCity(t: string): string | null {
  const from = t.match(/\bfrom\s+([a-z]+)/);
  if (from) {
    const c = ORIGIN_CITIES.find((x) => lower(x) === from[1]);
    if (c) return c;
  }
  const mentioned = ORIGIN_CITIES.filter((c) => new RegExp(`\\b${lower(c)}\\b`).test(t));
  return mentioned.length === 1 ? mentioned[0] : null;
}

function findDestination(t: string): { city: string | null; country: string | null } {
  for (const [country, cities] of Object.entries(DESTINATIONS)) {
    for (const c of cities) if (new RegExp(`\\b${lower(c)}\\b`).test(t)) return { city: c, country };
  }
  for (const country of Object.keys(DESTINATIONS)) {
    if (new RegExp(`\\b(to|into|in)\\s+(the\\s+)?${lower(country)}\\b`).test(t) || new RegExp(`^\\s*${lower(country)}\\s*$`).test(t)) {
      return { city: null, country };
    }
  }
  if (/\b(to|into)\s+(holland|the netherlands)\b/.test(t)) return { city: null, country: 'Netherlands' };
  return { city: null, country: null };
}

function findUnsupportedDestination(t: string, original: string): string | null {
  for (const p of UNSUPPORTED_PLACES) {
    if (new RegExp(`\\b(to|into|deliver(ed)? (to|in)|going to|in)\\s+${p}\\b`).test(t)) return p.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const m = original.match(/\b(?:ship|send|deliver|going|goes|go|move)\w*\s+(?:it\s+|them\s+|goods\s+)?to\s+([A-Z][a-zA-Z]+)/);
  if (m) {
    const w = m[1].toLowerCase();
    const known = [...Object.keys(DESTINATIONS), ...Object.values(DESTINATIONS).flat()].map(lower);
    const ignore = ['the', 'a', 'our', 'my', 'their', 'warehouse', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'holland'];
    if (!known.includes(w) && !ignore.includes(w)) return m[1];
  }
  return null;
}

function findPriority(t: string, pending: string | null): { priority: string; defaulted: boolean } | null {
  if (/\b(no (real )?preference|don'?t mind|do not mind|doesn'?t matter|either is fine)\b/.test(t)) return { priority: 'Balanced', defaulted: true };
  if (/\b(balanced?|best value|mix of|a bit of everything|all three)\b/.test(t)) return { priority: 'Balanced', defaulted: false };
  if (/\b(most reliable|reliab\w*|on[- ]time|dependable)\b/.test(t)) return { priority: 'Most reliable', defaulted: false };
  if (/\b(fastest|quickest|asap|urgent\w*|soonest|as fast|as quick|speed)\b/.test(t)) return { priority: 'Fastest', defaulted: false };
  if (/\b(cheapest|cheap|lowest (price|cost)|budget|least expensive|lowest)\b/.test(t)) return { priority: 'Cheapest', defaulted: false };
  if (pending === 'booking.sellerPriority' && /\b(any|whatever|either)\b/.test(t)) return { priority: 'Balanced', defaulted: true };
  return null;
}

function findSellerName(original: string, pending: string | null): string | null {
  const m = original.match(/\b(?:[Ss]eller(?: [Nn]ame)? is|[Cc]ompany(?: [Nn]ame)? is|[Bb]usiness(?: [Nn]ame)? is|[Ww]e are|[Ww]e're|[Tt]his is|[Ii]'m from|[Ii] am from|[Mm]y company is|[Oo]n behalf of|[Ss]eller:)\s+([A-Z0-9][\w&'.-]*(?:\s+(?:[A-Z0-9&][\w&'.-]*|of|and))*)/);
  if (m) return m[1].split(/[.,;!]\s|[.,;!]$/)[0].trim();
  if (pending === 'booking.sellerName') {
    const s = original.trim().replace(/^(it'?s|it is|we'?re|we are|the seller is|name is)\s+/i, '').replace(/[.!]$/, '');
    if (s && s.split(/\s+/).length <= 6) return s;
  }
  return null;
}

/** Amounts: unit prices ("£5 each", "at £5") vs totals ("worth £5.4k"). */
function findMoney(original: string): { unitPrice: number | null; total: number | null; nonGbp: string | null } {
  const t = original;
  const nonGbp = t.match(/(€|\$|₹|¥)\s*\d|\d[\d,.]*\s*(k\s*)?(eur|euros?|usd|dollars?|inr|rupees?|lakh|yen|yuan)\b|\b(euros?|dollars?|rupees?)\b/i);
  if (nonGbp) return { unitPrice: null, total: null, nonGbp: nonGbp[0] };
  let unitPrice: number | null = null;
  const unit = t.match(/(?:\bat\s*|@\s*)£\s*(\d[\d,]*(?:\.\d+)?)|£\s*(\d[\d,]*(?:\.\d+)?)\s*(?:each|per unit|a unit|apiece|per item|\/unit|per piece|a piece)|\bunit price\s*(?:is|of|:)?\s*£?\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:pounds?|gbp|quid)\s*(?:each|per unit|a unit|apiece)/i);
  if (unit) unitPrice = Number((unit[1] ?? unit[2] ?? unit[3] ?? unit[4]).replace(/,/g, ''));
  let total: number | null = null;
  const stripped = unit ? t.replace(unit[0], ' ') : t;
  const sym = stripped.match(/£\s*\d[\d,]*(?:\.\d+)?\s*k?\b|\d[\d,]*(?:\.\d+)?\s*k?\s*(?:gbp|pounds?|quid)\b/i);
  if (sym) {
    const p = parseMoneyGBP(sym[0]);
    if (p.ok) total = p.value;
  } else {
    const words = stripped.match(/\b((?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and|a)[\s-]+)+)(pounds|quid)\b/i);
    if (words) {
      const p = parseMoneyGBP(words[0]);
      if (p.ok) total = p.value;
    }
  }
  return { unitPrice, total, nonGbp: null };
}

/** Item details in a message. Returns null if the message isn't about a product. */
function findItemPatch(original: string, t: string): { patch: ItemPatch; context: boolean } {
  const patch: ItemPatch = {};
  const hs = original.match(/\bhs(?:\s*code)?\s*(?:is|:|=|#)?\s*(\d[\d .\-]*\d|\d)/i);
  if (hs) patch.hsCode = hs[1].trim();
  const sku = original.match(/\bsku\s*[:#]?\s*([A-Za-z0-9][\w-]*)/i) ?? original.match(/\b([A-Z]{2,}[-_]?\d+[A-Z0-9-]*)\b/);
  if (sku) patch.sku = sku[1];
  const upc = t.match(/(\d+)\s*(?:units?\s+|[a-z]+\s+)?(?:per|a|to a|in a|in each|each)\s+(?:carton|box)\b/) ?? t.match(/\b(?:cartons|boxes)\s+of\s+(\d+)\b/);
  if (upc) patch.unitsPerCarton = Number(upc[1]);
  const tWithoutUpc = upc ? t.replace(upc[0], ' ') : t;
  const qty = tWithoutUpc.match(/(\d[\d,]*)\s*(?:units?|pcs|pieces|items)\b/) ?? tWithoutUpc.match(/\b(?:quantity|qty)\s*(?:is|of|:)?\s*(\d[\d,]*)/);
  if (qty) patch.quantity = Number(qty[1].replace(/,/g, ''));
  const uw = t.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilos?|g|grams?)\s*(?:each|per unit|a unit|apiece|per item|per piece)/) ?? t.match(/\bunit weight\s*(?:is|of|:)?\s*(\d+(?:\.\d+)?)\s*(kg|g|grams?)?/) ?? t.match(/\b(?:each|one) (?:unit |one )?weighs\s*(\d+(?:\.\d+)?)\s*(kg|kgs|g|grams?)?/);
  if (uw) {
    const w = parseWeightKg(`${uw[1]} ${uw[2] ?? 'kg'}`);
    if (w) patch.unitWeightKg = w.value;
  }
  const country = t.match(/\b(?:made in|manufactured in|produced in|country of origin(?: is)?|origin(?: is)?:?)\s+(?:the\s+)?([a-z .]+?)(?:[,.;]|$|\s+and\b|\s+at\b)/);
  if (country) {
    const c = canonCountry(country[1].trim());
    if (c) patch.countryOfOrigin = c;
  }
  const context = Object.keys(patch).length > 0 || /\b(add|product|item|sku)\b/.test(t);
  return { patch, context };
}

function findDescription(original: string): string | null {
  const explicit = original.match(/\b(?:description|product|item)\s*(?:is|:)\s*([^,.;]+)/i);
  if (explicit) return explicit[1].trim();
  const of = original.match(/\b(?:pallets?|cartons?|boxes)\s+of\s+([a-z][a-z \-]+?)(?:\s+from\b|\s+to\b|[,.;]|$)/i);
  if (of) return of[1].trim();
  const add = original.match(/^\s*(?:also\s+)?add\s+(?:\d[\d,]*\s+)?(?:units? of\s+)?([a-z][a-z \-]*?)(?:\s*,|\s+sku\b|\s+hs\b|\s+at\b|\s+\d|$)/i);
  if (add && !/^(one|another|a|an|more|extra|\d)\b/i.test(add[1]) && !/pallet|carton/i.test(add[1])) return add[1].trim();
  return null;
}

/** Parse one seller message into state changes. Returns lines describing what changed. */
export function applyMessage(state: ChatState, message: string, today: string): { changes: string[]; notes: string[]; routeChanged: boolean } {
  const original = message.trim();
  const t = lower(original);
  const pending = state.meta.pendingQuestion;
  const changes: string[] = [];
  const notes: string[] = [];
  const bp: BookingPatch = {};
  let routeChanged = false;

  const lang = LANGUAGE_HINTS.find(([, re]) => re.test(original));
  if (lang || /[^\u0000-ɏ\s\d£€$.,;:!?'"()\-–—@#%&*/+=]/.test(original)) {
    notes.push(`You wrote in ${lang ? lang[0] : 'another language'}. I'll reply in English.`);
  }

  // --- declines ---
  const unsupported = findUnsupportedDestination(t, original);
  if (unsupported) notes.push(`We don't ship to ${unsupported}. ${lanesText()}`);
  const badOrigin = UK_NON_ORIGIN.find((c) => new RegExp(`\\bfrom\\s+${c}\\b`).test(t));
  if (badOrigin) notes.push(`We collect from ${ORIGIN_CITIES.join(', ')} only, not ${badOrigin[0].toUpperCase()}${badOrigin.slice(1)}.`);

  // --- removal ---
  const remove = original.match(/\b(?:remove|delete|drop|take out|take off)\s+(?:the\s+)?(.+?)(?:\s+from\b.*)?[.!]?$/i);
  if (remove && !/pallet|carton/i.test(remove[1])) {
    const removed = removeItem(state, remove[1].trim());
    if (removed) changes.push(`removed ${removed.description || removed.sku}`);
    else notes.push(`I couldn't find "${remove[1].trim()}" on the booking.`);
  }

  // --- route ---
  const origin = findOriginCity(t);
  if (origin && origin !== state.booking.originCity) { bp.originCity = origin; routeChanged = state.booking.originCity != null; }
  const dest = unsupported ? { city: null, country: null } : findDestination(t);
  if (dest.city && dest.city !== state.booking.destinationCity) {
    routeChanged = routeChanged || state.booking.destinationCity != null;
    bp.destinationCity = dest.city;
  } else if (dest.country && dest.country !== state.booking.destinationCountry) {
    routeChanged = routeChanged || state.booking.destinationCountry != null;
    bp.destinationCountry = dest.country;
  }
  if (/\bwarehouse|fulfil+ment cent|distribution cent/.test(t) && !/\bappointment\b/.test(t)) bp.destinationType = 'Warehouse';
  else if (/\bbusiness address|\boffice\b|\bshop\b|\bstore\b|\bcustomer'?s?\b|\bshowroom\b|\bretail\b/.test(t)) bp.destinationType = 'Business address';
  else if (pending === 'booking.destinationType' && /\bwarehouse\b/.test(t)) bp.destinationType = 'Warehouse';
  else if (pending === 'booking.destinationType' && /\bbusiness\b/.test(t)) bp.destinationType = 'Business address';

  // --- date ---
  const date = parseNaturalDate(original, today);
  if (date && (pending === 'booking.readyToShipDate' || /\b(ready|collect|ship|pick ?up|dispatch|date|on|by|next|this|tomorrow|today|from|in \d)\b/.test(t))) {
    if (date !== state.booking.readyToShipDate) bp.readyToShipDate = date;
  }

  // --- priority ---
  const prio = findPriority(t, pending);
  if (prio && (prio.priority !== state.booking.sellerPriority)) {
    bp.sellerPriority = prio.priority;
    state.meta.priorityDefaulted = prio.defaulted;
  }

  // --- seller ---
  const seller = findSellerName(original, pending);
  if (seller) bp.sellerName = seller;

  // --- appointment ---
  if (/\bappointment|\bslot\b|\bbooking slot/.test(t)) {
    if (/\b(no|not|haven'?t|don'?t have|without|none)\b/.test(t)) bp.deliveryAppointmentBooked = 'No';
    else if (/\b(yes|booked|have|got|has|confirmed)\b/.test(t)) bp.deliveryAppointmentBooked = 'Yes';
  } else if (pending === 'booking.deliveryAppointmentBooked') {
    if (YES.test(t)) bp.deliveryAppointmentBooked = 'Yes';
    else if (NO.test(t)) bp.deliveryAppointmentBooked = 'No';
  }

  // --- pallets ---
  const palletMore = t.match(/\b(?:add|plus|another|one more|extra)\s+(?:(\d+|one|two|three|four|five|a|an)\s+)?(?:more\s+|extra\s+)?pallets?\b/);
  const pallets = parseCount(original, 'pallet');
  if (palletMore && state.booking.pallets != null && state.booking.pallets > 0) {
    const n = palletMore[1] ? (parseNumber(palletMore[1])?.value ?? (/^(a|an)$/.test(palletMore[1]) ? 1 : 1)) : 1;
    bp.pallets = state.booking.pallets + n;
  } else if (pallets) {
    bp.pallets = pallets.value;
    if (pallets.approximate) state.meta.approximate = [...new Set([...state.meta.approximate, 'booking.pallets'])];
  } else if (/\bno pallets?\b|\bnot (on )?pallet/.test(t)) {
    bp.pallets = 0;
  }

  // --- item details ---
  const money = findMoney(original);
  if (money.nonGbp) notes.push(`We work in GBP only, so I haven't recorded "${money.nonGbp.trim()}". What's the value in pounds?`);
  const { patch: itemPatch, context: itemContext } = findItemPatch(original, t);
  if (money.unitPrice != null) itemPatch.unitPrice = money.unitPrice;
  const description = findDescription(original);

  const cartons = parseCount(original, 'carton') ?? parseCount(original.replace(/\bboxes\b/gi, 'cartons'), 'carton');
  const cartonsIsUpc = itemPatch.unitsPerCarton != null && cartons?.value === itemPatch.unitsPerCarton;
  const isItemMessage = itemContext || description != null && /\d/.test(original) && (itemPatch.quantity != null || money.unitPrice != null);
  if (cartons && !cartonsIsUpc) {
    if (isItemMessage || (pending?.startsWith('item:') && pending.endsWith('.cartons'))) itemPatch.cartons = cartons.value;
    else bp.cartons = cartons.value;
  }

  // Quantity like "1080 mugs" when the description is known.
  if (itemPatch.quantity == null && description) {
    const head = description.split(/\s+/)[0].replace(/[^a-z-]/gi, '');
    const q = original.match(new RegExp(`(\\d[\\d,]*)\\s+(?:\\w+\\s+)?${head}`, 'i'));
    if (q && !/pallet|carton/i.test(head)) itemPatch.quantity = Number(q[1].replace(/,/g, ''));
  }

  // --- weight (gross) ---
  if (itemPatch.unitWeightKg == null) {
    const w = original.match(/(\d[\d,]*(?:\.\d+)?)\s*(kg|kgs|kilos?|kilograms?|t|tonnes?|tons?)\b(?!\s*(each|per|a unit|apiece))/i);
    if (w) {
      const parsed = parseWeightKg(w[0]);
      if (parsed) {
        bp.totalGrossWeightKg = parsed.value;
        if (parsed.note) state.meta.conversions.push(parsed.note);
        if (/\b(about|around|roughly|approx\w*|~)\s*$/i.test(original.slice(0, w.index))) {
          state.meta.approximate = [...new Set([...state.meta.approximate, 'booking.totalGrossWeightKg'])];
        }
      }
    }
  }

  // --- total value ---
  if (money.total != null && (!isItemMessage || /\b(total|worth|value|declared|altogether|in total)\b/i.test(t))) {
    bp.totalDeclaredValue = money.total;
  }

  // --- answers to the pending question ---
  const bareNumber = /^\s*(about|around|roughly|~)?\s*[£]?\s*\d[\d,]*(\.\d+)?\s*(k|kg|t|tonnes?|g|units?|cartons?|pallets?|each)?\s*[.!]?\s*$/i.test(original)
    || (parseNumber(original) != null && original.split(/\s+/).length <= 4 && !/[a-z]{4,}/i.test(original.replace(/\b(about|around|roughly|units?|cartons?|pallets?|pounds?|each|kg|kilos?|tonnes?|grams?)\b/gi, '')));
  const hasWeightUnit = /\d\s*(kg|kgs|kilos?|t|tonnes?|tons?|g|grams?)\b/i.test(original);
  const hasMoney = /£|\bpounds?\b|\bgbp\b|\bquid\b/i.test(original);
  const weightField = pending === 'booking.totalGrossWeightKg' || !!pending?.endsWith('.unitWeightKg');
  const moneyField = pending === 'booking.totalDeclaredValue' || !!pending?.endsWith('.unitPrice');
  if (pending && bareNumber && (!hasWeightUnit || weightField) && (!hasMoney || moneyField)) {
    const n = parseNumber(original);
    if (n) {
      if (pending === 'booking.pallets' && bp.pallets == null) bp.pallets = n.value;
      else if (pending === 'booking.cartons' && bp.cartons == null) bp.cartons = n.value;
      else if (pending === 'booking.totalDeclaredValue' && bp.totalDeclaredValue == null) {
        const m = parseMoneyGBP(original);
        if (m.ok) bp.totalDeclaredValue = m.value;
      } else if (pending === 'booking.totalGrossWeightKg' && bp.totalGrossWeightKg == null) {
        const w = parseWeightKg(original);
        if (w) { bp.totalGrossWeightKg = w.value; if (w.note) state.meta.conversions.push(w.note); }
      } else if (pending.startsWith('item:')) {
        const field = pending.split('.').pop() as keyof Item;
        if (field === 'unitWeightKg') itemPatch.unitWeightKg = parseWeightKg(original)?.value ?? n.value;
        else if (field === 'unitPrice') itemPatch.unitPrice = n.value;
        else if (['quantity', 'unitsPerCarton', 'cartons'].includes(field) && itemPatch[field] == null) itemPatch[field] = n.value;
        else if (field === 'hsCode') itemPatch.hsCode = original.trim();
      }
      if (n.approximate && pending.startsWith('booking.')) state.meta.approximate = [...new Set([...state.meta.approximate, pending])];
    }
  }
  if (pending?.endsWith('.hsCode') && itemPatch.hsCode == null && /\d{4,}/.test(original)) itemPatch.hsCode = original.match(/\d[\d .\-]*\d/)![0];
  if (pending?.endsWith('.countryOfOrigin') && itemPatch.countryOfOrigin == null) {
    const c = canonCountry(original.replace(/^(made in|it'?s from|from|in)\s+/i, '').replace(/[.!]$/, '').trim())
      ?? ITEM_ORIGIN_COUNTRIES.find((x) => new RegExp(`\\b${lower(x)}\\b`).test(t)) ?? (/\b(uk|britain|england)\b/.test(t) ? 'United Kingdom' : null);
    if (c) itemPatch.countryOfOrigin = c;
  }
  if (pending?.endsWith('.description') && !description && !bareNumber) itemPatch.description = original.replace(/[.!]$/, '');
  if (pending === 'items.first' && !description && !itemPatch.sku && !bareNumber && original.split(/\s+/).length <= 5) itemPatch.description = original.replace(/[.!]$/, '');

  if (pending && DONT_KNOW.test(t) && !state.meta.unknown.includes(pending)) {
    state.meta.unknown.push(pending);
    notes.push('No problem, I\'ve left that blank. The checks below show what that means.');
  }

  // Yes/no to confirmation questions.
  const ev = evaluate(state, today, []);
  if (YES.test(t)) {
    if (pending === 'booking.totals' && ev.computed.cartons != null && ev.computed.declaredValue != null) {
      bp.cartons = ev.computed.cartons; bp.totalDeclaredValue = ev.computed.declaredValue;
    } else if (pending === 'booking.cartons' && ev.computed.cartons != null && bp.cartons == null) bp.cartons = ev.computed.cartons;
    else if (pending === 'booking.totalDeclaredValue' && ev.computed.declaredValue != null && bp.totalDeclaredValue == null) bp.totalDeclaredValue = ev.computed.declaredValue;
  }
  if (!state.meta.itemsDone && state.items.length && ((pending === 'items.more' && NO.test(t)) || ITEMS_DONE.test(t))) {
    state.meta.itemsDone = true;
    changes.push(`that's everything for products (${plural(state.items.length, 'product')})`);
  } else if (pending === 'items.more' && YES.test(t)) {
    notes.push('Go ahead: what is the next product? Name, HS code, quantity, unit price, units per carton, cartons, unit weight and country of origin.');
  }

  // --- apply item ---
  const hasItemPatch = Object.keys(itemPatch).length > 0 || description != null;
  if (hasItemPatch) {
    if (description && itemPatch.description == null) itemPatch.description = description;
    let target: number | string | null = null;
    if (pending?.startsWith('item:')) target = findItem(state.items, pending.slice(5, pending.lastIndexOf('.')));
    if ((target === null || target === -1) && description) target = findItem(state.items, description);
    if ((target === null || target === -1) && itemPatch.sku) target = findItem(state.items, String(itemPatch.sku));
    if ((target === null || target === -1) && !description && !itemPatch.sku) {
      const incomplete = state.items.findIndex((i) => [i.hsCode, i.quantity, i.unitPrice, i.unitsPerCarton, i.cartons, i.unitWeightKg, i.countryOfOrigin].some((v) => v == null));
      if (incomplete >= 0) target = incomplete;
    }
    const isNew = target === null || target === -1;
    try {
      const idx = upsertItem(state, itemPatch, typeof target === 'number' && target >= 0 ? state.items[target].sku ?? state.items[target].description : null);
      const it = state.items[idx];
      const name = it.description || it.sku || `item ${idx + 1}`;
      const bits: string[] = [];
      if (itemPatch.quantity != null) bits.push(`${num(it.quantity!)} units`);
      if (itemPatch.unitPrice != null) bits.push(`${money_(it.unitPrice!)} each`);
      if (itemPatch.unitsPerCarton != null) bits.push(`${num(it.unitsPerCarton!)} per carton`);
      if (itemPatch.cartons != null) bits.push(plural(it.cartons!, 'carton'));
      if (itemPatch.unitWeightKg != null) bits.push(`${kg(it.unitWeightKg!)} each`);
      if (itemPatch.hsCode != null) bits.push(`HS code ${it.hsCode}`);
      if (itemPatch.countryOfOrigin != null) bits.push(`made in ${it.countryOfOrigin}`);
      changes.push(`${isNew ? 'added ' : ''}${name}${bits.length ? `: ${bits.join(', ')}` : ''}`);
    } catch (e) {
      if (e instanceof InputError) notes.push(e.message); else throw e;
    }
  }

  // --- apply booking ---
  const before = { ...state.booking };
  for (const [k, v] of Object.entries(bp)) {
    try {
      applyBookingPatch(state, { [k]: v });
    } catch (e) {
      if (e instanceof InputError) notes.push(e.message); else throw e;
    }
  }
  const b = state.booking;
  if (b.originCity !== before.originCity || b.destinationCity !== before.destinationCity || b.destinationCountry !== before.destinationCountry) {
    const to = b.destinationCity ? `${b.destinationCity}, ${b.destinationCountry}` : b.destinationCountry;
    if (b.originCity && to) changes.push(`${b.originCity} to ${to}`);
    else if (to) changes.push(`going to ${to}`);
    else if (b.originCity) changes.push(`collecting from ${b.originCity}`);
  }
  if (b.destinationType !== before.destinationType && b.destinationType) changes.push(b.destinationType === 'Warehouse' ? 'delivering to a warehouse' : 'delivering to a business address');
  if (b.readyToShipDate !== before.readyToShipDate && b.readyToShipDate) changes.push(`ready ${displayDate(b.readyToShipDate)}`);
  if (b.sellerPriority !== before.sellerPriority && b.sellerPriority) {
    changes.push(state.meta.priorityDefaulted ? 'no preference, so I\'ll balance cost, speed and reliability' : `priority: ${b.sellerPriority.toLowerCase()}`);
  }
  if (b.sellerName !== before.sellerName && b.sellerName) changes.push(`seller ${b.sellerName}`);
  if (b.pallets !== before.pallets && b.pallets != null) {
    changes.push(state.meta.approximate.includes('booking.pallets') && before.pallets == null
      ? `${plural(b.pallets, 'pallet')} (you said about ${num(b.pallets)}, so I've used ${num(b.pallets)})`
      : plural(b.pallets, 'pallet'));
  }
  if (b.cartons !== before.cartons && b.cartons != null) changes.push(`${plural(b.cartons, 'carton')} in total`);
  if (b.totalDeclaredValue !== before.totalDeclaredValue && b.totalDeclaredValue != null) changes.push(`declared value ${money_(b.totalDeclaredValue)}`);
  if (b.totalGrossWeightKg !== before.totalGrossWeightKg && b.totalGrossWeightKg != null) {
    const conv = state.meta.conversions[state.meta.conversions.length - 1];
    changes.push(`gross weight ${kg(b.totalGrossWeightKg)}${conv && conv.endsWith(kg(b.totalGrossWeightKg)) ? ` (${conv})` : ''}`);
  }
  if (b.deliveryAppointmentBooked !== before.deliveryAppointmentBooked && b.deliveryAppointmentBooked) {
    changes.push(b.deliveryAppointmentBooked === 'Yes' ? 'delivery appointment booked' : 'no delivery appointment yet');
  }
  return { changes, notes, routeChanged };
}

const money_ = money;

/** Contradictions between seller-stated totals and the items: ask, don't pick. */
function contradictions(ev: Evaluation): string[] {
  const firstSentence = (s: string) => `${s.split(/\.\s/)[0]}.`;
  return ev.findings
    .filter((f) => (f.ruleId === 'R-02' && ev.computed.declaredValue != null) || (f.ruleId === 'R-04' && ev.computed.cartons != null))
    .map((f) => `${firstSentence(f.message)} Which should I use?`);
}

export function composeReply(state: ChatState, ev: Evaluation, changes: string[], notes: string[], routeChanged: boolean, first = false): string {
  const lines: string[] = [];
  const langNote = notes.find((n) => n.startsWith('You wrote in'));
  if (langNote) lines.push(langNote);
  const otherNotes = notes.filter((n) => n !== langNote);
  if (changes.length) lines.push(`${first ? 'Got it' : 'Updated'}: ${changes.join('; ')}.`);
  lines.push(...otherNotes);
  if (routeChanged && state.booking.destinationCountry) {
    const n = ev.recommendation.eligible.length || ev.recommendation.excluded.length;
    lines.push(n
      ? `The route changed, so I've re-checked carriers. ${plural(ev.recommendation.eligible.length, 'carrier')} can take this load on the new lane. The rest of the booking is unchanged.`
      : 'The route changed, so carriers will be re-checked once the pallet count and weight are in.');
  }
  if (!changes.length && !otherNotes.length && !langNote) lines.push("I didn't catch any booking details in that.");

  const asks = contradictions(ev);
  const reds = ev.findings.filter((f) => f.severity === 'Red' && f.ruleId !== 'DATA');
  const ambers = ev.findings.filter((f) => f.severity === 'Amber');
  if (ev.complete) {
    const rec = ev.recommendation.recommended;
    if (rec) lines.push(`Recommended: ${rec.carrier} · ${rec.service}, ${money(rec.totalCost)}. ${ev.recommendation.reason}`);
    else lines.push(ev.recommendation.reason);
    lines.push(`Status: ${ev.status}.`);
    if (ev.status !== 'Ready') lines.push(`Next: ${ev.confirmation.nextSteps[0]}`);
    else lines.push('Everything checks out. Press Confirm booking when you are ready.');
    state.meta.pendingQuestion = null;
  } else {
    if (reds.length || ambers.length) {
      const parts = [reds.length ? `${reds.length} red (${[...new Set(reds.map((f) => f.ruleId))].join(', ')})` : '', ambers.length ? `${ambers.length} amber (${[...new Set(ambers.map((f) => f.ruleId))].join(', ')})` : ''].filter(Boolean);
      lines.push(`Checks so far: ${parts.join(', ')}. Details are in the checks panel.`);
    }
    const qs = [...asks, ...ev.missing.slice(0, asks.length ? 1 : 2).map((q) => q.text)];
    lines.push(...qs.slice(0, 2));
    state.meta.pendingQuestion = asks.length ? null : ev.missing[0]?.key ?? null;
  }
  return lines.join('\n\n');
}

/** One conversation turn without the model. */
export function fallbackTurn(state: ChatState, message: string, today: string, carriers: Carrier[]): TurnResult {
  const first = state.items.length === 0 && !state.booking.originCity && !state.booking.destinationCountry;
  const { changes, notes, routeChanged } = applyMessage(state, message, today);
  const evaluation = evaluate(state, today, carriers);
  const reply = composeReply(state, evaluation, changes, notes, routeChanged, first);
  return { state, reply, evaluation };
}

export { itemKey };
