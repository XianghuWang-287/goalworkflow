## 4. LLM(xAI) 与 JSONGuard（严格 JSON + Zod）

### 4.1 环境变量（必须 server-side）

来自 `.env`（示例见 `env.example`）：

- `XAI_API_KEY`：xAI API key（必须）
- `XAI_BASE_URL`：默认 `https://api.x.ai/v1`
- `XAI_MODEL`：默认 `grok-4-latest`

**安全原则**：
- 前端代码不得读取/透传 API key
- 只允许在 route handlers / server code（`app/api/**`、Server Components、`lib/**`）调用 LLM

### 4.2 xAI Client：`lib/llm/xaiClient.ts`

封装 OpenAI-style Chat Completions：

- Endpoint：`POST ${XAI_BASE_URL}/chat/completions`
- Headers：
  - `Authorization: Bearer ${XAI_API_KEY}`
  - `Content-Type: application/json`
- Body：
  - `model`
  - `messages: [{role,content}]`
  - `stream: false`
  - `temperature: 0`

返回值：
- 取 `choices[0].message.content` 作为纯文本输出（期望为 JSON 字符串）

错误处理：
- 非 2xx：读取 `response.text()` 拼入 error message
- choices 为空：抛错

### 4.3 JSONGuard：`lib/llm/jsonGuard.ts`

`JSONGuard` 是所有 Agent 的“安全外壳”，确保 LLM 输出可用：

#### 4.3.1 核心接口

- `callAndValidate<T>(prompt, systemPrompt, zodSchema)`
  - 调用 LLM
  - 尝试解析 JSON
  - 用 Zod 校验
  - 失败：最多重试 `maxRetries`（默认 2）
  - 仍失败：走 `fallbackTemplate()`，并对 fallback 继续做 Zod 校验

#### 4.3.2 严格 JSON 解析

当前实现做了一个轻量清理：
- 如果输出被包在 ```json / ``` code fence 中，会移除 fence

然后：
- `JSON.parse(jsonString)` → `zodSchema.parse(parsed)`

#### 4.3.3 重试策略（2 retries）

失败时会：
- 记录 `responsePreview`（前 200 字符）
- 如果是 `ZodError`：把 `errors` 前 3 条塞回给模型，指导修复字段/类型/结构
- 往对话里追加：
  - assistant: 上一次输出
  - user: “请按 schema 修复并只返回 JSON”

#### 4.3.4 fallback（模板计划）

每个 Agent 提供自己的 fallback：
- `GoalSpecExtractor`：返回一个最小可用 GoalSpec
- `PlanGenerator`：生成 7 天固定 learn+practice 模板（即使 LLM 失败，也能跑通 UI/落库）
- `WeeklyReviewer`：返回固定的 metrics/blockers/wins/options 模板

> 注意：fallback 也会跑 Zod 校验，确保不会把坏数据写进 DB。

### 4.4 Zod Schemas：`lib/schemas/*`

- `GoalSpecSchema`：`lib/schemas/goalSpec.ts`
- `PlanSchema`：`lib/schemas/plan.ts`
  - `weeks[0].days.length === 7`
  - 每天 `tasks.min(1)`（为简单习惯目标允许 1 个任务；学习目标仍建议 2+）
  - task 结构包含 `fallback`
- `WeeklyReviewSchema`：`lib/schemas/weeklyReview.ts`
  - `next_week_options.length === 3`

### 4.5 Prompts（版本化）：`prompts/*.md`

每个 prompt 顶部有 `prompt_version: v1.0.0`：

- `prompts/goal_spec_extractor.md`
- `prompts/plan_generator.md`（已加入“简单习惯 vs 学习目标”指导）
- `prompts/weekly_reviewer.md`

当前 `Plan.promptVersion` 在 `POST /api/goals/create` 里写死 `v1.0.0`。

建议改进（后续）：
- 在 Agent 启动时解析 prompt 顶部 `prompt_version` 并存入 DB，避免手工不同步。

