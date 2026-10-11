// Ported from mobius@33ed2ece frontend/src/lib/legal.ts
export const LEGAL_EIP712_DOMAIN_NAME = "Mobius Legal";
export const LEGAL_EIP712_DOMAIN_VERSION = "1";

export const ACCEPT_LEGAL_TERMS_PRIMARY_TYPE = "AcceptLegalTerms";

/**
 * Human-readable statement shown in the wallet prompt. Signed as the first
 * field so the wallet displays it prominently; pinned identically on the
 * server so the recorded evidence always carries this exact wording.
 */
export const ACCEPT_LEGAL_TERMS_STATEMENT =
  "I have read and agree to the Mobius Terms of Service and Privacy Policy. This signature only records my acceptance. It does not authorize any transaction and cannot move funds.";

export const ACCEPT_LEGAL_TERMS_TYPES = {
  AcceptLegalTerms: [
    { name: "statement", type: "string" },
    { name: "wallet", type: "address" },
    { name: "termsVersion", type: "string" },
    { name: "termsUrl", type: "string" },
    { name: "privacyVersion", type: "string" },
    { name: "privacyUrl", type: "string" },
    { name: "signedAt", type: "uint256" },
  ],
} as const;

