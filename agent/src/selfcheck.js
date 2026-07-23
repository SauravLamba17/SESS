"use strict";

/**
 * Agent self-check — plain Node, no Electron, no GUI.
 *
 * Exercises the real Tracker with an injected fake clock, fake idle reader and
 * fake HTTP, so batching / accumulation / retry / consent-stop behaviour is
 * verified deterministically without launching a window.
 *
 * Run:  npm run selfcheck     (from /agent)
 */

const { Tracker, DEFAULT_IDLE_THRESHOLD_SECONDS } = require("./tracker");

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}

function makeTracker(overrides = {}) {
  let clock = 1_700_000_000_000;
  const sent = [];
  const t = new Tracker({
    getIdleSeconds: () => t._idle,
    now: () => clock,
    post: async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
      return t._response || { status: 200, json: { ok: true } };
    },
    pollSeconds: 15,
    batchSeconds: 900,
    ...overrides,
  });
  t._idle = 0;
  t._response = null;
  t._sent = sent;
  t._advance = (ms) => {
    clock += ms;
  };
  return t;
}

async function main() {
  console.log("── SESS agent self-check ──────────────────────────────\n");

  // 1. Threshold behaviour
  {
    const t = makeTracker();
    check(
      "1a default threshold is 210s (3.5 minutes)",
      t.thresholdSeconds === DEFAULT_IDLE_THRESHOLD_SECONDS && t.thresholdSeconds === 210,
      `threshold=${t.thresholdSeconds}s`,
    );

    t._idle = 10;
    t.tick();
    check(
      "1b input within threshold counts as ACTIVE",
      t.activeSeconds === 15 && t.idleSeconds === 0,
      `active=${t.activeSeconds}s idle=${t.idleSeconds}s`,
    );

    t._idle = 209;
    t.tick();
    check(
      "1c 209s idle still counts ACTIVE (threshold not yet reached)",
      t.activeSeconds === 30 && t.idleSeconds === 0,
    );

    t._idle = 210;
    t.tick();
    check("1d 210s idle counts IDLE (threshold is inclusive)", t.idleSeconds === 15,
      `idle=${t.idleSeconds}s`);
  }

  // 2. Window batching
  {
    const t = makeTracker();
    t._idle = 0;
    for (let i = 0; i < 40; i++) t.tick(); // 600s active
    t._idle = 300;
    for (let i = 0; i < 20; i++) t.tick(); // 300s idle

    check(
      "2a accumulates within a window WITHOUT sending (batched, not per-event)",
      t._sent.length === 0 && t.activeSeconds === 600 && t.idleSeconds === 300,
      `active=${t.activeSeconds}s idle=${t.idleSeconds}s http_calls=${t._sent.length}`,
    );

    check("2b window not yet elapsed", t.windowElapsed() === false);
    t._advance(900 * 1000);
    check("2c window elapsed after 15 minutes", t.windowElapsed() === true);

    const batch = t.closeWindow();
    check(
      "2d batch rounds to whole minutes: 600s→10m active, 300s→5m idle",
      batch.activeMinutes === 10 && batch.idleMinutes === 5,
      JSON.stringify(batch),
    );
    check("2e accumulator resets after closing", t.activeSeconds === 0 && t.idleSeconds === 0);
    check(
      "2f batch carries windowStart and windowEnd",
      typeof batch.windowStart === "string" && typeof batch.windowEnd === "string",
    );
  }

  // 3. Sending
  {
    const t = makeTracker();
    t.enqueue({ idleMinutes: 5, activeMinutes: 10, windowStart: "s", windowEnd: "e" });
    const res = await t.flush("https://sess.example.com/", "tok_abc");
    check(
      "3a posts to /api/agent/heartbeat with a bearer token",
      t._sent.length === 1 &&
        t._sent[0].url === "https://sess.example.com/api/agent/heartbeat" &&
        t._sent[0].auth === "Bearer tok_abc",
      `${t._sent[0] && t._sent[0].url} auth=${t._sent[0] && t._sent[0].auth}`,
    );
    check("3b buffer drains on success", t.buffer.length === 0 && res.sent === 1);
  }

  // 4. Retry / buffering — data is never silently dropped
  {
    const t = makeTracker();
    t._response = { status: 503, json: { error: "down" } };
    t.enqueue({ idleMinutes: 1, activeMinutes: 14, windowStart: "s", windowEnd: "e" });
    await t.flush("https://x", "tok");
    check(
      "4a a 5xx KEEPS the batch buffered (never dropped)",
      t.buffer.length === 1 && t.consecutiveFailures === 1,
      `buffered=${t.buffer.length} failures=${t.consecutiveFailures}`,
    );

    t.enqueue({ idleMinutes: 2, activeMinutes: 13, windowStart: "s", windowEnd: "e" });
    await t.flush("https://x", "tok");
    check(
      "4b failures accumulate, both batches still buffered",
      t.buffer.length === 2 && t.consecutiveFailures === 2,
      `buffered=${t.buffer.length} failures=${t.consecutiveFailures}`,
    );

    t.consecutiveFailures = 2;
    const b2 = t.backoffMs();
    t.consecutiveFailures = 4;
    const b4 = t.backoffMs();
    t.consecutiveFailures = 20;
    const bMax = t.backoffMs();
    check(
      "4c backoff grows exponentially and caps at 30 minutes",
      b2 === 120_000 && b4 === 480_000 && bMax === 1_800_000,
      `2 failures=${b2 / 1000}s, 4=${b4 / 1000}s, 20=${bMax / 1000}s (capped)`,
    );

    t.consecutiveFailures = 0;
    t._response = { status: 200, json: { ok: true } };
    const res = await t.flush("https://x", "tok");
    check(
      "4d buffered batches flush in order once the server recovers",
      res.sent === 2 && t.buffer.length === 0,
      `sent=${res.sent}`,
    );
  }

  // 5. Consent stop — the server telling the agent to pause
  {
    const t = makeTracker();
    t.enqueue({ idleMinutes: 3, activeMinutes: 12, windowStart: "s", windowEnd: "e" });
    t._response = {
      status: 403,
      json: {
        error: "Consent expired. Tracking is paused.",
        code: "PAUSE_TRACKING",
        shouldPause: true,
      },
    };
    const res = await t.flush("https://x", "tok");

    check("5a shouldPause latches the agent stopped", t.stoppedByServer === true);
    check(
      "5b the rejected batch is DISCARDED, not retried",
      t.buffer.length === 0,
      "no lawful basis to store it, so it must not be resent later either",
    );
    check(
      "5c reports the server's reason",
      res.stopped === true && /Consent expired/.test(res.error),
      res.error,
    );
    check(
      "5d status reads 'Stopped — consent not active'",
      t.status() === "Stopped — consent not active",
      t.status(),
    );

    t._idle = 0;
    t.tick();
    check("5e a stopped agent accumulates nothing", t.activeSeconds === 0 && t.idleSeconds === 0);

    t.resume();
    check("5f resume clears the stop latch",
      t.stoppedByServer === false && t.status() === "Tracking");
  }

  // 6. Threshold pushed down from the server
  {
    const t = makeTracker();
    t.enqueue({ idleMinutes: 1, activeMinutes: 14, windowStart: "s", windowEnd: "e" });
    t._response = { status: 200, json: { ok: true, idleThresholdSeconds: 300 } };
    await t.flush("https://x", "tok");
    check(
      "6a adopts a server-configured threshold without reinstall",
      t.thresholdSeconds === 300,
      `threshold now ${t.thresholdSeconds}s`,
    );
  }

  // 7. Pause / empty windows
  {
    const t = makeTracker();
    t.pause();
    t._idle = 0;
    t.tick();
    check("7a paused agent records nothing",
      t.activeSeconds === 0 && t.status() === "Paused", t.status());

    const t2 = makeTracker();
    const queued = t2.enqueue({
      idleMinutes: 0,
      activeMinutes: 0,
      windowStart: "s",
      windowEnd: "e",
    });
    check(
      "7b an empty window is not queued (nothing happened, nothing to say)",
      queued === false && t2.buffer.length === 0,
    );
  }

  // 8. Malformed batch dropped rather than blocking the queue forever
  {
    const t = makeTracker();
    t.enqueue({ idleMinutes: 1, activeMinutes: 1, windowStart: "s", windowEnd: "e" });
    t.enqueue({ idleMinutes: 2, activeMinutes: 2, windowStart: "s", windowEnd: "e" });
    let call = 0;
    t.post = async () => {
      call++;
      return call === 1
        ? { status: 400, json: { error: "bad batch" } }
        : { status: 200, json: { ok: true } };
    };
    const res = await t.flush("https://x", "tok");
    check(
      "8a a 4xx drops only that batch, later ones still send",
      res.sent === 1 && t.buffer.length === 0,
      "a permanently-invalid batch must not block the queue forever",
    );
  }

  console.log(
    `\n── ${fail === 0 ? `ALL ${pass} CHECKS PASSED` : `${fail} of ${pass + fail} FAILED`} ──`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SELFCHECK ERROR:", e);
  process.exit(1);
});
