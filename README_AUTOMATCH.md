# Image-Aware Hybrid Auto-Match Engine

## 1. Architectural Overview
The Auto-Match upgrade provides deterministic 1:1 matching for branded/specified BOQs and high-precision hybrid ranking for non-branded/generic BOQs.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Deterministic ExactMatch Short-Circuit (< 5ms)                           │
│    • Direct token/regex matching on brand, model, code, and direct URLs     │
│    • Bypasses LLM calls when verified in catalog or specification           │
│    • Emits tier: 'EXACT_MATCH' with 100% confidence                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. Hybrid Semantic Scoring Engine (< 40ms)                                  │
│    • finalScore = 0.60 * cosineSim + 0.25 * tokenScore + 0.15 * affinity    │
│    • Uses cached in-memory vector embeddings with background precomputation │
│    • Emits tier: 'HIGH_CONFIDENCE' (80-94%) or 'SUGGESTED' (60-79%)         │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. Spatial + OCR Image Pairing Verifier                                     │
│    • Matches document crop bounding boxes against row coordinates           │
│    • Cross-verifies OCR text tokens without sending raw binary image buffers│
│    • Emits pairingConfidence (0-100%) and persists in metadata.json         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Feature Flags (`.env` / `settings.json`)

| Feature Flag | Default | Description |
| :--- | :--- | :--- |
| `ENABLE_EXACT_MATCH_SHORTCIRCUIT` | `true` | Enables deterministic token and local catalog short-circuiting. |
| `ENABLE_HYBRID_SCORING` | `true` | Enables 3-factor hybrid semantic ranking ($\text{Vector} + \text{Token} + \text{Affinity}$). |
| `ENABLE_IMAGE_PAIRING_VERIFICATION` | `true` | Enables spatial + OCR image crop verification. |
| `ENABLE_STRICT_JSON_SCHEMA_VALIDATION` | `true` | Enforces server-side JSON schema validation and retry. |
| `ENABLE_PRECOMPUTED_EMBEDDING_WARMUP` | `true` | Pre-warms top contract brand vectors into memory on project load. |

---

## 3. Confidence Tiers & User Action Flow

* 🎯 **EXACT_MATCH (95–100%)**:
  - Deterministic 1:1 token & catalog verification.
  - Pre-approved for 1-click **⚡ Batch Accept ExactMatches**.
* ⚡ **HIGH_CONFIDENCE (80–94%)**:
  - Verified hybrid cosine + token match from approved contract catalog.
  - Single-click Accept in the UI.
* 💡 **SUGGESTED (60–79%)**:
  - Equivalent alternative. Requires review and confirmation.
* ⚠️ **LOW_CONFIDENCE / NOT_FOUND (<60%)**:
  - Automatically routed to the Human-in-the-Loop review queue.

---

## 4. Telemetry Metrics & Alerting Thresholds

```yaml
metrics:
  exact_match_shortcircuit_ratio: ">= 45.0%"
  hybrid_vector_p95_latency_ms: "<= 80 ms"
  llm_schema_validation_error_rate: "<= 1.5%"
  amazon_retail_mismatch_count: "0"
  user_single_click_accept_ratio: ">= 92.0%"

alerts:
  - alert: AutoMatchShortCircuitDegradation
    expr: exact_match_shortcircuit_ratio < 0.20
    severity: critical
    action: "Inspect regex token parser or catalog index availability."

  - alert: AmazonForbiddenBrandMatchDetected
    expr: amazon_retail_mismatch_count > 0
    severity: page
    action: "Commercial furniture matched to retail marketplace without direct URL."
```

---

## 5. Running Automated Unit Tests

```bash
node test/autoMatchSuite.test.js
```
