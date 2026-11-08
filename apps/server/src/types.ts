export interface AppDeps {
  dataDir: string;
  now: () => Date;
  fetchImpl: typeof fetch;
}
