"use client";

/**
 * The pre-login marketing page. Rendered ONLY at "/" and only for a visitor
 * who app/page.tsx did not redirect into a portal.
 *
 * ─── WHY THIS IS ONE BIG CLIENT COMPONENT ────────────────────────────────
 * It carries the only WebGL in the product. Everything heavy is loaded from
 * inside the mount effect (`await import("three")`, `await import("lenis")`),
 * so those two libraries live in their own chunks that no other route pulls,
 * and a failure to fetch either one degrades to a static — still readable,
 * still clickable, still scrollable — page rather than a blank one.
 *
 * Simple UI state (which module tab, which shift, which section is live) is
 * React state. The particle field is NOT: it is a 5,200-point buffer mutated
 * 60×/s, and pushing that through render would be both slower and a rewrite
 * of logic that is already visually verified. It stays imperative, owned by
 * one effect, and is torn down completely on unmount.
 *
 * Sign-in reuses the app's existing mechanism verbatim: Clerk's
 * <SignInButton mode="modal">, exactly as the previous app/page.tsx did.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SignInButton } from "@clerk/nextjs";
// Type-only: erased at compile time, so this does NOT pull lenis into the
// bundle. The runtime import lives in the effect below.
import type LenisInstance from "lenis";
import s from "./cinematic-landing.module.css";

// ── formations, one per scene ───────────────────────────────────
type FormName = "dial" | "lattice" | "clock" | "clusters" | "field";

const SCENE_FORMS: FormName[] = [
  "dial",
  "lattice",
  "clock",
  "clusters",
  "field",
  "dial",
];

const NAV_LINKS = ["Overview", "Modules", "Shifts", "Portals", "Principles"];

const MODULES = [
  {
    n: "Attendance",
    c: "#2BB673",
    t: "Shift-aware, always.",
    d: "Web clock-in with geofence and IP checks that flag for review instead of silently rejecting a real punch. Overnight shifts attribute to the day they began — verified against the assigned shift, never assumed from the clock.",
    f: [
      ["3", "Validation modes"],
      ["±m", "Accuracy recorded"],
      ["0", "Punches ever blocked"],
    ],
  },
  {
    n: "Appraisal",
    c: "#F5A623",
    t: "Frequency, not just failure.",
    d: "Punctuality separates how often someone is late from how late they were, so one bad morning never reads like a genuine pattern. The weighting formula is owned by Super Admin alone — HR runs cycles but can never edit the maths.",
    f: [
      ["0–100", "Internal scale"],
      ["/5", "Shown to staff"],
      ["1", "Formula owner"],
    ],
  },
  {
    n: "Payroll",
    c: "#4C9FE8",
    t: "Formats, never guesses tax.",
    d: "Statutory figures come from your own compliance team. SESS pro-rates, settles, totals and locks — it never calculates TDS itself, because that liability belongs with a human who can be accountable for it.",
    f: [
      ["2", "Approval steps"],
      ["∞", "Adjustment trail"],
      ["0", "Auto tax calls"],
    ],
  },
  {
    n: "Recruitment",
    c: "#2BB673",
    t: "A public pipeline that behaves.",
    d: "Job postings, a real careers page, and hire-conversion that reuses the exact same onboarding path as a manual hire — one code path, so the two can never quietly drift apart.",
    f: [
      ["5", "Pipeline stages"],
      ["1yr", "Data retention"],
      ["1", "Onboard function"],
    ],
  },
  {
    n: "Idle Tracking",
    c: "#F5A623",
    t: "Consent first, minutes only.",
    d: "No screenshots, no keystrokes, no application names. Idle-versus-active minutes and nothing more — and only once an employee has given consent that HR recorded first. A visible tray icon, never a hidden agent.",
    f: [
      ["3.5m", "Idle threshold"],
      ["0", "Screenshots"],
      ["1", "Org kill switch"],
    ],
  },
  {
    n: "Audit Log",
    c: "#4C9FE8",
    t: "Every action, permanently.",
    d: "Every approval, release, correction and redaction writes to one append-only log — inside the same transaction as the action itself, so the trail can never disagree with what actually happened.",
    f: [
      ["0", "Edits possible"],
      ["0", "Deletes possible"],
      ["1", "Source of truth"],
    ],
  },
];

/**
 * Portal cards. `href` is where Clerk sends the visitor AFTER sign-in — the
 * paths come from ROLE_HOME in lib/auth-types.ts; middleware still bounces
 * anyone whose role does not permit the destination, so a card is an
 * invitation, never a grant.
 */
const PORTALS = [
  {
    href: "/employee",
    rc: "#78848F",
    role: "Employee",
    h: "My own record",
    p: "Clock in, apply for leave, log production, download payslips — their work, nobody else's.",
  },
  {
    href: "/manager",
    rc: "#4C9FE8",
    role: "Manager",
    h: "My team, plus myself",
    p: "Approve leave, set targets, review quality — and clock in like everyone else.",
  },
  {
    href: "/hr",
    rc: "#2BB673",
    role: "HR",
    h: "Runs the business of people",
    p: "Onboarding, payroll runs, hiring pipeline, retention — real workflows, not a spreadsheet.",
  },
  {
    href: "/admin",
    rc: "#F5A623",
    role: "Super Admin",
    h: "Final authority",
    p: "Finalizes payroll, approves offers, owns the formula — never the one who also runs them.",
  },
];

const prefersReduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── the shift dial (pure maths, rendered by React) ──────────────
const dialPoint = (h: number): [number, number] => {
  const a = (h / 24) * Math.PI * 2;
  return [115 + Math.sin(a) * 72, 115 - Math.cos(a) * 72];
};

const DIAL_TICKS = Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * Math.PI * 2;
  const major = i % 6 === 0;
  const r2 = major ? 76 : 82;
  return {
    x1: 115 + Math.sin(a) * 88,
    y1: 115 - Math.cos(a) * 88,
    x2: 115 + Math.sin(a) * r2,
    y2: 115 - Math.cos(a) * r2,
    stroke: major ? "rgba(237,241,243,0.4)" : "rgba(237,241,243,0.15)",
    width: major ? 1.4 : 0.9,
  };
});

export default function CinematicLanding({
  signedInWithoutRole = false,
}: {
  /** Signed in, but the Clerk account carries no recognised role — the one
      case where a logged-in user still reaches this page (app/page.tsx can
      only redirect someone who HAS a role). */
  signedInWithoutRole?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const sceneRefs = useRef<(HTMLElement | null)[]>([]);
  const lenisRef = useRef<LenisInstance | null>(null);
  const applyFormRef = useRef<((name: FormName) => void) | null>(null);
  const formNameRef = useRef<FormName>("dial");

  // -1 until mounted so the first scene's reveal actually animates in,
  // exactly as the reference does with its post-boot setActive(0).
  const [active, setActive] = useState(-1);
  const [moduleIndex, setModuleIndex] = useState(0);
  const [shift, setShift] = useState<"day" | "night">("day");

  useEffect(() => setActive(0), []);

  /* ───────────────────────────────────────────────────────────
     PARTICLE FIELD — one continuous canvas behind everything.
     Particles physically reform per section, so the background
     encodes what you're reading rather than decorating it.
     ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const REDUCED = prefersReduced();
    let cancelled = false;
    let raf = 0;
    let teardown: (() => void) | null = null;

    (async () => {
      let THREE: typeof import("three");
      try {
        THREE = await import("three");
      } catch {
        return; // no particles; the page below is fully usable without them
      }
      if (cancelled) return;

      // three ≥ r152 turns on colour management and sRGB output by default,
      // which would brighten this palette away from the verified look. r128
      // (what the reference was built against) had neither.
      THREE.ColorManagement.enabled = false;

      const COUNT = 5200;
      const cur = new Float32Array(COUNT * 3);
      const tgt = new Float32Array(COUNT * 3);
      const vel = new Float32Array(COUNT * 3);
      const colCur = new Float32Array(COUNT * 3);
      const colTgt = new Float32Array(COUNT * 3);

      type RGB = readonly [number, number, number];
      const AMBER: RGB = [0.96, 0.65, 0.14];
      const TEAL: RGB = [0.25, 0.72, 0.77];
      const BONE: RGB = [0.93, 0.95, 0.96];
      const SLATE: RGB = [0.36, 0.42, 0.47];
      const GREEN: RGB = [0.17, 0.71, 0.45];

      const rnd = (a: number, b: number) => a + Math.random() * (b - a);
      const setC = (arr: Float32Array, i: number, c: RGB) => {
        arr[i * 3] = c[0];
        arr[i * 3 + 1] = c[1];
        arr[i * 3 + 2] = c[2];
      };

      type Particle = [number, number, number, RGB];
      const FORMS: Record<FormName, (i: number) => Particle> = {
        // precision dial: outer ring + tick spokes + needle — the brand mark
        dial() {
          const r = Math.random();
          if (r < 0.52) {
            const a = Math.random() * Math.PI * 2;
            const rad = 7.4 + rnd(-0.1, 0.1);
            return [
              Math.cos(a) * rad,
              Math.sin(a) * rad,
              rnd(-0.35, 0.35),
              Math.random() < 0.18 ? AMBER : BONE,
            ];
          }
          if (r < 0.8) {
            const k = Math.floor(Math.random() * 60);
            const major = k % 5 === 0;
            const a = (k / 60) * Math.PI * 2;
            const rad = (major ? 6.35 : 6.75) + Math.random() * (major ? 0.85 : 0.45);
            return [
              Math.cos(a) * rad,
              Math.sin(a) * rad,
              rnd(-0.22, 0.22),
              major ? BONE : SLATE,
            ];
          }
          if (r < 0.93) {
            const t = Math.random();
            const a = -Math.PI * 0.18;
            return [Math.cos(a) * t * 6.6, Math.sin(a) * t * 6.6, rnd(-0.14, 0.14), AMBER];
          }
          const a = Math.random() * Math.PI * 2;
          const rad = Math.random() * 5.4;
          return [Math.cos(a) * rad, Math.sin(a) * rad, rnd(-0.7, 0.7), SLATE];
        },
        // lattice: modules as an ordered structure
        lattice(i) {
          const n = 14;
          const x = (i % n) - n / 2;
          const y = (Math.floor(i / n) % n) - n / 2;
          const z = (Math.floor(i / (n * n)) % 9) - 4;
          return [
            x * 1.28 + rnd(-0.1, 0.1),
            y * 1.05 + rnd(-0.1, 0.1),
            z * 1.5 + rnd(-0.1, 0.1),
            Math.abs(x) < 1 && Math.abs(y) < 1
              ? AMBER
              : Math.random() < 0.12
                ? TEAL
                : SLATE,
          ];
        },
        // clock: 24h ring, night arc lit
        clock() {
          const r = Math.random();
          if (r < 0.62) {
            const h = Math.random() * 24;
            const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
            const rad = 7.0 + rnd(-0.14, 0.14);
            const night = h >= 18 || h < 3;
            return [
              Math.cos(a) * rad,
              -Math.sin(a) * rad,
              rnd(-0.3, 0.3),
              night ? AMBER : SLATE,
            ];
          }
          if (r < 0.8) {
            const k = Math.floor(Math.random() * 24);
            const a = (k / 24) * Math.PI * 2 - Math.PI / 2;
            const rad = 6.1 + Math.random() * 0.7;
            return [Math.cos(a) * rad, -Math.sin(a) * rad, rnd(-0.18, 0.18), BONE];
          }
          const t = Math.random();
          const a = -Math.PI * 0.5;
          return [
            Math.cos(a) * t * 5.9,
            -Math.sin(a) * t * 5.9,
            rnd(-0.12, 0.12),
            Math.random() < 0.4 ? AMBER : BONE,
          ];
        },
        // clusters: four roles, four bodies
        clusters(i) {
          const k = i % 4;
          const cols: RGB[] = [SLATE, [0.3, 0.62, 0.91], GREEN, AMBER];
          const cx = (k - 1.5) * 4.9;
          const cy = (k % 2 ? 1 : -1) * 0.9;
          const a = Math.random() * Math.PI * 2;
          const b = Math.acos(rnd(-1, 1));
          const rad = Math.pow(Math.random(), 0.55) * 2.1;
          return [
            cx + Math.sin(b) * Math.cos(a) * rad,
            cy + Math.sin(b) * Math.sin(a) * rad * 1.15,
            Math.cos(b) * rad,
            cols[k],
          ];
        },
        // field: quiet, sparse, disciplined
        field() {
          const a = Math.random() * Math.PI * 2;
          const b = Math.acos(rnd(-1, 1));
          const rad = 6.2 + Math.pow(Math.random(), 2) * 5.5;
          return [
            Math.sin(b) * Math.cos(a) * rad,
            Math.sin(b) * Math.sin(a) * rad * 0.62,
            Math.cos(b) * rad * 0.55,
            Math.random() < 0.1 ? AMBER : SLATE,
          ];
        },
      };

      const applyForm = (name: FormName) => {
        const f = FORMS[name] ?? FORMS.field;
        for (let i = 0; i < COUNT; i++) {
          const [x, y, z, c] = f(i);
          tgt[i * 3] = x;
          tgt[i * 3 + 1] = y;
          tgt[i * 3 + 2] = z;
          setC(colTgt, i, c);
        }
      };

      const w = () => canvas.clientWidth || 1;
      const h = () => canvas.clientHeight || 1;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        });
      } catch {
        return; // no WebGL context — leave the canvas empty and move on
      }
      if (cancelled) {
        renderer.dispose();
        return;
      }

      const scene3 = new THREE.Scene();
      scene3.fog = new THREE.FogExp2(0x05070a, 0.031);
      const camera = new THREE.PerspectiveCamera(52, w() / h(), 0.1, 120);
      camera.position.set(0, 0, 18.5);

      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.9));
      // Actual sizing is the ResizeObserver's job, below.

      applyForm(formNameRef.current);
      // seed from a scattered sphere so the first render "assembles"
      for (let i = 0; i < COUNT; i++) {
        const a = Math.random() * Math.PI * 2;
        const b = Math.acos(rnd(-1, 1));
        const r = 15 + Math.random() * 16;
        cur[i * 3] = Math.sin(b) * Math.cos(a) * r;
        cur[i * 3 + 1] = Math.sin(b) * Math.sin(a) * r;
        cur[i * 3 + 2] = Math.cos(b) * r;
        setC(colCur, i, SLATE);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(cur, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colCur, 3));

      const mat = new THREE.PointsMaterial({
        size: 0.062,
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geo, mat);
      scene3.add(points);

      applyFormRef.current = applyForm;

      /* pointer parallax — subtle, never gimmicky */
      let px = 0;
      let py = 0;
      let tpx = 0;
      let tpy = 0;
      const onPointer = (e: PointerEvent) => {
        tpx = e.clientX / window.innerWidth - 0.5;
        tpy = e.clientY / window.innerHeight - 0.5;
      };
      window.addEventListener("pointermove", onPointer, { passive: true });

      /**
       * Sizing is checked inside the render loop rather than from a "resize"
       * listener, because a listener only covers the case where the WINDOW
       * changes. It does not cover the one that actually bit here: this code
       * runs after `await import("three")`, and the component's stylesheet can
       * still be pending at that moment, so the canvas measures at its default
       * 300×150 (or 0) and the drawing buffer stays that size forever — a
       * blurry, wrongly-scaled field with no event to correct it.
       *
       * Comparing the buffer against the live client size every frame is
       * three's own documented pattern, costs one layout read, and needs no
       * listener or observer to unregister.
       */
      const fitToCanvas = () => {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (!width || !height) return;
        const pr = renderer.getPixelRatio();
        if (
          canvas.width === Math.floor(width * pr) &&
          canvas.height === Math.floor(height * pr)
        ) {
          return;
        }
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      let t = 0;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        fitToCanvas();
        t += 0.0042;

        const ease = REDUCED ? 1 : 0.055;
        for (let i = 0; i < COUNT * 3; i++) {
          if (REDUCED) {
            cur[i] = tgt[i];
          } else {
            const d = tgt[i] - cur[i];
            vel[i] = vel[i] * 0.8 + d * ease;
            cur[i] += vel[i];
          }
          colCur[i] += (colTgt[i] - colCur[i]) * 0.05;
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;

        if (!REDUCED) {
          px += (tpx - px) * 0.045;
          py += (tpy - py) * 0.045;
          points.rotation.y = Math.sin(t * 0.42) * 0.16 + px * 0.36;
          points.rotation.x = Math.cos(t * 0.31) * 0.07 - py * 0.24;
          points.rotation.z = Math.sin(t * 0.2) * 0.03;
        }
        renderer.render(scene3, camera);
      };
      raf = requestAnimationFrame(loop);

      teardown = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onPointer);
        applyFormRef.current = null;
        scene3.remove(points);
        geo.dispose();
        mat.dispose();
        renderer.dispose();
        // dispose() alone releases three's own objects but leaves the WebGL
        // context alive; browsers cap concurrent contexts (~16), so without
        // this, bouncing in and out of "/" eventually kills the oldest one.
        renderer.forceContextLoss();
      };
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      teardown?.();
    };
  }, []);

  /* Formation follows the live section. */
  useEffect(() => {
    if (active < 0) return;
    const form = SCENE_FORMS[active];
    formNameRef.current = form;
    applyFormRef.current?.(form);
  }, [active]);

  /* ───────────────────────────────────────────────────────────
     LENIS — real momentum/easing on every scroll input (wheel,
     trackpad, touch, drag). Without it the frame still scrolls
     natively; goTo() falls back to scrollIntoView.
     ─────────────────────────────────────────────────────────── */
  const goTo = useCallback((i: number) => {
    const target = sceneRefs.current[i];
    if (!target) return;
    const reduced = prefersReduced();
    const lenis = lenisRef.current;
    if (lenis) {
      lenis.scrollTo(target, {
        duration: reduced ? 0 : 1.15,
        easing: (t: number) => 1 - Math.pow(1 - t, 3),
      });
    } else {
      target.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    }
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || prefersReduced()) return;

    let cancelled = false;
    let raf = 0;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let lenis: LenisInstance | null = null;

    (async () => {
      try {
        const { default: Lenis } = await import("lenis");
        if (cancelled) return;
        lenis = new Lenis({
          wrapper: frame,
          content: frame,
          duration: 1.05, // glide length per wheel/drag input
          easing: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
          smoothWheel: true,
          wheelMultiplier: 1,
          touchMultiplier: 1.15,
          syncTouch: true,
        });
      } catch {
        return; // native scroll only
      }
      lenisRef.current = lenis;

      const raf_ = (time: number) => {
        lenis?.raf(time);
        raf = requestAnimationFrame(raf_);
      };
      raf = requestAnimationFrame(raf_);

      /* Gentle "settle to nearest section" — fires only after scrolling has
         genuinely stopped for a beat, never mid-gesture, so it reads as a
         soft correction rather than a hard CSS snap-jump. */
      lenis.on("scroll", () => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (!lenis || lenis.isScrolling) return;
          const y = frame.scrollTop;
          const h = frame.clientHeight;
          const clamped = Math.max(
            0,
            Math.min(SCENE_FORMS.length - 1, Math.round(y / h)),
          );
          const drift = Math.abs(y - clamped * h);
          if (drift > 4 && drift < h * 0.5) goTo(clamped);
        }, 260);
      });
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(settleTimer);
      lenis?.destroy();
      lenisRef.current = null;
    };
  }, [goTo]);

  /* Which section is live — drives the reveal, the rail and the formation. */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const els = sceneRefs.current.filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(els.indexOf(e.target as HTMLElement));
        });
      },
      { root: frame, threshold: 0.55 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const setSceneRef = (i: number) => (el: HTMLElement | null) => {
    sceneRefs.current[i] = el;
  };
  const sceneClass = (i: number) =>
    `${s.scene}${active === i ? ` ${s.live}` : ""}`;

  const mod = MODULES[moduleIndex];
  const [shiftStart, shiftEnd] = shift === "day" ? [9, 17] : [18, 27];
  const [ax1, ay1] = dialPoint(shiftStart);
  const [ax2, ay2] = dialPoint(shiftEnd % 24);
  const arcD = `M ${ax1} ${ay1} A 72 72 0 ${
    (shiftEnd - shiftStart) / 24 > 0.5 ? 1 : 0
  } 1 ${ax2} ${ay2}`;

  return (
    <div className={s.root}>
      <canvas ref={canvasRef} className={s.stage} aria-hidden="true" />
      <div className={s.vignette} aria-hidden="true" />
      <div className={s.grain} aria-hidden="true" />

      <header className={s.chrome}>
        <div className={s.logo}>
          <span className={s.ring} />
          SESS <em>SELF-SERVICE</em>
        </div>
        <div className={s.chromeRight}>
          <nav className={s.nav}>
            {NAV_LINKS.map((label, i) => (
              <a
                key={label}
                href={`#s${i}`}
                aria-current={active === i ? "true" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  goTo(i);
                }}
              >
                {label}
              </a>
            ))}
          </nav>
          <SignInButton mode="modal">
            <button className={s.signin}>Sign in</button>
          </SignInButton>
        </div>
      </header>

      <div className={s.rail} aria-label="Section navigation">
        {SCENE_FORMS.map((_, i) => (
          <button
            key={i}
            aria-label={`Go to section ${i + 1}`}
            aria-current={active === i ? "true" : undefined}
            onClick={() => goTo(i)}
          >
            <span>0{i + 1}</span>
            <span className={s.tick} />
          </button>
        ))}
      </div>

      <main className={s.frame} ref={frameRef}>
        {/* ===== 0 · HERO ===== */}
        <section className={sceneClass(0)} id="s0" ref={setSceneRef(0)}>
          <div className={s.wrap}>
            <div className={`${s.kicker} ${s.rv}`}>
              <i />
              Precision workforce measurement
            </div>
            <h1 className={s.rv}>
              Attendance and payroll
              <br />
              <span className={s.soft}>shouldn&apos;t be</span>{" "}
              <span className={s.hot}>guessed.</span>
            </h1>
            <p className={`${s.lede} ${s.rv}`}>
              Shift-aware attendance, punctuality that tells a bad day apart from
              a bad pattern, and payroll built on deterministic logic — never a
              model&apos;s best guess. Built end to end for Simplen eServices.
            </p>
            {signedInWithoutRole && (
              <p className={s.notice}>
                You&apos;re signed in, but no role is set on your account yet.
                Ask an administrator to assign one.
              </p>
            )}
            <div className={`${s.acts} ${s.rv}`}>
              <button className={`${s.act} ${s.filled}`} onClick={() => goTo(3)}>
                Enter a portal
              </button>
              <button className={s.act} onClick={() => goTo(1)}>
                Explore the system
              </button>
            </div>
          </div>
          <div className={s.heroLower}>
            <div className={s.metrics}>
              <div className={s.metric}>
                <b>0</b>
                <span>AI decisions in payroll</span>
              </div>
              <div className={s.metric}>
                <b>4</b>
                <span>Role-scoped portals</span>
              </div>
              <div className={s.metric}>
                <b>24h</b>
                <span>Shift coverage</span>
              </div>
              <div className={s.metric}>
                <b>100%</b>
                <span>Actions audited</span>
              </div>
            </div>
            <div className={s.scrollcue}>
              Scroll
              <span className={s.line} />
            </div>
          </div>
        </section>

        {/* ===== 1 · MODULES ===== */}
        <section className={sceneClass(1)} id="s1" ref={setSceneRef(1)}>
          <div className={s.wrap}>
            <div className={`${s.kicker} ${s.rv}`}>
              <i />
              Modules
            </div>
            <h2 className={s.rv}>
              One system,
              <br />
              not six disconnected tools.
            </h2>
            <div className={`${s.modGrid} ${s.rv}`}>
              <div className={s.modRail} role="tablist" aria-label="Modules">
                {MODULES.map((m, i) => (
                  <button
                    key={m.n}
                    className={s.modBtn}
                    role="tab"
                    aria-selected={moduleIndex === i}
                    aria-current={moduleIndex === i ? "true" : undefined}
                    onClick={() => setModuleIndex(i)}
                  >
                    <span className={s.no}>0{i + 1}</span>
                    {m.n}
                  </button>
                ))}
              </div>
              {/* key= remounts the panel so the fade replays per selection,
                  which is what the reference's class-toggle reflow did. */}
              <div
                key={moduleIndex}
                className={`${s.modPanel} ${s.glass} ${s.fade}`}
              >
                <div className={s.tag} style={{ color: mod.c }}>
                  {mod.n}
                </div>
                <h3>{mod.t}</h3>
                <p>{mod.d}</p>
                <div className={s.modFacts}>
                  {mod.f.map(([v, l]) => (
                    <div key={l}>
                      <b>{v}</b>
                      <span>{l}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== 2 · SHIFTS ===== */}
        <section className={sceneClass(2)} id="s2" ref={setSceneRef(2)}>
          <div className={s.wrap}>
            <div className={s.shiftGrid}>
              <div>
                <div className={`${s.kicker} ${s.rv}`}>
                  <i />
                  Shift-aware by design
                </div>
                <h2 className={s.rv}>
                  Midnight isn&apos;t
                  <br />
                  a bug here.
                </h2>
                <p className={`${s.lede} ${s.rv}`}>
                  A shift crossing midnight is one of the easiest things for HR
                  software to get quietly wrong — a punch lands on the wrong day,
                  lateness measures against the wrong clock, payroll comes out a
                  day short.
                </p>
                <div className={`${s.note} ${s.glass} ${s.rv}`}>
                  SESS resolves every overnight punch to the day the{" "}
                  <b>shift started</b> — one rule, applied identically across
                  attendance, payroll and reporting, instead of three modules
                  quietly disagreeing.
                </div>
              </div>
              <div className={s.rv}>
                <div className={s.dialBox}>
                  <svg viewBox="0 0 230 230" role="img" aria-label="24-hour shift dial">
                    <circle
                      cx="115"
                      cy="115"
                      r="103"
                      fill="none"
                      stroke="rgba(237,241,243,0.07)"
                    />
                    <circle
                      cx="115"
                      cy="115"
                      r="88"
                      fill="rgba(11,16,21,0.5)"
                      stroke="rgba(237,241,243,0.1)"
                    />
                    <g>
                      {DIAL_TICKS.map((t, i) => (
                        <line
                          key={i}
                          x1={t.x1}
                          y1={t.y1}
                          x2={t.x2}
                          y2={t.y2}
                          stroke={t.stroke}
                          strokeWidth={t.width}
                        />
                      ))}
                    </g>
                    <path
                      className={s.dialArc}
                      d={arcD}
                      fill="none"
                      strokeWidth="13"
                      strokeLinecap="round"
                      opacity="0.9"
                    />
                    <g className={s.dialText} fontSize="9">
                      <text x="115" y="26" textAnchor="middle">
                        00
                      </text>
                      <text x="206" y="119" textAnchor="middle">
                        06
                      </text>
                      <text x="115" y="214" textAnchor="middle">
                        12
                      </text>
                      <text x="24" y="119" textAnchor="middle">
                        18
                      </text>
                    </g>
                    <line
                      className={s.dialHand}
                      x1="115"
                      y1="115"
                      x2="115"
                      y2="42"
                      strokeWidth="2"
                      strokeLinecap="round"
                      style={{ transform: `rotate(${(shiftStart / 24) * 360}deg)` }}
                    />
                    <circle className={s.dialHub} cx="115" cy="115" r="5" />
                    <text
                      className={s.dialText}
                      x="115"
                      y="148"
                      textAnchor="middle"
                      fontSize="9"
                    >
                      {shift === "day"
                        ? "DAY · 09:00–17:00"
                        : "NIGHT · 18:00–03:00 · CROSSES MIDNIGHT"}
                    </text>
                  </svg>
                </div>
                <div className={s.shiftSwitch}>
                  <button
                    aria-current={shift === "day" ? "true" : undefined}
                    onClick={() => setShift("day")}
                  >
                    Day 09–17
                  </button>
                  <button
                    aria-current={shift === "night" ? "true" : undefined}
                    onClick={() => setShift("night")}
                  >
                    Night 18–03
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== 3 · PORTALS ===== */}
        <section className={sceneClass(3)} id="s3" ref={setSceneRef(3)}>
          <div className={s.wrap}>
            <div className={`${s.kicker} ${s.rv}`}>
              <i />
              Four roles, one system
            </div>
            <h2 className={s.rv}>
              Everyone sees exactly
              <br />
              what they should.
            </h2>
            <p className={`${s.lede} ${s.rv}`}>
              Access isn&apos;t a hidden button. Every boundary is enforced at
              the query itself — checked directly, never assumed from the
              interface.
            </p>
            <div className={`${s.portals} ${s.rv}`}>
              {PORTALS.map((p) => (
                <SignInButton key={p.href} mode="modal" forceRedirectUrl={p.href}>
                  <button
                    className={`${s.portal} ${s.glass}`}
                    style={{ "--rc": p.rc } as React.CSSProperties}
                  >
                    <div className={s.role}>
                      <i />
                      {p.role}
                    </div>
                    <h4>{p.h}</h4>
                    <p>{p.p}</p>
                    <div className={s.path}>
                      <span>{p.href}</span>
                      <span className={s.arrow}>→</span>
                    </div>
                  </button>
                </SignInButton>
              ))}
            </div>
          </div>
        </section>

        {/* ===== 4 · PRINCIPLES ===== */}
        <section className={sceneClass(4)} id="s4" ref={setSceneRef(4)}>
          <div className={s.wrap}>
            <div className={`${s.kicker} ${s.rv}`}>
              <i />
              Built on purpose
            </div>
            <h2 className={s.rv}>
              A few rules,
              <br />
              held everywhere.
            </h2>
            <div className={`${s.prin} ${s.rv}`}>
              <div className={s.glass}>
                <div className={s.k}>No AI in consequential decisions</div>
                <p>
                  Nothing affecting pay, appraisal or disciplinary record is
                  decided by a model. <b>Deterministic logic, every time</b> —
                  auditable, not a black box.
                </p>
              </div>
              <div className={s.glass}>
                <div className={s.k}>Separation of duties</div>
                <p>
                  HR runs payroll. Super Admin finalizes it.{" "}
                  <b>No single person does both</b> — the same discipline the
                  business already applies for its own clients.
                </p>
              </div>
              <div className={s.glass}>
                <div className={s.k}>Retention with an expiry</div>
                <p>
                  Personal data doesn&apos;t sit forever by default.{" "}
                  <b>Real redaction</b> on former employees, real deletion
                  schedules on candidates.
                </p>
              </div>
              <div className={s.glass}>
                <div className={s.k}>Record it, don&apos;t judge it</div>
                <p>
                  A flagged punch shows where and how precisely —{" "}
                  <b>evidence, not a verdict.</b> The system never blocks a punch
                  on distance alone.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ===== 5 · CLOSE ===== */}
        <section className={sceneClass(5)} id="s5" ref={setSceneRef(5)}>
          <div className={s.wrap}>
            <div className={s.close}>
              <div
                className={`${s.kicker} ${s.rv}`}
                style={{ justifyContent: "center" }}
              >
                <i />
                Simplen Employee Self-Service
              </div>
              <h2 className={s.rv}>
                Shaped around how Simplen
                <br />
                actually runs.
              </h2>
              <p className={`${s.lede} ${s.rv}`}>
                Not a template bent to fit. Every rule was written for one
                company&apos;s real shifts, real compliance posture, and real
                people.
              </p>
              <div className={`${s.acts} ${s.rv}`}>
                <SignInButton mode="modal">
                  <button className={`${s.act} ${s.filled}`}>Sign in</button>
                </SignInButton>
                <button className={s.act} onClick={() => goTo(0)}>
                  Back to top
                </button>
              </div>
            </div>
          </div>
          <div className={s.footline}>
            <span>SESS · Simplen Employee Self-Service</span>
            <span>Built for Simplen eServices</span>
          </div>
        </section>
      </main>
    </div>
  );
}
