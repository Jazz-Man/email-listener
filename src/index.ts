import { EventEmitter } from "node:events";

import Imap from "imap";
import { type ParsedMail, simpleParser } from "mailparser";

export type TSearchCriteria =
	| "ALL"
	| "ANSWERED"
	| "DELETED"
	| "DRAFT"
	| "FLAGGED"
	| "NEW"
	| "SEEN"
	| "RECENT"
	| "OLD"
	| "UNANSWERED"
	| "UNDELETED"
	| "UNDRAFT"
	| "UNFLAGGED"
	| "UNSEEN"
	| ["FROM", string]
	| ["TO", string]
	| ["CC", string]
	| ["BCC", string]
	| ["SUBJECT", string]
	| ["BODY", string]
	| ["TEXT", string]
	| ["BEFORE", string | Date]
	| ["ON", string | Date]
	| ["SINCE", string | Date]
	| ["SENTBEFORE", string | Date]
	| ["SENTON", string | Date]
	| ["SENTSINCE", string | Date]
	| ["HEADER", string, string]
	| ["LARGER", number]
	| ["SMALLER", number]
	| ["UID", string | number]
	| ["X-GM-RAW", string]
	| ["X-GM-THRID", string | number]
	| ["X-GM-MSGID", string | number]
	| ["X-GM-LABELS", string]
	| TSearchCriteria[];

type Config = Omit<Imap.Config, "keepalive"> & {
	keepalive?: boolean | Imap.KeepAlive;
};

export type MailOptions = {
	markSeen?: boolean;
	mailbox?: string;
	searchFilter?: TSearchCriteria[];
	fetchUnreadOnStart?: boolean;
} & Config;

export default class EmailListener extends EventEmitter<{
	error: [Error];
	"server:connected": [];
	"server:disconnected": [];
	mail: [ParsedMail, number, Imap.ImapMessageAttributes | undefined];
}> {
	#imap: Imap;

	private readonly markSeen: boolean;

	private readonly mailbox: string;

	private readonly fetchUnreadOnStart: boolean;

	private readonly searchFilter: TSearchCriteria[];

	constructor(options: MailOptions) {
		super();

		const {
			markSeen,
			mailbox,
			searchFilter,
			fetchUnreadOnStart,
			tls,
			...imapConfig
		} = options;

		this.markSeen = markSeen ?? true;
		this.mailbox = mailbox ?? "INBOX";

		this.searchFilter = searchFilter ?? ["UNSEEN"];

		this.fetchUnreadOnStart = fetchUnreadOnStart ?? true;

		this.#imap = new Imap({
			...imapConfig,
			tls: tls ?? true,
		});

		this.#imap.once("ready", this.imapReady.bind(this));
		this.#imap.once("close", this.imapClose.bind(this));
		this.#imap.on("error", this.imapError.bind(this));
	}

	start() {
		this.#imap.connect();
	}

	stop() {
		this.#imap.end();
	}

	private imapReady() {
		this.#imap.openBox(this.mailbox, false, (err) => {
			if (err) {
				this.emit("error", err);
			} else {
				this.emit("server:connected");
				if (this.fetchUnreadOnStart) {
					this.parseUnread();
				}

				this.#imap.on("mail", this.imapMail.bind(this));
				this.#imap.on("update", this.imapMail.bind(this));
			}
		});
	}

	private imapClose() {
		this.emit("server:disconnected");
	}

	private imapError(err: Error) {
		this.emit("error", err);
	}

	private imapMail() {
		this.parseUnread();
	}

	private parseUnread() {
		this.#imap.search(this.searchFilter, (err, results) => {
			if (err) {
				this.emit("error", err);
			} else if (results.length > 0) {
				for (const result of results) {
					const fetch = this.#imap.fetch(result, {
						bodies: "",
						markSeen: this.markSeen,
					});

					fetch.once("error", (error) => {
						this.emit("error", error);
					});

					fetch.once("message", this.handleMessage.bind(this));
				}
			}
		});
	}

	private handleMessage(message: Imap.ImapMessage, seqno: number) {
		let attributes: Imap.ImapMessageAttributes | undefined;

		message.on("attributes", (attrs) => {
			attributes = attrs;
		});

		message.on("body", (stream) => {
			let data = "";
			stream.on("data", (chunk) => {
				data += chunk.toString("UTF-8");
			});

			stream.once("error", (err) => {
				this.emit("error", err);
			});

			stream.once("end", () => {
				simpleParser(data, (err1: Error | undefined, mail) => {
					if (err1) {
						this.emit("error", err1);
						return;
					}

					this.emit("mail", mail, seqno, attributes);
				});
			});
		});
	}
}
