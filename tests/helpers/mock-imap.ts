import { mock } from "bun:test";
import { EventEmitter } from "node:events";
import Imap from "imap";

export interface MockImapControls {
	instance: (EventEmitter & Record<string, any>) | null;
	connectMock: ReturnType<typeof mock>;
	endMock: ReturnType<typeof mock>;
	openBoxMock: ReturnType<typeof mock>;
	searchMock: ReturnType<typeof mock>;
	fetchMock: ReturnType<typeof mock>;

	setOpenBoxError(err: Error): void;
	setSearchResults(uids: number[]): void;
	setSearchError(err: Error): void;
	setFetchError(err: Error): void;
	addFetchMessage(
		bodyData: string,
		seqno: number,
		attrs: Imap.ImapMessageAttributes,
	): void;

	emitReady(): void;
	emitClose(): void;
	emitError(err: Error): void;
	emitMail(): void;
	emitUpdate(): void;

	reset(): void;
	install(): void;
	restore(): void;
}

export function createMockImap(): MockImapControls {
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
	let fetchMessages: Array<{
		msg: MockImapMessage;
		seqno: number;
	}> = [];

	const connectMock = mock(function (this: any) {
		capturedInstance = this;
	});

	const endMock = mock(function (this: any) {});

	const openBoxMock = mock(
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

	const searchMock = mock(
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

	// Each fetch() call consumes one message from the queue
	const fetchMock = mock((_source: unknown, _options: unknown) => {
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

	function install() {
		Imap.prototype.connect = connectMock as any;
		Imap.prototype.end = endMock as any;
		Imap.prototype.openBox = openBoxMock as any;
		Imap.prototype.search = searchMock as any;
		Imap.prototype.fetch = fetchMock as any;
	}

	function restore() {
		Imap.prototype.connect = origConnect;
		Imap.prototype.end = origEnd;
		Imap.prototype.openBox = origOpenBox;
		Imap.prototype.search = origSearch;
		Imap.prototype.fetch = origFetch;
	}

	return {
		addFetchMessage: (bodyData, seqno, attrs) => {
			fetchMessages.push({
				msg: new MockImapMessage(bodyData, attrs),
				seqno,
			});
		},

		connectMock,
		emitClose: () => {
			capturedInstance?.emit("close");
		},
		emitError: (err) => {
			capturedInstance?.emit("error", err);
		},
		emitMail: () => {
			capturedInstance?.emit("mail");
		},
		emitReady: () => {
			capturedInstance?.emit("ready");
		},
		emitUpdate: () => {
			capturedInstance?.emit("update");
		},
		endMock,
		fetchMock,

		install,
		get instance() {
			return capturedInstance;
		},
		openBoxMock,

		reset: () => {
			capturedInstance = null;
			openBoxError = null;
			searchResults = [];
			searchError = null;
			fetchError = null;
			fetchMessages = [];
			connectMock.mockClear();
			endMock.mockClear();
			openBoxMock.mockClear();
			searchMock.mockClear();
			fetchMock.mockClear();
		},
		restore,
		searchMock,
		setFetchError: (err) => {
			fetchError = err;
		},
		setOpenBoxError: (err) => {
			openBoxError = err;
		},
		setSearchError: (err) => {
			searchError = err;
		},
		setSearchResults: (uids) => {
			searchResults = uids;
		},
	};
}

class MockImapMessage extends EventEmitter {
	private bodyData: string;
	private attrs: Imap.ImapMessageAttributes;

	constructor(bodyData: string, attrs: Imap.ImapMessageAttributes) {
		super();
		this.bodyData = bodyData;
		this.attrs = attrs;
	}

	deliver(): void {
		const stream = new MockReadableStream(this.bodyData);
		this.emit("body", stream, { size: this.bodyData.length, which: "TEXT" });
		this.emit("attributes", this.attrs);
		stream.start();
	}
}

class MockReadableStream extends EventEmitter {
	private data: string;

	constructor(data: string) {
		super();
		this.data = data;
	}

	start(): void {
		setImmediate(() => {
			this.emit("data", Buffer.from(this.data, "utf-8"));
			this.emit("end");
		});
	}
}

class MockImapFetch extends EventEmitter {}
