# BPMN Hybrid Decision Engine

> Deterministic business rules for what we know. Jev for what we need to judge.

A small full-stack app for editing BPMN processes and JDM decision tables, validating typed requests, and running processes. `order-discount`, `order`, and `loan-application` are **deterministic-only** examples; the `crm-customer` showcase combines ZEN rules with optional Jev assessment. Jev supplies signals, never an action. The stack is React/Vite, Fastify, `bpmn-engine`, and GoRules ZEN behind a `DecisionService` interface. [Hybrid decisions](docs/hybrid-decisions.md)

## Four roles

| Role | Question | Responsibility |
| --- | --- | --- |
| Rules (ZEN) | What do we know? | Derive hard facts from validated data. |
| Jev (optional) | What appears to be true? | Assess uncertain CRM signals. |
| Policy (ZEN) | What are we allowed to do? | Apply ordered, testable thresholds and choose an action. |
| BPMN | What happens next? | Execute the selected path. |

```text
Typed request → ZEN facts → Jev signals (optional) → ZEN policy → BPMN path
```

## Run locally

Prerequisite: Node.js 24 and npm. The API loads the optional root `.env` via Node's `--env-file-if-exists`. From this folder:

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173> and select **CRM showcase** in the top navigation. Choose a scenario, select **Rules only** or **Rules + Jev**, then use **Run** or **Compare**. The API listens at <http://127.0.0.1:3001>; Vite proxies browser `/api` requests to it.

For a keyless hybrid demo, copy the example configuration and set `JEV_MODE=mock` in `.env`. Mock answers are canned per fixture customer ID, display a **MOCK** badge, and ignore edited notes. For live Jev, set `JEV_MODE=live` and supply your own key locally (never commit or paste a real key into documentation):

```sh
cp .env.example .env
# Edit .env: JEV_MODE=mock
# Or, for live mode: JEV_MODE=live and JEV_API_KEY=<your-key>
```

Rules-only mode and `npm test` require no Jev key. With live mode and no key, a hybrid run records `JEV_UNAVAILABLE` and routes an otherwise active, non-delinquent customer to `HUMAN_REVIEW`; it never silently switches to mock. Payment and inactive-account rules have higher priority. Live Jev results may differ from canned mock outcomes. Jev is a user-approved, paid hosted API exception to the otherwise free/open-source stack. [Hybrid decisions](docs/hybrid-decisions.md)

`npm run dev` builds the decision package, then starts both development servers. Other commands:

```sh
npm test
npm run build
npm run test:live
```

`npm test` runs the decision-package and API tests without a live Jev call. `npm run build` builds the decision package, API, and web app. `npm run test:live` is opt-in: it checks a live Andes Retail answer shape when `JEV_API_KEY` is set, and skips otherwise.

## Layout and documentation

- `apps/web` — UI with process and decision editors, typed requests, and CRM showcase.
- `apps/api` — HTTP API, BPMN execution, and file storage in `apps/api/data/processes/*.bpmn`, `apps/api/data/decisions/*.json`, and typed contracts.
- `packages/decisions` — `DecisionService`, ZEN adapter, and Jev HTTP assessor/mock.
- `docs` — [architecture and API](docs/architecture.md), [stack decision](docs/adr/0001-stack-a-zen-bpmn-engine.md), [DMN portability guide](docs/dmn-portability.md), [typed request contracts](docs/request-contracts.md), [routing ADR](docs/adr/0002-typed-requests-and-routing.md), [hybrid decisions](docs/hybrid-decisions.md), and [hybrid ADR](docs/adr/0003-hybrid-decisions-jev.md).

The selected libraries are free/open source for this use: ZEN, its JDM editor, `bpmn-engine`, and `camunda-bpmn-moddle` are MIT licensed; `bpmn-js` uses the free bpmn.io license. **Keep the bpmn.io watermark visible and unobscured** in the modeler, as its license requires. [ZEN](https://github.com/gorules/zen/blob/master/README.md), [JDM editor](https://github.com/gorules/jdm-editor), [bpmn-engine](https://github.com/paed01/bpmn-engine/blob/master/LICENSE), [Camunda moddle](https://github.com/camunda/camunda-bpmn-moddle/blob/main/package.json), [bpmn.io license](https://bpmn.io/license/)
