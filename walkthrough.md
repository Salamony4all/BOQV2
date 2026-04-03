# BOQFLOW – AI Autofill Pipeline Walkthrough

Last Updated: 2026-04-03 (Session: Hardening Tier-Aware AI Autofill)

---

## What Was Built

This session completed the hardening of the AI Autofill feature in `MultiBudgetModal.jsx`, transforming it into a **row-sequential, tier-parallel, fault-tolerant procurement engine**.

---

## Key Changes This Session

### 1. `MultiBudgetModal.jsx` — Core AI Engine Rewrite

#### Row-First Sequential Processing
The central logic of `executeAutoFillAI` was refactored from a **tier-first parallel loop** to a **row-first sequential loop**:

```
OLD: Tier A processes all rows simultaneously
     Tier B processes all rows simultaneously  ← random UI order, prone to stuck state
     Tier C processes all rows simultaneously

NEW: Row 1 → fire Tier A + B + C in parallel → wait → Row 1 done ✓
     Row 2 → fire Tier A + B + C in parallel → wait → Row 2 done ✓
     Row 3 → ...                                                      ← clean sequence
```

This gives **top-to-bottom sequential visual feedback** while maintaining parallel speed (3 tiers per row simultaneously).

#### 30-Second Fetch Timeout (AbortController)
Every AI fetch call now has a `30s AbortController` timeout. If the AI API hangs, the row is marked `aiStatus: 'error'` with message `"Timeout (30s)"` and processing continues — **never freezes again**.

#### Enriched Description Sent to AI
`qty` and `unit` from each BOQ row are now sent to the backend and prepended to the description:
```
"OFFICE COFFEE TABLE R:30 | Qty: 2 Unit: Nos"
```
This gives the AI size context to prevent coffee tables being matched as meeting tables.

#### Fixed `isHeader()` — Removed Overly Aggressive ALL-CAPS Rule
Previous version caught ALL-CAPS short strings as "section headers", silently skipping real BOQ items like:
- `STAFF CHAIR`, `DIRECTOR CHAIR`, `GENERAL MEETING ROOM CHAIR`

New logic only catches:
1. Exact column keyword labels (`description`, `description and area`, `qty`, `unit`, etc.)
2. Explicit `HEAD OF / GROUP OF / SECTION OF` prefix patterns

#### Universal All-Tier Seeding
`handleAutoFillAI` seeds **all 3 tiers** (Budgetary, Mid, High) from the BOQ on first run. Previously only the active tab was seeded. The `tierDataRef` (a `useRef` synced via `useEffect`) ensures the async `executeAutoFillAI` always reads the latest seeded rows regardless of React state batching.

#### Unified Progress Counter
The button now shows `⏳ AI Processing (12/38)` using `aiProgress.current` / `aiProgress.total` — a single unified counter tracking rows processed across all tiers.

---

### 2. `server.js` — Enriched Description + Strict Tier Isolation

- **`qty` + `unit`** are now read from the request body
- An `enrichedDescription` is built: `"ORIGINAL DESC | Qty: X Unit: Y"` and passed to `identifyModel()` in Stage 1
- **Tier isolation** is enforced: even if the client sends brands from multiple tiers, the backend only allows brands whose `budgetTier` in the DB matches the requested tier

---

### 3. `llmUtils.js` — Hardened Discovery Prompts

- AI discovery prompt explicitly demands **direct CDN image URLs** (no relative paths, no placeholder images)
- Invalid or relative `imageUrl` values from AI are rejected server-side with fallback to brand logo

---

## Tier Configuration (Brand → Tier Mapping)

| Brand | Tier | Tab |
|---|---|---|
| Ottimo Furniture | Budgetary | 💰 Budgetary |
| NARBUTAS | Mid | ⭐ Mid-Range |
| Arper | High | 💎 High-End |

Brands are strictly isolated — the backend blocks cross-tier contamination even if the client sends mixed brand arrays.

---

## Verified Discovered Products (Saved to DB)

| Brand | Model | Category | Source |
|---|---|---|---|
| NARBUTAS | EIRA | Task Chairs | AI-Specialist-Discovery |
| NARBUTAS | OPTIMA | Office Furniture System | AI-Specialist-Discovery |
| NARBUTAS | KOPA | Lounge & Soft Seating | AI-Specialist-Discovery |
| Ottimo Furniture | Oxo Workstation | Workstations | AI-Specialist-Discovery |

---

## Known Open Issues for Next Session

> [!WARNING]
> **Coffee Table → Meeting Table mismatch**: NARBUTAS "Forum" series is categorized as "Meeting Tables" in the DB even though it's used for both. The AI now receives size context (`R:30 = 30cm`) but if NARBUTAS has no dedicated "coffee table" category, the match will stay as Meeting Tables. Consider adding a "Lounge Tables / Coffee Tables" subcategory to the NARBUTAS DB.

> [!NOTE]
> **Minor CSS lint warnings** (non-breaking): `scrollbar-width`, `scrollbar-color` in `MultiBudgetModal.module.css` and `AutoFillSelectModal.module.css` have Safari/older Chrome compatibility warnings. Safe to ignore for now.

> [!TIP]
> **Next steps to validate**: Run a full BOQ (30+ rows), verify all rows process in sequence top-to-bottom, verify Comparison View populates all 3 tiers correctly, verify newly discovered models appear in the brand DB JSON files.
