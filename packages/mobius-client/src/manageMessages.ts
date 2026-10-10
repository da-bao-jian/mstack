// Ported from mobius@33ed2ece frontend/src/features/delta-neutral/components/ManageView.tsx
export function buildCloseTaskMessage(params: {
	taskId: string;
	timestamp: number;
}): string {
	return `Close arbitrage task: ${params.taskId} timestamp=${params.timestamp}`;
}
export function buildNeutralizeTaskMessage(params: {
	taskId: string;
	timestamp: number;
}): string {
	return `Neutralize arbitrage task: ${params.taskId} timestamp=${params.timestamp}`;
}
export function buildAutoCloseTaskMessage(params: {
	taskId: string;
	autoClose: boolean;
	minFundingApy: number;
	timestamp: number;
}): string {
	return `Set arbitrage auto-close: ${params.taskId} autoClose=${params.autoClose ? "on" : "off"} minFundingApy=${params.minFundingApy} timestamp=${params.timestamp}`;
}
