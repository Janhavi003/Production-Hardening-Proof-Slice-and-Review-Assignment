'use strict';

// Circuit breaker for PromptPilot's model provider.
// Metrics are in-memory counters; onStateChange can be connected to structured logging.

class CircuitOpenError extends Error {
  constructor() {
    super('circuit is open');
    this.name = 'CircuitOpenError';
    this.code = 'CIRCUIT_OPEN';
  }
}

function createCircuitBreaker(options = {}) {
  const failureThreshold = options.failureThreshold ?? 0.5;
  const minimumRequests = options.minimumRequests ?? 5;
  const openMillis = options.openMillis ?? 30_000;
  const now = options.now ?? Date.now;
  const onStateChange = options.onStateChange ?? function () {};

  if (typeof failureThreshold !== 'number' || failureThreshold < 0 || failureThreshold > 1) {
    throw new RangeError('failureThreshold must be between 0 and 1');
  }
  if (!Number.isInteger(minimumRequests) || minimumRequests < 1) {
    throw new RangeError('minimumRequests must be a positive integer');
  }
  if (typeof openMillis !== 'number' || openMillis < 0) {
    throw new RangeError('openMillis must be a non-negative number');
  }
  if (typeof now !== 'function' || typeof onStateChange !== 'function') {
    throw new TypeError('now and onStateChange must be functions');
  }

  const metrics = {
    breaker_open_total: 0,
    short_circuited_total: 0,
    success_total: 0,
    failure_total: 0,
  };

  let state = 'CLOSED';
  let calls = 0;
  let failures = 0;
  let openedAt = null;
  let probeInFlight = false;

  function transition(nextState) {
    if (state === nextState) return;
    state = nextState;
    if (nextState === 'OPEN') {
      openedAt = now();
      probeInFlight = false;
      metrics.breaker_open_total += 1;
    }
    // Observability callbacks must not break the protected request path.
    try {
      onStateChange(nextState);
    } catch (_) {
      // A logging/metrics sink failure must not disable the breaker.
    }
  }

  function shortCircuit() {
    metrics.short_circuited_total += 1;
    throw new CircuitOpenError();
  }

  async function exec(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('exec expects a function');
    }

    let isProbe = false;
    if (state === 'OPEN') {
      if (now() - openedAt < openMillis) return shortCircuit();
      transition('HALF_OPEN');
      probeInFlight = true;
      isProbe = true;
    } else if (state === 'HALF_OPEN') {
      // Only one request is allowed to test recovery at a time.
      if (probeInFlight) return shortCircuit();
      probeInFlight = true;
      isProbe = true;
    }

    if (!isProbe) calls += 1;

    try {
      const result = await fn();
      metrics.success_total += 1;
      if (isProbe) {
        probeInFlight = false;
        transition('CLOSED');
        calls = 0;
        failures = 0;
      }
      return result;
    } catch (error) {
      metrics.failure_total += 1;
      if (isProbe) {
        probeInFlight = false;
        transition('OPEN');
      } else if (state === 'CLOSED') {
        failures += 1;
        if (calls >= minimumRequests && failures / calls >= failureThreshold) {
          transition('OPEN');
        }
      }
      throw error;
    }
  }

  return {
    exec,
    metrics,
    get state() {
      return state;
    },
  };
}

module.exports = { createCircuitBreaker, CircuitOpenError };
