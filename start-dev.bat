@echo off
echo Starting UniteFix Backend Server...
echo.

set NODE_ENV=development

npx tsx server/index.ts

pause
