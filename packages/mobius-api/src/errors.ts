const KEY_PATTERN = /mobius_([0-9a-fA-F-]{36})\.[0-9a-fA-F]{64}/g;

export function redactKey(text: string): string {
	return text.replace(KEY_PATTERN, "mobius_$1…");
}

// Also a malformed key (any secret length) and a key fragment a cut leaves.
const LOOSE_KEY = /mobius_([0-9a-fA-F-]{36})\.[0-9a-fA-F]+/g;
const TRAILING_FRAGMENT = /mobius_[0-9a-fA-F-]*(?:\.[0-9a-fA-F]*)?$/;

/** A bounded excerpt of a response body for an error message. It redacts
 * before it cuts, so a key that crosses the cut leaves no partial secret,
 * and it drops a key fragment the cut leaves at the end. */
export function redactExcerpt(text: string, limit = 240): string {
	const redacted = redactKey(text).replace(LOOSE_KEY, "mobius_$1…");
	if (redacted.length <= limit) return redacted;
	return `${redacted.slice(0, limit).replace(TRAILING_FRAGMENT, "")}…`;
}

export class StrategyApiError extends Error {
	readonly route: string;
	readonly status: number;
	readonly requestId?: string;
	readonly code?: string;
	readonly error?: string;
	readonly serverError?: string;
	readonly taskId?: string;

	constructor(options: {
		name?: string;
		route: string;
		status: number;
		requestId?: string | null;
		code?: string;
		serverError?: string;
		taskId?: string;
		message: string;
	}) {
		super(redactKey(options.message));
		this.name = options.name ?? "StrategyApiError";
		this.route = redactKey(options.route);
		this.status = options.status;
		this.requestId = options.requestId
			? redactKey(options.requestId)
			: undefined;
		this.code = options.code ? redactKey(options.code) : undefined;
		this.serverError = options.serverError
			? redactKey(options.serverError)
			: undefined;
		this.error = this.serverError;
		this.taskId = options.taskId;
	}
}

export class ApiKeyRejected extends StrategyApiError {
	constructor(options: ConstructorParameters<typeof StrategyApiError>[0]) {
		super({ ...options, name: "ApiKeyRejected" });
	}
}
export class ApiKeyScope extends StrategyApiError {
	constructor(options: ConstructorParameters<typeof StrategyApiError>[0]) {
		super({ ...options, name: "ApiKeyScope" });
	}
}
export class IdempotencyConflict extends StrategyApiError {
	constructor(options: ConstructorParameters<typeof StrategyApiError>[0]) {
		super({ ...options, name: "IdempotencyConflict" });
	}
}
export class StrategyApiUnavailable extends StrategyApiError {
	constructor(options: ConstructorParameters<typeof StrategyApiError>[0]) {
		super({ ...options, name: "StrategyApiUnavailable" });
	}
}
export class ApiRateLimited extends StrategyApiError {
	constructor(
		options: ConstructorParameters<typeof StrategyApiError>[0],
		readonly retryAfterSeconds: number | undefined,
	) {
		super(options);
		this.name = "ApiRateLimited";
	}
}
