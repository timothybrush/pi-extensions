import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

export interface CodexCompactionConfig {
	autoCompact: boolean;
	thresholdRatio: number;
	notify: boolean;
}

const DEFAULT_CONFIG: CodexCompactionConfig = {
	autoCompact: true,
	thresholdRatio: 0.9,
	notify: false,
};

function readConfig(path: string): Partial<CodexCompactionConfig> {
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		return {
			...(typeof parsed.autoCompact === "boolean" ? { autoCompact: parsed.autoCompact } : {}),
			...(
				typeof parsed.thresholdRatio === "number" && parsed.thresholdRatio > 0 && parsed.thresholdRatio < 1
					? { thresholdRatio: parsed.thresholdRatio }
					: {}
			),
			...(typeof parsed.notify === "boolean" ? { notify: parsed.notify } : {}),
		};
	} catch {
		return {};
	}
}

export function loadConfig(cwd: string, projectTrusted: boolean): CodexCompactionConfig {
	const globalConfig = readConfig(join(homedir(), CONFIG_DIR_NAME, "agent", "pi-codex-compaction.json"));
	const projectConfig = projectTrusted
		? readConfig(join(cwd, CONFIG_DIR_NAME, "pi-codex-compaction.json"))
		: {};
	const configured = { ...DEFAULT_CONFIG, ...globalConfig, ...projectConfig };
	const envRatio = Number(process.env.PI_CODEX_COMPACTION_THRESHOLD_RATIO);
	return {
		...configured,
		...(Number.isFinite(envRatio) && envRatio > 0 && envRatio < 1 ? { thresholdRatio: envRatio } : {}),
	};
}
