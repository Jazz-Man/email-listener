import { mock } from "bun:test";
import { EventEmitter } from "node:events";
import Imap from "imap";

const origConnect = Imap.prototype.connect;
const origEnd = Imap.prototype.end;
const origOpenBox = Imap.prototype.openBox;
const origSearch = Imap.prototype.search;
const origFetch = Imap.prototype.fetch;

let capturedInstance: (EventEmitter & Record<string, any>) | null = null;

let openBoxError: Error | null = null;
let searchResults: number[] = [];
let searchError: Error | null = null;
let fetchError: Error | null = null;
let streamError: Error | null = null;
let fetchMessages: Array<{ msg: MockImapMessage; seqno: number }> = [];

export const connectMock = mock(function (this: any) {
	capturedInstance = this;
});

export const endMock = mock(function (this: any) {});

export const openBoxMock = mock(
	(
		mailbox: string,
		_readOnly: boolean,
		cb: (err: Error | null, box?: any) => void,
	) => {
		if (openBoxError) {
			const err = openBoxError;
			openBoxError = null;
			cb(err);
		} else {
			cb(null, { name: mailbox });
		}
	},
);

export const searchMock = mock(
	(_criteria: unknown[], cb: (err: Error | null, uids: number[]) => void) => {
		if (searchError) {
			const err = searchError;
			searchError = null;
			cb(err, []);
		} else {
			const results = [...searchResults];
			searchResults = [];
			cb(null, results);
		}
	},
);

export const fetchMock = mock((_source: unknown, _options: unknown) => {
	const fetchEmitter = new MockImapFetch();

	if (fetchError) {
		const err = fetchError;
		fetchError = null;
		setImmediate(() => {
			fetchEmitter.emit("error", err);
		});
	} else {
		const entry = fetchMessages.shift();
		if (entry) {
			setImmediate(() => {
				fetchEmitter.emit("message", entry.msg, entry.seqno);
				entry.msg.deliver();
			});
		}
	}

	return fetchEmitter;
});

export function setOpenBoxError(err: Error) {
	openBoxError = err;
}

export function setSearchResults(uids: number[]) {
	searchResults = uids;
}

export function setSearchError(err: Error) {
	searchError = err;
}

export function setFetchError(err: Error) {
	fetchError = err;
}

export function setStreamError(err: Error) {
	streamError = err;
}

export function addFetchMessage(
	bodyData: string,
	seqno: number,
	attrs: Imap.ImapMessageAttributes,
) {
	fetchMessages.push({
		msg: new MockImapMessage(bodyData, attrs, streamError),
		seqno,
	});
	streamError = null;
}

export function emitReady() {
	capturedInstance?.emit("ready");
}

export function emitClose() {
	capturedInstance?.emit("close");
}

export function emitError(err: Error) {
	capturedInstance?.emit("error", err);
}

export function emitMail() {
	capturedInstance?.emit("mail");
}

export function emitUpdate() {
	capturedInstance?.emit("update");
}

export function install() {
	Imap.prototype.connect = connectMock as any;
	Imap.prototype.end = endMock as any;
	Imap.prototype.openBox = openBoxMock as any;
	Imap.prototype.search = searchMock as any;
	Imap.prototype.fetch = fetchMock as any;
}

export function restore() {
	Imap.prototype.connect = origConnect;
	Imap.prototype.end = origEnd;
	Imap.prototype.openBox = origOpenBox;
	Imap.prototype.search = origSearch;
	Imap.prototype.fetch = origFetch;
}

export function reset() {
	capturedInstance = null;
	openBoxError = null;
	searchResults = [];
	searchError = null;
	fetchError = null;
	fetchMessages = [];
	streamError = null;
	connectMock.mockClear();
	endMock.mockClear();
	openBoxMock.mockClear();
	searchMock.mockClear();
	fetchMock.mockClear();
}

// Auto-install on import (preload)
install();

class MockImapMessage extends EventEmitter {
	private bodyData: string;
	private attrs: Imap.ImapMessageAttributes;
	private streamErr: Error | null;

	constructor(
		bodyData: string,
		attrs: Imap.ImapMessageAttributes,
		streamErr: Error | null = null,
	) {
		super();
		this.bodyData = bodyData;
		this.attrs = attrs;
		this.streamErr = streamErr;
	}

	deliver(): void {
		const stream = new MockReadableStream(this.bodyData, this.streamErr);
		this.emit("body", stream, { size: this.bodyData.length, which: "TEXT" });
		this.emit("attributes", this.attrs);
		stream.start();
	}
}

class MockReadableStream extends EventEmitter {
	private data: string;
	private streamErr: Error | null;

	constructor(data: string, streamErr: Error | null = null) {
		super();
		this.data = data;
		this.streamErr = streamErr;
	}

	start(): void {
		setImmediate(() => {
			if (this.streamErr) {
				this.emit("error", this.streamErr);
				return;
			}
			this.emit("data", Buffer.from(this.data, "utf-8"));
			this.emit("end");
		});
	}
}

class MockImapFetch extends EventEmitter {}
