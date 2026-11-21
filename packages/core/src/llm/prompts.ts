export function extractPrompt(column: "price" | "event" | "rank" | "hot", page: string, body: string): { system: string; user: string } {
  const evidence = column === "event"
    ? "动态的 excerpt 必须同时覆盖标题、日期和正文，不能只摘简介。RSS/XML 新闻应逐字复制完整的 <item>...</item> 块（包括 title、pubDate 和 link），保留原有空格和换行；Markdown 日期位于上级标题时，从该日期标题连续摘到条目正文。没有完整日期依据的条目不要返回。"
    : column === "price"
      ? "价目的 excerpt 必须同时包含产品名、计价单位和该格价格；额度、重置和条件中的整数也必须出现在该片段中。"
      : column === "rank"
        ? "排名的 excerpt 必须包含模型名、完整分数及所填票数，不能借用模型版本号作为名次。"
        : "热榜的 excerpt 应覆盖条目名称和介绍，链接照原文填写。";
  const shape = column === "price"
    ? '{"rows":[{"kind":"api 或 plan","product":"","tier":"","metric":"","condition":"","price":"","unit":"","quota":"","reset":"","excerpt":""}]}'
    : column === "rank"
      ? '{"rows":[{"rank":"有印出名次才填","model":"","org":"","score":"","votes":"","boardDate":"原文没有就空","basis":"printed 或 sorted","excerpt":""}]}'
      : column === "hot"
        ? '{"rows":[{"rank":"","title":"","url":"","heat":"","summary":"","excerpt":""}]}'
        : '{"rows":[{"type":"release 或 news 或 status 或 incident","title":"","date":"","detail":"","url":"","excerpt":""}]}';
  return {
    system: `你是数据采集作业的摘录员。只根据给定原文返回一个 JSON 对象。excerpt 必须是原文里的连续子串。金额、整数、分数、百分比、日期必须在该条 excerpt 里逐字出现。不要编造，不要改数字。价目一格一行。热榜每条必须有自己的链接。排名只有原文印了名次才填 rank，否则 basis 用 sorted。不要输出 cn_access。${evidence}`,
    user: `页面：${page}\n栏目：${column}\n按这个形状返回：${shape}\n\n原文：\n${body}`,
  };
}

export function gapPrompt(body: string, products: readonly string[]): { system: string; user: string } {
  return {
    system: "你是数据采集作业的摘录员。只返回 JSON。从表格外面的原文补额度、重置和时段，并用中文写这三项。数字和区间必须与原文逐字相同。不要改价格。product 必须是给定产品名。excerpt 必须是原文连续子串，并且同时包含产品名和要填的额度或重置。原文没有就不要编。",
    user: `产品：${products.join("、")}\n形状：{"gaps":[{"product":"","quota":"","reset":"","condition":"","excerpt":""}]}\n\n原文：\n${body}`,
  };
}

export function hotBriefPrompt(items: readonly { title: string; excerpt: string }[]): { system: string; user: string } {
  const packed = items.map((item, index) => `#${index}\n名称：${item.title}\n片段：${item.excerpt}`).join("\n\n");
  return {
    system: "你是数据采集作业的摘录员。只返回 JSON。每条用一句不超过 100 字的中文说明这个仓库、模型或竞赛是什么、能做什么。只翻译和压缩片段里的官方介绍，不要根据名称补充片段里没有的能力，不要写名次、星标、下载量、点赞、编程语言或趋势分。数字必须在该条片段里逐字出现。excerpt 原样抄回片段。",
    user: `形状：{"briefs":[{"excerpt":"","brief":""}]}\n\n${packed}`,
  };
}

export function eventBriefPrompt(items: readonly { title: string; excerpt: string }[]): { system: string; user: string } {
  const packed = items.map((item, index) => `#${index}\n标题：${item.title}\n片段：${item.excerpt}`).join("\n\n");
  return {
    system: "你是数据采集作业的摘录员。只返回 JSON。每条用一句不超过 80 字的中文说明这条动态。数字必须在该条片段里逐字出现。不要补充片段里没有的价格或日期。excerpt 原样抄回片段。",
    user: `形状：{"briefs":[{"excerpt":"","brief":""}]}\n\n${packed}`,
  };
}
