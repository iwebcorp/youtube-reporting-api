import * as fs from "fs";
import * as path from "path";

// 1. 읽어들일 리포트 데이터 경로 (기존 reports 폴더)
const reportDir = path.join(process.cwd(), "reports");
const files = fs.existsSync(reportDir) ? fs.readdirSync(reportDir).filter(f => f.endsWith(".csv")) : [];

if (files.length === 0) {
  console.log("리포트 파일이 없습니다.");
  process.exit(1);
}

// 퍼블리싱 전용 저작 관련 가짜 메타데이터 캐싱
interface PubMockMeta {
  iswc: string;
  hfa: string;
  isrc: string;
  title: string;
  writers: string;
  claimType: string;
  rightType: string;
  ownership: string;
}
const pubMetaCache = new Map<string, PubMockMeta>();

const titles = ["Love Song", "Night Vibes", "Summer Dance", "Acoustic Journey", "City Lights"];
const writers = ["John Doe|Jane Smith", "Alex Brown", "Chris White|Sam Green", "Taylor Blue"];
const compositionTypes = ["Mechanical", "Performance"];

function getPubMockMeta(assetId: string): PubMockMeta {
  if (!pubMetaCache.has(assetId)) {
    pubMetaCache.set(assetId, {
      iswc: `T-${Math.floor(100000000 + Math.random() * 900000000)}-${Math.floor(1+Math.random()*9)}`, // e.g. T-123456789-1
      hfa: `H${Math.floor(1000000 + Math.random() * 9000000)}`,
      isrc: `KRA38${Math.floor(1000000 + Math.random() * 9000000)}`,
      title: titles[Math.floor(Math.random() * titles.length)],
      writers: writers[Math.floor(Math.random() * writers.length)],
      claimType: "Audio",
      rightType: compositionTypes[Math.floor(Math.random() * compositionTypes.length)],
      ownership: "100.00" // 지분율
    });
  }
  return pubMetaCache.get(assetId)!;
}

async function generatePublishingExports() {
  const ws1 = fs.createWriteStream(path.join(process.cwd(), "1_publishing_daily_ad.csv"), "utf-8");
  const ws2 = fs.createWriteStream(path.join(process.cwd(), "2_publishing_daily_ad_alt.csv"), "utf-8");
  const ws3 = fs.createWriteStream(path.join(process.cwd(), "3_publishing_monthly_sub.csv"), "utf-8");
  const ws4 = fs.createWriteStream(path.join(process.cwd(), "4_publishing_ddex_dsr.txt"), "utf-8");

  // 1번 저작 (Publishing 1)
  ws1.write("\uFEFFAsset ID,Asset Labels,Custom ID,ISWC,HFA Song Code,Asset Title,Writers,Music Claim Type,Composition Right Type,Ownership Percentage,Country,Owned Views,Owned Views : Watch Page,Owned Views : Embedded Player,Owned Views : Channel Page,Owned Views : Live,Owned Views : On Demand,Owned Views : Ad-Enabled,YouTube Revenue Split : AdSense Served YouTube Sold,YouTube Revenue Split : DoubleClick Served YouTube Sold,YouTube Revenue Split : DoubleClick Served Partner Sold,YouTube Revenue Split : Partner Served Partner Sold,YouTube Revenue Split,Partner Revenue : AdSense Served YouTube Sold,Partner Revenue : DoubleClick Served YouTube Sold,Partner Revenue : DoubleClick Served Partner Sold,Partner Revenue : Partner Served Partner Sold,Partner Revenue\n");
  
  // 2번 저작 (Publishing 2)
  ws2.write("\uFEFFAdjustment Type,Day,Country,Asset ID,Asset Title,Asset Labels,Asset Channel ID,Asset Type,Custom ID,ISRC,ISWC,HFA Song Code,Writers,Owned Views,YouTube Revenue Split : Auction,YouTube Revenue Split : Reserved,YouTube Revenue Split : Partner Sold YouTube Served,YouTube Revenue Split : Partner Sold Partner Served,YouTube Revenue Split,Partner Revenue : Auction,Partner Revenue : Reserved,Partner Revenue : Partner Sold YouTube Served,Partner Revenue : Partner Sold Partner Served,Partner Revenue\n");
  
  // 3번 저작 (Publishing 3)
  ws3.write("\uFEFFAdjustment Type,Month,Country,Asset ID,Asset Title,Asset Labels,Custom ID,ISRC,ISWC,HFA Song Code,Writers,Composition Right Type,Ownership Percentage,Claim Quality,Revshare Rate Type,Offer,Owned Views,Monetized Views : Audio,Monetized Views : Audio Visual,Monetized Views,YouTube Revenue Split,Partner Revenue : Pro Rata : Audio,Partner Revenue : Pro Rata : Audio Visual,Partner Revenue : Pro Rata,Partner Revenue : Per Sub Min,Partner Revenue\n");

  // 4번 저작 (DDEX DSR 포맷 - Flat File)
  ws4.write("HEAD\tdsrf/1.2/1.2/1.1\tUgcProfileSRB\t1.2\t12471339\t2026-02-04T22:22:26Z\t1\t1\t2026-03-01\t2026-03-31\tPADPIDA2013020802I\tYouTube\tUsage-HardwareAudioTier-Combined-All\tkwangsoomedia-pla\tkwangsoomedia_pla\t\n");
  
  console.log(`총 ${files.length}개의 리포트(한달치)에서 퍼블리싱 저작권 관련 CSV 추출을 시작합니다...`);

  const monthlySubData = new Map<string, { views: number, revenue: number, country: string }>();
  let srRecordCount = 1; // DDEX SR 레코드 카운터

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

        if (revenue === "0" && subRevenue === "0") continue; 

        const meta = getPubMockMeta(assetId);

        // 1번 저작 (비율 높음)
        if (parseFloat(revenue) > 0) {
            const views = Math.floor(Math.random() * 100);
            
            // Format 1
            ws1.write(`${assetId},,,${meta.iswc},${meta.hfa},"${meta.title}","${meta.writers}",${meta.claimType},${meta.rightType},${meta.ownership},${country},${views},${views},0,0,0,0,0,0,0,0,0,0,${revenue},0,0,0,${revenue}\n`);
            
            // Format 2 (Adjustment, 발생 비율 낮음 방지용 1%만 생성)
            if (Math.random() < 0.01) {
                ws2.write(`Regular,${date},${country},${assetId},"${meta.title}","",${channelId},Composition,,${meta.isrc},${meta.iswc},${meta.hfa},"${meta.writers}",${views},0,0,0,0,0,${revenue},0,0,0,${revenue}\n`);
            }
        }

        // 3번 저작 (월별 Sub 집계)
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

  // 3번 월별 & 4번 DDEX 요약 출력
  for (const [key, data] of monthlySubData.entries()) {
      const assetId = key.split("_")[0];
      const meta = getPubMockMeta(assetId);
      
      // 3번 쓰기
      ws3.write(`Regular,202603,${data.country},${assetId},"${meta.title}","",,${meta.isrc},${meta.iswc},${meta.hfa},"${meta.writers}",${meta.rightType},${meta.ownership},Verified,Standard,Default,${data.views},${data.views},0,${data.views},0.00,${data.revenue.toFixed(5)},0.00,${data.revenue.toFixed(5)},0.00,${data.revenue.toFixed(5)}\n`);
      
      // 4번: DDEX SR02 레코드 모킹 (Summary record)
      if (Math.random() < 0.05) { // 아주 일부만 추출하여 2MB 사이즈 모방
          ws4.write(`#GSY09\t${srRecordCount}\t${data.country}\tUsage-HardwareAudioTier-Music-All\t1813887\t${data.views}\t${data.revenue.toFixed(2)}\t0.00\tUSD\t${meta.rightType}\n`);
          srRecordCount++;
      }
  }

  ws4.write(`#SRFO\t${srRecordCount - 1}\t${srRecordCount - 1}\n`); // Footer

  // 스트림 종료
  await Promise.all([
    new Promise(r => ws1.end(r)),
    new Promise(r => ws2.end(r)),
    new Promise(r => ws3.end(r)),
    new Promise(r => ws4.end(r))
  ]);

  console.log("✅ 총 4개의 퍼블리싱(저작권)용 CSV/TSV 파일 추출이 완료되었습니다!");
}

generatePublishingExports().catch(console.error);
