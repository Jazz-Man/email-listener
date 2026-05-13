import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { simpleParser } from "mailparser";
import EmailListener from "../src/index.ts";
import type { MailOptions } from "../src/index.ts";
import { createMockImap } from "./helpers/mock-imap.ts";
import { createMockSimpleParser } from "./helpers/mock-mailparser.ts";
import {
	DEFAULT_CONFIG,
	SAMPLE_ATTRIBUTES,
	SAMPLE_PARSED_MAIL,
	SAMPLE_RAW_EMAIL,
} from "./helpers/test-data.ts";

const imap = createMockImap();
const parser = createMockSimpleParser();

// Replace simpleParser at module level
const _originalSimpleParser = simpleParser;

function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function waitForEvent(
	emitter: { once(event: string, cb: (...args: any[]) => void): void },
	event: string,
	timeout = 2000,
): Promise<any[]> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`Timeout waiting for "${event}"`)),
			timeout,
		);
		emitter.once(event, (...args: any[]) => {
			clearTimeout(timer);
			resolve(args);
		});
	});
}

beforeAll(() => {
	imap.install();
	// Patch simpleParser by replacing it on the mailparser module
	// Since we can't easily mock mailparser, we'll test through the Imap mock
});

afterAll(() => {
	imap.restore();
});

beforeEach(() => {
	imap.reset();
	parser.fn.mockClear();
	parser.setResult(SAMPLE_PARSED_MAIL);
});

afterEach(() => {
	imap.restore();
});

function createListener(options: Partial<MailOptions> = {}): EmailListener {
	imap.install();
	return new EmailListener({ ...DEFAULT_CONFIG, ...options });
}

describe("EmailListener", () => {
	describe("constructor", () => {
		test("applies custom mailbox name", () => {
			const listener = createListener({ mailbox: "[Gmail]/All Mail" });
			imap.addFetchMessage(SAMPLE_RAW_EMAIL, 1, SAMPLE_ATTRIBUTES);
			imap.setSearchResults([1]);

			listener.start();
			imap.emitReady();

			expect(imap.openBoxMock.mock.calls[0][0]).toBe("[Gmail]/All Mail");
		});

		test("applies custom searchFilter", () => {
			const listener = createListener({ searchFilter: ["SEEN"] });
			imap.setSearchResults([]);

			listener.start();
			imap.emitReady();

			expect(imap.searchMock.mock.calls[0][0]).toEqual(["SEEN"]);
		});

		test("defaults searchFilter to UNSEEN", () => {
			const listener = createListener();
			imap.setSearchResults([]);

			listener.start();
			imap.emitReady();

			expect(imap.searchMock.mock.calls[0][0]).toEqual(["UNSEEN"]);
		});

		test("defaults markSeen to true", () => {
			const listener = createListener();
			imap.setSearchResults([1]);

			listener.start();
			imap.emitReady();

			expect(imap.fetchMock.mock.calls[0][1]).toEqual({
				bodies: "",
				markSeen: true,
			});
		});
	});

	describe("start / stop", () => {
		test("start() calls imap.connect()", () => {
			const listener = createListener();
			listener.start();
			expect(imap.connectMock).toHaveBeenCalled();
		});

		test("stop() calls imap.end()", () => {
			const listener = createListener();
			listener.stop();
			expect(imap.endMock).toHaveBeenCalled();
		});
	});

	describe("connection lifecycle", () => {
		test("emits server:connected after mailbox opens", () => {
			const listener = createListener();
			let connected = false;

			listener.on("server:connected", () => {
				connected = true;
			});
			imap.setSearchResults([]);

			listener.start();
			imap.emitReady();

			expect(connected).toBe(true);
		});

		test("emits server:disconnected on close", () => {
			const listener = createListener();
			let disconnected = false;

			listener.on("server:disconnected", () => {
				disconnected = true;
			});

			listener.start();
			imap.emitClose();

			expect(disconnected).toBe(true);
		});

		test("full happy path lifecycle", async () => {
			const listener = createListener();
			const events: string[] = [];

			listener.on("server:connected", () => events.push("connected"));
			listener.on("mail", () => events.push("mail"));
			listener.on("server:disconnected", () => events.push("disconnected"));

			imap.setSearchResults([1]);
			imap.addFetchMessage(SAMPLE_RAW_EMAIL, 1, SAMPLE_ATTRIBUTES);

			const mailPromise = waitForEvent(listener, "mail");

			listener.start();
			imap.emitReady();

			await mailPromise;

			expect(events).toContain("connected");
			expect(events).toContain("mail");

			listener.stop();
			imap.emitClose();

			expect(events).toContain("disconnected");
			expect(events).toEqual(["connected", "mail", "disconnected"]);
		});
	});

	describe("parseUnread", () => {
		test("does not call fetch when search returns empty results", () => {
			const listener = createListener();
			imap.setSearchResults([]);

			listener.start();
			imap.emitReady();

			expect(imap.fetchMock).not.toHaveBeenCalled();
		});

		test("fetches each UID from search results", () => {
			const listener = createListener();
			imap.setSearchResults([1, 2, 3]);

			listener.start();
			imap.emitReady();

			expect(imap.fetchMock.mock.calls.length).toBe(3);
			expect(imap.fetchMock.mock.calls[0][0]).toBe(1);
			expect(imap.fetchMock.mock.calls[1][0]).toBe(2);
			expect(imap.fetchMock.mock.calls[2][0]).toBe(3);
		});

		test("emits mail event for each fetched message", async () => {
			const listener = createListener();
			const mailSeqnos: number[] = [];

			listener.on("mail", (_mail: any, seqno: number) => {
				mailSeqnos.push(seqno);
			});

			imap.setSearchResults([10, 20]);
			imap.addFetchMessage("body1", 10, {
				...SAMPLE_ATTRIBUTES,
				uid: 10,
			});
			imap.addFetchMessage("body2", 20, {
				...SAMPLE_ATTRIBUTES,
				uid: 20,
			});

			listener.start();
			imap.emitReady();

			for (let i = 0; i < 10; i++) {
				await flushMicrotasks();
			}

			expect(mailSeqnos).toEqual([10, 20]);
		});

		test("fetch options use bodies empty string", () => {
			const listener = createListener();
			imap.setSearchResults([1]);

			listener.start();
			imap.emitReady();

			expect(imap.fetchMock.mock.calls[0][1]).toMatchObject({
				bodies: "",
			});
		});
	});

	describe("handleMessage", () => {
		test("emits mail with correct seqno and attributes", async () => {
			const listener = createListener();
			let _receivedMail: any = null;
			let receivedSeqno: any = null;
			let receivedAttrs: any = null;

			listener.on("mail", (mail, seqno, attrs) => {
				_receivedMail = mail;
				receivedSeqno = seqno;
				receivedAttrs = attrs;
			});

			imap.setSearchResults([5]);
			imap.addFetchMessage(SAMPLE_RAW_EMAIL, 5, SAMPLE_ATTRIBUTES);

			const mailPromise = waitForEvent(listener, "mail");

			listener.start();
			imap.emitReady();

			await mailPromise;

			expect(receivedSeqno).toBe(5);
			expect(receivedAttrs).toEqual(SAMPLE_ATTRIBUTES);
		});
	});

	describe("error scenarios", () => {
		test("openBox error emits error event", () => {
			const listener = createListener();
			let receivedError: Error | null = null;

			listener.on("error", (err: Error) => {
				receivedError = err;
			});

			imap.setOpenBoxError(new Error("mailbox not found"));

			listener.start();
			imap.emitReady();

			expect(receivedError).toBeInstanceOf(Error);
			expect(receivedError?.message).toBe("mailbox not found");
		});

		test("openBox error prevents server:connected", () => {
			const listener = createListener();
			let connected = false;
			let receivedError: Error | null = null;

			listener.on("server:connected", () => {
				connected = true;
			});
			listener.on("error", (err: Error) => {
				receivedError = err;
			});

			imap.setOpenBoxError(new Error("mailbox not found"));

			listener.start();
			imap.emitReady();

			expect(connected).toBe(false);
			expect(receivedError).toBeInstanceOf(Error);
		});

		test("openBox error prevents mail/update listener registration", () => {
			const listener = createListener();
			listener.on("error", () => {}); // prevent unhandled error

			imap.setOpenBoxError(new Error("mailbox not found"));

			listener.start();
			imap.emitReady();

			// search should only be called once (from openBox flow), not from mail/update
			const callsBefore = imap.searchMock.mock.calls.length;

			imap.emitMail();
			imap.emitUpdate();

			expect(imap.searchMock.mock.calls.length).toBe(callsBefore);
		});

		test("search error emits error event", () => {
			const listener = createListener();
			let receivedError: Error | null = null;

			listener.on("error", (err: Error) => {
				receivedError = err;
			});

			imap.setSearchError(new Error("search failed"));

			listener.start();
			imap.emitReady();

			expect(receivedError).toBeInstanceOf(Error);
			expect(receivedError?.message).toBe("search failed");
		});

		test("fetch error emits error event", async () => {
			const listener = createListener();
			const errorPromise = waitForEvent(listener, "error");

			imap.setSearchResults([1]);
			imap.setFetchError(new Error("fetch failed"));

			listener.start();
			imap.emitReady();

			const [receivedError] = await errorPromise;

			expect(receivedError).toBeInstanceOf(Error);
			expect(receivedError.message).toBe("fetch failed");
		});

		test("IMAP connection error emits error event", () => {
			const listener = createListener();
			let receivedError: Error | null = null;

			listener.on("error", (err: Error) => {
				receivedError = err;
			});

			listener.start();
			imap.emitError(new Error("connection lost"));

			expect(receivedError).toBeInstanceOf(Error);
			expect(receivedError?.message).toBe("connection lost");
		});
	});

	describe("option behaviors", () => {
		test("fetchUnreadOnStart=false skips initial parseUnread", () => {
			const listener = createListener({ fetchUnreadOnStart: false });

			listener.start();
			imap.emitReady();

			expect(imap.searchMock).not.toHaveBeenCalled();
		});

		test("fetchUnreadOnStart=false still processes mail notifications", () => {
			const listener = createListener({ fetchUnreadOnStart: false });
			imap.setSearchResults([]);

			listener.start();
			imap.emitReady();

			expect(imap.searchMock).not.toHaveBeenCalled();

			imap.emitMail();

			expect(imap.searchMock).toHaveBeenCalled();
		});

		test("markSeen=false passes through to fetch options", () => {
			const listener = createListener({ markSeen: false });
			imap.setSearchResults([1]);

			listener.start();
			imap.emitReady();

			expect(imap.fetchMock.mock.calls[0][1]).toMatchObject({
				markSeen: false,
			});
		});

		test("markSeen=true (default) passes through to fetch options", () => {
			const listener = createListener();
			imap.setSearchResults([1]);

			listener.start();
			imap.emitReady();

			expect(imap.fetchMock.mock.calls[0][1]).toMatchObject({
				markSeen: true,
			});
		});

		test("custom searchFilter is used in search", () => {
			const listener = createListener({
				searchFilter: ["FROM", "boss@company.com"] as any,
			});
			imap.setSearchResults([]);

			listener.start();
			imap.emitReady();

			expect(imap.searchMock.mock.calls[0][0]).toEqual([
				"FROM",
				"boss@company.com",
			]);
		});
	});

	describe("IMAP event notifications", () => {
		test("mail event triggers parseUnread", () => {
			const listener = createListener();
			imap.setSearchResults([]);

			listener.start();
			imap.emitReady();

			const initialCalls = imap.searchMock.mock.calls.length;

			imap.setSearchResults([]);
			imap.emitMail();

			expect(imap.searchMock.mock.calls.length).toBe(initialCalls + 1);
		});

		test("update event triggers parseUnread", () => {
			const listener = createListener();
			imap.setSearchResults([]);

			listener.start();
			imap.emitReady();

			const initialCalls = imap.searchMock.mock.calls.length;

			imap.setSearchResults([]);
			imap.emitUpdate();

			expect(imap.searchMock.mock.calls.length).toBe(initialCalls + 1);
		});

		test("multiple mail notifications trigger independent searches", () => {
			const listener = createListener();
			imap.setSearchResults([]);

			listener.start();
			imap.emitReady();

			const initialCalls = imap.searchMock.mock.calls.length;

			imap.setSearchResults([]);
			imap.emitMail();
			imap.setSearchResults([]);
			imap.emitMail();
			imap.setSearchResults([]);
			imap.emitMail();

			expect(imap.searchMock.mock.calls.length).toBe(initialCalls + 3);
		});
	});

	describe("multiple messages", () => {
		test("processes multiple messages from single search", async () => {
			const listener = createListener();
			const mailSeqnos: number[] = [];

			listener.on("mail", (_mail: any, seqno: number) => {
				mailSeqnos.push(seqno);
			});

			imap.setSearchResults([10, 20, 30]);
			imap.addFetchMessage("body10", 10, {
				...SAMPLE_ATTRIBUTES,
				uid: 10,
			});
			imap.addFetchMessage("body20", 20, {
				...SAMPLE_ATTRIBUTES,
				uid: 20,
			});
			imap.addFetchMessage("body30", 30, {
				...SAMPLE_ATTRIBUTES,
				uid: 30,
			});

			listener.start();
			imap.emitReady();

			for (let i = 0; i < 10; i++) {
				await flushMicrotasks();
			}

			expect(mailSeqnos).toEqual([10, 20, 30]);
		});

		test("each message gets its own fetch call", () => {
			const listener = createListener();
			imap.setSearchResults([10, 20, 30]);

			listener.start();
			imap.emitReady();

			expect(imap.fetchMock.mock.calls.length).toBe(3);
			expect(imap.fetchMock.mock.calls[0][0]).toBe(10);
			expect(imap.fetchMock.mock.calls[1][0]).toBe(20);
			expect(imap.fetchMock.mock.calls[2][0]).toBe(30);
		});
	});
});
