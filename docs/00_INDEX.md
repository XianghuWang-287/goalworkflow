## GoalFlow 开发技术文档索引

这套文档面向**接手开发 / 部署运维 / 二次开发**，覆盖：架构、数据模型、路由/API、LLM/xAI 约束与 JSONGuard、Goal→问答→计划生成链路、UI 页面、运行与排错。

### 快速入口

- `CLAUDE.md`：**项目总览** — 技术栈、目录结构、开发命令、架构决策（AI 助手首先读取此文件）
- `docs/01_ARCHITECTURE.md`：整体架构、端到端链路、关键设计决策
- `docs/02_DATA_MODEL_PRISMA.md`：Prisma 数据模型解释（表/关系/字段用途）
- `docs/03_ROUTES_AND_APIS.md`：Next.js App Router 页面路由 + API 路由（入参/出参/鉴权/副作用）
- `docs/04_LLM_XAI_AND_JSON_GUARD.md`：xAI 调用封装、严格 JSON、Zod 校验、重试与 fallback
- `docs/05_GOAL_QA_FLOW.md`：Goal Analyzer 问答流程（问题结构、建议选项、答案如何合并进 GoalSpec）
- `docs/06_LOCAL_DEV_AND_DEPLOYMENT.md`：本地启动、数据库初始化、环境变量、部署注意事项
- `docs/07_TROUBLESHOOTING.md`：常见报错与定位路径
- `docs/08_DEVELOPMENT_PROGRESS.md`：**开发进度追踪** — Phase 1-5 完成情况、提交记录、已知问题、下一步计划

### 设计文档

- `docs/plans/2026-02-09-intelligent-agent-architecture-design.md`：智能 Agent 架构设计（五层 Agent、知识库、约束校验）
- `docs/plans/2026-02-09-intelligent-agent-implementation.md`：实施计划（15 个 Task、依赖图）
- `docs/plans/2026-02-10-streaming-design.md`：SSE Streaming 设计（xaiClient → jsonGuard → API → Frontend）

