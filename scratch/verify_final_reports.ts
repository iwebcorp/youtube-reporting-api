import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

async function validate() {
  const dir = "reports_final_v2";
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".csv"));
  
  let totalRevenue = 0;
  let zeroViewWithRevCount = 0;
  let totalRows = 0;

  console.log("--- ìµœì¢… ë¦¬í¬??ê²€ì¦??œì‘ ---");

  for (const file of files) {
    const filePath = path.join(dir, file);
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity
    });

    let headerMap: Record<string, number> = {};
    let isHeader = true;
    const separator = (file.endsWith(".tsv") || file.includes("dsr")) ? "\t" : ",";
    let fileRows = 0;

    for await (const line of rl) {
      if (isHeader) {
        const cols = line.replace(/^\uFEFF/, "").split(separator).map(c => c.trim().toLowerCase());
        cols.forEach((c, i) => headerMap[c] = i);
        isHeader = false;
        continue;
      }

      const cols = line.split(separator);
      const revIdx = headerMap["partner revenue"];
      const viewIdx = headerMap["owned views"];
      
      const revStr = (cols[revIdx] || "0").replace(/"/g, "").trim();
      const viewStr = (cols[viewIdx] || "0").replace(/"/g, "").trim();
      
      const rev = parseFloat(revStr);
      const views = parseInt(viewStr);

      if (!isNaN(rev)) totalRevenue += rev;
      if (rev > 0 && (isNaN(views) || views === 0)) {
        zeroViewWithRevCount++;
      }

      fileRows++;
      totalRows++;
    }
    console.log(`[${file}] ${fileRows.toLocaleString()} ??ê²€???„ë£Œ.`);
  }

  console.log("\n--- ê²€ì¦?ê²°ê³¼ ---");
  console.log(`ì´????? ${totalRows.toLocaleString()}`);
  console.log(`ì´??©ì‚° ?˜ìµ: $${totalRevenue.toFixed(2)}`);
  console.log(`?˜ìµ ë°œìƒ?ˆìœ¼??ì¡°íšŒ??0???? ${zeroViewWithRevCount}ê°?(?˜ë„??ê²°ê³¼: 0)`);
  
  if (zeroViewWithRevCount === 0) {
    console.log("??ëª¨ë“  ?‰ì˜ ì¡°íšŒ???•í•©?±ì´ ?•ë³´?˜ì—ˆ?µë‹ˆ??");
  } else {
    console.log("? ï¸ ?¼ë? ?‰ì—???¬ì „??ì¡°íšŒ???„ë½??ë°œê²¬?˜ì—ˆ?µë‹ˆ??");
  }
}

validate().catch(console.error);
