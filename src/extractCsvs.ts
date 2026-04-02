import * as fs from "fs";
import * as path from "path";

// --- 추출 설정 (여기서 원하는 기간을 정하세요) ---
const START_DATE = "2026-01-13"; // 시작일 (YYYY-MM-DD)
const END_DATE = "2026-02-27";   // 종료일 (YYYY-MM-DD)
const DATE_FILTER = "";          // 특정 문구 필터 (예: "2026-03"), 값이 있으면 위 날짜 범위보다 우선함

const reportDir = path.join(process.cwd(), "reports");
const allFiles = fs.existsSync(reportDir) ? fs.readdirSync(reportDir).filter(f => f.endsWith(".csv")) : [];

// 설정된 값에 따라 파일 필터링
let files = allFiles;
if (DATE_FILTER) {
  files = allFiles.filter(f => f.includes(DATE_FILTER));
  console.log(`\n[필터 적용] "${DATE_FILTER}" 문구가 포함된 리포트만 처리합니다. (총 ${files.length}개)`);
} else if (START_DATE && END_DATE) {
  const start = new Date(START_DATE);
  const end = new Date(END_DATE);
  
  // 날짜 비교를 위해 시간 제거 (00:00:00 기준)
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  files = allFiles.filter(f => {
    const match = f.match(/report_(\d{4}-\d{2}-\d{2})/);
    if (!match || !match[1]) return false;
    const fileDate = new Date(match[1]);
    return fileDate >= start && fileDate <= end;
  });
  console.log(`\n[기간 설정] ${START_DATE} ~ ${END_DATE} 범위의 리포트만 처리합니다. (총 ${files.length}개)`);
} else {
  console.log(`\n[전체 처리] 모든 리포트 파일을 처리합니다. (총 ${files.length}개)`);
}

if (files.length === 0) {
  console.log("조건에 맞는 리포트 파일이 없습니다. 설정을 확인해 주세요.");
  process.exit(1);
}

// 일관된 가짜 메타데이터 캐싱
interface MockMeta {
  isrc: string;
  upc: string;
  title: string;
  artist: string;
  label: string;
}
const assetMetaCache = new Map<string, MockMeta>();

const titles = ["Love Song", "Night Vibes", "Summer Dance", "Acoustic Journey", "City Lights"];
const artists = ["Artist A", "Artist B", "Band C", "Singer D"];
const labels = ["My Music Label", "Indie Records", "Big Sound", "Global Hit"];

function getMockMeta(assetId: string): MockMeta {
  if (!assetMetaCache.has(assetId)) {
    assetMetaCache.set(assetId, {
      isrc: `KRA38${Math.floor(1000000 + Math.random() * 9000000)}`,
      upc: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
      title: titles[Math.floor(Math.random() * titles.length)],
      artist: artists[Math.floor(Math.random() * artists.length)],
      label: labels[Math.floor(Math.random() * labels.length)]
    });
  }
  return assetMetaCache.get(assetId)!;
}

async function generateMonthlyExports() {
  const ws1 = fs.createWriteStream(path.join(process.cwd(), "1_neighboring_daily_ad.csv"), "utf-8");
  const ws2 = fs.createWriteStream(path.join(process.cwd(), "2_neighboring_daily_ad_alt.csv"), "utf-8");
  const ws3 = fs.createWriteStream(path.join(process.cwd(), "3_neighboring_monthly_sub.csv"), "utf-8");
  const ws4 = fs.createWriteStream(path.join(process.cwd(), "4_neighboring_daily_video.csv"), "utf-8");

  ws1.write("\uFEFFAdjustment Type,Day,Country,Asset ID,Asset Title,Asset Labels,Asset Channel ID,Asset Type,Custom ID,ISRC,UPC,GRid,Artist,Album,Label,Administer Publish Rights,Owned Views,YouTube Revenue Split : Auction,YouTube Revenue Split : Reserved,YouTube Revenue Split : Partner Sold YouTube Served,YouTube Revenue Split : Partner Sold Partner Served,YouTube Revenue Split,Partner Revenue : Auction,Partner Revenue : Reserved,Partner Revenue : Partner Sold YouTube Served,Partner Revenue : Partner Sold Partner Served,Partner Revenue\n");
  ws2.write("\uFEFFAdjustment Type,Day,Country,Asset ID,Asset Title,Asset Labels,Asset Channel ID,Asset Type,Custom ID,ISRC,UPC,GRid,Artist,Album,Label,Administer Publish Rights,Owned Views,YouTube Revenue Split : Auction,YouTube Revenue Split : Reserved,\"YouTube Revenue Split : Partner Sold YouTube\n  Served\",\"YouTube Revenue Split : Partner Sold Partner\n  Served\",YouTube Revenue Split,Partner Revenue : Auction,Partner Revenue : Reserved,Partner Revenue : Partner Sold YouTube Served,Partner Revenue : Partner Sold Partner Served,Partner Revenue\n");
  ws3.write("\uFEFFAdjustment Type,Month,Country,Asset ID,Asset Title,Asset Labels,Asset Type,Custom ID,ISRC,UPC,GRID,Artist,Album,Label,Claim Type,Content Type,Offer,Owned Views,Monetized Views : Audio,Monetized Views : Audio Visual,Monetized Views,YouTube Revenue Split,Partner Revenue : Pro Rata : Audio,Partner Revenue : Pro Rata : Audio Visual,Partner Revenue : Pro Rata,Partner Revenue : Per Sub Min,Partner Revenue\n");
  ws4.write("\uFEFFAdjustment Type,Date,Country,Video ID,Asset ID,Asset Title,Asset Labels,Custom ID,ISRC,Upc,Grid,Artist,Album,Label,Owned Views,YouTube Revenue Split,Partner Revenue Pro Rata,Partner Revenue Per Play Min,Partner Revenue\n");

  const processLabel = DATE_FILTER ? `${DATE_FILTER} 기간` : (START_DATE && END_DATE ? `${START_DATE} ~ ${END_DATE} 기간` : "전체");
  console.log(`총 ${files.length}개의 리포트(${processLabel} 데이터)를 처리합니다... 시간이 다소 소요될 수 있습니다.`);

  // Subscription (3번)은 월별 집계이므로 메모리에 우선 자산별로 합산합니다.
  const monthlySubData = new Map<string, { views: number, revenue: number, country: string }>();

  // 전체 파일 순회 (비동기로 스트림 처리보다 동기 readFileSync가 빠르고 간편할 수 있으나, 메모리 안정성을 위해 파일별로 처리)
  for (const file of files) {
    const filePath = path.join(reportDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(",");
        const date = cols[0] || "";
        const channelId = cols[1] || "";
        const videoId = cols[2] || "";
        const assetId = cols[3] || "A000000000000000";
        const country = cols[6] || "KR";
        const revenue = cols[7] || "0";
        const subRevenue = cols[11] || "0"; 

        if (revenue === "0" && subRevenue === "0") continue; // 빈 수익 무시

        const meta = getMockMeta(assetId);

        // 1번 (Daily Ad Revenue 기록 - 230MB 타겟으로 전체 기록 수행)
        if (parseFloat(revenue) > 0) {
            const views = Math.floor(Math.random() * 100);
            const rowBase = `Regular,${date},${country},${assetId},"${meta.title}","",${channelId},Sound Recording,,${meta.isrc},${meta.upc},,${meta.artist},"Album of ${meta.artist}",${meta.label},No,${views},0,0,0,0,0,${revenue},0,0,0,${revenue}\n`;
            ws1.write(rowBase);
            
            // 2번: (Prior Month Adjustment 등 특수 양식: 발생 확률 0.05%로 줄여서 100~200KB 용량 타겟화)
            if (Math.random() < 0.0005) {
                ws2.write(rowBase.replace("Regular", "Prior Month")); 
            }
            
            // 4번: Video 레벨 Transaction 등 양식 (발생 확률 약 1~2%로 줄여서 2MB 용량 타겟화)
            if (Math.random() < 0.015) {
                ws4.write(`Regular,${date},${country},${videoId},${assetId},"${meta.title}",,,${meta.isrc},${meta.upc},,${meta.artist},"Album of ${meta.artist}",${meta.label},${views},0.00,${revenue},0.00,${revenue}\n`);
            }
        }

        // 3번: 월별 집계 데이터 쌓기 (80MB 대역 사이즈)
        if (parseFloat(subRevenue) > 0) {
            const key = `${assetId}_${country}`;
            if (!monthlySubData.has(key)) {
                monthlySubData.set(key, { views: 0, revenue: 0, country });
            }
            const current = monthlySubData.get(key)!;
            current.views += Math.floor(Math.random() * 10);
            current.revenue += parseFloat(subRevenue);
        }
    }
  }

  // 집계가 끝난 3번 월별 리포트 데이터 쓰기
  for (const [key, data] of monthlySubData.entries()) {
      const assetId = key.split("_")[0];
      const meta = getMockMeta(assetId);
      
      const firstFile = files[0] || "";
      const dateMatch = firstFile.match(/report_(\d{4})-(\d{2})/); // 2026-03 -> 202603 추출 시도
      const displayMonth = dateMatch ? `${dateMatch[1]}${dateMatch[2]}` : "202603";
      
      ws3.write(`Regular,${displayMonth},${data.country},${assetId},"${meta.title}","",Sound Recording,,${meta.isrc},${meta.upc},,${meta.artist},"Album of ${meta.artist}",${meta.label},Audio,Premium,Default,${data.views},${data.views},0,${data.views},0.00,${data.revenue.toFixed(5)},0.00,${data.revenue.toFixed(5)},0.00,${data.revenue.toFixed(5)}\n`);
  }

  // 스트림 종료 대기
  await Promise.all([
    new Promise(r => ws1.end(r)),
    new Promise(r => ws2.end(r)),
    new Promise(r => ws3.end(r)),
    new Promise(r => ws4.end(r))
  ]);

  console.log("✅ 총 4개의 '한 달 치' 클라이언트용 CSV 파일 (사이즈 조정 반영) 추출이 완료되었습니다!");
}

generateMonthlyExports().catch(console.error);

