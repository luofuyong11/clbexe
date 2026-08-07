@echo off
set "NODE_EXE=%UNI_AGENT_NODE_PATH%"
if "%NODE_EXE%"=="" set "NODE_EXE=%HBUILDERX_NODE_PATH%"
if "%NODE_EXE%"=="" set "NODE_EXE=node"
"%NODE_EXE%" "%~dp0rust-lld-wrapper.js" %*
@exit /b %errorlevel%
