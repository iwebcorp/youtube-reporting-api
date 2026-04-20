import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as url from "url";

const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const SCOPES = [
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
  "https://www.googleapis.com/auth/youtubepartner",
  "https://www.googleapis.com/auth/youtube",
];

async function getAuthClient(): Promise<OAuth2Client> {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret, redirect_uris } = credentials.web;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    // redirect_uris[0],
    "http://localhost",
  );

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    oauth2Client.setCredentials(token);
    return oauth2Client;
  }

  return authorizeNewToken(oauth2Client);
}

async function authorizeNewToken(
  oauth2Client: OAuth2Client,
): Promise<OAuth2Client> {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  console.log("브라우저에서 아래 URL을 열어주세요:\n", authUrl);
  fs.writeFileSync("auth_url.txt", authUrl);
  console.log("URL이 auth_url.txt 파일에도 저장되었습니다.");

  const code = await waitForCode();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  console.log("token.json 저장 완료!");

  return oauth2Client;
}

function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const qs = url.parse(req.url || "", true).query;
      if (qs.code) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("인증 완료! 터미널로 돌아가세요.");
        server.close();
        resolve(qs.code as string);
      }
    });
    server.on("error", (err) => {
      console.error("서버 에러:", err);
      reject(err);
    });
    server.listen(80, () => {
      console.log("localhost:80 대기 중...");
    });
  });
}

export { getAuthClient };
