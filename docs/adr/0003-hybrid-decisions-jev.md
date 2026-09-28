# ADR 0003: Jev signals, deterministic ZEN policy, BPMN action

**Status:** Accepted. **Source:** [Milestone 3 brief](../../BRIEF.md).

## Context

The CRM showcase must use customer facts and unstructured notes without letting a probabilistic assessment directly choose an operational action. The existing ZEN and BPMN stack already separates decisions from process execution. [Brief](../../BRIEF.md), [architecture](../architecture.md)

## Decision

Use four roles: ZEN Rules derive known facts; Jev assesses four signals; a separate ZEN Policy chooses `policy.nextAction` and `policy.rule`; BPMN performs the selected action. Jev never returns or triggers an action. The policy is an ordered, first-hit decision table with a conservative `HUMAN_REVIEW` default. The BPMN exclusive gateway uses JavaScript `conditionExpression` scripts on `policy.nextAction`; `NO_ACTION` takes its default flow. [Facts decision](../../apps/api/data/decisions/crm-customer-facts.json), [policy decision](../../apps/api/data/decisions/crm-policy.json), [BPMN process](../../apps/api/data/processes/crm-next-best-action.bpmn)

## Rationale

- **Signals before policy:** Jev's `noul`, `choice`, and `score` answers carry degrees of belief or confidence. Those outputs are evidence, not authorization. A deterministic ZEN table combines them with hard customer facts and decides what is allowed. BPMN then executes the chosen path. This makes automated actions explainable by a stable rule ID. [Jev questions](../../packages/decisions/src/jev/crm-questions.ts), [TypeSafe architecture guidance](https://docs.typesafe.ai/concepts/how-to-build-with-system-one), [TypeSafe API schema](https://docs.typesafe.ai/api)
- **First-hit policy:** Row order mirrors TypeSafe's confidence-gating `if`/`elif` cascade: hard overrides first, then sufficiently confident signals, then review or no action. Different risk levels justify different gates. After the upsell row and before low attention, `strategicAccount && salesDeclining` chooses `CREATE_ACCOUNT_FOLLOWUP` (`STRATEGIC_DECLINE_FOLLOWUP`). This deterministic floor means Jev can raise the response through an earlier row but cannot turn a strategic sales decline into `NO_ACTION` merely because it detects no semantic risk. Thresholds (`0.8`, `0.85`, `0.4`, `0.5`) live in one editable table, not in question prompts or service code. The output includes `policy.rule`; the returned trace records this as the second `ZEN` entry, and the UI labels it **POLICY**. The table is testable with injected Jev-shaped assessments, without a live API call. First-hit/simple tests also preserve the project's JDM portability constraints. [Policy table](../../apps/api/data/decisions/crm-policy.json), [CRM tests](../../apps/api/src/crm.test.ts), [TypeSafe confidence guidance](https://docs.typesafe.ai/confidence), [portability guide](../dmn-portability.md)
- **Pinned model:** The assessor defaults to `jev-1.13.0`, with an explicit `JEV_MODEL` override, because policy thresholds are tuned against a particular response distribution. The run log records the response's actual `model`; changing versions requires rechecking thresholds and regression fixtures. [Assessor](../../packages/decisions/src/jev/index.ts), [run log](../../apps/api/src/process.ts), [TypeSafe models](https://docs.typesafe.ai/models)
- **Fail closed:** A missing key, timeout, network/auth/rate-limit error, or unusable response yields `jev.status = "unavailable"`, never a silent mock result. For an otherwise active, non-delinquent hybrid request, the ordered policy sends this to `HUMAN_REVIEW` via `JEV_UNAVAILABLE`. The earlier payment and inactive-account hard rules retain priority. Rules-only skips Jev and remains usable without a key. `JEV_MODE=mock` is an explicit keyless demo mode with canned fixture-ID answers; it displays a MOCK badge and ignores edited notes. [Assessor](../../packages/decisions/src/jev/index.ts), [service](../../apps/api/src/services/index.ts), [mock](../../packages/decisions/src/jev/mock.ts), [CRM UI](../../apps/web/src/CrmShowcase.tsx)

## License and operational exception

Jev is a paid hosted API and is an explicit user-approved **optional exception** to the free/open-source-only rule. It is not required for Rules-only mode or `npm test`; `npm run test:live` is opt-in and skips when `JEV_API_KEY` is absent. The process/rule stack stays free and open source; credentials stay server-side and do not appear in returned traces or CRM run logs. [Brief](../../BRIEF.md), [live test](../../packages/decisions/src/jev/live.test.ts), [stack ADR](0001-stack-a-zen-bpmn-engine.md)

## Consequences

The policy table is the authoritative action boundary. Operators can inspect its matching rule and BPMN path, while tests cover policy branches without a paid API call. A live model upgrade is a deliberate change requiring policy calibration, not an unnoticed service update. Live outcomes may differ from the five canned mock scenarios. [Hybrid guide](../hybrid-decisions.md), [TypeSafe models](https://docs.typesafe.ai/models)
