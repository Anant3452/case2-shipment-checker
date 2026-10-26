// Carrier eligibility (lane + R-05) and ranking by seller priority.

import scoring from '../../config/scoring.json';
import { kg, money, num, plural } from './format';
import { laneCarriers, weightPerPallet } from './rules';
import { DESTINATIONS, type Booking, type Carrier, type Item, type SellerPriority } from './types';

export interface BalancedWeights {
  cost: number;
  speed: number;
  reliability: number;
}

export interface RankedCarrier extends Carrier {
  totalCost: number;
  /** Balanced score 0..1, only set for the Balanced priority. */
  score?: number;
}

export interface ExcludedCarrier {
  carrier: Carrier;
  reason: string;
}

export type RecommendationStatus =
  | 'recommended'      // at least one eligible carrier
  | 'needs-pallets'    // pallets missing or zero: R-05 cannot run
  | 'needs-weight'     // gross weight missing
  | 'needs-route'      // destination country missing
  | 'no-lane'          // no carrier serves this lane
  | 'none-eligible';   // every lane carrier fails R-05

export interface Recommendation {
  status: RecommendationStatus;
  priority: SellerPriority;
  /** True when the seller gave no priority and Balanced was used. */
  priorityDefaulted: boolean;
  weightPerPalletKg: number | null;
  /** Ranked best first. */
  eligible: RankedCarrier[];
  excluded: ExcludedCarrier[];
  recommended: RankedCarrier | null;
  /** Up to two runners-up. */
  alternatives: RankedCarrier[];
  /** Plain-English reason for the recommendation, or for why there is none. */
  reason: string;
  /** One line each. */
  alternativeLines: string[];
  excludedLines: string[];
}

export const DEFAULT_WEIGHTS: BalancedWeights = scoring.balancedWeights;

export function validateWeights(w: BalancedWeights): void {
  const sum = w.cost + w.speed + w.reliability;
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`Balanced weights must sum to 1, got ${sum}`);
  if ([w.cost, w.speed, w.reliability].some((x) => x < 0)) throw new Error('Balanced weights must not be negative');
}

export const carrierName = (c: Carrier) => `${c.carrier} · ${c.service}`;

/**
 * Balanced score: min-max normalise each factor across the eligible set to 0..1.
 * Cost and transit are inverted (lower is better). When every carrier has the same
 * value for a factor, that factor scores 1 for all of them (it cannot separate them).
 */
export function balancedScores(list: RankedCarrier[], w: BalancedWeights = DEFAULT_WEIGHTS): number[] {
  validateWeights(w);
  const norm = (vals: number[], higherIsBetter: boolean) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return vals.map((v) => (hi === lo ? 1 : higherIsBetter ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)));
  };
  const cost = norm(list.map((c) => c.totalCost), false);
  const speed = norm(list.map((c) => c.transitDays), false);
  const rel = norm(list.map((c) => c.onTimeRate), true);
  return list.map((_, i) => w.cost * cost[i] + w.speed * speed[i] + w.reliability * rel[i]);
}

/** Sort eligible carriers best first for a priority. Ties break on cost, then name. */
export function rankCarriers(list: RankedCarrier[], priority: SellerPriority, w: BalancedWeights = DEFAULT_WEIGHTS): RankedCarrier[] {
  let ranked = list.map((c) => ({ ...c }));
  if (priority === 'Balanced' && ranked.length > 0) {
    const scores = balancedScores(ranked, w);
    ranked = ranked.map((c, i) => ({ ...c, score: scores[i] }));
  }
  const byCost = (a: RankedCarrier, z: RankedCarrier) => a.totalCost - z.totalCost || carrierName(a).localeCompare(carrierName(z));
  const primary: Record<SellerPriority, (a: RankedCarrier, z: RankedCarrier) => number> = {
    Cheapest: () => 0,
    Fastest: (a, z) => a.transitDays - z.transitDays,
    'Most reliable': (a, z) => z.onTimeRate - a.onTimeRate,
    // Round so floating-point noise doesn't beat the cost tie-break.
    Balanced: (a, z) => Math.round(((z.score ?? 0) - (a.score ?? 0)) * 1e9),
  };
  return ranked.sort((a, z) => primary[priority](a, z) || byCost(a, z));
}

function summaryLine(c: RankedCarrier, pallets: number): string {
  return `${carrierName(c)}: ${money(c.totalCost)} for ${plural(pallets, 'pallet')}, ${plural(c.transitDays, 'day')}, ${num(c.onTimeRate)}% on time.`;
}

function reasonFor(priority: SellerPriority, ranked: RankedCarrier[], pallets: number): string {
  const [best, next] = ranked;
  const p = plural(pallets, 'pallet');
  if (ranked.length === 1) {
    return `${carrierName(best)} is the only eligible option for this route and weight: ${money(best.totalCost)} for ${p}, ${plural(best.transitDays, 'day')}, ${num(best.onTimeRate)}% on time.`;
  }
  const cheapest = [...ranked].sort((a, z) => a.totalCost - z.totalCost)[0];
  const fastest = [...ranked].sort((a, z) => a.transitDays - z.transitDays || a.totalCost - z.totalCost)[0];
  const premium = (c: RankedCarrier) => money(c.totalCost - cheapest.totalCost);

  switch (priority) {
    case 'Cheapest': {
      const head = `Cheapest eligible option at ${money(best.totalCost)} for ${p}`;
      if (best.transitDays > next.transitDays)
        return `${head}, but it takes ${plural(best.transitDays, 'day')} against ${num(next.transitDays)} for the next option (${money(next.totalCost)}).`;
      if (best.totalCost === next.totalCost)
        return `${head}. ${carrierName(next)} costs the same; this one wins on the tie-break.`;
      return `${head}, and no slower than the next option. It saves ${money(next.totalCost - best.totalCost)}.`;
    }
    case 'Fastest': {
      const head = `Fastest eligible option at ${plural(best.transitDays, 'day')}`;
      if (best.transitDays === next.transitDays)
        return `${head}, tied with ${carrierName(next)}, and cheaper at ${money(best.totalCost)}.`;
      if (best === cheapest) return `${head}, and also the cheapest at ${money(best.totalCost)}.`;
      return `${head}. It costs ${money(best.totalCost)}, ${premium(best)} more than the cheapest option, which takes ${plural(cheapest.transitDays, 'day')}.`;
    }
    case 'Most reliable': {
      const head = `Most reliable eligible option at ${num(best.onTimeRate)}% on time`;
      if (best.onTimeRate === next.onTimeRate)
        return `${head}, tied with ${carrierName(next)}, and cheaper at ${money(best.totalCost)}.`;
      if (best === cheapest) return `${head}, and also the cheapest at ${money(best.totalCost)}.`;
      return `${head}. It costs ${money(best.totalCost)}, ${premium(best)} more than the cheapest option (${num(cheapest.onTimeRate)}% on time).`;
    }
    case 'Balanced': {
      const head = `Best balance of cost, speed and reliability: ${money(best.totalCost)}, ${plural(best.transitDays, 'day')}, ${num(best.onTimeRate)}% on time.`;
      const trade: string[] = [];
      if (cheapest !== best) trade.push(`The cheapest option saves ${premium(best)} but takes ${plural(cheapest.transitDays, 'day')}`);
      else if (fastest !== best) trade.push(`The fastest option arrives in ${plural(fastest.transitDays, 'day')} but costs ${money(fastest.totalCost - best.totalCost)} more`);
      return trade.length ? `${head} ${trade[0]}.` : `${head} It is also the cheapest and fastest.`;
    }
  }
}

export function recommendCarriers(
  booking: Booking,
  _items: Item[],
  priority: SellerPriority | null,
  carriers: Carrier[],
  weights: BalancedWeights = DEFAULT_WEIGHTS,
): Recommendation {
  const prio: SellerPriority = priority ?? 'Balanced';
  const base: Recommendation = {
    status: 'recommended', priority: prio, priorityDefaulted: priority == null,
    weightPerPalletKg: null, eligible: [], excluded: [], recommended: null, alternatives: [],
    reason: '', alternativeLines: [], excludedLines: [],
  };
  const served = [...new Set(carriers.map((c) => `${c.originCountry} → ${c.destinationCountry}`))];

  if (!booking.destinationCountry) {
    return { ...base, status: 'needs-route', reason: 'Add the destination to see carrier options.' };
  }
  const lane = laneCarriers(booking, carriers);
  if (lane.length === 0) {
    return {
      ...base, status: 'no-lane',
      reason: `No carrier serves ${booking.originCountry ?? 'United Kingdom'} → ${booking.destinationCountry}. Served lanes: ${served.join(', ')}.`,
    };
  }
  const pallets = booking.pallets;
  if (pallets == null || pallets <= 0) {
    return {
      ...base, status: 'needs-pallets',
      reason: `${plural(lane.length, 'carrier')} serve this route. Add the pallet count to check weight limits and compare prices.`,
    };
  }
  const perPallet = weightPerPallet(booking);
  if (perPallet === null) {
    return { ...base, status: 'needs-weight', reason: 'Add the total gross weight to check carrier weight limits.' };
  }

  const eligible: RankedCarrier[] = [];
  const excluded: ExcludedCarrier[] = [];
  for (const c of lane) {
    if (perPallet <= c.maxWeightPerPalletKg + 1e-9) eligible.push({ ...c, totalCost: pallets * c.pricePerPallet });
    else excluded.push({
      carrier: c,
      reason: `Excluded: ${kg(booking.totalGrossWeightKg as number)} across ${plural(pallets, 'pallet')} is ${kg(Math.round(perPallet * 10) / 10)} per pallet, above this carrier's ${kg(c.maxWeightPerPalletKg)} limit.`,
    });
  }
  const excludedLines = excluded.map((e) => `${carrierName(e.carrier)}. ${e.reason}`);

  if (eligible.length === 0) {
    const highest = Math.max(...lane.map((c) => c.maxWeightPerPalletKg));
    const need = Math.ceil((booking.totalGrossWeightKg as number) / highest);
    return {
      ...base, status: 'none-eligible', weightPerPalletKg: perPallet, excluded, excludedLines,
      reason: `No carrier can take ${kg(Math.round(perPallet * 10) / 10)} per pallet on this route. `
        + `Limits: ${lane.map((c) => `${carrierName(c)} ${kg(c.maxWeightPerPalletKg)}`).join(', ')}. `
        + `Spread the load over at least ${plural(need, 'pallet')}, split the shipment, or correct the gross weight if it is wrong.`,
    };
  }

  const ranked = rankCarriers(eligible, prio, weights);
  const [recommended, ...rest] = ranked;
  const alternatives = rest.slice(0, 2);
  return {
    ...base, weightPerPalletKg: perPallet, eligible: ranked, excluded, excludedLines,
    recommended, alternatives,
    reason: reasonFor(prio, ranked, pallets)
      + (priority == null ? ' No priority was given, so this uses Balanced.' : ''),
    alternativeLines: alternatives.map((c) => summaryLine(c, pallets)),
  };
}

export function servedLanes(carriers: Carrier[]): string[] {
  return Object.keys(DESTINATIONS).filter((d) => carriers.some((c) => c.destinationCountry === d));
}
