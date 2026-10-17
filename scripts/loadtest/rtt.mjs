// Network baseline to the TEST pooler: TCP connect time (≈ one round trip),
// no credentials sent. Host is read from .env.loadtest via lt-run's env.
import net from "node:net";
import dns from "node:dns/promises";
const host = new URL(process.env.DATABASE_URL.replace(/^postgresql:/, "http:")).hostname;
if (!process.env.LT_TEST_REF || process.env.DATABASE_URL.includes("ukjzcsvjbvlrhpmjwzfo")) throw new Error("REFUSING");
const addrs = await dns.lookup(host, { all: true });
console.log("host", host, "resolves to", addrs.map((a) => `${a.address} (v${a.family})`).join(", "));
for (const port of [6543, 5432]) {
  const ms = [];
  for (let i = 0; i < 8; i++) {
    const t = performance.now();
    await new Promise((res, rej) => { const s = net.connect({ host: addrs[0].address, port }, () => { s.destroy(); res(); }); s.on("error", rej); s.setTimeout(10000, () => rej(new Error("timeout"))); });
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  console.log(`TCP connect :${port}  min ${ms[0].toFixed(0)} ms  median ${ms[4].toFixed(0)} ms  max ${ms.at(-1).toFixed(0)} ms`);
}
