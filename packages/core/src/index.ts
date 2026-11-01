export { countVerdicts, dedupeByUrl } from "./compare.js";
export { applyGroups } from "./groups.js";
export type { GroupAssignment } from "./groups.js";
export { normalizeUtterance, validatePlan } from "./plan.js";
export { fallbackDigest, renderDigest } from "./digest.js";
export type { DigestBrief, DigestItem } from "./digest.js";
export {
  blockedByExclude,
  buildQueries,
  isCluePlatform,
  selectHotspots,
  titleKey,
} from "./hotspot.js";
export type {
  Audience,
  HeatStage,
  HotspotCandidate,
  HotspotRecord,
  HotspotSelection,
  ReportedHotspot,
} from "./hotspot.js";
export { isInsideFolder } from "./paths.js";
export { addCalendarDays, catchupNominalDate, localTimeZone, zonedParts } from "./time.js";
export type {
  BaselineKind,
  LabeledItem,
  NewSource,
  Trigger,
  Verdict,
  VerdictKind,
} from "./types.js";
