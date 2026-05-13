# @jazz-man/email-listener

A TypeScript library that connects to an IMAP server and emits parsed email objects when new mail arrives. Wraps [`imap`](https://github.com/mscdex/imap) for IMAP connectivity and [`mailparser`](https://github.com/nodemailer/mailparser) for MIME parsing.

## Installation

```bash
bun add @jazz-man/email-listener
```

```bash
npm install @jazz-man/email-listener
```

## Quick Start

```ts
import EmailListener from "@jazz-man/email-listener";

const listener = new EmailListener({
  user: "you@gmail.com",
  password: "app-password",
  host: "imap.gmail.com",
  port: 993,
});

listener.on("mail", (mail, seqno, attrs) => {
  console.log(`New email #${seqno}: ${mail.subject}`);
  console.log(`From: ${mail.from?.text}`);
  console.log(`Body: ${mail.text}`);
});

listener.on("error", (err) => {
  console.error("IMAP error:", err.message);
});

listener.start();
```

## Configuration

### `MailOptions`

All `imap` connection options are accepted, plus these:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `user` | `string` | — | IMAP username |
| `password` | `string` | — | IMAP password |
| `host` | `string` | — | IMAP server hostname |
| `port` | `number` | — | IMAP server port |
| `tls` | `boolean` | `true` | Use TLS for the connection |
| `mailbox` | `string` | `"INBOX"` | Mailbox to open and monitor |
| `markSeen` | `boolean` | `true` | Mark fetched emails as seen |
| `searchFilter` | `TSearchCriteria[]` | `["UNSEEN"]` | IMAP search criteria for finding messages |
| `fetchUnreadOnStart` | `boolean` | `true` | Fetch unread messages immediately after connecting |

### Search Criteria

`searchFilter` accepts an array of IMAP search criteria. Some examples:

```ts
// Unread messages (default)
{ searchFilter: ["UNSEEN"] }

// Messages from a specific sender
{ searchFilter: [["FROM", "boss@company.com"]] }

// Unread messages with a specific subject
{ searchFilter: ["UNSEEN", ["SUBJECT", "urgent"]] }

// Gmail raw search query
{ searchFilter: [["X-GM-RAW", "from:github is:unread"]] }
```

See `TSearchCriteria` in the source for the full list of supported criteria.

## Events

`EmailListener` extends `EventEmitter` with typed events:

### `mail`

Emitted when a new email is parsed.

```ts
listener.on("mail", (mail, seqno, attrs) => {
  // mail: ParsedMail — fully parsed email object
  // seqno: number — IMAP sequence number
  // attrs: ImapMessageAttributes — IMAP message attributes (flags, date, etc.)
});
```

The `mail` object is a [`ParsedMail`](https://nodemailer.com/extras/mailparser/#parsed-mail) instance from `mailparser` with fields like:

- `mail.from` — sender address object
- `mail.to` — recipient address objects
- `mail.subject` — email subject
- `mail.text` — plain text body
- `mail.html` — HTML body
- `mail.attachments` — array of attachments
- `mail.date` — send date

### `server:connected`

Emitted when connected and the mailbox is open.

```ts
listener.on("server:connected", () => {
  console.log("Connected to IMAP server");
});
```

### `server:disconnected`

Emitted when the connection closes.

```ts
listener.on("server:disconnected", () => {
  console.log("Disconnected from IMAP server");
});
```

### `error`

Emitted on any error (connection, search, fetch, parse).

```ts
listener.on("error", (err) => {
  console.error(err);
});
```

## Methods

### `start()`

Opens the IMAP connection and begins monitoring for new mail.

### `stop()`

Closes the IMAP connection.

## Examples

### Monitor a Gmail inbox

```ts
import EmailListener from "@jazz-man/email-listener";

const listener = new EmailListener({
  user: "you@gmail.com",
  password: "your-app-password",
  host: "imap.gmail.com",
  port: 993,
  mailbox: "[Gmail]/All Mail",
});

listener.on("mail", (mail) => {
  console.log(`From: ${mail.from?.text}`);
  console.log(`Subject: ${mail.subject}`);
});

listener.on("error", (err) => console.error(err));

listener.start();

// Graceful shutdown
process.on("SIGINT", () => {
  listener.stop();
});
```

### Only fetch on new arrivals (skip initial unread)

```ts
const listener = new EmailListener({
  user: "you@example.com",
  password: "secret",
  host: "imap.example.com",
  port: 993,
  fetchUnreadOnStart: false,
});
```

### Custom search with event-driven processing

```ts
const listener = new EmailListener({
  user: "you@example.com",
  password: "secret",
  host: "imap.example.com",
  port: 993,
  searchFilter: ["UNSEEN", ["FROM", "alerts@monitoring.io"]],
  markSeen: false,
});

listener.on("mail", (mail, seqno, attrs) => {
  // Process the alert without marking it as read
  handleAlert(mail.text);
});
```

### Save attachments

```ts
import { writeFileSync } from "node:fs";

listener.on("mail", (mail) => {
  for (const attachment of mail.attachments) {
    writeFileSync(attachment.filename, attachment.content);
    console.log(`Saved: ${attachment.filename}`);
  }
});
```

## Development

```bash
bun install           # install dependencies
bun test              # run tests
bun test --coverage   # run tests with coverage
bunx biome check src/ # lint + format check
```

## License

MIT
