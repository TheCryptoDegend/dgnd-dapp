// fetch-holders.mjs
import fs from "node:fs/promises";

const CHAIN_ID = 43114;
const TOKEN = "0x916eC27E0db3f8beb2c784a2617014094089148A";
const KEY = process.env.COVALENT_API_KEY;

async function fetchAllHolders(pageSize = 500) {
  let page = 0, all = [], hasMore = true;
  while (hasMore) {
    page++;
    const url = `https://api.covalenthq.com/v1/${CHAIN_ID}/tokens/${TOKEN}/token_holders/?page-size=${pageSize}&page-number=${page}`;
    const res = await fetch(url, { headers: { Authorization: "Basic " + Buffer.from(KEY + ":").toString("base64") }});
    if (!res.ok) throw new Error(`Covalent ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const items = json?.data?.items ?? [];
    all = all.concat(items);
    const p = json?.data?.pagination;
    hasMore = p ? p.has_more : items.length === pageSize;
    if (page > 200) hasMore = false;
  }
  return all;
}

async function main() {
  if (!KEY) throw new Error("Missing COVALENT_API_KEY");
  // Optional: get decimals/totalSupply from chain once (hardcode 18 if you prefer)
  const decimals = 18;

  const raw = await fetchAllHolders();
  const map = new Map();
  for (const it of raw) {
    const addr = (it.address || "").toLowerCase();
    const bal = Number(it.balance) / (10 ** decimals);
    if (bal > 0) map.set(addr, (map.get(addr) || 0) + bal);
  }
  const holders = [...map.entries()]
    .map(([address, balance]) => ({ address, balance }))
    .sort((a, b) => b.balance - a.balance);

  // Write to your Pages folder (e.g., /docs for GitHub Pages)
  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile("docs/leaderboard.json", JSON.stringify({ decimals, holders }, null, 2));
  console.log(`Wrote docs/leaderboard.json with ${holders.length} holders`);
}

main().catch(e => { console.error(e); process.exit(1); });
name: Build Leaderboard JSON

on:
  workflow_dispatch:
  schedule:
    - cron: "*/30 * * * *"  # every 30 minutes; adjust as needed

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node -e "console.log('node ok')"
      - run: node --version
      - run: npm --version
      - run: node fetch-holders.mjs
        env:
          COVALENT_API_KEY: ${{ secrets.COVALENT_API_KEY }}
      - name: Commit & push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add docs/leaderboard.json
          git commit -m "chore: update leaderboard.json [skip ci]" || echo "no changes"
          git push

