import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { TestContext } from "node:test";

import {
  buildHeartbeatArgs,
  flushPending,
  pendingCount,
  resolveEditDetails,
  trackEdit,
  trackRead,
  trackWrite,
} from "../src/public.js";
import { VERSION } from "../src/version.js";

const RESET_PROJECT = process.cwd();

afterEach(() => {
  flushPending(RESET_PROJECT);
});

function createProject(t: TestContext): string {
  const project = mkdtempSync(join(tmpdir(), "omp-wakatime-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  return project;
}

function flagValue(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `${flag} should be present in ${args.join(" ")}`);
  assert.ok(index + 1 < args.length, `${flag} should have a value in ${args.join(" ")}`);
  return args[index + 1];
}

function assertFlag(args: string[], flag: string): void {
  assert.ok(args.includes(flag), `${flag} should be present in ${args.join(" ")}`);
}

test("session heartbeat args mark sessions as unsaved entities and disable WakaTime AI sync", () => {
  const projectFolder = "/workspace/example";

  const args = buildHeartbeatArgs("oh-my-pi/test omp-wakatime/test", {
    type: "session",
    entity: "omp://session/abc123",
    projectFolder,
    stateKey: "session:abc123",
    sourceEvent: "SessionStart",
  });

  assert.equal(flagValue(args, "--entity"), "omp://session/abc123");
  assert.equal(flagValue(args, "--project-folder"), projectFolder);
  assertFlag(args, "--is-unsaved-entity");
  assertFlag(args, "--sync-ai-disabled");
});

test("write heartbeat args report AI coding category, write mode, and signed line changes", () => {
  const args = buildHeartbeatArgs("oh-my-pi/test omp-wakatime/test", {
    type: "file",
    entity: "/workspace/example/src/file.ts",
    projectFolder: "/workspace/example",
    category: "coding",
    isWrite: true,
    lineChanges: -3,
    sourceEvent: "PostToolUse",
  });

  assertFlag(args, "--write");
  assertFlag(args, "--sync-ai-disabled");
  assert.equal(flagValue(args, "--category"), "ai coding");
  assert.equal(flagValue(args, "--ai-line-changes"), "-3");
});

test("trackRead followed by flushPending emits a coding heartbeat for the read file", (t) => {
  const project = createProject(t);
  const file = join(project, "readme.md");
  writeFileSync(file, "read content");

  trackRead(file);
  const heartbeats = flushPending(project);

  assert.deepEqual(heartbeats, [{
    type: "file",
    entity: file,
    projectFolder: project,
    category: "coding",
    isWrite: false,
    lineChanges: 0,
    sourceEvent: "PostToolUse",
  }]);
  assert.equal(pendingCount(), 0);
});

test("trackWrite counts written content lines and marks the heartbeat as an AI write", (t) => {
  const project = createProject(t);
  const file = join(project, "src", "written.ts");
  mkdirSync(join(project, "src"));

  trackWrite(file, "one\ntwo\nthree");
  const [heartbeat] = flushPending(project);

  assert.deepEqual(heartbeat, {
    type: "file",
    entity: file,
    projectFolder: project,
    category: "ai coding",
    isWrite: true,
    lineChanges: 3,
    sourceEvent: "PostToolUse",
  });
  assert.equal(pendingCount(), 0);
});

test("trackEdit parses unified diff additions and deletions into net AI line changes", (t) => {
  const project = createProject(t);
  const file = join(project, "src", "edited.ts");
  const diff = [
    "--- a/src/edited.ts",
    "+++ b/src/edited.ts",
    "@@ -1,2 +1,3 @@",
    " unchanged",
    "-removed line",
    "+added line",
    "+another added line",
  ].join("\n");

  trackEdit({ path: file, diff });
  const [heartbeat] = flushPending(project);

  assert.deepEqual(heartbeat, {
    type: "file",
    entity: file,
    projectFolder: project,
    category: "ai coding",
    isWrite: true,
    lineChanges: 1,
    sourceEvent: "PostToolUse",
  });
  assert.equal(pendingCount(), 0);
});

test("resolveEditDetails resolves every relative edit path against the project folder", (t) => {
  const project = createProject(t);
  const absoluteFile = join(project, "absolute.ts");

  const resolved = resolveEditDetails({
    path: "src/primary.ts",
    perFileResults: [
      { path: "src/per-file.ts", diff: "+changed" },
      { path: absoluteFile, diff: "+absolute" },
    ],
    files: ["src/listed.ts", absoluteFile],
    fileReplacements: [
      { path: "src/replaced.ts", count: 2 },
      { path: absoluteFile, count: 4 },
    ],
  }, project);

  assert.equal(resolved?.path, join(project, "src", "primary.ts"));
  assert.deepEqual(resolved?.perFileResults?.map((result) => result.path), [
    join(project, "src", "per-file.ts"),
    absoluteFile,
  ]);
  assert.deepEqual(resolved?.files, [
    join(project, "src", "listed.ts"),
    absoluteFile,
  ]);
  assert.deepEqual(resolved?.fileReplacements?.map((replacement) => replacement.path), [
    join(project, "src", "replaced.ts"),
    absoluteFile,
  ]);
});

test("flushPending skips directory entities, emits file heartbeats, and clears pending state", (t) => {
  const project = createProject(t);
  const directory = join(project, "generated-dir");
  const file = join(project, "generated-file.ts");
  mkdirSync(directory);
  writeFileSync(file, "const value = 1;\n");

  trackRead(directory);
  trackRead(file);
  assert.equal(pendingCount(), 2);

  const heartbeats = flushPending(project);

  assert.deepEqual(heartbeats.map((heartbeat) => heartbeat.entity), [file]);
  assert.equal(heartbeats[0].category, "coding");
  assert.equal(pendingCount(), 0);
  assert.deepEqual(flushPending(project), []);
});

test("VERSION constant stays in sync with package.json (drift would corrupt the User-Agent)", () => {
  const packageJson = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as { version: string };
  assert.equal(VERSION, packageJson.version);
});
