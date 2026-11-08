# headline-chaser

个人工作台。一个主题一份本地档案，服务跑在本机。

## 目前实现

用户先确定主题、检索词和信息源，再运行以下三种模式。它们共用主题卡和采集流水线。

| 模式 | 当前行为 |
| --- | --- |
| 调研 | 按主题上的「过去 N 天」筛选后写简报 |
| 动态热点追踪 | 用同一套天数筛选，再结合来源、时效、相关度和历史记录计算热度与阶段 |
| 每日简报 | 定时走同一套天数筛选，并跳过已经报过且阶段未变的事件 |

已包含主题管理、方案确认、素材链接保存、笔记整理、历史快照、档案浏览和主题对话。主题档案使用 Markdown / JSON 等本地文件，无需数据库。模型辅助理解意图、事件分组和写作，执行步骤由服务端固定流水线控制。

## 代码与文档

| 路径 | 内容 |
| --- | --- |
| `apps/web` | React / Vite 界面 |
| `apps/server` | Hono HTTP API、主题档案、调度和采集运行时 |
| `packages/core` | 查询扩展、时间计算、去重、热点规则和简报格式 |
| `scripts/verify-opencli.ts` | 使用临时目录的功能与性能验收 |
| `environment.yml` | 独立 Conda Node.js 环境 |

当前实现与后续方向见 [智能体现状与理想](tasks/智能体现状与理想.md)；[原始 PRD](tasks/prd-topic-followup.md) 和 [原始 SPEC](tasks/spec-topic-followup.md) 保留第一版设计，其中跨快照对比方式、OpenCLI 接入和预算机制等内容已有后续调整。

## 启动

本项目使用 TypeScript / Node.js，不需要 Python。独立 Conda 环境管理 Node.js；OpenCLI 作为固定版本的项目依赖，由 `npm ci` 安装。

首次准备环境（Windows PowerShell）：

```powershell
conda env create -f environment.yml
conda activate headline-chaser
npm ci
```

不再要求全局安装 OpenCLI 或将它加入 PATH。需要浏览器的信息源仍需连接 OpenCLI 浏览器扩展；公开 API 信息源可以直接使用。需要诊断扩展时运行 `npm exec -w @followup/server -- opencli doctor`。

之后每次启动：

```text
conda activate headline-chaser
npm run dev
```

若 PowerShell 7 下 `conda activate` 报「参数列表中缺少参数」，可绕过 Conda 的 PowerShell 包装函数直接启动：

```powershell
& $env:CONDA_EXE run -n headline-chaser --no-capture-output npm.cmd run dev
```

浏览器打开 Vite 提示的地址，接口在 `http://127.0.0.1:4177`。晨报跟着这个服务进程走，只关浏览器标签不会停。服务端不会热重载，改完服务代码后重新执行 `npm run dev`。

配置写在项目根目录的 `.env`。第一次先复制示例再填写，密钥留在本机，不要提交：

```text
复制 .env.example 为 .env
```

`.env` 里可以写：

```text
OPENAI_BASE_URL
OPENAI_API_KEY
OPENAI_MODEL
FIRECRAWL_API_KEY
PORT
FOLLOWUP_DATA_DIR
FOLLOWUP_TOPICS_ROOT
```

示例把模型指到 DeepSeek：`OPENAI_BASE_URL=https://api.deepseek.com/v1`，`OPENAI_MODEL=deepseek-chat`。有 `.env` 时，模型这三项和 `FIRECRAWL_API_KEY` 只认文件里的值。文件里留空，就不会改用系统用户变量。不要把密钥写进启动命令，终端记录会留下它。

没有模型密钥时仍可确认计划和收集。关键词需要自己填，对话会提示还没有配置模型。登记和对话默认写在 `%APPDATA%\AI_NewsFollowUp`，主题文件夹默认在用户主目录的 `AI_NewsFollowUp\topics`。

信息源来自项目依赖 OpenCLI 2.0.2 的命令注册表。写操作不会出现。能搜索但不能收成统一条目的命令会显示为不可选。

服务按需启动常驻采集进程，批量读取目录并复用搜索运行时。搜索同时最多两个进程；同一进程内仍串行，因为上游执行器有全局会话状态。每个进程排队上限 64，单次请求预算包含排队时间，过期排队动作不会执行。读正文最多 4 条同时打开。单次执行超时会终止进程，下次请求重新启动，不自动重跑搜索。服务退出时采集进程同时关闭。既有的无适配器浏览器配方仍通过项目内 CLI 执行。

目录有内存和原子写入的磁盘缓存，有效期 24 小时，缓存带运行时版本标记。采集沿用有效缓存；`POST /api/catalog/refresh` 合并同时发生的刷新，并重启空闲采集运行时以重新发现适配器。刷新失败时沿用可读取的旧目录，实际搜索仍重新检查只读边界。

登录检测在独立短时进程中后台执行，只检查可选的浏览器信息源，结果缓存 60 秒。浏览器桥接未连接时返回未知，不自动打开浏览器或登录；检测最多等待 3.5 秒，不阻塞目录或搜索。界面短时轮询更新提示。子进程使用环境变量白名单：系统运行、代理/证书、`OPENCLI_*`，以及公开学术源的 `NCBI_API_KEY`、`NCBI_EMAIL`、`OPENALEX_MAILTO`、`SEMANTIC_SCHOLAR_API_KEY`、`HF_ENDPOINT`。模型密钥、数据库凭据和 `NODE_OPTIONS` 不会传入。

OpenCLI 的内部模块访问集中在 `apps/server/src/opencli/runtime.ts`；升级依赖时须验证目录字段和执行行为。回退集成可恢复旧代码及依赖锁文件；缓存为派生数据，旧版本会忽略不兼容缓存，主题档案格式保持不变。

## 验证

```text
npm test
npm run typecheck
npm run lint
npm run build -w @followup/web
npm run verify:opencli
```

`npm run verify:opencli -- --online` 还会搜索公开 npm 注册表，并在临时主题中验收调研、快照和简报，不使用模型密钥。验证报告写在输出的临时目录中。

2026-11-01 的本机验收结果见 [功能与性能记录](docs/performance/opencli-integration-20261101.json)：

| 验收内容 | 证据 |
| --- | --- |
| 自动化回归 | 42 项测试、类型检查、Lint、前端构建通过；覆盖缓存、只读门控、进程恢复、队列期限和登录检测隔离 |
| 目录兼容 | 133 条目录项、92 条可选信息源；与旧实现逐字段对比一致 |
| 本机性能 | 首次读取约 644 毫秒，内存缓存读取约 1.4 毫秒，10 个并发读取约 10 毫秒 |
| 真实公开源 | npm 搜索取得 20 条结果，完成创建主题、确认方案、调研、快照和简报；不调用模型 |
| HTTP 与退出 | 页面和健康接口正常，停止服务后服务与采集进程退出 |

这些性能数字来自单机单轮测量。浏览器登录态信息源尚需连接扩展后验收；本轮未验证模型生成质量。自动化夹具通过与真实信息源验收分别记录。
