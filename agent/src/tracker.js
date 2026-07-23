"use strict";

/**
 * Core tracking logic — DELIBERATELY FREE OF ELECTRON.
 *
 * Everything here is plain Node with injected dependencies (a clock, an
 * idle-seconds reader, a POST function), so the batching, accumulation and
 * retry behaviour can be exercised by `npm run selfcheck` without launching a
 * GUI. src/main.js is the thin Electron shell that wires the real
 * powerMonitor and fetch into this.
 *
 * ─── WHAT THIS RECORDS ────────────────────────────────────────────────
 * Two numbers per window: minutes idle, minutes active. Derived solely from
 * how many seconds the OS reports since the last keyboard/mouse input.
 *
 * WHAT IT DOES NOT RECORD, by design and permanently:
 *   • no screenshots           • no window or application titles
 *   • no URLs or browsing      • no keystrokes or input contents
 *   • no productivity score, no "productive vs unproductive" classification
 *
 * This is the least invasive form this category of software can take while
 * still answering "was this machine in use?".
 * ─────────────────────────────────────────────────────────────────────
 */

const DEFAULT_IDLE_THRESHOLD_SECONDS = 210; // 3.5 minutes
const DEFAULT_POLL_SECONDS = 15;
const DEFAULT_BATCH_SECONDS = 15 * 60; // send every 15 minutes
const MAX_BUFFERED_BATCHES = 96; // ~24h of unsent windows, then drop oldest

class Tracker {
  /**
   * @param {object} deps
   * @param {() => number}  deps.getIdleSeconds  seconds since last input
   * @param {(url, init) => Promise<{status:number, json:any}>} deps.post
   * @param {() => number}  [deps.now]           ms epoch, injectable for tests
   * @param {(msg:string) => void} [deps.log]
   */
  constructor(deps) {
    this.getIdleSeconds = deps.getIdleSeconds;
    this.post = deps.post;
    this.now = deps.now || (() => Date.now());
    this.log = deps.log || (() => {});

    this.thresholdSeconds = DEFAULT_IDLE_THRESHOLD_SECONDS;
    this.pollSeconds = deps.pollSeconds || DEFAULT_POLL_SECONDS;
    this.batchSeconds = deps.batchSeconds || DEFAULT_BATCH_SECONDS;

    // Accumulated seconds in the CURRENT window.
    this.idleSeconds = 0;
    this.activeSeconds = 0;
    this.windowStart = this.now();

    /** Windows that failed to send, oldest first. Never silently dropped. */
    this.buffer = [];

    this.paused = false;
    /** Set when the server says consent is gone — a harder stop than pause. */
    this.stoppedByServer = false;
    this.lastError = null;
    this.lastSentAt = null;
    this.consecutiveFailures = 0;
  }

  /** State for the tray menu. */
  status() {
    if (this.stoppedByServer) return "Stopped — consent not active";
    if (this.paused) return "Paused";
    return "Tracking";
  }

  /**
   * One poll tick. Attributes `pollSeconds` to idle or active.
   *
   * The OS reports seconds since the LAST input, so a reading at or above the
   * threshold means the user has been away for at least that long. We
   * attribute only this tick, not the whole idle stretch, so the totals add up
   * to real elapsed time rather than double-counting.
   */
  tick() {
    if (this.paused || this.stoppedByServer) return;

    const idleFor = this.getIdleSeconds();
    if (idleFor >= this.thresholdSeconds) this.idleSeconds += this.pollSeconds;
    else this.activeSeconds += this.pollSeconds;
  }

  /** True once the current window has run its full length. */
  windowElapsed() {
    return this.now() - this.windowStart >= this.batchSeconds * 1000;
  }

  /** Close the current window into a batch and reset the accumulator. */
  closeWindow() {
    const batch = {
      idleMinutes: Math.round(this.idleSeconds / 60),
      activeMinutes: Math.round(this.activeSeconds / 60),
      windowStart: new Date(this.windowStart).toISOString(),
      windowEnd: new Date(this.now()).toISOString(),
    };
    this.idleSeconds = 0;
    this.activeSeconds = 0;
    this.windowStart = this.now();
    return batch;
  }

  /**
   * Flush the buffer, oldest first. Stops at the first failure so ordering is
   * preserved and a dead server isn't hammered with the whole backlog.
   *
   * @param {string} serverUrl
   * @param {string} token
   */
  async flush(serverUrl, token) {
    if (this.stoppedByServer || this.buffer.length === 0) return { sent: 0 };

    let sent = 0;
    while (this.buffer.length > 0) {
      const batch = this.buffer[0];
      let res;
      try {
        res = await this.post(`${serverUrl.replace(/\/$/, "")}/api/agent/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(batch),
        });
      } catch (e) {
        // Network down — keep the batch, back off, try again later.
        this.consecutiveFailures++;
        this.lastError = `Network: ${e && e.message ? e.message : String(e)}`;
        this.log(`send failed (network), ${this.buffer.length} batch(es) buffered`);
        return { sent, error: this.lastError };
      }

      // The server explicitly telling us to stop. Not a transient error —
      // retrying would be both futile and rude.
      if (res.json && res.json.shouldPause) {
        this.stoppedByServer = true;
        this.lastError = res.json.error || "Tracking paused by server.";
        this.log(`server says stop: ${this.lastError}`);
        // The batch is discarded: consent is not active, so this data has no
        // lawful basis to be stored and must not be retried later either.
        this.buffer.length = 0;
        return { sent, stopped: true, error: this.lastError };
      }

      if (res.status >= 200 && res.status < 300) {
        this.buffer.shift();
        sent++;
        this.consecutiveFailures = 0;
        this.lastError = null;
        this.lastSentAt = this.now();
        // Server may have changed the threshold — adopt it without reinstall.
        if (res.json && Number.isFinite(res.json.idleThresholdSeconds)) {
          this.thresholdSeconds = res.json.idleThresholdSeconds;
        }
        continue;
      }

      if (res.status >= 400 && res.status < 500) {
        // Malformed batch: retrying cannot fix it, so drop THIS batch only
        // rather than blocking every later one behind it forever.
        this.log(`server rejected a batch (${res.status}) — discarding it`);
        this.buffer.shift();
        this.lastError = (res.json && res.json.error) || `Rejected (${res.status})`;
        continue;
      }

      // 5xx — server's problem, keep the batch and back off.
      this.consecutiveFailures++;
      this.lastError = (res.json && res.json.error) || `Server error (${res.status})`;
      return { sent, error: this.lastError };
    }
    return { sent };
  }

  /** Queue a batch, dropping the OLDEST if the buffer is somehow full. */
  enqueue(batch) {
    // Skip empty windows — nothing happened, nothing to say.
    if (batch.idleMinutes === 0 && batch.activeMinutes === 0) return false;
    this.buffer.push(batch);
    while (this.buffer.length > MAX_BUFFERED_BATCHES) this.buffer.shift();
    return true;
  }

  /** Backoff in ms: 1min, 2, 4, 8… capped at 30min. Never a tight retry loop. */
  backoffMs() {
    if (this.consecutiveFailures === 0) return 0;
    return Math.min(30 * 60 * 1000, 60 * 1000 * 2 ** (this.consecutiveFailures - 1));
  }

  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
    // Resuming after a server stop is a deliberate retry — let it try again.
    this.stoppedByServer = false;
    this.consecutiveFailures = 0;
    this.windowStart = this.now();
    this.idleSeconds = 0;
    this.activeSeconds = 0;
  }
}

module.exports = {
  Tracker,
  DEFAULT_IDLE_THRESHOLD_SECONDS,
  DEFAULT_POLL_SECONDS,
  DEFAULT_BATCH_SECONDS,
  MAX_BUFFERED_BATCHES,
};
