import { mock } from "bun:test";
import type { ParsedMail } from "mailparser";

export function createMockSimpleParser() {
	let pendingResult: ParsedMail | null = null;
	let pendingError: Error | null = null;

	const fn = mock(
		(_source: string, callback: (err: any, mail: ParsedMail) => void) => {
			if (pendingError) {
				const err = pendingError;
				pendingError = null;
				callback(err, undefined as any);
			} else {
				const mail = pendingResult;
				pendingResult = null;
				callback(undefined, mail!);
			}
		},
	);

	return {
		fn,
		setError: (err: Error) => {
			pendingError = err;
			pendingResult = null;
		},
		setResult: (mail: ParsedMail) => {
			pendingResult = mail;
			pendingError = null;
		},
	};
}
