import { describe, expect, it } from "vitest";
import { rejectSecretArgv } from "../src/model/client.js";
import { commandEnvironment } from "../src/opencli/runner.js";

describe("secret handling", () => {
  it("reads the key only from the environment", () => {
    expect(() => rejectSecretArgv(["node", "index.js"])).not.toThrow();
    expect(() => rejectSecretArgv(["node", "index.js", "OPENAI_API_KEY=sk-test-secret"])).toThrow(/环境变量/);
    expect(() => rejectSecretArgv(["node", "--api-key", "sk-test-secret"])).toThrow(/环境变量/);
    expect(() => rejectSecretArgv(["node", "sk-test-secret"], { OPENAI_API_KEY: "sk-test-secret" })).toThrow(/环境变量/);
    const env = commandEnvironment({ OPENAI_API_KEY: "sk-test-secret", DATABASE_URL: "test-only", NODE_OPTIONS: "--test-only", OPENCLI_PROFILE: "test-profile", PATH: "C:\\bin" });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.PATH).toBe("C:\\bin");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.OPENCLI_PROFILE).toBe("test-profile");
  });
});
