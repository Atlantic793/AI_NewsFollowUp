interface Rule {
  allow: boolean;
  pattern: string;
}

function groupsOf(robots: string): Array<{ agents: string[]; rules: Rule[] }> {
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const found = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!found) continue;
    const field = (found[1] ?? "").toLowerCase();
    const value = (found[2] ?? "").trim();
    if (field === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current || (field !== "allow" && field !== "disallow")) continue;
    if (value) current.rules.push({ allow: field === "allow", pattern: value });
  }
  return groups;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

/**
 * 按 RFC 9309 判断这个路径能不能抓：先找写着本程序名字的组，没有就用 "*" 组；
 * 规则里最长的匹配说了算，一样长时 Allow 优先。
 */
export function pathAllowed(robots: string, path: string, agent = "ai_newsfollowup"): boolean {
  const groups = groupsOf(robots);
  const own = groups.filter((group) => group.agents.some((name) => name !== "*" && agent.toLowerCase().includes(name)));
  const chosen = own.length > 0 ? own : groups.filter((group) => group.agents.includes("*"));
  const rules = chosen.flatMap((group) => group.rules).filter((rule) => matches(rule.pattern, path));
  if (rules.length === 0) return true;
  rules.sort((left, right) => right.pattern.length - left.pattern.length || Number(right.allow) - Number(left.allow));
  return rules[0]?.allow ?? true;
}
