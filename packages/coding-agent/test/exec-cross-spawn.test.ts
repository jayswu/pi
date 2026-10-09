/**
 * Regression test for #10616: execCommand must spawn through spawnProcess
 * (cross-spawn on Windows) so .cmd shims like npm/npx/pnpm resolve instead of
 * failing with ENOENT when `shell: false`.
 */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { execCommand } from "../src/core/exec.ts";
import type * as childProcessUtils from "../src/utils/child-process.ts";

const spawnProcessMock = vi.hoisted(() => vi.fn());
vi.mock("../src/utils/child-process.ts", async (importOriginal) => ({
	...(await importOriginal<typeof childProcessUtils>()),
	spawnProcess: spawnProcessMock,
}));

/** Minimal ChildProcess stand-in whose pipes waitForChildProcess can observe. */
function fakeChildProcess() {
	const child = new EventEmitter() as EventEmitter & {
		stdout: PassThrough;
		stderr: PassThrough;
		kill: (signal?: string) => void;
	};
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = vi.fn();
	return child;
}

describe("execCommand spawns via spawnProcess (#10616)", () => {
	it("delegates to spawnProcess instead of node:child_process spawn", async () => {
		const child = fakeChildProcess();
		spawnProcessMock.mockReturnValueOnce(child);

		const pending = execCommand("npm", ["--version"], "/tmp", { timeout: 1000 });
		child.emit("exit", 0);
		child.stdout.end("1.2.3");
		child.stderr.end("");
		const result = await pending;

		expect(spawnProcessMock).toHaveBeenCalledWith(
			"npm",
			["--version"],
			expect.objectContaining({ cwd: "/tmp", shell: false }),
		);
		expect(result).toEqual({ stdout: "1.2.3", stderr: "", code: 0, killed: false });
	});

	it("resolves with code 1 when the process errors", async () => {
		const child = fakeChildProcess();
		spawnProcessMock.mockReturnValueOnce(child);

		const pending = execCommand("npm", ["--version"], "/tmp");
		child.emit("error", new Error("spawn npm ENOENT"));
		child.stdout.end();
		child.stderr.end();
		const result = await pending;

		expect(result.code).toBe(1);
		expect(result.killed).toBe(false);
	});
});

describe.skipIf(process.platform !== "win32")("execCommand on Windows (#10616)", () => {
	it("spawns npm, a .cmd shim, without a shell", async () => {
		const result = await execCommand("npm", ["--version"], process.cwd(), { timeout: 30_000 });
		expect(result.code).toBe(0);
		expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
	});
});
