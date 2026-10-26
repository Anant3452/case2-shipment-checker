// Shapes returned by the API. Kept separate from the server code so the UI bundle stays small.

export interface Finding {
  ruleId: string;
  severity: 'Red' | 'Amber';
  message: string;
  fix: string;
  cells?: string[];
}

export interface Recommendation {
  status: string;
  reason: string;
  recommended: { carrier: string; service: string; totalCost: number; transitDays: number; onTimeRate: number } | null;
  alternativeLines: string[];
  excludedLines: string[];
  priorityDefaulted: boolean;
}

export interface Evaluation {
  findings: Finding[];
  status: 'Blocked' | 'Ready with warnings' | 'Ready';
  recommendation: Recommendation;
  confirmation: { text: string; nextSteps: string[]; expectedArrival: string | null };
  missing: { key: string; text: string }[];
  complete: boolean;
}

export interface ChatResponse {
  state: unknown;
  reply: string;
  evaluation: Evaluation;
  engine: 'gemini' | 'fallback';
  notice?: string;
}

export interface BookingResult {
  bookingId: string;
  bookingRow: number | null;
  status: Evaluation['status'];
  findings: Finding[];
  recommendation: Recommendation;
  confirmation: { text: string; nextSteps: string[]; expectedArrival: string | null };
  itemCount: number;
}

export interface UploadReport {
  summary: { bookings: number; blocked: number; withWarnings: number; ready: number; itemRows: number };
  results: BookingResult[];
  errors: { sheet: string; cell: string | null; message: string }[];
  notes: string[];
}
