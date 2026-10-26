# Demo

Three conversation prompts and one upload.

**Status of these prompts:** the conversation prompts were written for the Claude assistant and have not been run against the live API in this build (no key was available). The rule-based fallback has been checked only for the pallets-added scenario in `test/chat/scenario.test.ts` and for seller-name capture. With no key, send one fact per message; long single messages are not parsed in full by the fallback. The upload fixtures below are tested end to end.

## Conversation 1: clean booking, ends Ready
Send these in order:
1. `I need to send 1080 ceramic mugs from Manchester to Frankfurt, a warehouse, cheapest. Ready 5 Nov 2026.`
2. `Seller is Northfield Goods. MUG-01, HS 691200, 1080 units at £5 each, 12 per carton, 90 cartons, 0.5 kg each, made in UK.`
3. `That's all. Total is 620 kg and £5,400, the appointment is booked, and we have 3 pallets.`

Expected: the checks panel shows **Ready**, carrier **Carrier C · Groupage standard, £495** ("cheapest eligible option at £495 for 3 pallets, but it takes 7 days against 5 for the next option"), expected arrival **12 Nov 2026**. Confirm is enabled.

## Conversation 2: pallets omitted, then added, carrier list changes
1. `Glass tumblers from Leeds to Berlin, a warehouse, cheapest. Ready 29 Oct 2026. 300 tumblers at £4, 10 per carton, 30 cartons, 3 kg each, HS 701339, made in Vietnam. Gross weight 900 kg. Appointment booked. Seller is Glasshouse Goods.`

Expected: the assistant asks **how many pallets**, and the status is "needs pallets". Carriers are not ranked yet.

2. `add 2 pallets`

Expected: 900 kg across 2 pallets is 450 kg per pallet. **Carrier C (400 kg) is excluded**, and Carrier A and Carrier B remain. The recommendation is **Carrier A · Road economy, £360**. The status is **Ready**.

## Conversation 3: dangerous goods, ends Blocked
1. `Aerosol spray paint, 204 units, 12 per carton, 17 cartons, £3 each, HS 320910, from London to Hamburg, business address, ready 12 Nov 2026, 1 pallet, 90 kg gross, seller Paint Pro.`

Expected: **Blocked**. R-06 (Red) names "aerosol" and "spray" and the SKU SP-07. Confirm is disabled and the fix is to remove the item or change its description.

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
