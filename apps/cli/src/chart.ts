// A small terminal line chart: one column per bucket of points, with the
// scale on the left and a zero line when the range crosses zero.

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
	// Each column draws its bucket's value farthest from the mean, so a spike
	// survives the folding.
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const buckets: number[] = [];
	const step = Math.max(1, values.length / width);
	for (let i = 0; i < values.length; i += step) {
		const bucket = values.slice(Math.floor(i), Math.floor(i + step));
		buckets.push(
			bucket.reduce((far, value) =>
				Math.abs(value - mean) > Math.abs(far - mean) ? value : far,
			),
		);
	}
	// The scale spans every value, so the labels match the window's range
	// even when a bucket's drawn point is not its extreme.
	let low = Math.min(...values);
	let high = Math.max(...values);
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
