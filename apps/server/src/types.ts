export interface KaggleCredentials {
  username: string;
  key: string;
}

export interface AppDeps {
  dataDir: string;
  now: () => Date;
  fetchImpl: typeof fetch;
  kaggle: KaggleCredentials | null;
  gapMs?: number;
}
