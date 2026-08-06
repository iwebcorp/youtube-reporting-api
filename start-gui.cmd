@echo off
REM 월별 정산 로컬 웹 화면을 실행하는 시작 파일
cd /d "%~dp0"
set "NODE_EXE=node"
if exist "runtime\node.exe" set "NODE_EXE=runtime\node.exe"
if not exist "node_modules\tsx\dist\cli.mjs" (
  echo [설치] 프로그램 구성 파일을 설치합니다.
  call npm.cmd ci
  if errorlevel 1 (
    echo [오류] 프로그램 설치에 실패했습니다.
    pause
    exit /b 1
  )
)
"%NODE_EXE%" "node_modules\tsx\dist\cli.mjs" "src\guiServer.ts"
if errorlevel 1 pause
