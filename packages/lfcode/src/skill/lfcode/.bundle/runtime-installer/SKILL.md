---
name: runtime-installer
description: Use when the user asks to install, repair, initialize, or fix Lfcode runtimes or local dependency environments such as Python, pip, C++, Java, recorder, FFmpeg, 编译器, 运行时, 环境损坏, 缺依赖, 修复环境, 安装依赖.
---

# Lfcode Runtime Installer

Use this skill when the task is about making Lfcode's own local runtimes usable again.

## Scope

This skill is for the runtimes Lfcode already manages:

- `python-managed`
- `voice-recorder`
- `ffmpeg`
- `cpp-compiler`
- `java-runtime`
- `java-sdk`

## Required workflow

1. First call `runtime_manage` with `action="list"` to inspect the current runtime state.
2. If the needed runtime is missing and supports managed install, call `runtime_manage` with `action="install"` and the matching `id`.
3. If the runtime already exists but appears damaged or incomplete, call `runtime_manage` with `action="repair"` and the matching `id`.
4. After install or repair, retry the original tool or user task.
5. If you need recent evidence, call `runtime_manage` with `action="logs"`.

## Guardrails

- Prefer `runtime_manage` over ad-hoc shell installers or manual PATH editing.
- Do not download third-party runtime archives through `bash` when the managed runtime registry already supports the item.
- If the requested runtime is outside the supported list, say that clearly and do not pretend it is managed.
- When the user explicitly asks to fix Python/pip/C++/Java/recorder/FFmpeg for Lfcode itself, this skill should be used.
