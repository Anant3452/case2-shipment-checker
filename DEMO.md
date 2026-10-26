# Demo

Three conversation prompts and one upload.

**Status of these prompts:** the conversations were run against the deployed site with Gemini on 26 October 2026. Each reply takes about 40 to 60 seconds. Results are shown as observed. The rule-based fallback handles one or two facts per message, so send one fact per message if Gemini is unavailable. The upload fixtures below are tested end to end.

## Conversation 1: clean booking, ends Ready
Live run on the deployed site, three turns:

1. `I need to send 1080 ceramic mugs from Manchester to Frankfurt, a warehouse, cheapest. Ready 5 Nov 2026.`
   Result: status **Blocked** (details still missing). The assistant confirms the route, the warehouse, cheapest and the date, then asks for the HS code and the unit price.
2. `Seller is Northfield Goods. MUG-01, HS 691200, 1080 units at £5 each, 12 per carton, 90 cartons, 0.5 kg each, made in UK.`
   Result: still **Blocked**. The assistant asks for the carton count and the pallet count.
3. `That's all. Total is 620 kg and £5,400, the appointment is booked, and we have 3 pallets.`
   Result: **Ready**. Recommended **Carrier C · Groupage standard, £495**, 3 pallets, 7 days, 85% on time, expected arrival **12 Nov 2026**. The assistant asks whether to confirm.

Confirm is enabled at the end.

## Conversation 2: pallets omitted, then added, carrier list changes
Live run on the deployed site, two turns:

1. `Glass tumblers from Leeds to Berlin, a warehouse, cheapest. Ready 29 Oct 2026. 300 tumblers at £4, 10 per carton, 30 cartons, 3 kg each, HS 701339, made in Vietnam. Gross weight 900 kg. Appointment booked. Seller is Glasshouse Goods.`
   Result: status **Blocked**. The assistant asks for the pallet count and whether the item totals (30 cartons, £1,200) are the booking totals. No carrier is ranked yet, because pallets are missing.

2. `add 2 pallets`
   Result: **Ready**. 900 kg across 2 pallets is 450 kg each. **Carrier A · Road economy, £360**, 5 days, 92% on time, expected arrival **3 Nov 2026**. The assistant asks whether to confirm.

Carrier C (400 kg per pallet) is excluded at 450 kg per pallet. The live reply does not list exclusions, so this is checked by the scenario test (`test/chat/scenario.test.ts`), not in the live run.

## Conversation 3: dangerous goods, ends Blocked
Live run on the deployed site, one turn:

1. `Aerosol spray paint, 204 units, 12 per carton, 17 cartons, £3 each, HS 320910, from London to Hamburg, business address, ready 12 Nov 2026, 1 pallet, 90 kg gross, seller Paint Pro.`
   Result: **Blocked**. R-06 (Red) names "aerosol", "spray" and "paint". The message contains no SKU, so the finding names the description. Confirm is disabled.

## Upload: planted-error fixture, with expected statuses
Upload `test/fixtures/planted-errors-bookings.xlsx` and `test/fixtures/planted-errors-items.xlsx` on the **Upload sheets** tab.

| Booking | Status | Rules |
|---|---|---|
| BK-101 | Blocked | R-01 (HS 6912), R-08 |
| BK-102 | Blocked | R-02 (2% off) |
| BK-103 | Blocked | R-03 |
| BK-104 | Blocked | R-04 |
| BK-105 | Ready | none. Carrier C excluded for 450 kg per pallet; A and B pass |
| BK-106 | Blocked | R-05 (pallets 0) |
| BK-107 | Blocked | R-06 (aerosol) |
| BK-108 | Ready with warnings | R-07 |
| BK-109 | Ready with warnings | R-09, R-10 |
| BK-110 | Blocked | R-02 (no items) |
| BK-111 | Blocked | DATA: the quantity cell reads "lots" (Items!E13) |

Sheet problems: `BK-999` on Items row 14 matches no booking. The same list shows that BK-110 has no items.
