# BPMN + Decisions

A small full-stack app for editing BPMN processes and JDM decision tables, then running a process that evaluates a decision at a business rule task. The included `order-discount` example exercises both gateway paths. The stack is React/Vite, Fastify, `bpmn-engine`, and GoRules ZEN behind a `DecisionService` interface.

## Run locally

Prerequisite: Node.js 20.19+ or 22.12+ and npm ([Vite 7 requirement](https://v7.vite.dev/guide/migration)). From this folder:

```sh
npm install
npm run dev
```

Open the web app at <http://127.0.0.1:5173>. The API listens at <http://127.0.0.1:3001>; Vite proxies browser `/api` requests to it. `npm run dev` builds the decision package, then starts both development servers. Other commands:

```sh
npm test
npm run build
```

`npm test` runs the decision-package and API tests. `npm run build` builds the decision package, API, and web app.

## Layout and documentation

- `apps/web` — UI with process and decision editors and a Run panel.
- `apps/api` — HTTP API, BPMN execution, and file storage in `data/processes/*.bpmn` and `data/decisions/*.json`.
- `packages/decisions` — `DecisionService` and ZEN adapter.
- `docs` — [architecture and API](docs/architecture.md), [stack decision](docs/adr/0001-stack-a-zen-bpmn-engine.md), [DMN portability guide](docs/dmn-portability.md), [typed request contracts](docs/request-contracts.md), and [routing ADR](docs/adr/0002-typed-requests-and-routing.md).

The selected libraries are free/open source for this use: ZEN, its JDM editor, `bpmn-engine`, and `camunda-bpmn-moddle` are MIT licensed; `bpmn-js` uses the free bpmn.io license. **Keep the bpmn.io watermark visible and unobscured** in the modeler, as its license requires. [ZEN](https://github.com/gorules/zen/blob/master/README.md), [JDM editor](https://github.com/gorules/jdm-editor), [bpmn-engine](https://github.com/paed01/bpmn-engine/blob/master/LICENSE), [Camunda moddle](https://github.com/camunda/camunda-bpmn-moddle/blob/main/package.json), [bpmn.io license](https://bpmn.io/license/)
