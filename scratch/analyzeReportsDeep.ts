import * as fs from "fs";
import * as path from "path";

const reportsDir = path.join(process.cwd(), "reports");
const files = fs.readdirSync(reportsDir).filter(f => f.endsWith(".csv"));

const headers = new Set<string>();
const channels = new Set<string>();
let totalRows = 0;

for (const file of files) {
    const filePath = path.join(reportsDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    
    if (lines.length > 0) {
        headers.add(lines[0].trim());
    }
    
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (cols.length > 1) {
            channels.add(cols[1]); // channel_id
            totalRows++;
        }
    }
}

console.log(`[분석 결과]`);
console.log(`- 전체 리포트 파일 수: ${files.length}`);
console.log(`- 발견된 유니크 헤더 종류: ${headers.size}`);
headers.forEach(h => console.log(`  > ${h}`));
console.log(`- 유니크 채널 수: ${channels.size}`);
console.log(`- 전체 데이터 행 수: ${totalRows}`);
