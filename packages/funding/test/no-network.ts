// A missing fixture must fail instead of making a live request during bun test.
function refuseNetwork(): never {
	throw new Error(
		"Network disabled in tests; inject recorded fixture responses",
	);
}
globalThis.fetch = Object.assign(refuseNetwork, { preconnect: refuseNetwork });
