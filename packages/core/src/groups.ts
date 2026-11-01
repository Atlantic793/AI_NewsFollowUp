export interface GroupAssignment {
  id: string;
  eventKey: string;
}

export function applyGroups(
  items: readonly { id: string }[],
  groups: readonly (readonly string[])[],
): { degraded: boolean; assignments: GroupAssignment[] } {
  const expected = items.map((item) => item.id);
  const seen = new Map<string, number>();
  for (const group of groups) {
    for (const id of group) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const valid = expected.every((id) => seen.get(id) === 1) && seen.size === expected.length;
  if (!valid) {
    return {
      degraded: true,
      assignments: expected.map((id) => ({ id, eventKey: `solo:${id}` })),
    };
  }
  const eventKeyById = new Map<string, string>();
  groups.forEach((group, index) => {
    for (const id of group) eventKeyById.set(id, `g${index}`);
  });
  return {
    degraded: false,
    assignments: expected.map((id) => ({ id, eventKey: eventKeyById.get(id) ?? `solo:${id}` })),
  };
}
