// Runtime config: the I/O side of the app. The domain module never reads the clock or files.

import appConfig from '../config/app.json';
import carriersFile from '../data/carriers.json';
import type { Carrier } from './domain';

export const carriers: Carrier[] = carriersFile.carriers;
export const carrierSource = carriersFile.source;

/** Today's date (YYYY-MM-DD) in the configured time zone, or the TODAY env / todayOverride. */
export function today(now: Date = new Date()): string {
  const override = process.env.TODAY || appConfig.todayOverride;
  if (override) return override;
  return new Intl.DateTimeFormat('en-CA', { timeZone: appConfig.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
