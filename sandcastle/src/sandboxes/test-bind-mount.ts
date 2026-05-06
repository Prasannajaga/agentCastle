/**
 * Filesystem-based test bind-mount sandbox provider.
 *
 * Uses a temp directory on the local filesystem as the "sandbox".
 * Intended for testing the bind-mount provider abstraction without
 * requiring Docker or Podman.
 */

import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import {
  createBindMountSandboxProvider,
  type BindMountSandboxHandle,
  type BindMountSandboxProvider,
  type ExecResult,
} from "../SandboxProvider.js";

/**
 * Create a filesystem-based test bind-mount sandbox provider.
 *
 * The "sandbox" is a temp directory. `exec` runs shell commands in it,
 * `copyFileIn`/`copyFileOut` copy single files between host and the temp dir,
 * and `close` removes the temp dir.
 */
export const testBindMount = (): BindMountSandboxProvider =>
  createBindMountSandboxProvider({
    name: "test-bind-mount",
    create: async (): Promise<BindMountSandboxHandle> => {
      const sandboxRoot = await mkdtemp(join(tmpdir(), "sandcastle-test-bm-"));
      const worktreePath = join(sandboxRoot, "workspace");
      await mkdir(worktreePath, { recursive: true });

      return {
        worktreePath,

        exec: (
          command: string,
          options?: {
            onLine?: (line: string) => void;
            cwd?: string;
            sudo?: boolean;
          },
        ): Promise<ExecResult> => {
          if (options?.onLine) {
            const onLine = options.onLine;
            return new Promise((resolve, reject) => {
              const proc = spawn("sh", ["-c", command], {
                cwd: options?.cwd ?? worktreePath,
                stdio: ["ignore", "pipe", "pipe"],
              });

              const stdoutChunks: string[] = [];
              const stderrChunks: string[] = [];

              const rl = createInterface({ input: proc.stdout! });
              rl.on("line", (line) => {
                stdoutChunks.push(line);
                onLine(line);
              });

              proc.stderr!.on("data", (chunk: Buffer) => {
                stderrChunks.push(chunk.toString());
              });

              proc.on("error", (error) => {
                reject(new Error(`exec failed: ${error.message}`));
              });

              proc.on("close", (code) => {
                resolve({
                  stdout: stdoutChunks.join("\n"),
                  stderr: stderrChunks.join(""),
                  exitCode: code ?? 0,
                });
              });
            });
          }

          return new Promise((resolve, reject) => {
            execFile(
              "sh",
              ["-c", command],
              {
                cwd: options?.cwd ?? worktreePath,
                maxBuffer: 10 * 1024 * 1024,
              },
              (error, stdout, stderr) => {
                if (error && error.code === undefined) {
                  reject(new Error(`exec failed: ${error.message}`));
                } else {
                  resolve({
                    stdout: stdout.toString(),
                    stderr: stderr.toString(),
                    exitCode: typeof error?.code === "number" ? error.code : 0,
                  });
                }
              },
            );
          });
        },

        copyFileIn: async (
          hostPath: string,
          sandboxPath: string,
        ): Promise<void> => {
          await mkdir(dirname(sandboxPath), { recursive: true });
          await copyFile(hostPath, sandboxPath);
        },

        copyFileOut: async (
          sandboxPath: string,
          hostPath: string,
        ): Promise<void> => {
          await mkdir(dirname(hostPath), { recursive: true });
          await copyFile(sandboxPath, hostPath);
        },

        close: async (): Promise<void> => {
          await rm(sandboxRoot, { recursive: true, force: true });
        },
      };
    },
  });
