import * as fs from "fs";
import * as path from "path";

const reportsDir = path.join(process.cwd(), "reports");
const files = fs.readdirSync(reportsDir).filter(f => f.endsWith(".csv"));

const revenueAssets = new Set<string>();
let processedRows = 0;

for (const file of files) {
    const filePath = path.join(reportsDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    
    // 헤더에서 revenue 컬럼 인덱스 찾기 (date,channel_id,video_id,asset_id,claimed_status,uploader_type,country_code,estimated_partner_revenue,...)
    // 보통 7번 인덱스 (0부터 시작)
    
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (cols.length >= 8) {
            const assetId = cols[3];
            const revenue = parseFloat(cols[7]);
            if (assetId && revenue > 0) {
                revenueAssets.add(assetId);
            }
        }
        processedRows++;
    }
}

console.log(`[통계 결과]`);
console.log(`- 분석된 리포트 행 수: ${processedRows}`);
console.log(`- 실제로 수익이 발생한 유니크 자산 수: ${revenueAssets.size}`);
