import { describe, expect, it } from "vitest";
import { applyEnvText } from "../src/env-file.js";
import { rejectSecretArgv } from "../src/model/client.js";
import { commandEnvironment } from "../src/opencli/runner.js";

describe("secret handling", () => {
  it("reads the key only from the environment", () => {
    expect(() => rejectSecretArgv(["node", "index.js"])).not.toThrow();
    expect(() => rejectSecretArgv(["node", "index.js", "OPENAI_API_KEY=sk-test-secret"])).toThrow(/环境变量/);
    expect(() => rejectSecretArgv(["node", "--api-key", "sk-test-secret"])).toThrow(/环境变量/);
    expect(() => rejectSecretArgv(["node", "sk-test-secret"], { OPENAI_API_KEY: "sk-test-secret" })).toThrow(/环境变量/);
    const env = commandEnvironment({ OPENAI_API_KEY: "sk-test-secret", FIRECRAWL_API_KEY: "fc-test-secret", DATABASE_URL: "test-only", NODE_OPTIONS: "--test-only", OPENCLI_PROFILE: "test-profile", PATH: "C:\\bin" });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.FIRECRAWL_API_KEY).toBeUndefined();
    expect(env.PATH).toBe("C:\\bin");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.OPENCLI_PROFILE).toBe("test-profile");
  });

  it("lets the project .env own the model and Firecrawl settings", () => {
    const env: NodeJS.ProcessEnv = { OPENAI_MODEL: "from-the-shell", OPENAI_API_KEY: "from-the-shell", PORT: "4177" };
    applyEnvText("# comment\nOPENAI_BASE_URL=https://api.deepseek.com/v1\nOPENAI_MODEL=deepseek-chat\nOPENAI_API_KEY=\nFIRECRAWL_API_KEY=\"fc-test\"\nPORT=4180\n", env);
    expect(env.OPENAI_BASE_URL).toBe("https://api.deepseek.com/v1");
    expect(env.OPENAI_MODEL).toBe("deepseek-chat");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.FIRECRAWL_API_KEY).toBe("fc-test");
    expect(env.PORT).toBe("4180");
  });
});
