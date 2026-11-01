import { describe, expect, it } from "vitest";
import { rejectSecretArgv } from "../src/model/client.js";
import { commandEnvironment } from "../src/opencli/runner.js";

describe("secret handling", () => {
  it("reads the key only from the environment", () => {
    expect(() => rejectSecretArgv(["node", "index.js"])).not.toThrow();
    expect(() => rejectSecretArgv(["node", "index.js", "OPENAI_API_KEY=sk-test-secret"])).toThrow(/环境变量/);
    expect(() => rejectSecretArgv(["node", "--api-key", "sk-test-secret"])).toThrow(/环境变量/);
    expect(() => rejectSecretArgv(["node", "sk-test-secret"], { OPENAI_API_KEY: "sk-test-secret" })).toThrow(/环境变量/);
    const env = commandEnvironment({ OPENAI_API_KEY: "sk-test-secret", PATH: "C:\\bin" });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.PATH).toBe("C:\\bin");
  });
});
