import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SandboxPaths {
  root: string;
  traces: string;
  reviews: string;
  conclusions: string;
}

export function resolveSandboxPaths(baseDir = process.cwd()): SandboxPaths {
  const root = join(baseDir, "logs", "sandbox");
  return {
    root,
    traces: join(root, "traces"),
    reviews: join(root, "reviews"),
    conclusions: join(root, "conclusions"),
  };
}

/**
 * Ensures sandbox directories exist.
 */
export function initSandboxDirectories(baseDir = process.cwd()): SandboxPaths {
  const paths = resolveSandboxPaths(baseDir);
  for (const dir of [paths.root, paths.traces, paths.reviews, paths.conclusions]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  return paths;
}

/**
 * Purges all files from the sandbox logs directories, guaranteeing a clean run.
 */
export function cleanupSandboxLogs(baseDir = process.cwd()): { purgedCount: number } {
  const paths = initSandboxDirectories(baseDir);
  let purgedCount = 0;

  for (const dir of [paths.traces, paths.reviews, paths.conclusions]) {
    if (existsSync(dir)) {
      const files = readdirSync(dir);
      for (const file of files) {
        if (file === ".gitkeep") continue;
        rmSync(join(dir, file), { force: true, recursive: true });
        purgedCount++;
      }
    }
  }

  return { purgedCount };
}

export interface EditorSandboxPaths {
  root: string;
  traces: string;
  reviews: string;
  conclusions: string;
}

export function resolveEditorSandboxPaths(baseDir = process.cwd()): EditorSandboxPaths {
  const root = join(baseDir, "logs", "sandbox", "editors");
  return {
    root,
    traces: join(root, "traces"),
    reviews: join(root, "reviews"),
    conclusions: join(root, "conclusions"),
  };
}

/**
 * Ensures editor sandbox directories exist.
 */
export function initEditorSandboxDirectories(baseDir = process.cwd()): EditorSandboxPaths {
  const paths = resolveEditorSandboxPaths(baseDir);
  for (const dir of [paths.root, paths.traces, paths.reviews, paths.conclusions]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  return paths;
}

/**
 * Purges all files from the editor sandbox logs directories, guaranteeing a clean run.
 */
export function cleanupEditorSandboxLogs(baseDir = process.cwd()): { purgedCount: number } {
  const paths = initEditorSandboxDirectories(baseDir);
  let purgedCount = 0;

  for (const dir of [paths.traces, paths.reviews, paths.conclusions]) {
    if (existsSync(dir)) {
      const files = readdirSync(dir);
      for (const file of files) {
        if (file === ".gitkeep") continue;
        rmSync(join(dir, file), { force: true, recursive: true });
        purgedCount++;
      }
    }
  }

  return { purgedCount };
}
