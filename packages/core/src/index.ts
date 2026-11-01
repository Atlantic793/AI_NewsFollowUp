export { countVerdicts, dedupeByUrl } from "./compare.js";
export { applyGroups } from "./groups.js";
export type { GroupAssignment } from "./groups.js";
export { normalizeUtterance, validatePlan } from "./plan.js";
export { composeDigestLead, fallbackDigest, formatWindowLead, renderDigest } from "./digest.js";
export type { DigestBrief, DigestItem } from "./digest.js";
export {
  blockedByExclude,
  buildQueries,
  freshnessDrop,
  isCluePlatform,
  OPEN_CAP,
  openGate,
  screenByWindow,
  selectHotspots,
  takeToOpen,
  titleKey,
  topicDrop,
} from "./hotspot.js";
export type {
  Audience,
  DropReason,
  HeatStage,
  HotspotCandidate,
  HotspotRecord,
  HotspotSelection,
  ReportedHotspot,
  WindowDropCounts,
} from "./hotspot.js";
export { isInsideFolder } from "./paths.js";
export { addCalendarDays, catchupNominalDate, dateInText, localTimeZone, zonedParts } from "./time.js";
export type {
  BaselineKind,
  LabeledItem,
  NewSource,
  Trigger,
  Verdict,
  VerdictKind,
} from "./types.js";
