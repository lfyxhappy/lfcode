# 新建对话后输入框短暂不可输入

## 问题

桌面端新建一个对话后，输入框在初始化完成前有一段时间无法输入。用户感知为输入框短暂只读，等待片刻后恢复正常。

问题已通过源码修复；实际等待时长未单独量化。

## 原因

高概率是输入组件尚未挂载，而不是编辑宿主被设置为 `readonly` 或 `disabled`：

- `packages/app/src/pages/session/composer/session-composer-region.tsx:176-195` 在 `prompt.ready()` 完成前只渲染 loading 占位层，该层设置了 `pointer-events-none`。
- `packages/app/src/context/prompt.tsx:208-212` 为新建对话创建 workspace 级草稿持久化；没有 session ID 时会走 `Persist.scoped(dir, id, "prompt", ...)` 的 workspace 分支。
- `packages/app/src/utils/persist.ts:352-466` 在桌面端使用异步存储，初始化结果是 Promise，`ready` 完成前为 false。
- `packages/app/src/components/prompt-input.tsx:1186-1193` 还会等待 `prompt.ready().promise`。
- `packages/app/src/components/prompt-input/editor-surface.tsx:71-90` 中真正的编辑宿主是 `contenteditable="true"`，没有 `readonly` 或 `disabled` 属性。

因此，初始化窗口内页面显示的是不可交互占位层；持久化读取完成后才切换到真正的 contenteditable 输入框。

## 修复记录

- `packages/app/src/pages/session/composer/session-composer-region.tsx` 不再用 `prompt.ready()` 替换整个主会话输入区；真实 `PromptInput` 立即挂载，并传入 `suspendUntilReady={false}`。
- `@solid-primitives/storage` 的异步初始化仍保留“用户先修改则不恢复覆盖”的行为；`packages/app/src/utils/persist.ts` 另外对桌面存储读写失败做降级处理，读取失败时继续使用默认空草稿。
- `packages/app/src/utils/persist.test.ts` 覆盖异步恢复、用户提前输入保留以及存储读取失败三条回归路径。

已有预发布日志未发现输入框相关 renderer 崩溃。日志中的 safeStorage 解密失败和缺少 `resources\\app-update.yml` 属于其他启动问题，暂未证明与输入延迟直接相关。

## 验证

- `packages/app`：`bun --conditions=browser test --preload ./happydom.ts ./src/utils/persist.test.ts` 通过（8 项）。
- `packages/app`：`bun run typecheck` 通过。
- 未运行桌面安装版人工交互验收；按项目规则应由用户在 pre 版确认新建对话后立即输入。

## 状态

已解决
