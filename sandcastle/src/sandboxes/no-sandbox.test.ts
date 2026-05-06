import { describe, expect, it } from "vitest";
import { noSandbox } from "./no-sandbox.js";

describe("noSandbox", () => {
  it("returns a provider with tag 'none'", () => {
    const provider = noSandbox();
    expect(provider.tag).toBe("none");
    expect(provider.name).toBe("no-sandbox");
    expect(provider.env).toEqual({});
  });

  it("merges env from options", () => {
    const provider = noSandbox({ env: { FOO: "bar" } });
    expect(provider.env).toEqual({ FOO: "bar" });
  });

  describe("handle", () => {
    it("exec runs a command on the host and returns output", async () => {
      const provider = noSandbox();
      const handle = await provider.create({
        worktreePath: process.cwd(),
        env: {},
      });

      const result = await handle.exec('echo "hello world"');
      expect(result.stdout).toContain("hello world");
      expect(result.exitCode).toBe(0);
    });

    it("exec returns non-zero exit code on failure", async () => {
      const provider = noSandbox();
      const handle = await provider.create({
        worktreePath: process.cwd(),
        env: {},
      });

      const result = await handle.exec("exit 42");
      expect(result.exitCode).toBe(42);
    });

    it("exec supports onLine streaming callback", async () => {
      const provider = noSandbox();
      const handle = await provider.create({
        worktreePath: process.cwd(),
        env: {},
      });

      const lines: string[] = [];
      const result = await handle.exec('echo "line1"; echo "line2"', {
        onLine: (line) => lines.push(line),
      });

      expect(lines).toEqual(["line1", "line2"]);
      expect(result.stdout).toContain("line1");
      expect(result.exitCode).toBe(0);
    });

    it("exec respects cwd option", async () => {
      const provider = noSandbox();
      const handle = await provider.create({
        worktreePath: "/tmp",
        env: {},
      });

      const result = await handle.exec("pwd", { cwd: "/tmp" });
      expect(result.stdout.trim()).toBe("/tmp");
    });

    it("exec ignores sudo option (no-op)", async () => {
      const provider = noSandbox();
      const handle = await provider.create({
        worktreePath: process.cwd(),
        env: {},
      });

      // sudo is a no-op — the command should still run successfully
      const result = await handle.exec('echo "test"', { sudo: true });
      expect(result.stdout).toContain("test");
      expect(result.exitCode).toBe(0);
    });

    it("exec passes env vars to spawned processes", async () => {
      const provider = noSandbox();
      const handle = await provider.create({
        worktreePath: process.cwd(),
        env: { MY_TEST_VAR: "sandcastle_test_value" },
      });

      const result = await handle.exec("echo $MY_TEST_VAR");
      expect(result.stdout.trim()).toBe("sandcastle_test_value");
    });

    it("interactiveExec spawns process and returns exit code", async () => {
      const provider = noSandbox();
      const handle = await provider.create({
        worktreePath: process.cwd(),
        env: {},
      });

      const result = await handle.interactiveExec(["sh", "-c", "exit 0"], {
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
      });

      expect(result.exitCode).toBe(0);
    });

    it("close is a no-op and does not throw", async () => {
      const provider = noSandbox();
      const handle = await provider.create({
        worktreePath: process.cwd(),
        env: {},
      });

      await expect(handle.close()).resolves.toBeUndefined();
    });
  });
});
