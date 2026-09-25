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
