import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const reportDir = "reports";
const files = fs.readdirSync(reportDir).filter(f => f.endsWith(".csv"));

const filesByDate: Record<string, string[]> = {};

files.forEach(f => {
  const match = f.match(/report_(\d{4}-\d{2}-\d{2})/);
  if (match) {
    const d = match[1];
    if (!filesByDate[d]) filesByDate[d] = [];
    filesByDate[d].push(f);
  }
});

function getHash(filePath: string) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

console.log("Checking for duplicates in reports/...");

Object.keys(filesByDate).forEach(date => {
  const group = filesByDate[date];
  if (group.length > 1) {
    console.log(`Date ${date}: found ${group.length} files. Checking for identical content...`);

    // Choose the first one as master (prefer longer filename as it usually has the full ID)
    group.sort((a, b) => b.length - a.length);
    const masterPath = path.join(reportDir, group[0]);
    const masterHash = getHash(masterPath);

    for (let i = 1; i < group.length; i++) {
      const checkPath = path.join(reportDir, group[i]);
      const checkHash = getHash(checkPath);
      if (masterHash === checkHash) {
        console.log(`Deleting identical duplicate: ${group[i]}`);
        fs.unlinkSync(checkPath);
      } else {
        console.log(`Warning: File ${group[i]} for date ${date} has DIFFERENT content. Keeping both.`);
      }
    }
  }
});

console.log("Cleanup complete.");
