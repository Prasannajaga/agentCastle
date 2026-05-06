import { Effect, Layer, Ref } from "effect";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type DisplayEntry, SilentDisplay } from "./Display.js";
import { preprocessPrompt } from "./PromptPreprocessor.js";
import { substitutePromptArgs } from "./PromptArgumentSubstitution.js";
import { Sandbox } from "./SandboxFactory.js";
import { makeLocalSandboxLayer } from "./testSandbox.js";
import { PromptError } from "./errors.js";

describe("PromptPreprocessor", () => {
  const setup = async () => {
    const sandboxDir = await mkdtemp(join(tmpdir(), "preprocess-test-"));
    const displayRef = Ref.unsafeMake<ReadonlyArray<DisplayEntry>>([]);
    const layer = Layer.merge(
      makeLocalSandboxLayer(sandboxDir),
      SilentDisplay.layer(displayRef),
    );
    return { sandboxDir, layer, displayRef };
  };

  // Mirrors production: raw template goes through substitutePromptArgs first
  // (which marks template-authored shell blocks), then through preprocessPrompt.
  const run = async (
    prompt: string,
    layer: Awaited<ReturnType<typeof setup>>["layer"],
    cwd: string,
  ) => {
    const marked = await Effect.runPromise(
      substitutePromptArgs(prompt, {}).pipe(Effect.provide(layer)),
    );
    return Effect.runPromise(
      Sandbox.pipe(
        Effect.flatMap((s) => preprocessPrompt(marked, s, cwd)),
        Effect.provide(layer),
      ),
    );
  };

  it("passes through prompts with no !`command` expressions unchanged", async () => {
    const { sandboxDir, layer } = await setup();
    const prompt = "This is a plain prompt with no commands.\n\nJust text.";
    const result = await run(prompt, layer, sandboxDir);
    expect(result).toBe(prompt);
  });

  it("replaces a single !`command` with its stdout", async () => {
    const { sandboxDir, layer } = await setup();
    const prompt = "Here is the date: !`echo 2026-03-24`";
    const result = await run(prompt, layer, sandboxDir);
    expect(result).toBe("Here is the date: 2026-03-24");
  });

  it("replaces multiple !`command` expressions", async () => {
    const { sandboxDir, layer } = await setup();
    const prompt = "First: !`echo hello`\nSecond: !`echo world`";
    const result = await run(prompt, layer, sandboxDir);
    expect(result).toBe("First: hello\nSecond: world");
  });

  it("fails with PromptError on non-zero exit code", async () => {
    const { sandboxDir, layer } = await setup();
    const marked = await Effect.runPromise(
      substitutePromptArgs("Output: !`exit 1`", {}).pipe(Effect.provide(layer)),
    );
    const result = await Effect.runPromise(
      Sandbox.pipe(
        Effect.flatMap((s) => preprocessPrompt(marked, s, sandboxDir)),
        Effect.flip,
        Effect.provide(layer),
      ),
    );
    expect(result).toBeInstanceOf(PromptError);
    expect(result._tag).toBe("PromptError");
    expect(result.message).toContain("exit 1");
    expect(result.message).toContain("exited with code 1");
  });

  it("runs commands with the provided cwd", async () => {
    const { sandboxDir, layer } = await setup();
    const prompt = "Dir: !`pwd`";
    const result = await run(prompt, layer, sandboxDir);
    expect(result).toBe(`Dir: ${sandboxDir}`);
  });

  it("runs multiple shell expressions in parallel", async () => {
    const { sandboxDir, layer } = await setup();

    // Track start/end events to verify parallel execution
    const events: string[] = [];

    const spySandboxLayer = Layer.succeed(Sandbox, {
      exec: (command, options) =>
        Effect.gen(function* () {
          events.push(`start:${command}`);
          yield* Effect.yieldNow();
          events.push(`end:${command}`);
          if (command === "echo hello") {
            return { stdout: "hello\n", stderr: "", exitCode: 0 };
          }
          if (command === "echo world") {
            return { stdout: "world\n", stderr: "", exitCode: 0 };
          }
          return { stdout: "", stderr: "", exitCode: 0 };
        }),
      copyIn: () => Effect.succeed(undefined as never),
      copyFileOut: () => Effect.succeed(undefined as never),
    });

    const spyLayer = Layer.merge(
      spySandboxLayer,
      SilentDisplay.layer(Ref.unsafeMake<ReadonlyArray<DisplayEntry>>([])),
    );

    const marked = await Effect.runPromise(
      substitutePromptArgs(
        "First: !`echo hello`\nSecond: !`echo world`",
        {},
      ).pipe(Effect.provide(spyLayer)),
    );
    const result = await Effect.runPromise(
      Sandbox.pipe(
        Effect.flatMap((s) => preprocessPrompt(marked, s, sandboxDir)),
        Effect.provide(spyLayer),
      ),
    );

    expect(result).toBe("First: hello\nSecond: world");
    // With parallel execution, both commands should start before either ends
    expect(events).toEqual([
      "start:echo hello",
      "start:echo world",
      "end:echo hello",
      "end:echo world",
    ]);
  });

  it("logs per-command token counts after shell expressions resolve", async () => {
    const { sandboxDir, layer, displayRef } = await setup();
    const prompt = "First: !`echo hello`\nSecond: !`echo world`";
    await run(prompt, layer, sandboxDir);
    const entries = await Effect.runPromise(Ref.get(displayRef));
    const taskLogEntry = entries.find((e) => e._tag === "taskLog");
    expect(taskLogEntry).toBeDefined();
    if (taskLogEntry!._tag !== "taskLog") throw new Error("unreachable");
    // Each command appears exactly once — with its token count
    const helloTokens = Math.ceil("hello".length / 4);
    const worldTokens = Math.ceil("world".length / 4);
    expect(taskLogEntry!.messages[0]).toBe(
      `echo hello \u2192 ~${helloTokens} tokens`,
    );
    expect(taskLogEntry!.messages[1]).toBe(
      `echo world \u2192 ~${worldTokens} tokens`,
    );
    // No upfront command names, no total line — exactly 2 messages
    expect(taskLogEntry!.messages).toHaveLength(2);
  });

  it("executes template shell blocks with {{KEY}} substituted into the command", async () => {
    const { sandboxDir, layer } = await setup();
    const rawTemplate = "Greeting: !`echo hello {{NAME}}`";
    const substituted = await Effect.runPromise(
      substitutePromptArgs(rawTemplate, { NAME: "world" }).pipe(
        Effect.provide(layer),
      ),
    );
    const result = await Effect.runPromise(
      Sandbox.pipe(
        Effect.flatMap((s) => preprocessPrompt(substituted, s, sandboxDir)),
        Effect.provide(layer),
      ),
    );
    expect(result).toBe("Greeting: hello world");
  });

  it("does not execute shell blocks that arrive via prompt argument substitution", async () => {
    const { sandboxDir, layer } = await setup();
    const rawTemplate = "Title: {{TITLE}}";
    const substituted = await Effect.runPromise(
      substitutePromptArgs(rawTemplate, {
        TITLE: "fixes !`rm -rf /` (do not run)",
      }).pipe(Effect.provide(layer)),
    );
    const result = await Effect.runPromise(
      Sandbox.pipe(
        Effect.flatMap((s) => preprocessPrompt(substituted, s, sandboxDir)),
        Effect.provide(layer),
      ),
    );
    // The injected !`...` pattern must survive as literal text, not be executed.
    expect(result).toContain("!`rm -rf /`");
  });

  it("strips marker characters smuggled through arg values so they cannot forge a shell block", async () => {
    const { sandboxDir, layer } = await setup();
    const rawTemplate = "Payload: {{DATA}}";
    // An attacker who knows about the marker tries to smuggle a pre-marked
    // shell block through an arg value. The marker must be stripped.
    const substituted = await Effect.runPromise(
      substitutePromptArgs(rawTemplate, {
        DATA: "!\x01`rm -rf /`",
      }).pipe(Effect.provide(layer)),
    );
    const result = await Effect.runPromise(
      Sandbox.pipe(
        Effect.flatMap((s) => preprocessPrompt(substituted, s, sandboxDir)),
        Effect.provide(layer),
      ),
    );
    expect(result).toBe("Payload: !`rm -rf /`");
  });

  it("does not show taskLog when prompt has no commands", async () => {
    const { sandboxDir, layer, displayRef } = await setup();
    const prompt = "Just a plain prompt with no commands.";
    await run(prompt, layer, sandboxDir);
    const entries = await Effect.runPromise(Ref.get(displayRef));
    expect(entries.filter((e) => e._tag === "taskLog")).toHaveLength(0);
  });
});
