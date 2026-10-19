/** Answers the venue account lookups the way Hyperliquid and Lighter do. */
export function venueAccountResponse(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	owner: string,
	missing: readonly string[] = [],
): Response | undefined {
	const url = new URL(String(input));
	if (url.host === "api.hyperliquid.xyz" && url.pathname === "/info") {
		const { type } = JSON.parse(String(init?.body));
		if (type === "userRole")
			return Response.json({
				role: missing.includes("hl") ? "missing" : "user",
			});
		// "hl-deposit" in `missing` is a wallet that exists but never deposited.
		if (type === "clearinghouseState")
			return Response.json({
				marginSummary: {
					accountValue: missing.includes("hl-deposit") ? "0.0" : "250.5",
				},
			});
		if (type === "spotClearinghouseState")
			return Response.json({ balances: [] });
		return undefined;
	}
	if (url.pathname !== "/api/v1/accountsByL1Address") return undefined;
	const venue =
		url.host === "mainnet.zklighter.elliot.ai"
			? "lighter-mainnet"
			: url.host === "api.rh.lighter.xyz"
				? "lighter"
				: undefined;
	if (!venue || url.searchParams.get("l1_address") !== owner) return undefined;
	if (missing.includes(venue))
		return Response.json(
			{ code: 21100, message: "account not found" },
			{ status: 400 },
		);
	return Response.json({
		code: 200,
		l1_address: owner,
		sub_accounts: [
			{ code: 0, account_type: 1, index: 900, l1_address: owner },
			{
				code: 0,
				account_type: 0,
				index: venue === "lighter" ? 123 : 456,
				l1_address: owner,
			},
		],
	});
}
