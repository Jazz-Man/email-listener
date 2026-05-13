import { beforeEach, describe, expect, test } from "bun:test";
import type { MailOptions } from "../src/index.ts";
import EmailListener from "../src/index.ts";
import { imap } from "./helpers/setup.ts";
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
	imap.reset();
});

describe("EmailListener", () => {
	describe("constructor", () => {
		test("applies custom mailbox name", () => {
			imap.addFetchMessage(SAMPLE_RAW_EMAIL, 1, SAMPLE_ATTRIBUTES);
			imap.setSearchResults([1]);

			createAndConnect({ mailbox: "[Gmail]/All Mail" });
			imap.emitReady();

			expect(imap.openBoxMock.mock.calls[0][0]).toBe("[Gmail]/All Mail");
		});

		test("applies custom searchFilter", () => {
			imap.setSearchResults([]);

			createAndConnect({ searchFilter: ["SEEN"] });
			imap.emitReady();

			expect(imap.searchMock.mock.calls[0][0]).toEqual(["SEEN"]);
		});

		test("defaults searchFilter to UNSEEN", () => {
			imap.setSearchResults([]);

			createAndConnect();
			imap.emitReady();

			expect(imap.searchMock.mock.calls[0][0]).toEqual(["UNSEEN"]);
		});

		test("defaults markSeen to true", () => {
			imap.setSearchResults([1]);

			createAndConnect();
			imap.emitReady();

			expect(imap.fetchMock.mock.calls[0][1]).toEqual({
				bodies: "",
				markSeen: true,
			});
		});
	});

	describe("start / stop", () => {
		test("start() calls imap.connect()", () => {
			createAndConnect();
			expect(imap.connectMock).toHaveBeenCalled();
		});

		test("stop() calls imap.end()", () => {
			const listener = new EmailListener(DEFAULT_CONFIG);
			listener.stop();
			expect(imap.endMock).toHaveBeenCalled();
		});
	});

	describe("connection lifecycle", () => {
		test("emits server:connected after mailbox opens", () => {
			let connected = false;
			imap.setSearchResults([]);

			const listener = createAndConnect();
			listener.on("server:connected", () => {
				connected = true;
			});
			imap.emitReady();

			expect(connected).toBe(true);
		});

		test("emits server:disconnected on close", () => {
			let disconnected = false;

			const listener = createAndConnect();
			listener.on("server:disconnected", () => {
				disconnected = true;
			});
			imap.emitClose();

			expect(disconnected).toBe(true);
		});

		test("full happy path lifecycle", async () => {
			const events: string[] = [];
			imap.setSearchResults([1]);
			imap.addFetchMessage(SAMPLE_RAW_EMAIL, 1, SAMPLE_ATTRIBUTES);

			const listener = createAndConnect();
			listener.on("server:connected", () => events.push("connected"));
			listener.on("mail", () => events.push("mail"));
			listener.on("server:disconnected", () => events.push("disconnected"));

			const mailPromise = waitForEvent(listener, "mail");
			imap.emitReady();
			await mailPromise;

			listener.stop();
			imap.emitClose();

			expect(events).toEqual(["connected", "mail", "disconnected"]);
		});
	});

	describe("parseUnread", () => {
		test("does not call fetch when search returns empty results", () => {
			imap.setSearchResults([]);

			createAndConnect();
			imap.emitReady();

			expect(imap.fetchMock).not.toHaveBeenCalled();
		});

		test("fetches each UID from search results", () => {
			imap.setSearchResults([1, 2, 3]);

			createAndConnect();
			imap.emitReady();

			expect(imap.fetchMock.mock.calls.length).toBe(3);
			expect(imap.fetchMock.mock.calls[0][0]).toBe(1);
			expect(imap.fetchMock.mock.calls[1][0]).toBe(2);
			expect(imap.fetchMock.mock.calls[2][0]).toBe(3);
		});

		test("emits mail event for each fetched message", async () => {
			const mailSeqnos: number[] = [];
			imap.setSearchResults([10, 20]);
			imap.addFetchMessage("body1", 10, { ...SAMPLE_ATTRIBUTES, uid: 10 });
			imap.addFetchMessage("body2", 20, { ...SAMPLE_ATTRIBUTES, uid: 20 });

			const listener = createAndConnect();
			listener.on("mail", (_mail: any, seqno: number) => {
				mailSeqnos.push(seqno);
			});

			imap.emitReady();
			for (let i = 0; i < 10; i++) {
				await new Promise((r) => setImmediate(r));
			}

			expect(mailSeqnos).toEqual([10, 20]);
		});

		test("fetch options use bodies empty string", () => {
			imap.setSearchResults([1]);

			createAndConnect();
			imap.emitReady();

			expect(imap.fetchMock.mock.calls[0][1]).toMatchObject({
				bodies: "",
			});
		});
	});

	describe("handleMessage", () => {
		test("emits mail with correct seqno and attributes", async () => {
			imap.setSearchResults([5]);
			imap.addFetchMessage(SAMPLE_RAW_EMAIL, 5, SAMPLE_ATTRIBUTES);

			const listener = createAndConnect();
			const mailPromise = waitForEvent(listener, "mail");
			imap.emitReady();
			const [_mail, seqno, attrs] = await mailPromise;

			expect(seqno).toBe(5);
			expect(attrs).toEqual(SAMPLE_ATTRIBUTES);
		});

		test("body stream error emits error event", async () => {
			imap.setSearchResults([1]);
			imap.setStreamError(new Error("stream broken"));
			imap.addFetchMessage("data", 1, SAMPLE_ATTRIBUTES);

			const listener = createAndConnect();
			imap.emitReady();

			const [err] = await waitForEvent(listener, "error");
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe("stream broken");
		});
	});

	describe("error scenarios", () => {
		test("openBox error emits error event", () => {
			imap.setOpenBoxError(new Error("mailbox not found"));

			const listener = createAndConnect();
			let receivedError: Error | null = null;
			listener.on("error", (err: Error) => {
				receivedError = err;
			});
			imap.emitReady();

			expect(receivedError).toBeInstanceOf(Error);
			expect(receivedError!.message).toBe("mailbox not found");
		});

		test("openBox error prevents server:connected", () => {
			imap.setOpenBoxError(new Error("mailbox not found"));

			const listener = createAndConnect();
			let connected = false;
			let receivedError: Error | null = null;
			listener.on("server:connected", () => {
				connected = true;
			});
			listener.on("error", (err: Error) => {
				receivedError = err;
			});
			imap.emitReady();

			expect(connected).toBe(false);
			expect(receivedError).toBeInstanceOf(Error);
		});

		test("openBox error prevents mail/update listener registration", () => {
			imap.setOpenBoxError(new Error("mailbox not found"));

			const listener = createAndConnect();
			listener.on("error", () => {});
			imap.emitReady();

			const callsBefore = imap.searchMock.mock.calls.length;
			imap.emitMail();
			imap.emitUpdate();

			expect(imap.searchMock.mock.calls.length).toBe(callsBefore);
		});

		test("search error emits error event", () => {
			imap.setSearchError(new Error("search failed"));

			const listener = createAndConnect();
			let receivedError: Error | null = null;
			listener.on("error", (err: Error) => {
				receivedError = err;
			});
			imap.emitReady();

			expect(receivedError).toBeInstanceOf(Error);
			expect(receivedError!.message).toBe("search failed");
		});

		test("fetch error emits error event", async () => {
			imap.setSearchResults([1]);
			imap.setFetchError(new Error("fetch failed"));

			const listener = createAndConnect();
			imap.emitReady();

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
			imap.emitError(new Error("connection lost"));

			expect(receivedError).toBeInstanceOf(Error);
			expect(receivedError!.message).toBe("connection lost");
		});
	});

	describe("option behaviors", () => {
		test("fetchUnreadOnStart=false skips initial parseUnread", () => {
			createAndConnect({ fetchUnreadOnStart: false });
			imap.emitReady();

			expect(imap.searchMock).not.toHaveBeenCalled();
		});

		test("fetchUnreadOnStart=false still processes mail notifications", () => {
			imap.setSearchResults([]);

			createAndConnect({ fetchUnreadOnStart: false });
			imap.emitReady();

			expect(imap.searchMock).not.toHaveBeenCalled();

			imap.emitMail();

			expect(imap.searchMock).toHaveBeenCalled();
		});

		test("markSeen=false passes through to fetch options", () => {
			imap.setSearchResults([1]);

			createAndConnect({ markSeen: false });
			imap.emitReady();

			expect(imap.fetchMock.mock.calls[0][1]).toMatchObject({
				markSeen: false,
			});
		});

		test("markSeen=true (default) passes through to fetch options", () => {
			imap.setSearchResults([1]);

			createAndConnect();
			imap.emitReady();

			expect(imap.fetchMock.mock.calls[0][1]).toMatchObject({
				markSeen: true,
			});
		});

		test("custom searchFilter is used in search", () => {
			imap.setSearchResults([]);

			createAndConnect({
				searchFilter: ["FROM", "boss@company.com"] as any,
			});
			imap.emitReady();

			expect(imap.searchMock.mock.calls[0][0]).toEqual([
				"FROM",
				"boss@company.com",
			]);
		});
	});

	describe("IMAP event notifications", () => {
		test("mail event triggers parseUnread", () => {
			imap.setSearchResults([]);

			createAndConnect();
			imap.emitReady();

			const initialCalls = imap.searchMock.mock.calls.length;

			imap.setSearchResults([]);
			imap.emitMail();

			expect(imap.searchMock.mock.calls.length).toBe(initialCalls + 1);
		});

		test("update event triggers parseUnread", () => {
			imap.setSearchResults([]);

			createAndConnect();
			imap.emitReady();

			const initialCalls = imap.searchMock.mock.calls.length;

			imap.setSearchResults([]);
			imap.emitUpdate();

			expect(imap.searchMock.mock.calls.length).toBe(initialCalls + 1);
		});

		test("multiple mail notifications trigger independent searches", () => {
			imap.setSearchResults([]);

			createAndConnect();
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
			const mailSeqnos: number[] = [];
			imap.setSearchResults([10, 20, 30]);
			imap.addFetchMessage("body10", 10, { ...SAMPLE_ATTRIBUTES, uid: 10 });
			imap.addFetchMessage("body20", 20, { ...SAMPLE_ATTRIBUTES, uid: 20 });
			imap.addFetchMessage("body30", 30, { ...SAMPLE_ATTRIBUTES, uid: 30 });

			const listener = createAndConnect();
			listener.on("mail", (_mail: any, seqno: number) => {
				mailSeqnos.push(seqno);
			});

			imap.emitReady();
			for (let i = 0; i < 10; i++) {
				await new Promise((r) => setImmediate(r));
			}

			expect(mailSeqnos).toEqual([10, 20, 30]);
		});

		test("each message gets its own fetch call", () => {
			imap.setSearchResults([10, 20, 30]);

			createAndConnect();
			imap.emitReady();

			expect(imap.fetchMock.mock.calls.length).toBe(3);
			expect(imap.fetchMock.mock.calls[0][0]).toBe(10);
			expect(imap.fetchMock.mock.calls[1][0]).toBe(20);
			expect(imap.fetchMock.mock.calls[2][0]).toBe(30);
		});
	});
});
