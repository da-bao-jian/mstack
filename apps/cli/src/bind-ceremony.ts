import type { ArbitrageVenue } from "@mstack/mobius-client";
import type { Proposal } from "@mstack/proposals";

const names = {
	hl: "Hyperliquid",
	aster: "Aster",
	lighter: "Robinhood Lighter",
	"lighter-mainnet": "Lighter mainnet",
};

export function bindingSteps(
	venue: ArbitrageVenue,
	step: string,
	confirmOnly = false,
) {
	const steps = [
		"prepare binding",
		venue.startsWith("lighter") ? "approve key" : "approve agent",
		venue === "hl" && !confirmOnly
			? "approve builder fee"
			: venue === "lighter-mainnet"
				? "approve integrator"
				: "confirm binding",
	];
	const index =
		step === "prepare"
			? 0
			: ["approve-agent", "approve-key"].includes(step)
				? 1
				: 2;
	const complete = step === "complete";
	return `${names[venue]} binding · step ${index + 1} of 3 · ${complete ? "complete" : steps[index]}\n${steps.map((label, i) => `${complete || i < index ? "✓" : i === index ? "▶" : "·"} ${label}`).join("\n")}`;
}

export function bindingCeremony(p: Proposal): string {
	const binding = p.submit.binding;
	if (!binding) throw new Error("Binding ceremony requires a binding Proposal");
	const { venue, step } = binding;
	const action =
		step === "prepare"
			? "This signature asks MoB to prepare a venue key."
			: step === "approve-builder-fee"
				? "This signature approves the builder fee shown in the Proposal."
				: step === "approve-integrator"
					? "This signature approves the zero-fee Lighter integrator."
					: "This signature approves the venue key and its capabilities shown in the Proposal.";
	const after =
		step === "prepare"
			? `After submission, run mob bind ${venue} to review the key approval.`
			: p.submit.completion
				? "After submission, mob checks binding status and completes the stored finalization steps."
				: `After submission, run mob bind ${venue} to check the next step.`;
	return `${bindingSteps(venue, step, venue === "hl" && step === "approve-agent" && !!p.submit.completion)}\n${action}\n${after}\nThe MoB server creates and holds this venue key.`;
}
