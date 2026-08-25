# MiniMax 额度重置倒计时单位错误

## 问题

MiniMax 额度查询的相对重置时间偶尔显示为 `192d 16h`、`1567d 16h` 等明显大于实际剩余时间的值；同一条数据的绝对重置时间仍然正常。

## 原因

MiniMax 的 `remains_time`、`weekly_remains_time` 等字段存在秒和毫秒两种返回格式。解析器此前统一按秒计算，导致毫秒值被放大 1000 倍。

## 推荐解决方案

在 provider 解析层统一规范化持续时间：有绝对重置时间时用绝对时间校准单位；只有持续时间时，将明显超过一周的值按毫秒转换。保留秒格式兼容，并用秒、毫秒和绝对时间测试覆盖。

## 状态

已解决

证据：`packages/lfcode/src/provider/minimax-usage.ts` 已加入单位规范化；`bun test src/provider/minimax-usage.test.ts` 通过 6 项；修复已打包并同步到 `C:\算法\小应用\Lfcodepre`。生产使用版未修改。
