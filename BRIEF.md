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
