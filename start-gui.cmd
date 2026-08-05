@echo off
REM 월별 정산 로컬 웹 화면을 실행하는 시작 파일
cd /d "%~dp0"
set "NODE_EXE=node"
if exist "runtime\node.exe" set "NODE_EXE=runtime\node.exe"
"%NODE_EXE%" "node_modules\tsx\dist\cli.mjs" "src\guiServer.ts"
if errorlevel 1 pause
