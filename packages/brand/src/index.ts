import logo from "../../../assets/logo.json";

export const palette = logo.palette;
export type Mode = "truecolor" | "ansi256" | "mono" | "ascii";
type Environment = Record<string, string | undefined>;
export type Terminal = { env: Environment; isTTY: boolean };
type Color = keyof typeof palette;
const colors: Color[] = ["bg", "sky", "orange", "navy"];
const rgb = (hex: string) =>
	[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const ansi = [
	[0, 0, 0],
	[128, 0, 0],
	[0, 128, 0],
	[128, 128, 0],
	[0, 0, 128],
	[128, 0, 128],
	[0, 128, 128],
	[192, 192, 192],
	[128, 128, 128],
	[255, 0, 0],
	[0, 255, 0],
	[255, 255, 0],
	[0, 0, 255],
	[255, 0, 255],
	[0, 255, 255],
	[255, 255, 255],
];
for (const r of [0, 95, 135, 175, 215, 255])
	for (const g of [0, 95, 135, 175, 215, 255])
		for (const b of [0, 95, 135, 175, 215, 255]) ansi.push([r, g, b]);
for (let i = 0; i < 24; i++) ansi.push([8 + i * 10, 8 + i * 10, 8 + i * 10]);
// Squared Euclidean distance in RGB; ties use the first xterm palette index.
const nearest = Object.fromEntries(
	colors.map((color) => {
		const target = rgb(palette[color]);
		const distances = ansi.map((value) =>
			value.reduce((sum, v, i) => sum + (v - target[i]) ** 2, 0),
		);
		return [color, distances.indexOf(Math.min(...distances))];
	}),
) as Record<Color, number>;
const reset = "\x1b[0m";
function sgr(color: Color, mode: "truecolor" | "ansi256", background = false) {
	return `\x1b[${background ? 48 : 38};${mode === "truecolor" ? `2;${rgb(palette[color]).join(";")}` : `5;${nearest[color]}`}m`;
}
export function detectMode({ env, isTTY }: Terminal): Mode {
	const locale = env.LC_ALL || env.LC_CTYPE || env.LANG;
	if (locale && !/utf-?8/i.test(locale)) return "ascii";
	if (!isTTY) return "ascii";
	if (env.NO_COLOR !== undefined) return "mono";
	if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? "")) return "truecolor";
	return env.TERM?.includes("256color") ? "ansi256" : "mono";
}
export function renderTerminalLogo({
	size,
	terminal,
	mode = detectMode(terminal),
}: {
	size: 32 | 44 | 60;
	terminal: Terminal;
	mode?: Mode;
}): { lines: string[]; mode: Mode } {
	const lines = renderLogo({ size, mode });
	return {
		mode,
		lines: terminal.isTTY ? lines : ["<<<MOB", ...lines, "MOB>>>"],
	};
}
export function renderLogo({
	size,
	mode,
}: {
	size: 32 | 44 | 60;
	mode: Mode;
}): string[] {
	const grid = logo.sizes[String(size) as keyof typeof logo.sizes];
	const lines: string[] = [];
	for (let y = 0; y < grid.height; y += 2) {
		let line = "";
		for (let x = 0; x < grid.width; x++) {
			const top = Number(grid.rows[y][x]);
			const bottom = Number(grid.rows[y + 1]?.[x] ?? 0);
			if (mode === "mono" || mode === "ascii")
				line += (mode === "mono" ? " ░▒█" : " -+#")[top || bottom];
			else if (top || bottom)
				line +=
					(top ? sgr(colors[top], mode) : "") +
					(bottom && top
						? sgr(colors[bottom], mode, true)
						: bottom
							? sgr(colors[bottom], mode)
							: "") +
					(top ? "▀" : "▄") +
					reset;
			else line += " ";
		}
		lines.push(line.trimEnd());
	}
	return lines;
}
export function renderPalette({ mode }: { mode: Mode }): string {
	return colors
		.map((color, i) =>
			mode === "mono"
				? ["··", "░░", "▒▒", "██"][i]
				: mode === "ascii"
					? ["..", "--", "++", "##"][i]
					: `${sgr(color, mode, true)}  ${reset}`,
		)
		.join(" ");
}
export function style(
	text: string,
	effect:
		| "bold"
		| "dim"
		| "reset"
		| "success"
		| "warning"
		| "info"
		| "danger"
		| "muted"
		| Color,
	terminal: Terminal,
): string {
	const mode = detectMode(terminal);
	if (
		!terminal.isTTY ||
		terminal.env.NO_COLOR !== undefined ||
		mode === "mono" ||
		mode === "ascii"
	)
		return text;
	const statusColors = {
		success: "\x1b[32m",
		warning: "\x1b[33m",
		info: "\x1b[34m",
		danger: "\x1b[31m",
		muted: "\x1b[90m",
	};
	const code =
		effect in statusColors
			? statusColors[effect as keyof typeof statusColors]
			: effect === "bold"
				? "\x1b[1m"
				: effect === "dim"
					? "\x1b[2m"
					: effect === "reset"
						? reset
						: sgr(effect as Color, mode);
	return `${code}${text}${reset}`;
}
