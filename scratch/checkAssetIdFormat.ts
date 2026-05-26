import * as fs from "fs";
import * as path from "path";

function run(): void {
  const filePath = path.resolve(process.cwd(), process.argv[2] ?? "scratch/red_pub_26_3_top200_asset_ids.json");
  const ids = JSON.parse(fs.readFileSync(filePath, "utf-8")) as string[];
  const valid = ids.filter((value) => /^A\d+$/.test(value));
  const invalid = ids.filter((value) => !/^A\d+$/.test(value));
  console.log(
    JSON.stringify(
      {
        filePath,
        total: ids.length,
        valid: valid.length,
        invalid: invalid.length,
        sampleInvalid: invalid.slice(0, 30),
      },
      null,
      2,
    ),
  );
}

run();
