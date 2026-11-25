export type ConsentChoice = {
  terms: boolean;
  privacy: boolean;
  overseas_transfer: boolean;
};

export const EMPTY_CONSENT: ConsentChoice = {
  terms: false,
  privacy: false,
  overseas_transfer: false,
};

export function consentReady(choice: ConsentChoice): boolean {
  return choice.terms === true && choice.privacy === true && choice.overseas_transfer === true;
}

const LEGAL_PATHS = new Set(["/privacy", "/terms"]);

export function needsConsentGate(consentsCurrent: boolean | undefined, path: string): boolean {
  if (consentsCurrent === true) return false;
  return !LEGAL_PATHS.has(path);
}
