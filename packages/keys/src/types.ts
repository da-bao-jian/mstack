export type KeyStoreSelection =
	| "auto"
	| "env"
	| "keychain"
	| "secret-tool"
	| "file";
export type KeyStoreBackend = Exclude<KeyStoreSelection, "auto">;

export interface KeyMeta {
	name?: string;
	venues?: string[];
	maxSizeUsd?: number;
	importedAt: number;
	verifiedAt?: number;
	apiBase: string;
}

export interface StoredKey {
	key: string;
	meta: KeyMeta;
}

export interface KeyDescription {
	prefix: string;
	backend: KeyStoreBackend;
	meta: KeyMeta;
}

export interface KeyStore {
	readonly backend: KeyStoreBackend;
	put(owner: string, key: string, meta: KeyMeta): Promise<void>;
	get(owner: string): Promise<StoredKey | null>;
	delete(owner: string): Promise<boolean>;
	describe(owner: string): Promise<KeyDescription | null>;
}
