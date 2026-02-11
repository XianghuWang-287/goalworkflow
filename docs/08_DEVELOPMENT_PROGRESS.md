# 08. 开发进度追踪

> 最后更新: 2026-02-10

## Phase 1: MVP Core (2026-02-03)

**状态: ✅ 完成**

基础全栈应用搭建，打通 Goal → Q&A → Plan → UI 核心链路。

| 功能 | 提交 | 说明 |
|------|------|------|
| Auth (注册/登录) | `7ff854c` | NextAuth Credentials + bcrypt |
| Goal Analyzer Q&A | `7ff854c` | LLM 生成 3-5 个澄清问题 |
| Plan Generator | `7ff854c` | 7 天计划生成 + Zod 校验 |
| Goal Detail 页面 | `7ff854c` | Today tasks + Plan overview + Timeline |
| Dashboard | `7ff854c` | Goal 列表 |
| 技术文档 | `7ff854c` | docs/01-07 全套文档 |

## Phase 2: Intelligent Agent Architecture (2026-02-09)

**状态: ✅ 完成**

从模板填充式升级为智能多 Agent 目标规划系统。使用 superpowers MCP 的 `writing-plans` + `executing-plans` + `dispatching-parallel-agents` 技能完成。

| 功能 | 提交 | 说明 |
|------|------|------|
| DB Schema 扩展 | `ff7a007` | UserProfile, DomainProfile, Conversation, PlanVersion 表 |
| Goal Classifier | `8b01c7e` | 自动分类: domain, complexity, planStructure |
| Profile Service | `8b01c7e` | 用户画像持久化 + 跨目标复用 |
| Constraint Validator | `8b01c7e` | 代码级时间冲突校验 |
| Domain Expert Agent | `4e076f4` | 多轮对话 + 领域知识库注入 |
| Plan Generator 重写 | `8ef3626` | 多结构支持 (fixed_cycle/phased/countdown) + 约束校验 |
| Plan Modifier | `a90698f` | 卡片操作 + 自然语言修改计划 |
| Orchestrator | `5f5722e` | Fast/Deep 路径自动路由 |
| Data Migration | `be463bf` | 已有数据迁移脚本 |
| Weekly Review 适配 | `ab0e82b` | 适配 phased plans |
| Goal Creation UI | `ef862ec` | Chat 对话 + Plan Preview |
| Plan Modification UI | `8b9cd1f` + `ce61fba` | 卡片编辑 + AI 调整 |
| Weekly Review Route 修复 | `90f307a` | 适配新 generatePlan 签名 |

**设计文档:**
- `docs/plans/2026-02-09-intelligent-agent-architecture-design.md`
- `docs/plans/2026-02-09-intelligent-agent-implementation.md` (15 个 Task 的实施计划)

## Phase 3-4: Email / Badges / Checkin / Review (2026-02-10)

**状态: ✅ 完成**

闭环 checkin → 状态可视化 → weekly review → 下周计划 的完整循环。

| 功能 | 提交 | 说明 |
|------|------|------|
| JSON Schema 强化 | `2cd0247` | JSONGuard 支持 xAI response_format strict JSON |
| TypeScript 修复 | `bf5dbf8` | Agent + Profile Manager 编译错误修复 |
| ESLint 修复 | `f7ad81b` | JSX unescaped entities |
| Email Service (Resend) | `b846f44` | 每日 checkin 邮件 + 每周 review 邮件 |
| Badge System | `b846f44` | 徽章定义 + 自动发放逻辑 |
| One-Time Token | `b846f44` | 邮件链接 token 生成/验证/消费 |
| API Routes 批量添加 | `af2fb2a` | badges, checkin, goal detail/delete, tokens, weekly-review |
| Vercel Cron 配置 | `a545039` | daily-email + weekly-review cron |
| SSE Streaming | `603bdaa` | xaiClient streaming + jsonGuard stream 模式 |
| ExpertTurnResult 修复 | `dc964ec` | 允许 null profileUpdates/goalSpec |

## Phase 5: Checkin 状态显示 + Weekly Review 闭环 (2026-02-10)

**状态: ✅ 完成** (未提交)

| 功能 | 文件 | 说明 |
|------|------|------|
| Checkin 查询扩大 | `app/goals/[id]/page.tsx` | 去掉 `take: 7`，取全部 checkin |
| Day 卡片状态指示 | `app/goals/[id]/page.tsx` | ✓ 绿色 / ◐ 黄色 / ✗ 红色 左边框 + 图标 |
| Weekly Review 按钮 | `components/WeeklyReviewButton.tsx` | 当前周 checkin 完成后显示，POST 生成 review |
| Authenticated Review 页面 | `app/goals/[id]/review/page.tsx` | 显示 metrics/wins/blockers + 三选项 |
| PATCH 选项提交 | `app/api/weekly-review/route.ts` | 认证用户选择下周方案 → 生成新 plan |

**测试脚本:** `npx tsx scripts/simulate-checkins.ts`

## Phase 5.1: Weekly Review UX 重构 (2026-02-10)

**状态: ✅ 完成**

Review 按钮逻辑修正 + Review 历史卡片 + 防重复生成。

| 功能 | 提交 | 说明 |
|------|------|------|
| Goal Detail 查询 weeklyReviews | `cc08e3a` | 从 DB 查询该 goal 的所有 weeklyReviews |
| allCheckedIn 逻辑修正 | `cc08e3a` | 要求当前周所有天都已过去且都有 checkin，不再用 buffer 计数 |
| Review 按钮状态管理 | `cc08e3a` | review 完成后隐藏按钮；有 pending review 时显示"Continue Review" |
| Weekly Reviews 历史卡片 | `cc08e3a` | Goal Detail 新增历史卡片，展示 metrics/wins/blockers/chosen option |
| 防重复 review 生成 | `cc08e3a` | WeeklyReviewButton 先检查是否有 pending review，有则直接跳转 |

## 当前已知问题

- Plan day.date 与 Task date 存在 ±1 天偏移（plan 生成时的日期计算问题），allCheckedIn 已改为按实际天数判断
- SSE streaming 已实现底层，前端 UI 集成待完善
- 生产环境需配置 Resend API key 和 Vercel Cron

## 下一步计划

- [ ] SSE streaming 前端集成（对话 + 计划生成时显示实时 token）
- [ ] UI 打磨（Dashboard 统计卡片、Goal 进度可视化）
- [ ] 生产部署 + 环境变量配置
- [ ] E2E 测试覆盖核心流程
- [ ] Plan day.date 偏移根因修复
