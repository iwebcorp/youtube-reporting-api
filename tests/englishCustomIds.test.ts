// 전달용 CSV의 영문 Custom ID 조회·교체와 확인 목록 갱신을 임시 파일로 검증한다.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import nativeFs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import iconv from "iconv-lite";
import { parse } from "csv-parse/sync";
import { PACKAGE_FILES, getMonthlyPaths } from "../src/monthlyReadiness.ts";
import { englishCustomIdReportPath, listEnglishCustomIdAssets, replaceEnglishCustomIds, reviewEnglishCustomIds } from "../src/englishCustomIds.ts";
import { normalizeCustomId } from "../src/reporting/utils.ts";

test("추출 시 단일 영문 값과 앞자리 0은 보존하고 복수 값은 공란 처리한다", () => {
  for (const value of ["abc123", "o6RnLdZLTjE", "00123", "0_sCtaY2Yjs", "Song ABC"]) assert.equal(normalizeCustomId(value), value);
  for (const value of ["abc;def", "abc|def", "abc,def", "", "123-456"]) assert.equal(normalizeCustomId(value), "");
});

test("전달용 CSV 조회·저장과 목록 갱신", async (t) => {
  const previousCwd = process.cwd();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "english-custom-ids-test-"));
  process.chdir(directory);
  t.after(() => { process.chdir(previousCwd); fs.rmSync(directory, { recursive: true, force: true }); });
  const month = "202609";
  const { packageDir } = getMonthlyPaths(month);
  fs.mkdirSync(packageDir);
  for (const file of PACKAGE_FILES) fs.writeFileSync(path.join(packageDir, file), "Asset ID,Asset Title,Custom ID,Partner Revenue\n");
  const adPath = path.join(packageDir, "1_neighboring_daily_ad.csv");
  const subPath = path.join(packageDir, "3_neighboring_monthly_sub.csv");
  const pubPath = path.join(packageDir, "1_publishing_daily_ad.csv");
  fs.writeFileSync(adPath, iconv.encode('Asset Summary\nAsset ID,Asset Title,Custom ID,Partner Revenue\nA,한글 곡,abc123,1.25\nA,한글 곡,abc123,2\nA,한글 곡,,3\nB,숫자,00123,4\nC,복수,"abc;def",5\nD,값 충돌,alpha,6\nE,미입력,otherA,7\n', "cp949"));
  fs.writeFileSync(subPath, '\ufeffAsset ID,Asset Title,Custom ID,Partner Revenue\nA,한글 곡,abc123,8\nD,값 충돌,123,9\n');
  fs.writeFileSync(pubPath, 'Asset ID,Asset Title,Custom ID,Partner Revenue\nP,저작 곡,pubA,10\n');
  const originals = new Map(PACKAGE_FILES.map((file) => [file, fs.readFileSync(path.join(packageDir, file))]));

  await t.test("중복 행을 묶고 복수 값·서로 다른 값·숫자·공란을 제외한다", async () => {
    const assets = await reviewEnglishCustomIds(month);
    assert.deepEqual(assets.map((asset) => asset.assetId), ["A", "E", "P"]);
    assert.equal(assets[0]?.currentValue, "abc123");
    assert.equal(assets[0]?.assetTitle, "한글 곡");
    assert.equal(assets[0]?.rows, 3);
    assert.deepEqual(assets[0]?.files, ["1_neighboring_daily_ad.csv", "3_neighboring_monthly_sub.csv"]);
    const report = fs.readFileSync(englishCustomIdReportPath(month), "utf8");
    assert.ok(report.startsWith("\ufeff"));
    assert.equal(parse(report, { bom: true, columns: true }).length, 3);
    for (const [file, before] of originals) assert.deepEqual(fs.readFileSync(path.join(packageDir, file)), before);
  });

  await t.test("숫자 외 입력·대상 외 자산·오래된 기존 값을 거부하고 CSV를 보존한다", async () => {
    for (const input of [
      { A: { currentValue: "abc123", value: "12X" } },
      { B: { currentValue: "00123", value: "999" } },
      { A: { currentValue: "oldValue", value: "999" } },
      { A: { currentValue: "abc123", value: "" } },
    ]) await assert.rejects(replaceEnglishCustomIds(month, input));
    for (const [file, before] of originals) assert.deepEqual(fs.readFileSync(path.join(packageDir, file)), before);
  });

  await t.test("두 번째 파일 교체가 실패하면 먼저 교체한 파일도 원본으로 복원한다", async (testContext) => {
    const originalRename = nativeFs.renameSync;
    const mocked = testContext.mock.method(nativeFs, "renameSync", (source, destination) => {
      if (String(source) === subPath && String(destination).endsWith(".original")) {
        const error = new Error("simulated file lock") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      }
      return originalRename(source, destination);
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(replaceEnglishCustomIds(month, { A: { currentValue: "abc123", value: "999" } }), /Excel을 닫고/);
    } finally {
      mocked.mock.restore();
      syncBuiltinESMExports();
    }
    for (const [file, before] of originals) assert.deepEqual(fs.readFileSync(path.join(packageDir, file)), before);
    assert.equal(fs.readdirSync(packageDir).some((file) => file.startsWith(".custom-id-")), false);
    assert.deepEqual((await reviewEnglishCustomIds(month)).map((asset) => asset.assetId), ["A", "E", "P"]);
  });

  await t.test("해당 월의 기존 값과 일치하는 행만 수정하고 인코딩·숫자·공란·미입력 자산을 보존한다", async () => {
    const otherMonthDir = getMonthlyPaths("202608").packageDir;
    fs.mkdirSync(otherMonthDir);
    fs.copyFileSync(adPath, path.join(otherMonthDir, "1_neighboring_daily_ad.csv"));
    const result = await replaceEnglishCustomIds(month, {
      A: { currentValue: "abc123", value: "0012345" },
      E: { currentValue: "otherA", value: "" },
    });
    assert.deepEqual(result, { updatedAssets: 1, updatedRows: 3, remainingAssets: 2 });
    const ad = iconv.decode(fs.readFileSync(adPath), "cp949");
    assert.ok(ad.startsWith("Asset Summary\n"));
    assert.ok(ad.includes("A,한글 곡,0012345,1.25"));
    assert.ok(ad.includes("A,한글 곡,,3"));
    assert.ok(ad.includes("B,숫자,00123,4"));
    assert.ok(ad.includes("E,미입력,otherA,7"));
    const sub = fs.readFileSync(subPath, "utf8");
    assert.ok(sub.startsWith("\ufeff"));
    assert.ok(sub.includes("A,한글 곡,0012345,8"));
    assert.deepEqual(fs.readFileSync(path.join(otherMonthDir, "1_neighboring_daily_ad.csv")), originals.get("1_neighboring_daily_ad.csv"));
    assert.deepEqual(fs.readFileSync(pubPath), originals.get("1_publishing_daily_ad.csv"));
    assert.deepEqual((await reviewEnglishCustomIds(month)).map((asset) => asset.assetId), ["E", "P"]);
    const report = parse(fs.readFileSync(englishCustomIdReportPath(month), "utf8"), { bom: true, columns: true });
    assert.deepEqual(report.map((row: Record<string, string>) => row["Asset ID"]), ["E", "P"]);
  });

  await t.test("외부 CSV 변경을 다시 읽고 모든 수정이 끝나면 목록을 헤더만 남긴다", async () => {
    fs.appendFileSync(pubPath, "Q,외부 추가,newA,11\n");
    assert.deepEqual((await reviewEnglishCustomIds(month)).map((asset) => asset.assetId), ["E", "P", "Q"]);
    await replaceEnglishCustomIds(month, {
      E: { currentValue: "otherA", value: "88" },
      P: { currentValue: "pubA", value: "99" },
      Q: { currentValue: "newA", value: "00" },
    });
    assert.equal((await listEnglishCustomIdAssets(packageDir)).length, 0);
    assert.equal(parse(fs.readFileSync(englishCustomIdReportPath(month), "utf8"), { bom: true, columns: true }).length, 0);
    fs.unlinkSync(englishCustomIdReportPath(month));
    await reviewEnglishCustomIds(month);
    assert.ok(fs.existsSync(englishCustomIdReportPath(month)));
  });
});
