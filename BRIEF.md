# BPMN + DMN app — orchestrator brief

Owner: orchestrator-bpmn (Claude, pane w3:p1). Agents: executor-bpmn (w3:p2) builds, docs-bpmn (w3:p3) documents.

## Hard rules
- Free / open-source only. No paid tiers, no commercial licenses (Camunda 8 is out).
- Everything stays inside `bpmn-dmn-app/`. Do not install globally or outside this folder.
- Keep the bpmn.io watermark visible (bpmn-js license requirement).

## Stack (A)
- Monorepo, npm workspaces, TypeScript everywhere.
- `apps/web` — React + Vite. `bpmn-js` modeler for processes, `@gorules/jdm-editor` for decisions.
- `apps/api` — Node + Fastify. `bpmn-engine` runs BPMN 2.0 XML; business rule tasks call ZEN.
- `packages/decisions` — the only package that imports `@gorules/zen-engine`, exposed through a
  `DecisionService` interface (`evaluate(decisionKey, input) -> output`). The rest of the app never
  imports ZEN directly, so it can be swapped for a standard DMN engine later.
- Storage: plain files under `apps/api/data/` (`processes/*.bpmn`, `decisions/*.json`). No DB yet.

## Staying portable to standard DMN (so we can migrate later)
- Decisions: use only Decision Table nodes (plus input/output nodes). No Function (JS) nodes,
  no custom expression nodes.
- Table cells: stick to simple comparisons, ranges, lists and literals — things that map 1:1 to
  FEEL unary tests. Avoid ZEN-only functions.
- BPMN links a business rule task to a decision by key (e.g. `camunda:decisionRef`-style attribute or
  an extension property), never by ZEN-specific structure.

## First milestone (walking skeleton)
Example "Order discount" flow, end to end:
1. Start → Business Rule Task "Determine discount" (decision `order-discount`) → Exclusive gateway
   (discount > 0?) → "Apply discount" / "No discount" → End.
2. API: list/get/save processes and decisions; `POST /processes/:id/start` with variables returns
   the final variables and the path taken.
3. Web: two pages — Process modeler (load/save .bpmn) and Decision editor (load/save JDM) — plus a
   "Run" panel that posts variables and shows the result.
4. `npm test` covers DecisionService and one full process run.

## Milestone 2 — typed requests: envelope + per-type contract + ZEN routing

Goal: a client sends one standard envelope. `type` selects a payload contract (strict JSON Schema);
a ZEN routing decision for that type evaluates the payload and picks which BPMN process runs.

### Envelope (fixed, strict — `additionalProperties: false`)
```json
{ "requestId": "string", "type": "order", "version": 1, "payload": { } }
```
- `requestId`: non-empty string; echoed back. `type`: model key format `^[a-z0-9][a-z0-9-]*$`.
- `version`: integer ≥ 1. `payload`: object, validated by the contract for `type` + `version`.

### Type registry (files, same store as today)
- `data/contracts/<type>/v<version>.json` — JSON Schema (draft 2020-12 or 07) for `payload`.
  Contracts are strict: `additionalProperties: false`, explicit `required`, types, enums, min/max.
- `data/decisions/route-<type>.json` — JDM routing decision. Input = payload fields; output must be
  `{ "processKey": "<process id>" }` (may also return extra variables, merged into process vars).
  Same portability rules as other decisions (decision tables only, first-hit).
- `data/processes/<processKey>.bpmn` — the flows. Any process may still call other decisions via
  business rule tasks.

### API
- `POST /requests` → validate envelope → load contract (unknown type/version → 400 `UNKNOWN_CONTRACT`)
  → validate payload (→ 400 `CONTRACT_VIOLATION` with a list of `{ path, message }`)
  → evaluate `route-<type>` → start `processKey` with variables = payload
  (+ `request: { requestId, type, version }`). Route returning no/unknown processKey → 500
  `ROUTING_ERROR` (it is a configuration bug, not a client error).
- Response: `{ requestId, type, version, processKey, variables, path }`.
- `GET /contracts`, `GET /contracts/:type/:version` — read-only for now.

### Service tasks
Replace the hard-coded `applyDiscount` with a small service registry (`apps/api/src/services/`),
so each process references `${environment.services.<name>}` and new flows only add a handler.

### Example types (placeholders until the user supplies real contracts)
1. `order` v1 — payload `{ customerTier: "gold"|"silver"|"bronze", orderTotal: number ≥ 0, country: 2-letter }`.
   `route-order`: orderTotal ≥ 1000 → `high-value-order`; otherwise → `order-discount` (existing).
   `high-value-order`: business rule task (reuse `order-discount` decision) → service "flagForReview" → end.
2. `loan-application` v1 — payload `{ applicantAge: integer 18–100, monthlyIncome: number > 0,
   amount: number > 0, termMonths: 12|24|36|48 }`.
   `route-loan-application` (first hit, plain comparisons only):
   applicantAge < 21 → `loan-manual-review`; amount > 50000 → `loan-manual-review`;
   otherwise → `loan-auto-approve`. No derived fields (e.g. amount/income ratio) in this
   milestone — computed inputs are a later decision. Both processes: one service task each.

### Web
New "Send request" page: envelope JSON editor with a type selector that pre-fills an example
payload from the contract, Send button, and a result view (processKey chosen, path, variables,
or the contract violation list).

## Milestone 3 — Hybrid decisions: ZEN rules + Jev signals + ZEN policy → BPMN (branch `feature/jev-hybrid`)

Principle (the lesson of the demo — keep it visible everywhere):
Rules = "what do we know?" · Jev = "what appears to be true?" · Policy = "what are we allowed to do?" · BPMN = "what happens next?"
Jev returns signals/probabilities, never actions. A deterministic policy decides. The order-discount /
order / loan examples stay untouched as the deterministic-only examples.

Exception to "free only" approved by the user: Jev (TypeSafe, paid hosted API) as an OPTIONAL add-on.
Everything must still work without a key (Rules-only mode, and every test).

### Jev HTTP API (from docs.typesafe.ai, read 2026-09-27 — use this, not third-party blogs)
- `POST https://api.typesafe.ai/v1/systemone`, headers `Authorization: Bearer $JEV_API_KEY`, `Content-Type: application/json`.
- Body: `{ model, state, questions }`. `state`: string | object | array. `questions`: map id → question.
  Question ids are NOT sent to the model — instructions must carry the full meaning. Reference state with
  backticked paths like `notes[0]`.
  - noul: `{ type:"noul", instructions, criteria?: { true: "...", false: "..." } }`
  - choice: `{ type:"choice", instructions, criteria: { OPTION: "description" | null, ... } }` (max 255)
  - score: `{ type:"score", instructions, criteria: ["level 0 description", ..., ] }` (2–10 levels, 0-based)
- Response: `{ model: "jev-1.13.0", answers: { id: ... }, usage: { input_tokens, output_tokens } }`
  - noul: `{ type:"noul", noul: 0..1 }` (no confidence; ~0.5 means uncertain, not "medium")
  - choice: `{ type:"choice", choice, probabilities: {OPTION: p}, confidence }`
  - score: `{ type:"score", score: weighted position 0..n-1, legend: {"0":"..."}, probabilities: {"0":p}, confidence }`
- Errors: 401 bad key, 422 validation, 429 rate limit, 529 overloaded (retry 429/529 once, honour
  `retry-after` up to 2s). Timeout: 8s via AbortSignal.
- Model: pin `jev-1.13.0` (docs: pin the version once thresholds are tuned against it); override with
  `JEV_MODEL`. Log the `model` field from the response.
- Use plain `fetch` (thin client). Do NOT add the TypeSafe SDK.

### Config / secrets
- Root `.env` (gitignored) + committed `.env.example`: `JEV_API_KEY=`, `JEV_MODEL=jev-1.13.0`, `JEV_MODE=live`.
- API dev/start load it with Node's `--env-file-if-exists` (Node 24; no dotenv dependency).
- `JEV_MODE=mock` = canned answers per fixture customer id, response marked `source:"mock"` and the UI
  shows a MOCK badge. Mock is opt-in only; never fall back to mock silently.
- Never log or return the key or the Authorization header.

### Code layout (extend, don't refactor)
- `packages/decisions/src/jev/`: `client.ts` (fetch, timeout, errors → typed `JevError` kinds:
  `missing-key | auth | timeout | network | rate-limit | bad-response | http`), `types.ts`,
  `mapping.ts` (raw answers → domain), `crm-questions.ts` (the 4 questions — wording lives here),
  `mock.ts`. Export `createJevAssessor(config, fetchImpl?)` returning
  `assessCustomer(state) => Promise<JevAssessment>` that NEVER throws: failures become
  `{ status:"unavailable", errorKind, message }`.
- `JevAssessment` (flat, so ZEN tables can read it):
  `{ status:"ok"|"unavailable"|"skipped", source:"live"|"mock"|null, model, elapsedMs,
     needsAttention, switchingRisk, objective, objectiveProbability, objectiveConfidence,
     relationshipRisk (score), relationshipLevel ("LOW".."CRITICAL", nearest level), relationshipConfidence,
     errorKind?, message? }`
- `apps/api/src/services/`: `createServiceRegistry(decisions, variables, deps)` gains `assessWithJev`
  (skips with status "skipped" when `mode === "rules-only"`) and `recordCrmAction`. Wire the assessor in
  `buildApp` (injectable for tests).
- Each step appends to a `trace` variable: `{ step:"ZEN"|"JEV"|"POLICY"|"BPMN", ... }`.
- Server log one structured line per CRM run: model, question ids, answers, probabilities, confidence,
  elapsedMs, policyRule, nextAction, BPMN path. No state/notes text, no key.

### Questions (one Jev request, shared state = the customer payload minus `mode`)
- `needs_commercial_attention` noul — "Does this account currently require proactive commercial attention?"
- `switching_risk` noul — "Is there meaningful evidence that this customer may switch suppliers?"
- `commercial_objective` choice — RETENTION | UPSELL | COLLECTION | NORMAL_FOLLOWUP | OTHER (with descriptions;
  OTHER = none of these fit).
- `relationship_risk` score — 4 concrete levels LOW, MEDIUM, HIGH, CRITICAL (each a standalone description).
Thresholds are NOT in the prompts.

### Request type `crm-customer` v1 (reuse milestone 2 flow)
- Contract `data/contracts/crm-customer/v1.json` (strict): `mode: "rules-only"|"hybrid"`, `customer {id, name,
  segment A|B|C, annualRevenue ≥0, active}`, `sales {trend90Days, daysSinceLastOrder}`,
  `payments {overdueInvoices ≥0, overdueAmount ≥0}`, `activity {daysSinceLastVisit}`,
  `notes: string[] (max 10, each ≤ 1000 chars)`.
- `route-crm-customer` → `crm-next-best-action` (one row).
- Fixtures `data/fixtures/crm-customer.json`: `[{id, title, description, payload}]` for: healthy, churn/switching
  risk (the brief's Andes Retail), upsell opportunity, payment issue, ambiguous. Served by
  `GET /fixtures/:type`.

### Decisions (portable: decision tables, first-hit, simple unary tests — must pass validatePortableDecision)
- `crm-customer-facts`: one JDM graph with 4 small tables (one fact each, default row false):
  strategicAccount (segment A or annualRevenue ≥ 250000), salesDeclining (trend90Days < -20),
  visitOverdue (daysSinceLastVisit > 30), paymentProblem (overdueInvoices > 0). Outputs `facts.*`.
- `crm-policy` (first-hit, ordered like the TypeSafe confidence-gating example; thresholds live ONLY here):
  1 paymentProblem → COLLECTION_FOLLOWUP / PAYMENT_DELINQUENCY
  2 active = false → NO_ACTION / INACTIVE_ACCOUNT
  3 mode rules-only & strategic & salesDeclining → HUMAN_REVIEW / RULES_ONLY_RISK_UNCLEAR
  4 mode rules-only → NO_ACTION / RULES_ONLY_NO_SIGNAL
  5 jev.status "unavailable" → HUMAN_REVIEW / JEV_UNAVAILABLE
  6 strategic & switchingRisk ≥ 0.8 & needsAttention ≥ 0.85 → CREATE_RETENTION_VISIT / RETENTION_STRATEGIC_ACCOUNT
  7 switchingRisk ≥ 0.4 → HUMAN_REVIEW / AMBIGUOUS_SWITCHING_RISK
  8 objective UPSELL & objectiveProbability ≥ 0.8 & objectiveConfidence ≥ 0.5 → CREATE_UPSELL_FOLLOWUP / UPSELL_CONFIDENT
  9 strategic & salesDeclining → CREATE_ACCOUNT_FOLLOWUP / STRATEGIC_DECLINE_FOLLOWUP
  10 needsAttention < 0.5 → NO_ACTION / NO_ATTENTION_NEEDED
  11 default → HUMAN_REVIEW / NO_POLICY_MATCH (conservative)
  Outputs `policy.nextAction`, `policy.rule`.

### BPMN `crm-next-best-action`
Start → Business rule "Derive customer facts" (crm-customer-facts) → Service "Assess with Jev" →
Business rule "Apply policy" (crm-policy) → Exclusive gateway on `policy.nextAction` →
No action | Human review | Retention visit | Upsell follow-up | Account follow-up | Collection follow-up (service `recordCrmAction`) → End.
Laid out cleanly in the modeler (DI present).

### Web — "CRM showcase" page
Scenario picker (from /fixtures), mode switch (Rules only / Rules + Jev) and a "Compare" view that runs both.
Four panels: 1 Customer state (notes editable for every scenario), 2 Business rules (✓/✕), 3 Jev assessment
(probability bars, objective + confidence, relationship level + score; banner when unavailable/skipped/mock;
caption "signals, not guarantees"), 4 Decision trace (ZEN → JEV → POLICY rule → BPMN path + action).

### Tests (no live API in CI)
- Mapping from recorded/mocked HTTP responses; each failure kind (missing key, 401, timeout, network, bad JSON/shape).
- Policy table: retention, ambiguous → HUMAN_REVIEW, upsell, payment → COLLECTION, Jev unavailable → HUMAN_REVIEW,
  rules-only cases.
- Full process run via POST /requests with an injected fake assessor.
- Optional live test `npm run test:live` (skipped unless JEV_API_KEY set).
