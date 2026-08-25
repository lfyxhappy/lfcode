# 删除供应商后仍显示

## 问题

在模型设置或模型管理页面删除供应商后，界面提示供应商已移除，但供应商仍出现在列表中。截图中的 `volcengine-plan` 即为该现象。

## 原因

### 已确认主因：删除分支实际只执行了禁用

`packages/app/src/utils/custom-provider.ts:3-14` 只有在全局配置中的供应商存在顶层 `options.baseURL`，且 npm 包名符合白名单时，才将其识别为自定义供应商。

`packages/app/src/components/dialog-delete-custom-provider.tsx:33-47` 在识别失败时不会调用删除配置接口，而是只把供应商 ID 写入 `disabled_providers`。因此原来的 `config.provider[id]` 仍然存在。

当前工作树中的供应商设置还增加了 `configuredProvidersWithoutModels`：

- `packages/app/src/components/settings-models.tsx:296-304` 直接遍历 `globalSync.data.config.provider`；
- `packages/app/src/components/settings-models.tsx:568-600` 将没有模型的配置供应商重新渲染出来；
- 该逻辑没有排除 `disabled_providers`。

所以供应商虽然已被禁用、模型列表中没有可用模型，仍会作为“无模型供应商”显示。当前运行副本的配置中，`volcengine-plan` 同时存在于 `provider` 和 `disabled_providers`，与截图相符。

### 关联风险：全局删除不会清理项目级配置

模型列表在存在目录参数时使用当前项目的 child provider 数据。配置加载会先合并全局配置，再合并项目配置：

- `packages/lfcode/src/config/config.ts:1110-1121`：全局配置与项目配置依次合并；
- `packages/lfcode/src/config/config.ts:1692-1730`：`removeGlobalCustomProvider` 只遍历全局配置文件，不处理项目 `.lfcode` 配置。

如果同一供应商仍存在于项目的 `.lfcode/opencode.jsonc` 或其他项目配置中，删除全局配置后它仍会被当前项目重新加载。

### 关联风险：配置失效与供应商列表刷新存在时序问题

`packages/lfcode/src/server/routes/instance/provider.ts:621-643` 将过滤后的模型目录与 `Provider.Service.list()` 的已连接供应商合并。配置变更通过异步实例失效触发刷新，删除后若立即请求列表，存在旧的 connected provider 被重新合并的风险。

## 推荐解决方案

1. 统一“删除”和“禁用”的语义。供应商来源应明确区分全局配置、项目配置、环境变量和内置目录；删除操作应删除实际配置来源，禁用操作应使用独立文案和入口。
2. 让前端的 `isCustomProviderConfig` 判断与后端 `isCustomProviderConfig` 保持一致，并兼容现有旧格式，避免把可删除配置误判为只能禁用。
3. `configuredProvidersWithoutModels` 至少排除 `disabled_providers` 中的 ID，避免已禁用供应商继续显示。
4. 对项目级供应商提供正确的项目配置删除路径，或在界面明确提示当前删除的是全局配置而非项目配置。
5. 配置变更后等待实例/供应商状态刷新完成，再返回 `provider.list`；必要时显式调用 `Provider.refresh`，避免旧 connected 数据复活。
6. 增加回归验证：旧格式自定义供应商、标准全局自定义供应商、项目级供应商、内置供应商禁用、删除后立即刷新及应用重启后的列表结果。

## 状态

已解决

2026-07-19：已修正三处链路：已禁用的配置供应商不再进入“无模型供应商”列表；实例供应商列表过滤已禁用的残留连接；带 `baseURL` 的旧版自定义供应商即使没有 `models` 也能实际删除配置。新增旧版删除回归用例通过，`packages/app` 与 `packages/lfcode` 类型检查通过，Windows 使用版已重新打包、同步、启动且健康检查正常。尚未通过自动化桥直接读取设置页 DOM，需在下次人工删除供应商时观察一次列表即时刷新。
