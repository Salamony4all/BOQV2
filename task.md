# BOQFLOW — Task List

Last Updated: 2026-04-03

---

## ✅ Completed This Session

- `[x]` **Tier Isolation** — Backend enforces strict tier filtering per request; Ottimo→Budgetary, NARBUTAS→Mid, Arper→High
- `[x]` **Universal Tier Seeding** — All 3 tiers seeded simultaneously from BOQ on AI AUTO-FILL trigger
- `[x]` **Row-First Sequential Processing** — `executeAutoFillAI` now processes rows 1→2→3 in order, firing all tiers per row in parallel
- `[x]` **30-Second Fetch Timeout** — AbortController prevents stuck/frozen AI processing state
- `[x]` **Fixed `isHeader()` False Positives** — Removed ALL-CAPS heuristic that was silently skipping real BOQ rows (STAFF CHAIR, DIRECTOR CHAIR, etc.)
- `[x]` **Enriched AI Description** — `qty` + `unit` appended to BOQ description before AI Stage 1 call (e.g., `"OFFICE COFFEE TABLE R:30 | Qty: 2 Unit: Nos"`)
- `[x]` **Unified Progress Counter** — Button shows `⏳ AI Processing (X/Y)` with single counter across all tiers
- `[x]` **Image Validation** — AI-discovered products with invalid/relative imageUrls fall back to brand logo
- `[x]` **tierDataRef** — `useRef` synced via `useEffect` to ensure async functions always read latest React state
- `[x]` **Discovery Persistence** — Newly discovered models (EIRA, OPTIMA, KOPA, Oxo Workstation) permanently saved to brand JSON files

---

## 🔲 Pending — Next Session

### High Priority
- `[ ]` **Full-Scale Batch Test** — Run AI AUTO-FILL on a 30+ row BOQ, verify:
  - All rows process top-to-bottom in sequence (no skips, no random order)
  - Budgetary, Mid, High tabs all populate correctly
  - Comparison View shows all 3 tiers populated
  - No stuck/frozen state at any row
- `[ ]` **Coffee Table Category Fix** — Add `Lounge Tables` / `Coffee Tables` subcategory to NARBUTAS DB so coffee table BOQ items don't match as "Meeting Tables"
- `[ ]` **Export Validation** — Confirm `brandLogo` and `brandImage` fields from AI-matched rows render correctly in PDF/PPTX/Excel exports

### Medium Priority
- `[ ]` **Retry Button Fix** — `handleRetryRow` currently only resets `aiStatus` but doesn't re-trigger the AI. Wire it up to re-run `executeAutoFillAI` for a single row.
- `[ ]` **Manual URL Override** — Add an input field in `MultiBudgetModal` for manual product URL override when AI discovery fails
- `[ ]` **Persistent AI Log** — Write AI match history to `server/logs/ai_matches.json` for auditing (brand, model, description, status, timestamp)

### Low Priority
- `[ ]` **CSS Lint Cleanup** — Remove deprecated `-webkit-overflow-scrolling` and add `scrollbar-width`/`scrollbar-color` vendor prefixes or feature queries
- `[ ]` **Duplicate `app.listen`** — Remove the second `app.listen(3001)` call in `server.js` (harmless but messy)
