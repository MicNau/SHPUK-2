@echo off
rem Запуск dev-сервера SHPUK (раздаёт сайт + прокси к каталогу sollersdev.ru).
rem Двойной клик по этому файлу запускает сервер. Закрыть окно = остановить сервер.
cd /d "%~dp0"

rem ============================================================================
rem  Обход VPN (Outline) для каталога sollersdev.ru.
rem  Outline гонит весь трафик в туннель, и российский сервер каталога через него
rem  недоступен. Добавляем точечный маршрут /32: ТОЛЬКО трафик к каталогу идёт в
rem  обход VPN через локальный шлюз; Claude и всё остальное остаются в туннеле.
rem  Требует прав администратора (route add) — поэтому при необходимости
rem  перезапускаем этот же .bat с запросом UAC.
rem  Если поменялся IP каталога или шлюз — поправьте две строки ниже
rem  (узнать IP: nslookup sollersdev.ru; шлюз: ipconfig -> Основной шлюз).
rem ============================================================================
set "CATALOG_IP=80.87.103.137"
set "LAN_GATEWAY=192.168.0.1"

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  Запрашиваю права администратора для маршрута к каталогу...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo  Маршрут к каталогу %CATALOG_IP% в обход VPN через %LAN_GATEWAY% ...
route delete %CATALOG_IP% >nul 2>&1
route add %CATALOG_IP% mask 255.255.255.255 %LAN_GATEWAY% metric 1 >nul 2>&1
if %errorlevel% equ 0 (
    echo   ... маршрут добавлен.
) else (
    echo   ... не удалось добавить маршрут ^(проверьте шлюз/права^).
)

echo.
echo  Запуск SHPUK dev-сервера...
echo  Откройте в браузере:  http://localhost:8848
echo  Остановить: закройте это окно или нажмите Ctrl+C
echo.
python "%~dp0devserver.py" 8848
echo.
echo  Сервер остановлен.
pause
