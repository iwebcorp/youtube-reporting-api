// 월 선택과 단계 실행 및 실시간 로그 표시를 담당하는 브라우저 코드
const monthInput = document.querySelector("#yearMonth");
const runButton = document.querySelector("#runButton");
const stopButton = document.querySelector("#stopButton");
const openButton = document.querySelector("#openButton");
const openSettlementButton = document.querySelector("#openSettlementButton");
const rateControl = document.querySelector("#rateControl");
const exchangeRateInput = document.querySelector("#exchangeRate");
const clearButton = document.querySelector("#clearButton");
const logOutput = document.querySelector("#logOutput");
const notice = document.querySelector("#notice");
const runBadge = document.querySelector("#runBadge");
const customIdWarning = document.querySelector("#customIdWarning");
const customIdWarningText = document.querySelector("#customIdWarningText");
const openCustomIdButton = document.querySelector("#openCustomIdButton");
const customIdButton = document.querySelector("#customIdButton");
const customIdDialog = document.querySelector("#customIdDialog");
const customIdForm = document.querySelector("#customIdForm");
const customIdRows = document.querySelector("#customIdRows");
const customIdCancel = document.querySelector("#customIdCancel");
const customIdSave = document.querySelector("#customIdSave");
const customIdDialogNotice = document.querySelector("#customIdDialogNotice");
const englishIdButton = document.querySelector("#englishIdButton");
const englishIdDialog = document.querySelector("#englishIdDialog");
const englishIdForm = document.querySelector("#englishIdForm");
const englishIdRows = document.querySelector("#englishIdRows");
const englishIdSave = document.querySelector("#englishIdSave");
const englishIdCancel = document.querySelector("#englishIdCancel");
const englishIdNotice = document.querySelector("#englishIdNotice");
const englishIdSummary = document.querySelector("#englishIdSummary");
const openEnglishIdButton = document.querySelector("#openEnglishIdButton");
const stageInputs = [...document.querySelectorAll('.stage-row input[type="checkbox"]')];
let readiness = null;
let runState = { running: false };
let englishAssets = null;
let englishLoading = false;
let englishDialogMonth = "";

function previousMonth() {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function compactMonth() {
  return monthInput.value.replace("-", "");
}

function selectedSteps() {
  return stageInputs.filter((input) => input.checked).map((input) => input.value);
}

function setStatus(stage, text, kind) {
  const status = document.querySelector(`[data-stage="${stage}"] .stage-status`);
  status.textContent = text;
  status.className = `stage-status ${kind}`;
}

function renderReadiness() {
  if (!readiness) return;
  setStatus("raw", readiness.raw.ready ? `준비 완료 ${readiness.raw.present}/${readiness.raw.expected}` : `${readiness.raw.present}/${readiness.raw.expected}`, readiness.raw.ready ? "ready" : "missing");
  setStatus("managed", readiness.managed.ready ? `준비 완료 ${readiness.managed.present}/${readiness.managed.expected}` : `${readiness.managed.present}/${readiness.managed.expected}`, readiness.managed.ready ? "ready" : "missing");
  setStatus("extract", readiness.extract.ready ? `생성 완료 ${readiness.extract.present}/${readiness.extract.expected}` : "생성 필요", readiness.extract.ready ? "ready" : "waiting");
  const warning = readiness.customIdWarning;
  const blankRows = warning ? warning.blankRows : 0;
  if (!readiness.extract.ready) setStatus("customId", "추출 필요", "waiting");
  else if (blankRows > 0) setStatus("customId", `공란 ${blankRows}행 · 자산 ${warning.blankAssets}개`, "missing");
  else if (englishLoading) setStatus("customId", "영문 값 검사 중", "loading");
  else if (englishAssets === null) setStatus("customId", "영문 값 확인 필요", "waiting");
  else if (englishAssets.length > 0) setStatus("customId", `영문 ${englishAssets.length}개 자산`, "missing");
  else setStatus("customId", "입력 완료", "ready");
  if (!readiness.extract.ready || blankRows > 0 || englishAssets === null || englishAssets.length > 0) setStatus("settle", "4단계 완료 필요", "waiting");
  else if (readiness.settle.stale) setStatus("settle", "다시 계산 필요", "missing");
  else setStatus("settle", readiness.settle.ready ? `생성 완료 ${readiness.settle.present}/${readiness.settle.expected}` : "생성 필요", readiness.settle.ready ? "ready" : "waiting");
  renderCustomIdButton();

  customIdWarning.hidden = !warning;
  if (warning) {
    const messages = [];
    if (warning.blankRows > 0) {
      messages.push(`Custom ID 공란 ${warning.blankRows}행(자산 ${warning.blankAssets}개)은 값이 없거나 사용할 수 없는 값입니다. 4단계에서 공란 입력과 영문 값 수정을 마친 뒤 정산금 계산을 실행해 주세요.`);
    }
    if (warning.noteRows > 0) {
      messages.push(`참고: CMS에 Custom ID가 여러 개 등록된 곡 ${warning.noteAssets}개는 정산 보고서 값을 사용했습니다. CMS 정리가 필요한지 목록에서 확인해 주세요.`);
    }
    customIdWarningText.textContent = messages.join(" ");
  }
}

function renderCustomIdButton() {
  const blankRows = readiness?.customIdWarning ? readiness.customIdWarning.blankRows : 0;
  customIdButton.disabled = runState.running || englishLoading || !readiness?.extract.ready || blankRows === 0;
  englishIdButton.disabled = runState.running || englishLoading || !readiness?.extract.ready;
  englishIdButton.textContent = englishLoading ? "영문 값 검사 중…" : `영문 Custom ID 수정${englishAssets?.length ? ` (${englishAssets.length})` : ""}`;
}

function renderRunState() {
  runBadge.textContent = runState.running ? "실행 중" : runState.exitCode === 0 ? "완료" : runState.exitCode ? "오류" : "대기 중";
  runBadge.className = `run-badge ${runState.running ? "running" : runState.exitCode === 0 ? "complete" : runState.exitCode ? "error" : "idle"}`;
  runButton.disabled = runState.running || englishLoading;
  stopButton.disabled = !runState.running;
  monthInput.disabled = runState.running;
  stageInputs.forEach((input) => { input.disabled = runState.running; });
  const settle = stageInputs.find((input) => input.value === "settle");
  const customIdsComplete = readiness?.extract.ready && (readiness.customIdWarning?.blankRows ?? 0) === 0 && englishAssets?.length === 0 && !englishLoading;
  settle.disabled = runState.running || !customIdsComplete;
  if (!customIdsComplete) settle.checked = false;
  exchangeRateInput.disabled = settle.disabled;
  renderCustomIdButton();
}

// 추출은 Raw·System-managed 데이터가 있어야 한다.
function enforceExtractPrerequisites() {
  const extract = stageInputs.find((input) => input.value === "extract");
  const settle = stageInputs.find((input) => input.value === "settle");
  if (settle.disabled) settle.checked = false;
  if (!readiness) return;
  const added = [];
  if (!extract.checked) return;
  for (const stage of ["raw", "managed"]) {
    if (!readiness[stage].ready) {
      const input = stageInputs.find((candidate) => candidate.value === stage);
      if (!input.checked) added.push(stage === "raw" ? "Raw Data" : "System-managed Data");
      input.checked = true;
    }
  }
  notice.textContent = added.length > 0 ? `선행 단계가 자동 선택되었습니다. ${added.join(", ")}` : "";
}

async function refreshStatus() {
  if (!monthInput.value) return;
  const yearMonth = compactMonth();
  try {
    const response = await fetch(`/api/status?yearMonth=${yearMonth}`);
    const data = await response.json();
    if (yearMonth !== compactMonth()) return;
    if (!response.ok) throw new Error(data.error);
    readiness = data.readiness;
    runState = data.run;
    renderReadiness();
    renderRunState();
    enforceExtractPrerequisites();
    if (readiness.extract.ready && !runState.running && !englishLoading) await loadEnglishCustomIds();
  } catch (error) {
    notice.textContent = error.message;
  }
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

monthInput.addEventListener("change", () => {
  notice.textContent = "";
  readiness = null;
  englishAssets = null;
  renderRunState();
  setStatus("settle", "확인 중", "loading");
  refreshStatus();
});

stageInputs.forEach((input) => input.addEventListener("change", () => {
  enforceExtractPrerequisites();
  if (!input.checked && ["raw", "managed", "extract"].includes(input.value)) enforceExtractPrerequisites();
}));

// 환율 칸 주변 글자를 눌러도 단계 체크가 바뀌지 않게 하고, 환율을 입력하면 정산금 계산 단계를 선택한다.
rateControl.addEventListener("click", (event) => {
  if (event.target === exchangeRateInput) return;
  event.preventDefault();
  exchangeRateInput.focus();
});
exchangeRateInput.addEventListener("input", () => {
  const settle = stageInputs.find((input) => input.value === "settle");
  if (!settle.disabled && exchangeRateInput.value.trim() && !settle.checked) {
    settle.checked = true;
    enforceExtractPrerequisites();
  }
});

runButton.addEventListener("click", async () => {
  enforceExtractPrerequisites();
  const steps = selectedSteps();
  if (steps.length === 0) {
    notice.textContent = "실행할 단계를 하나 이상 선택해 주세요.";
    return;
  }
  const exchangeRate = exchangeRateInput.value.replace(/,/g, "").trim();
  if (steps.includes("settle") && !(/^\d+(\.\d+)?$/.test(exchangeRate) && Number(exchangeRate) > 0)) {
    notice.textContent = "정산금 계산에 사용할 환율(원/USD)을 숫자로 입력해 주세요.";
    exchangeRateInput.focus();
    return;
  }
  const blankRows = readiness?.customIdWarning ? readiness.customIdWarning.blankRows : 0;
  if (steps.includes("settle") && !steps.includes("extract") && blankRows > 0) {
    notice.textContent = `Custom ID 공란 ${blankRows}행이 남아 있습니다. 4단계 Custom ID 입력을 마친 뒤 정산금 계산을 실행해 주세요.`;
    return;
  }
  try {
    notice.textContent = "";
    logOutput.textContent = "";
    const data = await postJson("/api/run", { yearMonth: compactMonth(), steps, exchangeRate });
    for (const input of stageInputs) input.checked = data.steps.includes(input.value);
  } catch (error) {
    notice.textContent = error.message;
  }
});

stopButton.addEventListener("click", async () => {
  try {
    await postJson("/api/stop");
  } catch (error) {
    notice.textContent = error.message;
  }
});

openButton.addEventListener("click", async () => {
  try {
    await postJson("/api/open-output", { yearMonth: compactMonth() });
  } catch (error) {
    notice.textContent = error.message;
  }
});

openSettlementButton.addEventListener("click", async () => {
  try {
    await postJson("/api/open-settlement", { yearMonth: compactMonth() });
  } catch (error) {
    notice.textContent = error.message;
  }
});

openCustomIdButton.addEventListener("click", async () => {
  try {
    await postJson("/api/open-custom-id", { yearMonth: compactMonth() });
  } catch (error) {
    notice.textContent = error.message;
  }
});

// 4단계: 공란 Custom ID를 Asset ID별로 받아 전달 파일 원본에 저장한다.
function renderCustomIdRows(assets, target = customIdRows, english = false) {
  target.replaceChildren(...assets.map((asset) => {
    const row = document.createElement("tr");
    const input = document.createElement("input");
    input.type = "text";
    input.name = asset.assetId;
    input.autocomplete = "off";
    if (english) {
      input.inputMode = "numeric";
      input.pattern = "[0-9]+";
      input.title = "숫자만 입력해 주세요. 앞자리 0은 유지됩니다.";
      input.dataset.currentValue = asset.currentValue;
    }
    input.setAttribute("aria-label", `${asset.assetId} Custom ID`);
    const cells = [asset.assetId, asset.assetTitle, ...(english ? [asset.currentValue] : []), `${asset.rows}행 · ${asset.files.join(", ")}`].map((text) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      return cell;
    });
    const inputCell = document.createElement("td");
    inputCell.append(input);
    row.append(...cells, inputCell);
    return row;
  }));
}

customIdButton.addEventListener("click", async () => {
  try {
    const response = await fetch(`/api/custom-ids?yearMonth=${compactMonth()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (data.assets.length === 0) {
      notice.textContent = "입력할 Custom ID 공란이 없습니다.";
      refreshStatus();
      return;
    }
    renderCustomIdRows(data.assets);
    customIdDialogNotice.textContent = "";
    customIdDialog.showModal();
    customIdRows.querySelector("input")?.focus();
  } catch (error) {
    notice.textContent = error.message;
  }
});

customIdCancel.addEventListener("click", () => customIdDialog.close());
customIdDialog.addEventListener("cancel", (event) => {
  if (customIdSave.disabled) event.preventDefault();
});

customIdForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (customIdSave.disabled) return;
  const values = Object.fromEntries([...customIdRows.querySelectorAll("input")]
    .map((input) => [input.name, input.value.trim()])
    .filter(([, value]) => value));
  if (Object.keys(values).length === 0) {
    customIdDialogNotice.textContent = "저장할 Custom ID를 하나 이상 입력해 주세요.";
    return;
  }
  customIdSave.disabled = true;
  customIdCancel.disabled = true;
  try {
    const result = await postJson("/api/custom-ids", { yearMonth: compactMonth(), values });
    customIdDialog.close();
    await refreshStatus();
    notice.textContent = `Custom ID ${result.filledRows}행을 저장했습니다.${result.remainingRows > 0 ? ` 남은 공란 ${result.remainingRows}행` : ""}`;
  } catch (error) {
    customIdDialogNotice.textContent = error.message;
  } finally {
    customIdSave.disabled = false;
    customIdCancel.disabled = false;
  }
});

async function loadEnglishCustomIds() {
  if (englishLoading) return false;
  const yearMonth = compactMonth();
  englishLoading = true;
  englishAssets = null;
  renderReadiness();
  renderRunState();
  try {
    const response = await fetch(`/api/english-custom-ids?yearMonth=${yearMonth}`);
    const data = await response.json();
    if (yearMonth !== compactMonth() || runState.running) return false;
    if (!response.ok) throw new Error(data.error);
    englishAssets = data.assets;
    return true;
  } catch (error) {
    notice.textContent = error.message;
    return false;
  } finally {
    englishLoading = false;
    renderReadiness();
    renderRunState();
    if (yearMonth !== compactMonth()) refreshStatus();
  }
}

englishIdButton.addEventListener("click", async () => {
  if (!await loadEnglishCustomIds()) return;
  englishDialogMonth = compactMonth();
  renderCustomIdRows(englishAssets, englishIdRows, true);
  englishIdSummary.textContent = englishAssets.length > 0
    ? `${englishAssets.length}개 자산 · ${englishAssets.reduce((sum, asset) => sum + asset.rows, 0)}행이 수정 대상입니다.`
    : "수정할 단일 영문 Custom ID가 없습니다. 전달용 CSV 검사를 마쳤습니다.";
  englishIdNotice.textContent = "";
  englishIdSave.disabled = englishAssets.length === 0;
  englishIdDialog.showModal();
  (englishIdRows.querySelector("input") ?? englishIdCancel).focus();
});

let englishSaving = false;
englishIdCancel.addEventListener("click", () => englishIdDialog.close());
englishIdDialog.addEventListener("cancel", (event) => { if (englishSaving) event.preventDefault(); });
openEnglishIdButton.addEventListener("click", async () => {
  try {
    await postJson("/api/open-english-custom-id", { yearMonth: englishDialogMonth });
  } catch (error) {
    englishIdNotice.textContent = error.message;
  }
});
englishIdForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (englishSaving) return;
  const values = Object.fromEntries([...englishIdRows.querySelectorAll("input")]
    .filter((input) => input.value.trim())
    .map((input) => [input.name, { currentValue: input.dataset.currentValue, value: input.value.trim() }]));
  if (Object.keys(values).length === 0) {
    englishIdNotice.textContent = "저장할 Custom ID를 하나 이상 입력해 주세요.";
    return;
  }
  englishSaving = true;
  englishIdSave.disabled = true;
  englishIdCancel.disabled = true;
  openEnglishIdButton.disabled = true;
  englishIdNotice.textContent = "전달용 CSV에 저장하고 목록을 갱신하고 있습니다…";
  try {
    const result = await postJson("/api/english-custom-ids", { yearMonth: englishDialogMonth, values });
    englishIdDialog.close();
    await refreshStatus();
    notice.textContent = `영문 Custom ID ${result.updatedAssets}개 자산, ${result.updatedRows}행을 수정했습니다. 남은 대상 ${result.remainingAssets}개. 확인 목록 CSV도 갱신했습니다.`;
  } catch (error) {
    englishIdNotice.textContent = error.message;
    englishAssets = null;
  } finally {
    englishSaving = false;
    englishIdSave.disabled = false;
    englishIdCancel.disabled = false;
    openEnglishIdButton.disabled = false;
    renderReadiness();
    renderRunState();
  }
});

clearButton.addEventListener("click", () => { logOutput.textContent = ""; });

const events = new EventSource("/api/events");
events.addEventListener("state", (event) => {
  runState = JSON.parse(event.data);
  if (runState.running) englishAssets = null;
  renderRunState();
  if (!runState.running) refreshStatus();
});
events.addEventListener("log", (event) => {
  if (logOutput.textContent === "실행 대기 중입니다.") logOutput.textContent = "";
  logOutput.textContent += `${JSON.parse(event.data)}\n`;
  logOutput.scrollTop = logOutput.scrollHeight;
});

monthInput.value = previousMonth();
refreshStatus();
