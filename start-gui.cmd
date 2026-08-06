@echo off
chcp 65001 >nul
setlocal
REM 월별 정산 로컬 웹 화면을 실행하는 시작 파일
cd /d "%~dp0"
set "NODE_EXE=node"
if exist "runtime\node.exe" set "NODE_EXE=runtime\node.exe"
if exist "runtime\node.exe" goto node_ready
where node >nul 2>nul
if errorlevel 1 goto node_missing

:node_ready
if exist "node_modules\tsx\dist\cli.mjs" goto launch
echo [설치] 프로그램 구성 파일을 설치합니다.
call npm.cmd ci
if errorlevel 1 goto install_failed

:launch
"%NODE_EXE%" "node_modules\tsx\dist\cli.mjs" "src\guiServer.ts"
if errorlevel 1 goto run_failed
exit /b 0

:node_missing
echo [오류] Node.js LTS를 먼저 설치해 주세요.
goto failed

:install_failed
echo [오류] 프로그램 설치에 실패했습니다.
goto failed

:run_failed
echo [오류] 프로그램 실행이 중단되었습니다.

:failed
pause
exit /b 1
