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

## Trade-off

The breaker adds state and a short-circuit fallback path. During recovery, one probe request is allowed while concurrent calls are rejected. Thresholds and the open duration require tuning to the provider's normal error rate and latency.

## Remaining risk

The counters are in-memory and reset when the process restarts; they are not a distributed breaker across multiple instances. A successful probe only confirms one request worked, and the fallback may not fully satisfy every ticket. A production deployment should export metrics to a durable monitoring system and consider per-provider/per-tenant isolation and a fallback-quality policy.

## How this production control protects my Modules 1–3 design

The breaker protects the support-reply workflow from an unhealthy optional model dependency, preserving the API's ability to return a safe response rather than waiting on repeated doomed provider calls. It complements the service's existing fallback contract; it does not replace request validation, authorization, or data-integrity guarantees.

## Pull request submission

Create the required branch, commit your implementation, push it to your fork, and open a pull request from `production-hardening-slice`.

```bash
git checkout -b production-hardening-slice
git add src/circuitBreaker.js README.md
git commit -m "Implement PromptPilot circuit breaker proof slice"
git push -u origin production-hardening-slice
```

Then open your fork on GitHub and create a pull request. Include the passing output from `node --test` in the PR description. The commands above prepare and push the branch; they do not create the PR automatically.
