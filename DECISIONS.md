# Decisions

Written for the judges who assess reasoning. Short, with the trade-offs.

## Rules are deterministic code; the LLM is only the conversation layer
Pass or fail is decided by `src/domain/rules.ts`, which is pure, unit tested and identical for chat and upload. The model extracts fields through tools (`update_booking`, `update_items`, `set_field`, `remove_item`), the server applies them and re-runs every check, and the results go back to the model to phrase. The model is never asked whether something passes. This keeps the checks auditable and stops a fluent answer from hiding a wrong number.

## Balanced weights and how to change them
Balanced ranks eligible carriers by a weighted score: cost 0.40, speed 0.30, reliability 0.30 (`config/scoring.json`). Each factor is min-max normalised across the eligible carriers, so 0 is the worst carrier on that factor and 1 the best. Cost and transit days are inverted because lower is better. The weights are a judgement: cost is weighted highest because most sellers said so when asked. To change them, edit `config/scoring.json`. The weights must sum to 1; the app refuses to start otherwise. Tie-breaks fall back to cost.

## The 1% tolerance is relative to the calculated sum
R-02 passes when `abs(declared − calculated) ≤ 0.01 × calculated`. Relative, not relative to the declared value, so the test is the same whichever figure a seller typed. Exactly 1% passes and 1.01% fails (covered by unit tests).

## Pallets zero and missing HS codes
- **Pallets 0 or blank:** R-05 cannot run, so it reports a Red finding asking for the count. The app never assumes a pallet count. Carriers are listed as "needs pallets" rather than ranked on a guess.
- **Missing HS code:** R-01 is Red and points to the UK Trade Tariff. The chat never guesses a code from a product name.

## Fallback and why it exists
The app must never break, and judges may run it without a key. With no `GEMINI_API_KEY`, or if a Gemini call fails, a rule-based slot-filler (regex and keyword matching in `src/chat/fallback.ts`) handles cities, countries, numbers, dates, priority and items, and writes through the same state functions. A failed Gemini call falls back for that turn and shows a notice. Both paths produce the same checks.

## What is out of scope and why (brief section 2)
- **No carrier bookings, labels, customs filing or HS lookup:** the brief excludes them, and a live lookup would invent authority the MVP doesn't have.
- **No payments, accounts or live FX:** currency is GBP only.
- **No storage:** chat state lives in the browser; uploads are processed in memory and discarded.
- **Only the UK → Germany, France and Netherlands lanes:** anything else is declined politely.

## Known limitations
- **Placeholder rate card:** the real template was not available. Only the Carrier A UK → Germany row is from the brief; the other carriers are placeholders marked DUMMY. Replace them with `npm run import-template -- <real.xlsx>`.
- **Grey example row:** the template's example row (row 3, grey) is skipped by detecting its fill colour. A sheet with no grey fill would have its first data row treated as data.
- **Gemini path:** tested with a scripted client, and once against the live API on the deployed site. Replies take about 40 to 55 seconds there.
- **Fallback scope:** the rule-based assistant reliably handles one or two facts per message. Long single messages with many items are not fully parsed, so the demo conversations need the Gemini assistant.
- **Dates:** "next Thursday" resolves to the next Thursday after today. The assistant always repeats the date back.
- **R-05 with several carriers:** the booking is not Red if at least one carrier can take the load. Carriers that can't are listed as excluded.

## Gemini instead of Anthropic (a change from the brief)
The brief asks for the Anthropic SDK and a Claude model. We use Google's Gemini API instead, at the team's direction, through `@google/genai` (pinned to 2.28.0, released 7 October 2026). The model is `gemini-3.5-flash-lite`, set by `GEMINI_MODEL`. Only `src/chat/llm.ts` calls the model. The rules, ranking, upload and UI are unchanged. The Anthropic version is kept in git history.

The model receives the same deterministic checks and returns them as function responses. It still never decides pass or fail.

**Timeouts.** Gemini calls are limited to 40 seconds (`httpOptions.timeout`) with no retries. If a call times out or fails, the rule-based assistant answers that turn and the UI shows a notice. The browser gives up after 60 seconds with a message to resend, so the page cannot hang on "Checking...". Thinking is set to MINIMAL, since the task is field extraction and needs little reasoning.

**Weekdays.** The model is told weekday names computed in code, and told to use only those, because it guessed one wrong in a live test.
