import { getAuthClient } from "../src/auth.js";

async function run() {
  console.log("--- Starting Re-Authentication Process ---");
  try {
    const auth = await getAuthClient();
    console.log("✅ Current Auth Valid (Token exists)");
  } catch (err) {
    console.error("Auth process error.");
  }
}

run();
