import type Imap from "imap";
import type { ParsedMail } from "mailparser";
import type { MailOptions } from "../../src/index.ts";

export const DEFAULT_CONFIG: MailOptions = {
	host: "imap.example.com",
	password: "testpass",
	port: 993,
	tls: true,
	user: "test@example.com",
};

export const SAMPLE_PARSED_MAIL = {
	attachments: [],
	date: new Date("2024-01-15T10:00:00Z"),
	from: {
		html: "sender@example.com",
		text: "Sender <sender@example.com>",
		value: [{ address: "sender@example.com", name: "Sender" }],
	},
	headerLines: [],
	headers: new Map(),
	html: "<p>Hello</p>",
	messageId: "<msg123@example.com>",
	subject: "Test Subject",
	text: "Hello",
	textAsHtml: "<p>Hello</p>",
	to: {
		html: "test@example.com",
		text: "Test <test@example.com>",
		value: [{ address: "test@example.com", name: "Test" }],
	},
} as unknown as ParsedMail;

export const SAMPLE_ATTRIBUTES: Imap.ImapMessageAttributes = {
	date: new Date("2024-01-15T10:00:00Z"),
	flags: ["\\Seen"],
	uid: 42,
};

export const SAMPLE_RAW_EMAIL = [
	"From: sender@example.com",
	"To: test@example.com",
	"Subject: Test Subject",
	"Date: Mon, 15 Jan 2024 10:00:00 +0000",
	"Message-ID: <msg123@example.com>",
	"",
	"Hello",
].join("\r\n");
