# dsh-llm-cost

> 让 DeepSeek Harness 显示**每个 turn、每个 step 的 LLM 成本**（美元），并在价格过期时用 LLM + 联网自动更新价格表。

DSH 已经精确记录了每个 step 的真实 token 用量（`assistant/message` 的 `usage`：输入/输出/缓存读/缓存写），但**没有任何美元成本概念**。`dsh-llm-cost` 补上缺失的那一环：把「用量 × 单价」变成 DSH 的持久事实（`costUsage` session projection），并在每个对话框下方的 stats 行里渲染出该 turn 的成本。

## 工作原理

- **host 端（node）**：一个 session projection 单元（照 `token-meter` 的骨架），在 `session/event` 上折叠：
  - `request/context`（解析后的 provider/model 路由，post-fallback）决定每个 step 用的模型；
  - `assistant/message`（或 `assistant/chunk` 的 usage chunk）报告该 step 的用量；
  - 单价表 → `costUsd`，同一 turn/step 的重复采样做**替换**而非重复累计。
- **client 端（浏览器）**：注册到 `conversation.chat.turnTail` 扩展链，读 `useProjection('costUsage')`，在每个完成的 assistant 消息下方渲染 `$0.0042 · 1.2K tok`。
- **未定价模型**：显示 `unknown`，绝不静默显示 `$0.00`（避免「未知」被误读成「免费」）。

## 功能

| 层 | 内容 |
|---|---|
| 成本投影 | `costUsage`：`totalCostUsd`、`pricedSteps`/`unpricedSteps`、token 分桶、`byModel` 聚合、`steps[]` 每步明细 |
| 每 turn 渲染 | 对话框下方 stats 行：`$0.0042 · 1.2K tok` / `unknown` |
| 自动维护 | `llm_cost_refresh` 工具：联网搜索当前价格 → LLM 抽取 JSON → 写入 override 文件并即时生效 |

## 安装

```bash
# npm（发布后）
dsh plugin --profile web add dsh-llm-cost

# 本地 tarball（未发布时 / 内网）
dsh plugin --profile web add ./dsh-llm-cost-0.1.0.tgz

# git（需 allowBuilds 授权，见官方发布手册）
dsh plugin --profile web add github:chenyinrusi/dsh-llm-cost#v0.1.0
```

本地验证：`pnpm dsh web --patch ./cordis.patch.yml`（或 `--dump-config` 查看层）。

## 配置

`cordis.patch.yml` 里该行的 `config` 可设（全部可选）：

| 键 | 默认 | 说明 |
|---|---|---|
| `pricing` | 内置快照 | 内联的定价覆盖，合并到快照之上 |
| `pricingFile` | `~/.dsh/llm-cost/pricing.override.json` | refresh 工具写出的覆盖文件 |
| `refreshProvider` | 无 | 价格抽取调用的 provider 路由（配置后才启用 refresh） |
| `refreshModel` | 无 | 价格抽取调用的模型 id |

配置由 zod `Config` schema 校验（cordis 在 `apply` 前执行）：省略 `config` 键 = 全默认；`config: {}` 合法；**不要写空 `config:` 键**——YAML 会解析成 `null`，被 schema 响亮拒绝（带 entry 名）。未知键被静默丢弃。

## 自动维护价格（`llm_cost_refresh`）

这个工具**自己调用 LLM + 联网**完成整条链路，不需要 agent 逐步编排：

1. `ctx.web.search` 对目标模型搜索「current API price per million tokens」；
2. `ctx.llm.stream` 用配置的 `refreshProvider`/`refreshModel` 把搜索结果抽成严格 JSON；
3. 宽松校验（坏模型直接丢弃，绝不污染价格表）→ 合并进 registry → 写 `pricingFile`。

前置：DSH 里要装一个 web 搜索 provider（`dsh-web-search-*`）+ 一个可用的 LLM 路由。抽取结果建议先人工抽查——它写的是 override 文件，**不会**覆盖内置快照。

> 定价是会过期的数据（intro 价、模型改名）。把 `src/config/llm_models.toml [pricing_v2]` 作为单一事实来源，跑 `pnpm gen`（`node scripts/gen-pricing.mjs`）重新生成 `pricing.json` + `src/pricing-data.ts`，锁步发布。

## 数据

`pricing.json` 是内置 JSON 快照，由 `scripts/gen-pricing.mjs` 从 `llm_models.toml [pricing_v2]` 生成（默认读相邻 `customized_agentic_system/src/config/llm_models.toml`）。计费字段：`inputPerM` / `outputPerM` / `cacheReadPerM` / `cacheWritePerM`（`cacheWrite1hPerM` 保留，batch/storage 维度 v1 不计入显示值）。

## 匹配阶梯（对齐 `models.py:get_pricing`）

```
0. provider === "ollama"  → 免费
1. 模型 id 精确匹配
2. 最长 key 子串匹配（防 "gpt-5.4" 吞掉 "gpt-5.4-mini"）
3. 未知 → unknown（显示 "unknown"，不显示 $0.00）
```

## 开发

```bash
npm install
npm test          # node --test（纯逻辑层，无需 DSH 工具链）
npm run gen       # 重新生成价格快照
npm run build     # tsdown 打包 host + client + 声明文件
```

## License

MIT © 2026 Chen (Jarry) Pan
