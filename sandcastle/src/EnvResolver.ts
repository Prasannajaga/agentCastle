import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { join } from "node:path";

const parseEnvFile = (
  filePath: string,
): Effect.Effect<Record<string, string>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs
      .readFileString(filePath)
      .pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (content === null) return {};
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        value.length >= 2 &&
        ((value[0] === '"' && value[value.length - 1] === '"') ||
          (value[0] === "'" && value[value.length - 1] === "'"))
      ) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
    return vars;
  });

/**
 * Resolve all env vars from .env files with process.env fallback.
 *
 * Precedence: .sandcastle/.env > process.env
 * Only keys declared in .sandcastle/.env are resolved from process.env.
 * Repo root .env is not part of the resolution chain.
 */
export const resolveEnv = (
  repoDir: string,
  configDir = join(repoDir, ".sandcastle"),
): Effect.Effect<Record<string, string>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const sandcastleEnv = yield* parseEnvFile(join(configDir, ".env"));

    const result: Record<string, string> = {};
    for (const key of Object.keys(sandcastleEnv)) {
      const value = sandcastleEnv[key] || process.env[key];
      if (value) {
        result[key] = value;
      }
    }

    return result;
  });
