## 7. Troubleshooting（常见问题与排查路径）

### 7.1 `XAI_API_KEY is not set!`

现象：
- 创建 goal 或 analyze 时直接 500
- server log：`[XAIClient] XAI_API_KEY is not set!`

原因：
- `.env` 未配置 `XAI_API_KEY`

排查：
- 检查 `.env` 是否存在且被 Next 读取（重启 dev server）
- 对照 `env.example` 补齐

涉及代码：
- `lib/llm/xaiClient.ts`：constructor 里缺 key 会 throw

### 7.2 `JSON validation failed ...`（Zod 校验失败）

现象：
- LLM 输出不符合 schema（比如 tasks 是 string 数组）
- JSONGuard 会重试 2 次；仍失败则 fallback

排查：
- 看 server log：
  - `[JSONGuard] Attempt X failed`
  - `Schema validation errors: ...`
- 看 prompt 是否写清结构：
  - `prompts/plan_generator.md`

建议：
- 优先通过 prompt 强约束结构
- 其次在 JSONGuard 的 retry message 里补充更明确的修复指令

### 7.3 你遇到的：`input.constraints.join is not a function`

现象：
- `POST /api/goals/create` 500
- 日志：`TypeError: input.constraints.join is not a function`

原因：
- `constraints` 在 schema 里是 `string[]`
- 但问答流程里可能把 `constraints` 当作普通文本（string）传入
- 旧实现假设 constraints 一定是 array，于是直接 `.join()`

修复（已完成）：
- `lib/agents/goalSpecExtractor.ts` 对 constraints 做了 array/string 兼容：
  - array：join
  - string：直接拼接

后续建议：
- UI 改成多选/Tag 输入，让 constraints 天然产出 string[]

### 7.4 `DATABASE_URL not found` 或 Prisma P1012

现象：
- `npm run db:push` 报错找不到 `DATABASE_URL`

排查：
- `.env` 是否存在且包含 `DATABASE_URL="..."`（注意引号）
- 重新运行 `npm run db:push`
- 必要时重启 dev server

### 7.5 登录后仍被重定向到 `/auth/signin`

现象：
- 进入 `/dashboard` 或 `/goals/*` 立刻 redirect

原因：
- NextAuth session 没成功建立（cookie/secret/url 配置问题）

排查：
- `.env` 是否配置：
  - `NEXTAUTH_URL`
  - `NEXTAUTH_SECRET`
- 清 cookie 重试
- 在 `lib/auth.ts` 的 authorize 里加 log（仅本地）

### 7.6 `.next` 缓存导致奇怪行为

处理：
```bash
rm -rf .next
npm run dev
```

