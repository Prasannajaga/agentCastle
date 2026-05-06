import { describe, expect, it, vi } from "vitest";
import {
  defaultImageName,
  expandTilde,
  resolveHostPath,
  resolveSandboxPath,
  resolveUserMounts,
  normalizeMounts,
  parseGitdirPath,
  patchGitMountsForWindows,
  PARENT_GIT_SANDBOX_DIR,
} from "./mountUtils.js";
import { SANDBOX_REPO_DIR } from "./SandboxFactory.js";

vi.mock("node:fs", () => ({
  existsSync: (p: string) =>
    p === "/existing/path" || p === "/home/testuser/data",
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => "/home/testuser",
  };
});

describe("defaultImageName", () => {
  it("derives image name from POSIX repo directory", () => {
    expect(defaultImageName("/home/user/my-repo")).toBe("sandcastle:my-repo");
  });

  it("lowercases and sanitizes the directory name", () => {
    expect(defaultImageName("/home/user/My Repo!")).toBe("sandcastle:my-repo-");
  });

  it("handles trailing slashes", () => {
    expect(defaultImageName("/home/user/repo/")).toBe("sandcastle:repo");
  });

  it("falls back to 'local' for empty path", () => {
    expect(defaultImageName("")).toBe("sandcastle:local");
  });

  it("handles Windows paths with backslashes", () => {
    expect(defaultImageName("C:\\Users\\project")).toBe("sandcastle:project");
  });

  it("handles Windows paths with trailing backslash", () => {
    expect(defaultImageName("C:\\Users\\project\\")).toBe("sandcastle:project");
  });

  it("handles mixed separators", () => {
    expect(defaultImageName("C:\\Users/project")).toBe("sandcastle:project");
  });
});

describe("expandTilde", () => {
  it("expands ~ to home directory", () => {
    expect(expandTilde("~")).toBe("/home/testuser");
  });

  it("expands ~/ prefix", () => {
    expect(expandTilde("~/data")).toBe("/home/testuser/data");
  });

  it("expands ~\\ prefix (Windows tilde path)", () => {
    expect(expandTilde("~\\data")).toBe("/home/testuser/data");
  });

  it("leaves absolute POSIX paths unchanged", () => {
    expect(expandTilde("/usr/local")).toBe("/usr/local");
  });

  it("leaves relative paths unchanged", () => {
    expect(expandTilde("relative/path")).toBe("relative/path");
  });
});

describe("resolveHostPath", () => {
  it("expands tilde and returns absolute path", () => {
    expect(resolveHostPath("~/data")).toBe("/home/testuser/data");
  });

  it("returns absolute paths as-is", () => {
    expect(resolveHostPath("/absolute/path")).toBe("/absolute/path");
  });
});

describe("resolveSandboxPath", () => {
  it("returns absolute paths as-is", () => {
    expect(resolveSandboxPath("/mnt/data")).toBe("/mnt/data");
  });

  it("resolves relative paths against SANDBOX_REPO_DIR", () => {
    expect(resolveSandboxPath("data")).toBe(`${SANDBOX_REPO_DIR}/data`);
  });

  it("expands ~ to sandboxHomedir when provided", () => {
    expect(resolveSandboxPath("~", "/home/agent")).toBe("/home/agent");
  });

  it("expands ~/.npm to sandboxHomedir/.npm", () => {
    expect(resolveSandboxPath("~/.npm", "/home/agent")).toBe(
      "/home/agent/.npm",
    );
  });

  it("throws when ~ is used but sandboxHomedir is undefined", () => {
    expect(() => resolveSandboxPath("~/.npm")).toThrow(
      /sandboxPath.*tilde.*sandboxHomedir/i,
    );
  });

  it("throws when ~ alone is used but sandboxHomedir is undefined", () => {
    expect(() => resolveSandboxPath("~")).toThrow(
      /sandboxPath.*tilde.*sandboxHomedir/i,
    );
  });
});

describe("resolveUserMounts", () => {
  it("resolves and validates user mounts", () => {
    const result = resolveUserMounts([
      { hostPath: "/existing/path", sandboxPath: "/mnt/data" },
    ]);
    expect(result).toEqual([
      { hostPath: "/existing/path", sandboxPath: "/mnt/data" },
    ]);
  });

  it("throws if hostPath does not exist", () => {
    expect(() =>
      resolveUserMounts([
        { hostPath: "/nonexistent/path", sandboxPath: "/mnt/data" },
      ]),
    ).toThrow("Mount hostPath does not exist");
  });

  it("preserves readonly flag", () => {
    const result = resolveUserMounts([
      { hostPath: "/existing/path", sandboxPath: "/mnt/data", readonly: true },
    ]);
    expect(result[0]!.readonly).toBe(true);
  });

  it("expands ~ in sandboxPath when sandboxHomedir is provided", () => {
    const result = resolveUserMounts(
      [{ hostPath: "/existing/path", sandboxPath: "~/.npm" }],
      "/home/agent",
    );
    expect(result[0]!.sandboxPath).toBe("/home/agent/.npm");
  });

  it("expands ~ alone in sandboxPath when sandboxHomedir is provided", () => {
    const result = resolveUserMounts(
      [{ hostPath: "/existing/path", sandboxPath: "~" }],
      "/home/agent",
    );
    expect(result[0]!.sandboxPath).toBe("/home/agent");
  });

  it("throws when ~ used in sandboxPath but sandboxHomedir is undefined", () => {
    expect(() =>
      resolveUserMounts([
        { hostPath: "/existing/path", sandboxPath: "~/.npm" },
      ]),
    ).toThrow(/sandboxPath.*tilde.*sandboxHomedir/i);
  });

  it("resolves hostPath tilde via os.homedir() regardless of sandboxHomedir", () => {
    const result = resolveUserMounts(
      [{ hostPath: "~/data", sandboxPath: "/mnt/data" }],
      undefined,
    );
    expect(result[0]!.hostPath).toBe("/home/testuser/data");
  });
});

describe("normalizeMounts", () => {
  describe("on non-Windows platform", () => {
    it("returns mounts unchanged", () => {
      const mounts = [{ hostPath: "/repo/.git", sandboxPath: "/repo/.git" }];
      const result = normalizeMounts(
        mounts,
        "/repo",
        SANDBOX_REPO_DIR,
        "linux",
      );
      expect(result).toEqual(mounts);
    });

    it("preserves sandboxPath === hostPath for git mounts on POSIX", () => {
      const mounts = [
        {
          hostPath: "/home/user/project/.git",
          sandboxPath: "/home/user/project/.git",
        },
      ];
      const result = normalizeMounts(
        mounts,
        "/home/user/project",
        SANDBOX_REPO_DIR,
        "darwin",
      );
      expect(result[0]!.sandboxPath).toBe("/home/user/project/.git");
    });
  });

  describe("on Windows platform", () => {
    it("normalizes backslashes to forward slashes in hostPath", () => {
      const mounts = [
        {
          hostPath: "C:\\Users\\project\\.git",
          sandboxPath: "C:\\Users\\project\\.git",
        },
      ];
      const result = normalizeMounts(
        mounts,
        "C:\\Users\\project",
        SANDBOX_REPO_DIR,
        "win32",
      );
      expect(result[0]!.hostPath).toBe("C:/Users/project/.git");
    });

    it("remaps sandboxPath to POSIX path relative to sandboxRepoDir when under worktree path", () => {
      const mounts = [
        {
          hostPath: "C:\\Users\\project\\.git",
          sandboxPath: "C:\\Users\\project\\.git",
        },
      ];
      const result = normalizeMounts(
        mounts,
        "C:\\Users\\project",
        SANDBOX_REPO_DIR,
        "win32",
      );
      expect(result[0]!.sandboxPath).toBe(`${SANDBOX_REPO_DIR}/.git`);
    });

    it("normalizes the worktree mount itself", () => {
      const mounts = [
        { hostPath: "C:\\Users\\project", sandboxPath: SANDBOX_REPO_DIR },
        {
          hostPath: "C:\\Users\\project\\.git",
          sandboxPath: "C:\\Users\\project\\.git",
        },
      ];
      const result = normalizeMounts(
        mounts,
        "C:\\Users\\project",
        SANDBOX_REPO_DIR,
        "win32",
      );
      expect(result[0]!.hostPath).toBe("C:/Users/project");
      expect(result[0]!.sandboxPath).toBe(SANDBOX_REPO_DIR);
      expect(result[1]!.hostPath).toBe("C:/Users/project/.git");
      expect(result[1]!.sandboxPath).toBe(`${SANDBOX_REPO_DIR}/.git`);
    });

    it("handles worktree git mounts from parent repo", () => {
      // In worktree mode, the parent .git directory is also mounted
      const parentGitDir = "C:\\Users\\repo\\.git";
      const mounts = [
        {
          hostPath: "C:\\Users\\worktrees\\my-wt",
          sandboxPath: SANDBOX_REPO_DIR,
        },
        {
          hostPath: "C:\\Users\\worktrees\\my-wt\\.git",
          sandboxPath: "C:\\Users\\worktrees\\my-wt\\.git",
        },
        { hostPath: parentGitDir, sandboxPath: parentGitDir },
      ];
      const result = normalizeMounts(
        mounts,
        "C:\\Users\\worktrees\\my-wt",
        SANDBOX_REPO_DIR,
        "win32",
      );
      // worktree mount: hostPath normalized, sandboxPath already POSIX
      expect(result[0]!.hostPath).toBe("C:/Users/worktrees/my-wt");
      expect(result[0]!.sandboxPath).toBe(SANDBOX_REPO_DIR);
      // .git file mount: under worktree, so sandboxPath remapped
      expect(result[1]!.hostPath).toBe("C:/Users/worktrees/my-wt/.git");
      expect(result[1]!.sandboxPath).toBe(`${SANDBOX_REPO_DIR}/.git`);
      // parent .git dir: NOT under worktree, sandboxPath gets backslashes normalized
      expect(result[2]!.hostPath).toBe("C:/Users/repo/.git");
      expect(result[2]!.sandboxPath).toBe("C:/Users/repo/.git");
    });

    it("preserves readonly flag through normalization", () => {
      const mounts = [
        {
          hostPath: "C:\\Users\\data",
          sandboxPath: "/mnt/data",
          readonly: true as const,
        },
      ];
      const result = normalizeMounts(
        mounts,
        "C:\\Users\\project",
        SANDBOX_REPO_DIR,
        "win32",
      );
      expect(result[0]!.readonly).toBe(true);
    });

    it("normalizes backslashes in user mount hostPaths", () => {
      const mounts = [
        { hostPath: "C:\\Users\\project\\cache", sandboxPath: "/mnt/cache" },
      ];
      const result = normalizeMounts(
        mounts,
        "C:\\Users\\project",
        SANDBOX_REPO_DIR,
        "win32",
      );
      expect(result[0]!.hostPath).toBe("C:/Users/project/cache");
      // sandboxPath is already a valid POSIX path, unchanged
      expect(result[0]!.sandboxPath).toBe("/mnt/cache");
    });
  });
});

describe("parseGitdirPath", () => {
  it("parses POSIX gitdir path", () => {
    const result = parseGitdirPath(
      "/home/user/repo/.git/worktrees/my-worktree",
    );
    expect(result.parentGitDir).toBe("/home/user/repo/.git");
    expect(result.worktreeName).toBe("my-worktree");
  });

  it("parses Windows gitdir path with backslashes", () => {
    const result = parseGitdirPath("C:\\Users\\project\\.git\\worktrees\\abc");
    expect(result.parentGitDir).toBe("C:/Users/project/.git");
    expect(result.worktreeName).toBe("abc");
  });

  it("parses Windows gitdir path with forward slashes", () => {
    const result = parseGitdirPath(
      "C:/Users/project/.git/worktrees/feature-branch",
    );
    expect(result.parentGitDir).toBe("C:/Users/project/.git");
    expect(result.worktreeName).toBe("feature-branch");
  });

  it("handles trailing slash", () => {
    const result = parseGitdirPath("/home/user/repo/.git/worktrees/my-wt/");
    expect(result.parentGitDir).toBe("/home/user/repo/.git");
    expect(result.worktreeName).toBe("my-wt");
  });
});

describe("patchGitMountsForWindows", () => {
  // Mock readFile and statFile for deterministic cross-platform testing.
  // Tests use POSIX-style paths but simulate win32 platform behavior.

  const makeStatFile =
    (gitFileType: "file" | "directory") =>
    async (_path: string): Promise<"file" | "directory"> =>
      _path.endsWith(".git") ? gitFileType : "file";

  const makeReadFile =
    (gitdirContent: string) =>
    async (_path: string): Promise<string> =>
      gitdirContent;

  describe("on non-Windows platform", () => {
    it("returns mounts unchanged", async () => {
      const mounts = [{ hostPath: "/repo/.git", sandboxPath: "/repo/.git" }];
      const result = await patchGitMountsForWindows(
        mounts,
        "/worktree",
        SANDBOX_REPO_DIR,
        undefined,
        undefined,
        "linux",
      );
      expect(result).toEqual(mounts);
    });
  });

  describe("on Windows platform", () => {
    it("returns mounts unchanged when .git is a directory", async () => {
      const mounts = [
        {
          hostPath: "C:/Users/project/.git",
          sandboxPath: "C:/Users/project/.git",
        },
      ];
      const result = await patchGitMountsForWindows(
        mounts,
        "/tmp/test-worktree",
        SANDBOX_REPO_DIR,
        undefined,
        makeStatFile("directory"),
        "win32",
      );
      expect(result).toEqual(mounts);
    });

    it("remaps parent .git dir and adds overlay mount for Sandcastle-created worktree", async () => {
      // Scenario B: Sandcastle created a worktree. resolveGitMounts returned
      // one mount for the parent .git directory. The worktree's .git file
      // points into it.
      const mounts = [
        {
          hostPath: "C:/Users/project/.git",
          sandboxPath: "C:/Users/project/.git",
        },
      ];
      const result = await patchGitMountsForWindows(
        mounts,
        "/tmp/test-worktree",
        SANDBOX_REPO_DIR,
        makeReadFile("gitdir: C:/Users/project/.git/worktrees/my-wt\n"),
        makeStatFile("file"),
        "win32",
      );

      expect(result).toHaveLength(2);
      // Parent .git dir remapped to deterministic sandbox path
      expect(result[0]).toEqual({
        hostPath: "C:/Users/project/.git",
        sandboxPath: PARENT_GIT_SANDBOX_DIR,
      });
      // Overlay mount for corrected .git file
      expect(result[1]!.sandboxPath).toBe(`${SANDBOX_REPO_DIR}/.git`);
      // The hostPath is a temp file — just verify it exists
      expect(result[1]!.hostPath).toBeTruthy();
    });

    it("replaces .git file mount when host repo is a worktree", async () => {
      // Scenario A: Host repo is itself a worktree. resolveGitMounts returned
      // two mounts: the .git file and the parent .git directory.
      const mounts = [
        {
          hostPath: "/tmp/test-worktree/.git",
          sandboxPath: "/tmp/test-worktree/.git",
        },
        {
          hostPath: "C:/Users/parent-repo/.git",
          sandboxPath: "C:/Users/parent-repo/.git",
        },
      ];
      const result = await patchGitMountsForWindows(
        mounts,
        "/tmp/test-worktree",
        SANDBOX_REPO_DIR,
        makeReadFile("gitdir: C:/Users/parent-repo/.git/worktrees/my-branch\n"),
        makeStatFile("file"),
        "win32",
      );

      expect(result).toHaveLength(2);
      // .git file mount replaced with corrected version
      expect(result[0]!.sandboxPath).toBe(`${SANDBOX_REPO_DIR}/.git`);
      // Parent .git dir remapped
      expect(result[1]).toEqual({
        hostPath: "C:/Users/parent-repo/.git",
        sandboxPath: PARENT_GIT_SANDBOX_DIR,
      });
    });

    it("corrected .git file contains POSIX gitdir path", async () => {
      const mounts = [
        {
          hostPath: "C:/Users/project/.git",
          sandboxPath: "C:/Users/project/.git",
        },
      ];

      let writtenContent = "";
      const origPatch = patchGitMountsForWindows;
      const result = await origPatch(
        mounts,
        "/tmp/test-worktree",
        SANDBOX_REPO_DIR,
        makeReadFile("gitdir: C:\\Users\\project\\.git\\worktrees\\feat-x\n"),
        makeStatFile("file"),
        "win32",
      );

      // Verify the overlay mount points to the right sandbox path
      const overlayMount = result.find(
        (m) => m.sandboxPath === `${SANDBOX_REPO_DIR}/.git`,
      );
      expect(overlayMount).toBeDefined();

      // Read the temp file to verify its content
      const { readFile } = await import("node:fs/promises");
      writtenContent = await readFile(overlayMount!.hostPath, "utf-8");
      expect(writtenContent).toBe(
        `gitdir: ${PARENT_GIT_SANDBOX_DIR}/worktrees/feat-x\n`,
      );
    });

    it("returns mounts unchanged when .git file has no gitdir line", async () => {
      const mounts = [
        {
          hostPath: "C:/Users/project/.git",
          sandboxPath: "C:/Users/project/.git",
        },
      ];
      const result = await patchGitMountsForWindows(
        mounts,
        "/tmp/test-worktree",
        SANDBOX_REPO_DIR,
        makeReadFile("something unexpected\n"),
        makeStatFile("file"),
        "win32",
      );
      expect(result).toEqual(mounts);
    });

    it("handles Windows backslash gitdir paths", async () => {
      const mounts = [
        {
          hostPath: "C:/Users/project/.git",
          sandboxPath: "C:/Users/project/.git",
        },
      ];
      const result = await patchGitMountsForWindows(
        mounts,
        "/tmp/test-worktree",
        SANDBOX_REPO_DIR,
        makeReadFile(
          "gitdir: C:\\Users\\project\\.git\\worktrees\\backslash-wt\n",
        ),
        makeStatFile("file"),
        "win32",
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        hostPath: "C:/Users/project/.git",
        sandboxPath: PARENT_GIT_SANDBOX_DIR,
      });

      // Verify temp file content
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(result[1]!.hostPath, "utf-8");
      expect(content).toBe(
        `gitdir: ${PARENT_GIT_SANDBOX_DIR}/worktrees/backslash-wt\n`,
      );
    });
  });
});
