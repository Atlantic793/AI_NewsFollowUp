> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 套餐概览

GLM Coding Plan 是专为大模型调用打造的订阅套餐，仅需少量投入，即可覆盖从代码生成、调试修复到任务自主拆解与交付全流程，Coding 与 Work 一套搞定，为您带来智能、高速、稳定的体验。

## 可用模型

* 所有套餐均支持 **GLM-5.3**、GLM-5.3-Flash。
* 调用历史模型 GLM-5.2、GLM-5.1 都将自动切换至 GLM-5.3，调用 GLM-5-Turbo、GLM-4.7 将自动切换至 GLM-5.3-Flash。

## 适用工具

* 套餐仅限在官方支持的 [指定工具与产品环境](https://docs.bigmodel.cn/cn/coding-plan/tool/others.md#%E4%B8%80%E3%80%81%E9%80%82%E7%94%A8%E5%B7%A5%E5%85%B7) 中使用。在除规定工具外调用 API，不可享用 Coding 套餐的额度。
* 套餐支持 OpenClaw 使用，但采用**次级调度**与尽力交付策略，Coding Agent 任务享有资源抢占优先权，高负载下 OpenClaw 任务将自动触发包括动态排队、限流等公平使用策略。
* 订阅套餐后，在上述工具中调用 GLM 模型，按接入指南配置即可使用套餐额度。当套餐额度耗尽后，需要等待下一个 5 小时周期恢复额度，系统不会继续消耗您的其他资源包/账户余额。

## 用量说明

> [!WARNING]
>
> 团队版用量说明，请前往 [团队版权益](https://docs.bigmodel.cn/cn/coding-plan/team.md) 查看。

### 积分额度

套餐同时设有每 5 小时和每周额度上限，您可以在 [用量统计](https://www.bigmodel.cn/coding-plan/personal/usage) 中查看您的额度消耗进展：

| 套餐类型 | 5 小时积分 | 每周积分 |
| :-: | :-: | :-: |
| Lite 套餐 | 2,000 | 10,000 |
| Pro 套餐 | 12,000 | 60,000 |
| Max 套餐 | 28,000 | 140,000 |

**积分刷新规则**

* **5 小时积分**：采用动态刷新机制，积分额度在请求消耗 5 小时后刷新重置。
* **周积分**：自套餐下单时起，以 7 天为一个周期刷新。
* **套餐升级与续费**：已订阅用户升级套餐后，积分额度将按新套餐档位立即刷新；续费不会触发积分额度重置，原有积分刷新周期保持不变。

### 积分抵扣计算方式

* 模型消耗积分数=（输入 Token × Input 抵扣系数 + 缓存命中 Token × Cached Input 抵扣系数 + 输出 Token × Output 抵扣系数） / 10000
* MCP 消耗积分数=调用次数 × Output 抵扣系数

> [!TIP]
>
> 您可在 [财务-费用明细](https://www.bigmodel.cn/finance-center/bill/expensebill/list) 查询具体消耗的不同价格类型的 Token 数/ 工具调用次数。

<table>
  <thead>
    <tr>
      <th>产品类型</th>
      <th>产品名称</th>
      <th>Input 抵扣系数</th>
      <th>Cached Input 抵扣系数</th>
      <th>Output 抵扣系数</th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td rowSpan="2">模型</td>
      <td>GLM-5.3</td>
      <td>6.9</td>
      <td>1.7</td>
      <td>24</td>
    </tr>

    <tr>
      <td>GLM-5.3-Flash（含视觉理解 MCP）</td>
      <td>2.3</td>
      <td>0.56</td>
      <td>8</td>
    </tr>

    <tr>
      <td rowSpan="3">MCP 工具</td>
      <td>联网搜索</td>
      <td>—</td>
      <td>—</td>
      <td>1.2</td>
    </tr>

    <tr>
      <td>网页读取</td>
      <td>—</td>
      <td>—</td>
      <td>1.2</td>
    </tr>

    <tr>
      <td>开源仓库</td>
      <td>—</td>
      <td>—</td>
      <td>1.2</td>
    </tr>
  </tbody>
</table>

**非高峰时段内，模型调用按基础积分消耗的 50% 抵扣。**\


> [!NOTE]
>
> 高峰时段：每周一至周五的 14:00～18:00 （UTC+8）。

### 可用额度参考

套餐的 Token 用量会因缓存命中率而有所不同，具体如下：

| 缓存命中率 | 模型 | Lite（亿 Tokens/周） | Pro（亿 Tokens/周） | Max（亿 Tokens/周） |
| :-: | :-: | :-: | :-: | :-: |
| 95% | GLM‑5.3 | 0.48～0.97 | 2.90～5.80 | 6.76～13.52 |
| 95% | GLM‑5.3‑Flash | 1.46～2.92 | 8.77～17.55 | 20.47～40.95 |
| 96% | GLM‑5.3 | 0.50～0.99 | 2.97～5.95 | 6.94～13.87 |
| 96% | GLM‑5.3‑Flash | 1.50～3.00 | 9.00～18.01 | 21.01～42.02 |
| 98% | GLM‑5.3 | 0.52～1.04 | 3.13～6.27 | 7.31～14.63 |
| 98% | GLM‑5.3‑Flash | 1.58～3.17 | 9.50～19.00 | 22.17～44.33 |

区间说明

* 最多 Tokens：全部在非高峰时段，按 0.5 倍积分消耗
* 最少 Tokens：全部在高峰时段，按 1 倍积分消耗

**当充分利用非高峰时段优惠时，相较于按量调用 GLM-5.3 标准 API，最高可节省 92% 成本**

## 独家优势

* **畅用智谱高智能模型**：GLM 模型上线时在推理、代码、智能体能力全面达到开源模型 SOTA，工具调用、复杂任务执行表现出色。
* **兼容多款工具**：支持 ZCode、AutoClaw、Claude Code、Codex、OpenCode、WorkBuddy 等主流工具，灵活适配多种开发场景。
* **高额用量，普惠价格**：远超常规方案的调用额度，升级至 Pro、Max，即可轻松满足高频复杂项目需求。
* **扩展覆盖更多能力**：套餐包含专属图像视频理解、联网搜索、网页读取、开源仓库 MCP，上线 [GLM in Excel (Beta)](https://docs.bigmodel.cn/cn/coding-plan/extension/glm-in-excel.md) 权益，助力完成更广泛开发任务。

## 下一步

* [快速开始](https://docs.bigmodel.cn/cn/coding-plan/quick-start.md)：帮助您快速上手，从订阅套餐到在工具中使用，只需几分钟
* [使用须知](https://docs.bigmodel.cn/cn/coding-plan/usage-notes.md)：快速了解账号使用规范、并发限制、退款政策等注意事项
* [常见问题](https://docs.bigmodel.cn/cn/coding-plan/faq.md)：覆盖套餐相关的订阅、活动及使用过程中的常见问题

> [card] [GLM Coding 开发者社区](https://zhipu-ai.feishu.cn/wiki/TrlMwahsfihLrKkZsy0cpuTenCz?from=from_copylink)
>
> 官方知识库
>
> * 入门指南
> * 实战教程
> * 应用案例

> [card] GLM Coding 用户交流群
>
> 飞书扫码入群
>
> ![Main dashboard interface](https://cloud-document-converter.oss-cn-beijing.aliyuncs.com/feishu2md/20261009/1791531329005-6ocbo8.jpg)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.