// A small terminal line chart: one column per bucket of points, the last
// value of each bucket, with the scale on the left and a zero line when the
// range crosses zero.

export function lineChart(
	values: readonly number[],
	options: {
		width?: number;
		height?: number;
		format: (value: number) => string;
	},
): string[] {
	if (!values.length) return [];
	const width = Math.max(10, options.width ?? 60);
	const height = Math.max(4, options.height ?? 10);
	const buckets: number[] = [];
	const step = Math.max(1, values.length / width);
	for (let i = 0; i < values.length; i += step)
		buckets.push(values[Math.min(values.length - 1, Math.floor(i + step) - 1)]);
	let low = Math.min(...buckets);
	let high = Math.max(...buckets);
	if (high === low) {
		high += 1;
		low -= 1;
	}
	const row = (value: number) =>
		Math.round(((high - value) / (high - low)) * (height - 1));
	const zero = low < 0 && high > 0 ? row(0) : -1;
	const grid: string[][] = Array.from({ length: height }, (_, y) =>
		Array.from({ length: buckets.length }, () => (y === zero ? "-" : " ")),
	);
	buckets.forEach((value, x) => {
		grid[row(value)][x] = "•";
	});
	const labels = grid.map((_, y) =>
		y === 0
			? options.format(high)
			: y === height - 1
				? options.format(low)
				: y === zero
					? options.format(0)
					: "",
	);
	const pad = Math.max(...labels.map((label) => label.length));
	return grid.map(
		(cells, y) => `${labels[y].padStart(pad)} │${cells.join("").trimEnd()}`,
	);
}
