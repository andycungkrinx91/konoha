# Blender LTS & DCC-MCP Toolchain Specification

## Supported Runtime Manifests
- **Blender 4.5.9 LTS**:
  - `linux-x64`: `blender-4.5.9-linux-x64.tar.xz`
  - `darwin-arm64`: `blender-4.5.9-macos-arm64.dmg`
  - `darwin-x64`: `blender-4.5.9-macos-x64.dmg`
  - `win32-x64`: `blender-4.5.9-windows-x64.zip`
- **DCC-MCP-Blender**:
  - Package: `dcc-mcp-blender` (`v0.2.26`) installed into Blender's embedded Python.

## Single-Instance Singleton Management
- Tracked via PID lockfile: `~/.konoha/blender.lock`.
- Prevents multi-instance memory leaks or rogue GUI popups during automated API/SDLC runs.
- Automatic process termination on server stop (`process.on('exit')`, `SIGINT`, `SIGTERM`).
