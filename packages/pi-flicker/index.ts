import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_INTERVAL_MS = 90;
const MIN_INTERVAL_MS = 30;
const MAX_INTERVAL_MS = 2000;
const DEFAULT_FLASH_GAP_MS = 16;
const MIN_FLASH_GAP_MS = 0;
const MAX_FLASH_GAP_MS = 100;
const WIDGET_KEY = "pi-flicker";

function parseClampedInt(value: string | undefined, fallback: number, min: number, max: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(min, Math.min(max, parsed));
}

function parseIntervalMs(value: string | undefined): number {
	return parseClampedInt(value, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
}

function parseFlashGapMs(value: string | undefined): number {
	return parseClampedInt(value, DEFAULT_FLASH_GAP_MS, MIN_FLASH_GAP_MS, MAX_FLASH_GAP_MS);
}

function installFlicker(ctx: ExtensionContext, intervalMs: number, flashGapMs: number): void {
	if (!ctx.hasUI) return;

	ctx.ui.setWidget(
		WIDGET_KEY,
		(tui, _theme) => {
			type TUIInternals = {
				previousLines?: string[];
				previousViewportTop?: number;
				previousHeight?: number;
				terminal: { write(data: string): void; rows: number };
			};

			type FrameSnapshot = {
				lines: string[];
				capturedAt: number;
			};

			const snapshots: FrameSnapshot[] = [];
			let repaintTimeout: ReturnType<typeof setTimeout> | null = null;

			function captureVisibleFrame(): FrameSnapshot | null {
				const internal = tui as unknown as TUIInternals;
				const previousLines = internal.previousLines;
				if (!Array.isArray(previousLines) || previousLines.length === 0) return null;

				const height =
					typeof internal.previousHeight === "number" && internal.previousHeight > 0
						? internal.previousHeight
						: internal.terminal.rows;
				const viewportTop =
					typeof internal.previousViewportTop === "number"
						? internal.previousViewportTop
						: Math.max(0, previousLines.length - height);
				const lines = previousLines.slice(viewportTop, viewportTop + height);
				return { lines, capturedAt: Date.now() };
			}

			function writeFrame(lines: string[]): void {
				const internal = tui as unknown as TUIInternals;
				let buffer = "\x1b[2J\x1b[H";
				for (let i = 0; i < lines.length; i++) {
					if (i > 0) buffer += "\r\n";
					buffer += lines[i] ?? "";
				}
				buffer += "\x1b[J";
				internal.terminal.write(buffer);
			}

			const timer = setInterval(() => {
				if (repaintTimeout) {
					clearTimeout(repaintTimeout);
					repaintTimeout = null;
				}

				const snapshot = captureVisibleFrame();
				if (snapshot) {
					snapshots.push(snapshot);
					if (snapshots.length > 6) snapshots.shift();
				}

				const staleSnapshot = snapshots.length >= 3 ? snapshots.at(-3) : snapshots.at(0);
				if (staleSnapshot && staleSnapshot.lines.length > 0) {
					// Replay a stale viewport-sized frame first so old text visibly snaps back
					// into place before the real render catches up.
					writeFrame(staleSnapshot.lines);
				} else {
					const internal = tui as unknown as TUIInternals;
					internal.terminal.write("\x1b[2J\x1b[H\x1b[3J");
				}

				repaintTimeout = setTimeout(() => {
					tui.requestRender(true);
					repaintTimeout = null;
				}, flashGapMs);
			}, intervalMs);

			return {
				dispose() {
					clearInterval(timer);
					if (repaintTimeout) clearTimeout(repaintTimeout);
				},
				invalidate() {},
				render(_width: number): string[] {
					return [""];
				},
			};
		},
		{ placement: "belowEditor" },
	);
}

function uninstallFlicker(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setWidget(WIDGET_KEY, undefined);
}

function normalizeAction(args: string): "on" | "off" | "toggle" | "invalid" {
	const action = args.trim().toLowerCase();
	if (action === "" || action === "toggle") return "toggle";
	if (action === "on") return "on";
	if (action === "off") return "off";
	return "invalid";
}

export default function piFlickerExtension(pi: ExtensionAPI) {
	let enabled = process.env.PI_FLICKER !== "0";
	let working = false;
	const intervalMs = parseIntervalMs(process.env.PI_FLICKER_INTERVAL_MS);
	const flashGapMs = parseFlashGapMs(process.env.PI_FLICKER_FLASH_MS);

	function apply(ctx: ExtensionContext): void {
		if (enabled && working) installFlicker(ctx, intervalMs, flashGapMs);
		else uninstallFlicker(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		working = false;
		apply(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		working = false;
		apply(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		working = true;
		apply(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		working = false;
		apply(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		working = false;
		uninstallFlicker(ctx);
	});

	pi.registerCommand("flicker", {
		description: "Toggle the pi-flicker meme renderer",
		handler: async (args, ctx) => {
			const action = normalizeAction(args);
			if (action === "invalid") {
				ctx.ui.notify("Usage: /flicker [on|off|toggle]", "error");
				return;
			}

			if (action === "toggle") enabled = !enabled;
			else enabled = action === "on";

			apply(ctx);
			ctx.ui.notify(
				enabled
					? working
						? `pi-flicker enabled (${intervalMs}ms redraws, ${flashGapMs}ms stale-frame flash while agent works)`
						: `pi-flicker armed (${intervalMs}ms redraws, ${flashGapMs}ms stale-frame flash when agent starts working)`
					: "pi-flicker disabled",
				"info",
			);
		},
	});

	pi.registerCommand("no_flicker", {
		description: "Disable pi-flicker",
		handler: async (_args, ctx) => {
			enabled = false;
			apply(ctx);
			ctx.ui.notify("NO_FLICKER mode activated. terminal citizenship restored.", "info");
		},
	});
}
