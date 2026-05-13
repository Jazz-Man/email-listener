# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`@jazz-man/email-listener` — a TypeScript library that connects to an IMAP server and emits parsed email objects via Node.js `EventEmitter` when new mail arrives. Wraps `imap` (IMAP connectivity) and `mailparser` (MIME parsing).

## Commands

- **Lint/Format:** `bunx biome check src/` (lint + format check), `bunx biome check --write src/` (auto-fix)
- **Tests:** `bun test` (test root is `./tests` per `bunfig.toml`, 31 tests, 100% coverage)
- **Install:** `bun install`

No build step — `package.json` `"module"` points directly to `src/index.ts`. Bun and bundlers consume the TypeScript source directly.

## Architecture

Single-file library: `src/index.ts` (~183 lines).

**Exports:**
- `EmailListener` class — extends `EventEmitter`, manages IMAP lifecycle
- `MailOptions` type — config (IMAP credentials, `markSeen`, `mailbox`, `searchFilter`, `fetchUnreadOnStart`)
- `TSearchCriteria` type — IMAP search criteria union (including Gmail extensions like `X-GM-RAW`)
- `TParsedMail` type — re-export of `ParsedMail` from `mailparser`

**Events:** `mail` (parsed email + seqno + attrs), `server:connected`, `server:disconnected`, `error`

**Data flow:** `start()` → IMAP connect → `imapReady()` → open mailbox → `parseUnread()` (if `fetchUnreadOnStart`) → search + fetch each message → `handleMessage()` → stream body → `simpleParser` → emit `mail`. On new mail notifications, `imapMail()` → `parseUnread()` again.

**Patch:** `patches/utf7@1.0.2.patch` modernizes the transitive `utf7` dependency (removes `semver`, converts to ESM). Managed via `patchedDependencies` in `package.json`.

## Conventions

- Use Bun instead of Node.js (`bun`, `bun test`, `bun install`, `bunx`)
- Bun auto-loads `.env` — no `dotenv` needed
- Formatter: tabs, double quotes (configured in `biome.json`)
- Biome for linting and formatting — not ESLint/Prettier
- `tsconfig.json` extends `@tsconfig/bun` with `strictNullChecks`, `exactOptionalPropertyTypes`, `esModuleInterop`
