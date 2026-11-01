export type Trigger = "collect" | "research" | "track" | "morning";

export type BaselineKind =
  | "none"
  | "previous"
  | "yesterday"
  | "yesterday-missing"
  | "no-comparable-platforms";

export type VerdictKind = "appeared" | "heating" | "ongoing" | "fading";

export interface LabeledItem {
  id: string;
  eventKey: string;
  title: string;
  url: string;
  platform: string;
}

export interface Verdict {
  kind: VerdictKind;
  eventKey: string;
  title: string;
  url: string;
  prevCount: number;
  currCount: number;
  addedPlatforms: string[];
  detail: string;
}

export interface NewSource {
  title: string;
  url: string;
  platform: string;
}
