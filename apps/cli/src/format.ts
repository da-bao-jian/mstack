import { style } from "@mstack/brand";

export type Terminal = {
	env?: Record<string, string | undefined>;
	stdoutIsTTY?: boolean;
	isTTY?: boolean;
};
export function paint(
	text: string,
	effect: Parameters<typeof style>[1],
	terminal: Terminal = {},
) {
	return style(text, effect, {
		env: terminal.env ?? process.env,
		isTTY: terminal.stdoutIsTTY ?? terminal.isTTY ?? !!process.stdout.isTTY,
	});
}
export function number(value: number, digits = 2): string {
	// "negative" signs only values that stay negative after rounding, so a
	// tiny negative rate prints 0.0000, never -0.0000.
	return value.toLocaleString("en-US", {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
		signDisplay: "negative",
	});
}
export function usd(value: number | undefined): string {
	if (value === undefined) return "—";
	for (const [scale, suffix] of [
		[1e9, "B"],
		[1e6, "M"],
		[1e3, "K"],
	] as const)
		if (Math.abs(value) >= scale)
			return `$${number(value / scale, 1)}${suffix}`;
	return `$${number(value, 2)}`;
}
export function relative(time: number, now: number): string {
	const seconds = Math.abs(Math.round((time - now) / 1000));
	const value =
		seconds < 60
			? `${seconds} sec`
			: seconds < 3600
				? `${Math.floor(seconds / 60)} min`
				: seconds < 86400
					? `${Math.floor(seconds / 3600)} hr`
					: `${Math.floor(seconds / 86400)} ${seconds < 172800 ? "day" : "days"}`;
	return time > now ? `in ${value}` : `${value} ago`;
}
export function expiry(time: number, now: number): string {
	if (time <= now) return `expired ${relative(time, now)}`;
	const seconds = Math.ceil((time - now) / 1000);
	return `expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
