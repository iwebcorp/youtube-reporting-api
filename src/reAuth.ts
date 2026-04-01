import * as fs from "fs";
import * as path from "path";

const TOKEN_PATH = path.join(process.cwd(), "token.json");

if (fs.existsSync(TOKEN_PATH)) {
  fs.unlinkSync(TOKEN_PATH);
  console.log("token.json 삭제 완료! 이제 다시 실행하여 재인증하세요.");
} else {
  console.log("token.json 파일이 존재하지 않습니다.");
}
