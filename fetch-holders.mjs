// fetch-holders.mjs
import fs from "node:fs/promises";

const CHAIN_ID = 43114; // Avalanche C-Chain
const TOKEN = "0x916eC27E0db3f8beb2c784a2617014094089148A";
const KEY = process.env.COVALENT_API_KEY;

// common addresses you may want to exclude
const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0x000000000000000000000000000000000000deaD",
  "0x000000000000000000000000000000000000dEaD",
  "0x000000000000000000000000000000000000DeAd"
]);

async function fetchAllHolders(pageSize = 500) {
  let page = 0, all = [], hasMore = true;

  while (hasMore) {
    page++;
    const url = `https://api.covalenthq.com/v1/${CHAIN_ID}/tokens/${TOKEN}/token_holders/` +
                `?page-size=${pageSize}&page-number=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: "Basic " + Buffer.from(KEY + ":").toString("base64")
      }
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Covalent ${res.status}: ${body}`);
    }

    const json = await res.json();
    const items = json?.data?.items ?? [];
    all = all.concat(items);

    const p = json?.data?.pagination;
    hasMore = p ? p.has_more : items.length === pageSize;

    // polite backoff to avoid rate limits
    if (hasMore) await new Promise(r => setTimeout(r, 150));

    // safety bound to avoid accidental infinite loop
    if (page > 250) hasMore = false;
  }

  return all;
}

async function main() {
  if (!KEY) throw new Error("Missing COVALENT_API_KEY");

  // First page also includes contract metadata (decimals); fetch once
  const firstUrl = `https://api.covalenthq.com/v1/${CHAIN_ID}/tokens/${TOKEN}/token_holders/?page-size=1&page-number=1`;
  const firstRes = await fetch(firstUrl, {
    headers: { Authorization: "Basic " + Buffer.from(KEY + ":").toString("base64") }
  });
  if (!firstRes.ok) throw new Error(`Covalent meta ${firstRes.status}: ${await firstRes.text()}`);
  const firstJson = await firstRes.json();
  const decimals = Number(firstJson?.data?.items?.[0]?.contract_decimals ?? 18);

  const raw = await fetchAllHolders();
  const tokenLower = TOKEN.toLowerCase();

  // Aggregate balances by address and filter undesired holders
  const map = new Map();
  for (const it of raw) {
    const addr = String(it.address || "").toLowerCase();
    if (!addr) continue;
    if (BURN_ADDRESSES.has(addr)) continue;
    if (addr === tokenLower) continue; // exclude token contract if present

    // Covalent returns "balance" as a raw integer string
    const bal = Number(it.balance) / (10 ** decimals);
    if (bal > 0) map.set(addr, (map.get(addr) || 0) + bal);
  }

  const holders = [...map.entries()]
    .map(([address, balance]) => ({ address, balance }))
    .sort((a, b) => b.balance - a.balance);

  // Optionally trim file size (keep top N + everyone above a threshold)
  // const MIN_BAL = 0.000001;
  // const TOP_N = 5000;
  // const trimmed = holders.filter(h => h.balance >= MIN_BAL).slice(0, TOP_N);

  // Write to your GitHub Pages folder (docs/)
  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile(
    "docs/leaderboard.json",
    JSON.stringify({ token: TOKEN, chainId: CHAIN_ID, decimals, updatedAt: new Date().toISOString(), holders }, null, 2)
  );

  console.log(`Wrote docs/leaderboard.json with ${holders.length} holders`);
}

main().catch(e => { console.error(e); process.exit(1); });
