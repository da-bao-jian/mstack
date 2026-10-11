import { expect, test } from "bun:test";
import asset from "../../../assets/logo.json";
import {
	detectMode,
	palette,
	renderLogo,
	renderPalette,
	style,
} from "../src/index.ts";

for (const size of [32, 44, 60] as const) {
	for (const mode of ["mono", "ascii"] as const)
		test(`${size} ${mode} snapshot and pixel parity`, () => {
			const lines = renderLogo({ size, mode });
			expect(lines.join("\n")).toMatchSnapshot();
			expect(lines).toHaveLength(asset.sizes[size].height / 2);
			expect(lines.join("\n")).not.toContain("\x1b");
			if (mode === "ascii") expect(lines.join("\n")).toMatch(/^[ -~\n]*$/);
			const grid = asset.sizes[size];
			for (let y = 0; y < grid.height; y += 2)
				expect(lines[y / 2]).toBe(
					[...grid.rows[y]]
						.map(
							(pixel, x) =>
								(mode === "ascii" ? " -+#" : " ░▒█")[
									Number(pixel === "0" ? grid.rows[y + 1][x] : pixel)
								],
						)
						.join("")
						.trimEnd(),
				);
		});
	for (const mode of ["truecolor", "ansi256"] as const)
		test(`${size} ${mode} half-block geometry and per-cell reset`, () => {
			const lines = renderLogo({ size, mode });
			const grid = asset.sizes[size];
			for (let y = 0; y < grid.height; y += 2) {
				const codes: Record<string, string> =
					mode === "truecolor"
						? { "1": "2;127;216;255", "2": "2;246;96;71", "3": "2;2;123;176" }
						: { "1": "5;117", "2": "5;203", "3": "5;31" };
				const expected = [...grid.rows[y]]
					.map((top, x) => {
						const bottom = grid.rows[y + 1][x];
						if (top === "0" && bottom === "0") return " ";
						const fg = top === "0" ? bottom : top;
						const bg =
							top !== "0" && bottom !== "0" ? `\x1b[48;${codes[bottom]}m` : "";
						return `\x1b[38;${codes[fg]}m${bg}${top === "0" ? "▄" : "▀"}\x1b[0m`;
					})
					.join("")
					.trimEnd();
				expect(lines[y / 2]).toBe(expected);
				expect(Bun.stringWidth(lines[y / 2])).toBeLessThanOrEqual(size);
			}
		});
}
test.each([
	[{ LANG: "en_US.UTF-8", COLORTERM: "truecolor" }, true, "truecolor"],
	[{ LANG: "C.UTF8", COLORTERM: "24bit" }, true, "truecolor"],
	[{ TERM: "xterm-256color" }, true, "ansi256"],
	[{ TERM: "xterm" }, true, "mono"],
	[{ COLORTERM: "truecolor", NO_COLOR: "" }, true, "mono"],
	[{ COLORTERM: "truecolor" }, false, "mono"],
	[{ LANG: "C", COLORTERM: "truecolor" }, true, "ascii"],
	[{ LANG: "C", NO_COLOR: "1" }, false, "ascii"],
	[
		{ LC_ALL: "C", LC_CTYPE: "en_US.UTF-8", LANG: "en_US.UTF-8" },
		true,
		"ascii",
	],
	[
		{ LC_ALL: "", LC_CTYPE: "en_US.UTF-8", LANG: "C", TERM: "256color" },
		true,
		"ansi256",
	],
] as const)("mode for %j tty=%s is %s", (env, isTTY, expected) =>
	expect(detectMode({ env, isTTY })).toBe(expected),
);
test("palette and styles respect terminal capabilities", () => {
	expect(palette).toEqual({
		bg: "#e9e3d5",
		sky: "#7fd8ff",
		orange: "#f66047",
		navy: "#027bb0",
	});
	expect(renderPalette({ mode: "mono" })).toBe("·· ░░ ▒▒ ██");
	expect(renderPalette({ mode: "ascii" })).toBe(".. -- ++ ##");
	expect(renderPalette({ mode: "ansi256" })).toBe(
		"\x1b[48;5;254m  \x1b[0m \x1b[48;5;117m  \x1b[0m \x1b[48;5;203m  \x1b[0m \x1b[48;5;31m  \x1b[0m",
	);
	const terminal = { env: { COLORTERM: "truecolor" }, isTTY: true };
	expect(style("title", "bold", terminal)).toBe("\x1b[1mtitle\x1b[0m");
	expect(style("muted", "dim", terminal)).toBe("\x1b[2mmuted\x1b[0m");
	for (const effect of [
		"bold",
		"dim",
		"reset",
		"bg",
		"sky",
		"orange",
		"navy",
	] as const) {
		expect(style("x", effect, { env: { NO_COLOR: "" }, isTTY: true })).toBe(
			"x",
		);
		expect(style("x", effect, { ...terminal, isTTY: false })).toBe("x");
	}
	for (const color of ["bg", "sky", "orange", "navy"] as const)
		expect(style("x", color, terminal)).toContain("\x1b[38;2;");
});
