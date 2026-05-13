import { beforeEach, describe, expect, test } from "bun:test";
import type { MailOptions } from "../src/index.ts";
import EmailListener from "../src/index.ts";
import {
	addFetchMessage,
	connectMock,
	emitClose,
	emitError,
	emitMail,
	emitReady,
	emitUpdate,
	endMock,
	fetchMock,
	openBoxMock,
	reset,
	searchMock,
	setFetchError,
	setOpenBoxError,
	setSearchError,
	setSearchResults,
	setStreamError,
} from "./helpers/mock-imap.ts";
import {
	DEFAULT_CONFIG,
	SAMPLE_ATTRIBUTES,
	SAMPLE_RAW_EMAIL,
} from "./helpers/test-data.ts";

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

function createAndConnect(options: Partial<MailOptions> = {}): EmailListener {
	const listener = new EmailListener({ ...DEFAULT_CONFIG, ...options });
	listener.start();
	return listener;
}

beforeEach(() => {
	reset();
});

describe("EmailListener", () => {
	describe("constructor", () => {
		test("applies custom mailbox name", () => {
			addFetchMessage(SAMPLE_RAW_EMAIL, 1, SAMPLE_ATTRIBUTES);
			setSearchResults([1]);

			createAndConnect({ mailbox: "[Gmail]/All Mail" });
			emitReady();

			expect(openBoxMock.mock.calls[0]![0]).toBe("[Gmail]/All Mail");
		});

		test("applies custom searchFilter", () => {
			setSearchResults([]);

			createAndConnect({ searchFilter: ["SEEN"] });
			emitReady();

			expect(searchMock.mock.calls[0]![0]).toEqual(["SEEN"]);
		});

		test("defaults searchFilter to UNSEEN", () => {
			setSearchResults([]);

			createAndConnect();
			emitReady();

			expect(searchMock.mock.calls[0]![0]).toEqual(["UNSEEN"]);
		});

		test("defaults markSeen to true", () => {
			setSearchResults([1]);

			createAndConnect();
			emitReady();

			expect(fetchMock.mock.calls[0]![1]).toEqual({
				bodies: "",
				markSeen: true,
			});
		});
	});

	describe("start / stop", () => {
		test("start() calls connect()", () => {
			createAndConnect();
			expect(connectMock).toHaveBeenCalled();
		});

		test("stop() calls end()", () => {
			const listener = new EmailListener(DEFAULT_CONFIG);
			listener.stop();
			expect(endMock).toHaveBeenCalled();
		});
	});

	describe("connection lifecycle", () => {
		test("emits server:connected after mailbox opens", () => {
			let connected = false;
			setSearchResults([]);

			const listener = createAndConnect();
			listener.on("server:connected", () => {
				connected = true;
			});
			emitReady();

			expect(connected).toBe(true);
		});

		test("emits server:disconnected on close", () => {
			let disconnected = false;

			const listener = createAndConnect();
			listener.on("server:disconnected", () => {
				disconnected = true;
			});
			emitClose();

			expect(disconnected).toBe(true);
		});

		test("full happy path lifecycle", async () => {
			const events: string[] = [];
			setSearchResults([1]);
			addFetchMessage(SAMPLE_RAW_EMAIL, 1, SAMPLE_ATTRIBUTES);

			const listener = createAndConnect();
			listener.on("server:connected", () => events.push("connected"));
			listener.on("mail", () => events.push("mail"));
			listener.on("server:disconnected", () => events.push("disconnected"));

			const mailPromise = waitForEvent(listener, "mail");
			emitReady();
			await mailPromise;

			listener.stop();
			emitClose();

			expect(events).toEqual(["connected", "mail", "disconnected"]);
		});
	});

	describe("parseUnread", () => {
		test("does not call fetch when search returns empty results", () => {
			setSearchResults([]);

			createAndConnect();
			emitReady();

			expect(fetchMock).not.toHaveBeenCalled();
		});

		test("fetches each UID from search results", () => {
			setSearchResults([1, 2, 3]);

			createAndConnect();
			emitReady();

			expect(fetchMock.mock.calls.length).toBe(3);

			expect(fetchMock.mock.calls[0]![0]).toBe(1);
			expect(fetchMock.mock.calls[1]![0]).toBe(2);
			expect(fetchMock.mock.calls[2]![0]).toBe(3);
		});

		test("emits mail event for each fetched message", async () => {
			const mailSeqnos: number[] = [];
			setSearchResults([10, 20]);
			addFetchMessage("body1", 10, { ...SAMPLE_ATTRIBUTES, uid: 10 });
			addFetchMessage("body2", 20, { ...SAMPLE_ATTRIBUTES, uid: 20 });

			const listener = createAndConnect();
			listener.on("mail", (_mail: any, seqno: number) => {
				mailSeqnos.push(seqno);
			});

			emitReady();
			for (let i = 0; i < 10; i++) {
				await new Promise((r) => setImmediate(r));
			}

			expect(mailSeqnos).toEqual([10, 20]);
		});

		test("fetch options use bodies empty string", () => {
			setSearchResults([1]);

			createAndConnect();
			emitReady();

			expect(fetchMock.mock.calls[0]![1]).toMatchObject({
				bodies: "",
			});
		});
	});

	describe("handleMessage", () => {
		test("emits mail with correct seqno and attributes", async () => {
			setSearchResults([5]);
			addFetchMessage(SAMPLE_RAW_EMAIL, 5, SAMPLE_ATTRIBUTES);

			const listener = createAndConnect();
			const mailPromise = waitForEvent(listener, "mail");
			emitReady();
			const [_mail, seqno, attrs] = await mailPromise;

			expect(seqno).toBe(5);
			expect(attrs).toEqual(SAMPLE_ATTRIBUTES);
		});

		test("body stream error emits error event", async () => {
			setSearchResults([1]);
			setStreamError(new Error("stream broken"));
			addFetchMessage("data", 1, SAMPLE_ATTRIBUTES);

			const listener = createAndConnect();
			emitReady();

			const [err] = await waitForEvent(listener, "error");
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe("stream broken");
		});
	});

	describe("error scenarios", () => {
		test("openBox error emits error event", () => {
			setOpenBoxError(new Error("mailbox not found"));

			const listener = createAndConnect();
			let receivedError: Error | null = null;
			listener.on("error", (err: Error) => {
				receivedError = err;
			});
			emitReady();

			expect(receivedError).toBeInstanceOf(Error);
			expect(receivedError!.message).toBe("mailbox not found");
		});

		test("openBox error prevents server:connected", () => {
			setOpenBoxError(new Error("mailbox not found"));

			const listener = createAndConnect();
			let connected = false;
			let receivedError: Error | null = null;
			listener.on("server:connected", () => {
				connected = true;
			});
			listener.on("error", (err: Error) => {
				receivedError = err;
			});
			emitReady();

			expect(connected).toBe(false);
			expect(receivedError).toBeInstanceOf(Error);
		});

		test("openBox error prevents mail/update listener registration", () => {
			setOpenBoxError(new Error("mailbox not found"));

			const listener = createAndConnect();
			listener.on("error", () => {});
			emitReady();

			const callsBefore = searchMock.mock.calls.length;
			emitMail();
			emitUpdate();

			expect(searchMock.mock.calls.length).toBe(callsBefore);
		});

		test("search error emits error event", () => {
			setSearchError(new Error("search failed"));

			const listener = createAndConnect();
			let receivedError: Error | null = null;
			listener.on("error", (err: Error) => {
				receivedError = err;
			});
			emitReady();

			expect(receivedError).toBeInstanceOf(Error);
			expect(receivedError!.message).toBe("search failed");
		});

		test("fetch error emits error event", async () => {
			setSearchResults([1]);
			setFetchError(new Error("fetch failed"));

			const listener = createAndConnect();
			emitReady();

			const [err] = await waitForEvent(listener, "error");
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe("fetch failed");
		});

		test("IMAP connection error emits error event", () => {
			const listener = createAndConnect();
			let receivedError: Error | null = null;
			listener.on("error", (err: Error) => {
				receivedError = err;
			});
			emitError(new Error("connection lost"));

			expect(receivedError).toBeInstanceOf(Error);
			expect(receivedError!.message).toBe("connection lost");
		});
	});

	describe("option behaviors", () => {
		test("fetchUnreadOnStart=false skips initial parseUnread", () => {
			createAndConnect({ fetchUnreadOnStart: false });
			emitReady();

			expect(searchMock).not.toHaveBeenCalled();
		});

		test("fetchUnreadOnStart=false still processes mail notifications", () => {
			setSearchResults([]);

			createAndConnect({ fetchUnreadOnStart: false });
			emitReady();

			expect(searchMock).not.toHaveBeenCalled();

			emitMail();

			expect(searchMock).toHaveBeenCalled();
		});

		test("markSeen=false passes through to fetch options", () => {
			setSearchResults([1]);

			createAndConnect({ markSeen: false });
			emitReady();

			expect(fetchMock.mock.calls[0]![1]).toMatchObject({
				markSeen: false,
			});
		});

		test("markSeen=true (default) passes through to fetch options", () => {
			setSearchResults([1]);

			createAndConnect();
			emitReady();

			expect(fetchMock.mock.calls[0]![1]).toMatchObject({
				markSeen: true,
			});
		});

		test("custom searchFilter is used in search", () => {
			setSearchResults([]);

			createAndConnect({
				searchFilter: ["FROM", "boss@company.com"] as any,
			});
			emitReady();

			expect(searchMock.mock.calls[0]![0]).toEqual([
				"FROM",
				"boss@company.com",
			]);
		});
	});

	describe("IMAP event notifications", () => {
		test("mail event triggers parseUnread", () => {
			setSearchResults([]);

			createAndConnect();
			emitReady();

			const initialCalls = searchMock.mock.calls.length;

			setSearchResults([]);
			emitMail();

			expect(searchMock.mock.calls.length).toBe(initialCalls + 1);
		});

		test("update event triggers parseUnread", () => {
			setSearchResults([]);

			createAndConnect();
			emitReady();

			const initialCalls = searchMock.mock.calls.length;

			setSearchResults([]);
			emitUpdate();

			expect(searchMock.mock.calls.length).toBe(initialCalls + 1);
		});

		test("multiple mail notifications trigger independent searches", () => {
			setSearchResults([]);

			createAndConnect();
			emitReady();

			const initialCalls = searchMock.mock.calls.length;

			setSearchResults([]);
			emitMail();
			setSearchResults([]);
			emitMail();
			setSearchResults([]);
			emitMail();

			expect(searchMock.mock.calls.length).toBe(initialCalls + 3);
		});
	});

	describe("multiple messages", () => {
		test("processes multiple messages from single search", async () => {
			const mailSeqnos: number[] = [];
			setSearchResults([10, 20, 30]);
			addFetchMessage("body10", 10, { ...SAMPLE_ATTRIBUTES, uid: 10 });
			addFetchMessage("body20", 20, { ...SAMPLE_ATTRIBUTES, uid: 20 });
			addFetchMessage("body30", 30, { ...SAMPLE_ATTRIBUTES, uid: 30 });

			const listener = createAndConnect();
			listener.on("mail", (_mail: any, seqno: number) => {
				mailSeqnos.push(seqno);
			});

			emitReady();
			for (let i = 0; i < 10; i++) {
				await new Promise((r) => setImmediate(r));
			}

			expect(mailSeqnos).toEqual([10, 20, 30]);
		});

		test("each message gets its own fetch call", () => {
			setSearchResults([10, 20, 30]);

			createAndConnect();
			emitReady();

			expect(fetchMock.mock.calls.length).toBe(3);
			expect(fetchMock.mock.calls[0]![0]).toBe(10);
			expect(fetchMock.mock.calls[1]![0]).toBe(20);
			expect(fetchMock.mock.calls[2]![0]).toBe(30);
		});
	});
});
