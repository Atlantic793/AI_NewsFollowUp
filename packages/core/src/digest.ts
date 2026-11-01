export interface DigestItem {
  title: string;
  url: string;
  what: string;
  why: string;
  source: string;
}

export interface DigestBrief {
  lead: string;
  items: DigestItem[];
  followups: string[];
}

export function fallbackDigest(input: {
  name: string;
  sources: readonly { title: string; url: string; summary: string; platform: string }[];
}): DigestBrief {
  const items = input.sources.filter((item) => /^https?:\/\//i.test(item.url)).map((item) => ({
    title: item.title,
    url: item.url,
    what: item.summary.trim() || item.title,
    why: item.summary.trim() ? "这是检索摘要，还不是对原文的概括。" : "检索结果只有标题，打开原文再判断。",
    source: item.platform,
  }));
  const first = items[0];
  return {
    lead: `这次留下 ${items.length} 条。`,
    items,
    followups: first ? [`读《${first.title}》的原文。`, "对照这几条的日期和来源，看哪一条写了新进展。"] : [],
  };
}

export function renderDigest(input: { name: string; date: string; brief: DigestBrief }): string {
  if (input.brief.items.length === 0) return `今日关于「${input.name.trim() || "这个主题"}」无明显更新。\n`;
  const lines = [`【${input.name} 简报 · ${input.date}】`, "", input.brief.lead, ""];
  input.brief.items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.title}`,
      item.what,
      `为何关注：${item.why}`,
      `来源：${item.source}`,
      `[原文](${item.url})`,
      "",
    );
  });
  if (input.brief.followups.length > 0) {
    lines.push("【跟进建议】");
    for (const advice of input.brief.followups) lines.push(`- ${advice}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
