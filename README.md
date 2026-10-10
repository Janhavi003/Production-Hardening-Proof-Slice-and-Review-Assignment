# PromptPilot — Circuit Breaker Proof Slice

This repository implements Option B of the Production Hardening Proof Slice and Review assignment: a circuit breaker around PromptPilot's external model provider.

## Risk addressed

When the model provider is slow or failing, repeated requests can pile up and amplify an outage. Repeated provider failures can also make the support-reply workflow unavailable.

## Chosen control

`src/circuitBreaker.js` implements a circuit breaker with `CLOSED`, `OPEN`, and `HALF_OPEN` states. It opens when the failure ratio reaches the configured threshold after the minimum request volume, rejects calls during the open window, and permits one recovery probe after that window. `src/replyService.js` uses a safe fallback when the provider fails or the circuit is open.

Defaults: `failureThreshold: 0.5`, `minimumRequests: 5`, and `openMillis: 30000`. These can be overridden when calling `createCircuitBreaker` or `createReplyService`.

## How to run / test

Prerequisite: Node.js 18 or newer. No third-party packages are required.

```bash
cd Production-Hardening-Proof-Slice-and-Review-Assignment
node --version
node --test
```

Expected result: all tests pass, with a final summary showing zero failures.

To run only the circuit-breaker tests:

```bash
node --test test/circuitBreaker.test.js
```

## Evidence

The automated tests prove that the breaker:
- stays closed below `minimumRequests`;
- opens when the failure ratio reaches the threshold at sufficient volume;
- rejects calls while open without invoking the provider;
- transitions to `HALF_OPEN` after the open window and closes after a successful probe;
- reopens after a failed probe; and
- reports transitions through `onStateChange`.

The reply-service tests also prove that an open circuit returns the configured safe fallback. Reproduce the evidence with `node --test`.

## Observability note

The breaker exposes `breaker_open_total`, `short_circuited_total`, `success_total`, and `failure_total`. The optional `onStateChange(state)` callback is invoked on each state transition (`OPEN`, `HALF_OPEN`, and `CLOSED`), so the host service can emit structured logs or connect the counters to its metrics backend. The callback is isolated so a logging failure cannot break the protected request path. Do not log secrets, tokens, full prompts, or personal data.

## Trade-offs and design implications

This circuit breaker improves failure isolation, but it introduces deliberate costs and limitations:

- **In-memory state is fast but temporary.** The counters and breaker state live only in this Node.js process. They add little latency and need no database or external service, but all counts reset on process restart or redeployment. As a result, dashboards based only on these counters lose continuity, and the breaker starts with a fresh view of provider health after a restart. A restart during an outage can therefore briefly allow requests through before the failure threshold is reached again.
- **Each application instance makes its own decision.** With multiple replicas, one instance can be `OPEN` while another remains `CLOSED`; the counters are not shared or aggregated by this implementation. Some requests may still reach an unhealthy provider through other instances. For a larger deployment, export metrics to a monitoring backend and decide whether per-instance breakers are sufficient or whether coordinated rate limiting / provider-level protection is also needed.
- **A threshold trades availability against false alarms.** A low failure threshold or small minimum request count opens the circuit quickly but may react to a short-lived blip. A high threshold or long observation period tolerates more transient errors but can keep sending requests to a failing provider for longer. The defaults (`failureThreshold: 0.5`, `minimumRequests: 5`, `openMillis: 30000`) are starting values, not universal production settings; tune them using observed provider error rates and latency.
- **The open window delays recovery checks.** While the circuit is open, requests fail fast and the service uses its fallback instead of waiting for the provider. This protects latency and avoids piling up calls, but users may receive degraded replies during the open window even if the provider recovers early.
- **The half-open probe is only a small sample.** One successful probe closes the circuit, but it does not guarantee that the provider is healthy for all request types or under load. One failed probe reopens it, which is conservative but can prolong fallback use when failures are intermittent.
- **Fallback quality is a product decision.** The fallback preserves the response path, but it may not answer the user's request as well as the model-generated reply. Callers should be able to distinguish a fallback response where appropriate, and the fallback text should be safe and useful for the workflow.
- **Observability needs a durable destination.** The local counters are useful for tests and process-level inspection, but they are not by themselves durable monitoring. Connect them to a metrics backend and emit state-transition logs with safe metadata. Do not log secrets, tokens, full prompts, or personal data.

## Remaining risk and next steps

This proof slice reduces repeated calls to an unhealthy model provider; it does **not** eliminate provider outages or guarantee a high-quality response during an outage. It also does not implement a distributed circuit breaker, persistent history, per-tenant isolation, a provider timeout, or a retry policy. A call that never settles may still need an explicit timeout at the provider-client layer.

Recommended follow-ups for a production deployment:
1. Add or verify a timeout around each provider request so a hung call cannot occupy resources indefinitely.
2. Export counters and breaker state to a durable metrics/alerting system, and retain historical data across restarts.
3. Decide whether each replica should have an independent breaker or whether provider-level coordination is needed.
4. Review fallback content and measure how often it is served, without recording prompt contents or personal data.
5. Tune thresholds and the open window against real provider telemetry, and test intermittent failures and recovery under concurrent load.

## How this production control protects my Modules 1–3 design

The starter repository does not include the original Modules 1–3 design documents, so the links below are stated in terms of the concrete design decisions visible in this implementation. If your earlier submissions used different names for these decisions, align the wording with those documents before submitting.

- **Workflow decision — the support-reply workflow can return a safe fallback when the model provider is unavailable.** `src/replyService.js` preserves that behavior when the breaker is open or the provider call fails. The breaker therefore protects the workflow from being entirely blocked by an optional external dependency.
- **API/response-contract decision — callers should receive a controlled response rather than wait on repeated doomed provider calls.** The breaker fails fast while open, and the reply service uses the configured fallback. This helps preserve the response path and avoids making provider recovery the only way to respond.
- **Dependency-boundary decision — model-provider access is isolated behind the reply service.** The breaker wraps provider execution rather than spreading provider-failure handling across the application. That keeps the resilience behavior in one place and makes it testable.
- **Concurrency/recovery decision — only a limited recovery probe should test the provider after the open window.** The half-open state allows a probe and rejects other calls during that check, limiting the number of requests sent while provider health is uncertain.

The control does not replace request validation, authorization, or data-integrity guarantees from earlier work. Its purpose is narrower: preserve the support-reply workflow's fallback behavior and reduce pressure on an unhealthy provider.

## Pull request submission

Create the required branch, commit your implementation, push it to your fork, and open a pull request from `production-hardening-slice`.

```bash
git checkout -b production-hardening-slice
git add src/circuitBreaker.js README.md
git commit -m "Implement PromptPilot circuit breaker proof slice"
git push -u origin production-hardening-slice
```

Then open your fork on GitHub and create a pull request. Include the passing output from `node --test` in the PR description. The commands above prepare and push the branch; they do not create the PR automatically.
