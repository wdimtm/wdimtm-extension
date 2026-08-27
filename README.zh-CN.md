# WDIMTM — 于我何意

[English](README.md) · 简体中文

> 看懂眼前这段内容 —— 以及它跟你有什么关系。

WDIMTM 是一个浏览器原生的 AI 助手，服务于这样一个瞬间：你在网上看到某段内容，心里冒出一句「**这跟我有什么关系？**」

不必打开聊天窗口、复制内容、再写提示词 —— 直接在页面上选中，然后问 WDIMTM。它会结合选区、周围的页面上下文、你当前启用的 **Lens（透镜）**，以及可选的个人记忆，给出一段简洁而切题的解释。

## 界面长什么样

|  |  |
|---|---|
| ![选中文字，就地得到解释](store-assets/screenshot-1-explain.png) | ![切换透镜，同一段文字换个角度读](store-assets/screenshot-2-lenses.png) |
| **选中 → 就地解释。** 卡片锚定在选区旁，页面布局不会被撑开。事实与推测分开呈现。 | **用透镜，而不是写提示词。** 同一段话，用工程视角读，或用投资视角读。可以给某个网站固定一个透镜，也可以用自己的话写一个。 |
| ![带着同一段选区展开的页面对话](store-assets/screenshot-3-chat.png) | ![审阅从聊天记录里提炼出的记忆](store-assets/screenshot-4-memory.png) |
| **一句话不够的时候。**「深入对话」把同一张卡片展开成页面内对话，选区和页面上下文一并带着。截图可以直接粘进去。 | **由你掌握的记忆。** 导入 ChatGPT 或 Claude 的导出记录，每一条候选都要你过目才会保存。不点确认，什么都不会被记住。 |

截图由 `npm run store:assets` 从扩展实际使用的样式表生成 —— 所以 UI 一变，它们就会过时。

## 为什么做这个

大多数 AI 助手都要求用户先把「困惑」翻译成「提示词」：

`看到不懂的 → 复制 → 切换应用 → 粘贴 → 解释意图 → 读答案`

WDIMTM 想要的是：

`看到不懂的 → 选中 → 看懂了`

关键在于：**光有解释是不够的。** 同一段内容，对不同的人意味着完全不同的东西。

## 产品原则

- **别打断心流。** 不要把用户从当前页面拽走。
- **不需要写提示词。** 从选区加上下文推断出默认意图。
- **渐进披露。** 先给几行有用的，需要再展开。
- **先有上下文，再谈对话。** 先理解选中的文字和它周围的页面。
- **与个人相关。** 从「这是什么」走到「这对我意味着什么」。
- **事实与推测分开。** 尤其是在投资 / 机会分析场景下。
- **记忆由用户掌控。** 个性化必须可查看、可编辑、可关闭。
- **拥有相关性，而不是基础设施。** WDIMTM 负责上下文构建与个性化；运行时和记忆存储都是可替换的 provider。
- **一个客户端，多种服务模式。** 免费与付费的差别在服务模式，绝不在客户端版本。

## 服务模式

```text
                  WDIMTM 扩展
                （唯一的客户端）
                         │
          ┌──────────────┼──────────────┐
          │              │              │
        Local           BYOK        WDIMTM Cloud
        本地记忆      你自己的模型      托管服务
          免费           免费            订阅
```

Local 与 BYOK 永远是一等公民，永久免费。WDIMTM Cloud 是可选的，只提供那些确实需要服务端的能力：无需 API Key、跨设备的个人上下文、可持久运行的研究与监控任务。升级不会更换扩展。

商业模式与架构边界：`docs/internal/business-model.md`（私有工作仓库）

## 官网

静态营销站 —— 生产环境：[wdimtm.com](https://wdimtm.com)

```bash
npm run landing       # http://127.0.0.1:4174/
npx wrangler deploy --config landing/wrangler.jsonc   # 部署到 wdimtm.com
```

源码：[`landing/`](landing/) —— Cloudflare Worker 静态资源。

## 快速开始

```bash
# 1. 构建扩展 —— 不跑构建就没有 dist/
npm install
npm run build
# chrome://extensions → 开启开发者模式 → 加载已解压的扩展程序 → 选 dist/

# 2. 可选：本地演示页 / 官网
npm run demo          # http://127.0.0.1:4173/demo.html
npm run landing       # http://127.0.0.1:4174/

# 3. 验证
npm run test:unit
npm run test:e2e      # 有头 Chromium + 真实未打包扩展
```

默认运行时是 **mock**（离线）。在扩展选项里可以切换到 OpenAI-compatible、Anthropic、PromptaaS 或 WDIMTM Cloud。

三种服务模式（Local / BYOK / WDIMTM Cloud）是同一个客户端，不是不同版本 —— 见 `docs/internal/business-model.md` 与 `docs/internal/cloud-api-contract.md`（均为私有工作仓库）。

## 架构

```text
网页
   │ 选区 + 有界上下文
   ▼
浏览器扩展 (MV3)
   │ content：气泡、透镜、浮层、流式 UI
   ▼
WDIMTM Context Builder（service worker）
   ├── 页面 / 选区归一化
   ├── 当前 Lens（推荐或钉住）
   ├── 相关记忆检索
   │       │
   │       ▼
   │  Memory Provider (local | none | 未来扩展)
   └── 可选的网络证据（verify / research / chat）
           │
           ▼
     Search Provider (tavily | brave | serper | none)
   │
   ▼
运行时适配器
   ├── mock
   ├── openai-compatible（可选流式）
   ├── anthropic
   ├── promptaas
   └── wdimtm-cloud（托管服务模式）
   │
   ▼
浮动界面
   ├── 紧凑态：解释 + 预测追问 + 记忆建议
   └── 展开态：基于同一选区的页面对话，可收起为一个标记
```

契约细节：[`docs/runtime-contract.md`](docs/runtime-contract.md)
Cloud API 契约：`docs/internal/cloud-api-contract.md`（私有工作仓库）
记忆 RFC：[`docs/memory-rfc.md`](docs/memory-rfc.md)
AI 接入方式：[`docs/ai-access-modes.md`](docs/ai-access-modes.md)
扩展说明：[`extension/README.md`](extension/README.md)

运行时适配器是产品中**短暂**的那一半。可持久的工作（深度研究、监控）属于云端 agent 运行时。

### 请求结构

```ts
interface ExplainRequest {
  selection: string;
  page: { url: string; title: string; context?: string };
  lens?: { id: string; instructions?: string };
  memories?: Array<{ type: string; content: string }>;
  profile?: string;
  mode?:
    | "explain" | "more" | "simplify" | "why_it_matters" | "verify"
    | "research" | "opportunity" | "probe" | "summarize" | "summarize-page";
  answerLanguage?: string;   // auto | en | zh_CN | match-selection
  answerDepth?: "short" | "normal" | "detailed";
  followUpQuestion?: string; // 用于 mode=probe
}
```

## 已实现的功能

### 核心闭环
- 选中 → 操作气泡 → 紧凑解释卡片
- 有边界的上下文抽取（绝不抓整个 DOM）
- 加载 / 流式 / 错误状态
- Esc 或点击外部关闭

### 透镜 Lenses
- 内置预设（中/EN）：通俗解释、**有没有道理**、核实主张、找机会、工程视角、投资视角
- 自定义自然语言透镜，内置透镜也都可以改
- 智能选择：WDIMTM 会按选区推荐透镜；钉住一个之后它就不再猜
- 气泡上的逐次下拉选择 + 设置里的默认值
- 按站点设默认（`x.com = sanity`），单次选区可临时覆盖

### 追问
- **展开说明**、**为什么重要**、**核实主张**、**讲简单点**、**有没有机会**
- 追问芯片来自答案本身，而不是一排固定按钮
- **记住这个** → 本地记忆

### 一个界面，两种尺寸
- 「解释」保持为锚定选区的紧凑卡片
- **深入对话**把它展开成页面对话，带着同一段选区与页面上下文
- 右下角浮动面板，可收起为一个标记；宿主页面布局从不被改动
- 每段选区一个会话，每页最多 8 个，存于 `chrome.storage.session` —— 第二次选中会新开会话，而不是顶掉第一个
- **本页记录**列出该页保存过的对话（含轮次）与历史一次性解释，点击即可恢复
- 会话仅存活于当前浏览器会话，浏览器退出即丢弃

### 对话中的图片
- 用系统截图（⌘⇧4 / PrtSc）直接粘进输入框 —— 也可以上传或拖入
- 打开对话会自动聚焦输入框，⌘V 直接落进去
- 每轮最多 4 张，发送前降采样到 1568px 并重新编码
- 文字提示是可选的：一张图本身就是一个问题
- 以 OpenAI 多模态 `image_url` 形式发送 —— 需要支持视觉的模型
- 原图只留在标签页内，随会话持久化的只有缩略图
- 不需要额外权限 —— 扩展从不自己抓屏

### 网络证据（可选）
- Provider：`tavily` | `brave` | `serper` | `none`，用你自己的 Key
- 供**核实**、**研究**与页面对话使用；以 `WEB EVIDENCE` 注入并附带可引用的 URL
- 普通「解释」保持离线、单次调用；证据缺失时答案会明说
- 默认关闭

### 记忆
- Provider 接口（`local` | `none`）
- 画像文本 + 结构化记忆卡片
- 关键词相关性检索（不上向量库）
- 选项页内可查看 / 编辑 / 遗忘

### 运行时
- Mock（默认、离线、模拟流式）
- OpenAI 兼容的 chat completions（+ SSE 流式）
- Anthropic Messages API（用户自带 Claude Key）
- PromptaaS 适配器（`POST /v1/agents/{id}/run`）+ 本地 mock server（`npm run promptaas:mock`）
- WDIMTM Cloud 适配器（`POST /v1/explain`，流式）：Google 登录、托管推理、按能力计费的额度、记忆同步

### 研究（WDIMTM Cloud）
- 从任意解释发起**研究这个** → 服务端持久化的 `AgentJob`，关掉标签页也继续跑
- 浮层内显示进度 / 可取消，选项页有任务列表，结果附去重后的来源
- 默认运行时为 PromptaaS Single Agent，回退到单次托管推理

## 路线图

### Phase 0 — 产品验证
- [x] Chrome 扩展骨架
- [x] 检测选区并显示操作气泡
- [x] 抽取选区与周边页面上下文
- [x] 定义 WDIMTM → 运行时契约 + 轻适配器
- [x] 打通一条解释链路
- [x] 渲染紧凑解释浮层

### Phase 1 — 可用的 MVP
- [x] 通用解释模式
- [x] 内置透镜
- [x] 自定义透镜指令
- [x] 显式的本地画像 / 偏好
- [x] 展开说明 / 为什么重要
- [x] 响应中的 Markdown 与链接
- [x] 基础设置与隐私控制
- [x] 流式响应

### Phase 2 — 上下文与核实
- [x] 有界的语义邻域抽取
- [x] 核实模式 + **有没有道理**透镜
- [x] 社交帖子容器（X `article` / 推文正文）以获得更丰富的本地上下文
- [ ] 完整的话题串 / 多帖拼接
- [x] 实时网络研究引用（Tavily / Brave / Serper，用户自备 Key）
- [ ] 图片 / 截图作为上下文

### Phase 3 — 个人记忆
- [x] 记忆 provider 接口
- [x] 记忆查看 / 编辑器
- [x]「记住这个」交互
- [x] 相关记忆检索（关键词 V1）
- [x] 记忆来源标注（source 字段）+ 仅显式保存策略
- [ ] 可选的习得偏好（目前记忆仍然只来自显式确认）
- [ ] Nowledge Mem 集成实验
- [ ] MCP / provider 集成实验

### Phase 4 — 从理解到行动
- [x] 深度研究动作（持久化云端 `AgentJob`）
- [x] 机会调查流程（同一任务，`opportunity_research` 模式）
- [ ] 保存 / 关注话题
- [ ] 监控某个机会或主张的变化
- [ ] 跨页面研究会话
- [ ] 适当场景下的 agent 行动

## 明确不做的事

- 再造一个通用聊天机器人 UI
- 自动记录用户读过的一切
- 在 WDIMTM 内部做一个完整的个人知识管理平台
- 在扩展里塞一个复杂的自治 agent 框架
- 在检索规模真正需要之前引入向量数据库
- 第一天就支持所有浏览器

## 状态

**v0.5.0** —— Chrome MV3 扩展：`选中 → 透镜 → 解释 → 追问/记忆`，短答不够时升级为基于同一选区的页面对话。页面对话支持图片 —— 系统截图直接粘贴，也可上传或拖入。Mock + OpenAI 兼容 + Anthropic + PromptaaS 适配器，可选网络证据，本地记忆 provider，对其它选区类扩展（如 Trancy）的共存处理，单元测试 + 有头 Playwright E2E。

**暂缓：** 完整话题串拼接、图片作为上下文、习得偏好、Nowledge/MCP 记忆 provider、Phase 4 行动流程。
