import fs from "node:fs";
import path from "node:path";

type TitleTotal = {
  title: string;
  sum: number;
  rows: number;
  labels: string[];
};

type Combo = {
  total: number;
  diff: number;
  titles: string[];
};

function subsetCombos(items: TitleTotal[]) {
  const result: Combo[] = [];
  const limit = 1 << items.length;

  for (let mask = 0; mask < limit; mask += 1) {
    let total = 0;
    const titles: string[] = [];

    for (let i = 0; i < items.length; i += 1) {
      if (mask & (1 << i)) {
        total += items[i].sum;
        titles.push(items[i].title);
      }
    }

    result.push({ total, diff: 0, titles });
  }

  return result;
}

function main() {
  const target = Number(process.argv[2] ?? "2464.324693");
  const take = Number(process.argv[3] ?? "24");
  const sourcePath =
    process.argv[4] ?? path.join(process.cwd(), "scratch", "cms_ad_titles.json");

  const data = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as TitleTotal[];
  const groups = data.slice(0, take);
  const mid = Math.floor(groups.length / 2);
  const left = groups.slice(0, mid);
  const right = groups.slice(mid);

  const rightCombos = subsetCombos(right)
    .map((combo) => ({ ...combo, diff: Math.abs(target - combo.total) }))
    .sort((a, b) => a.total - b.total);

  let best: Combo | null = null;

  for (const leftCombo of subsetCombos(left)) {
    const remaining = target - leftCombo.total;

    let lo = 0;
    let hi = rightCombos.length - 1;
    while (lo < hi) {
      const midIdx = Math.floor((lo + hi) / 2);
      if (rightCombos[midIdx].total < remaining) {
        lo = midIdx + 1;
      } else {
        hi = midIdx;
      }
    }

    for (const idx of [lo - 1, lo, lo + 1]) {
      if (idx < 0 || idx >= rightCombos.length) {
        continue;
      }

      const total = leftCombo.total + rightCombos[idx].total;
      const diff = Math.abs(target - total);
      if (!best || diff < best.diff) {
        best = {
          total,
          diff,
          titles: [...leftCombo.titles, ...rightCombos[idx].titles],
        };
      }
    }
  }

  if (!best) {
    throw new Error("No combination found");
  }

  process.stdout.write(`${JSON.stringify(best, null, 2)}\n`);
}

main();
