# Before You Share

See what a file may reveal before you send it.

Before You Share is an experimental, privacy-first browser tool for inspecting
hidden or easily overlooked information in files. It is intended to help
people understand that a photograph, PDF, or document may disclose more than
the content visible on screen.

The planned experience runs locally in the browser. Files are not uploaded,
accounts are not required, and analysis does not depend on a remote service.

## Status

Foundation ready; implementation has not started. Supported formats, parsing
libraries, browser APIs, sanitization behavior, and deployment have not yet
been selected or implemented.

## Start here

- [Architecture boundary](docs/ARCHITECTURE.md)
- [Development harness](docs/HARNESS.md)
- [Agent guide](AGENTS.md)

## Product principles

- Process files locally by default and make any network boundary impossible to
  miss.
- Never modify the original file. Any sanitized result is a separate copy.
- Explain each finding in plain language: what it is, where it came from, why
  it may matter, and how confident the tool is.
- Distinguish verified metadata from heuristics and unsupported file content.
- Keep analysis useful without an account, database, AI provider, or backend.
- Treat every file and parser result as untrusted input.
- Bound file size, memory, CPU time, decompression, recursion, and previews.
- Make privacy education more important than alarmist scoring.
- Require zero monetary cost and avoid services that can charge automatically.

## Experimental limitations

Before You Share is not a guarantee that a file is anonymous, safe, clean, or
free of hidden information. Parsers can miss data, file formats evolve, and a
copy produced by a browser tool may lose features or fail to open correctly.

The application must therefore:

- preserve the original untouched;
- label every generated file as a new experimental copy;
- state exactly what was removed or rebuilt;
- recommend opening and checking the copy before sharing it;
- never encourage deletion of the original;
- avoid claiming to replace professional forensic, legal, compliance, or
  security review.

## Deliberately excluded from the first release

- Cloud uploads or remote file storage.
- Accounts, profiles, analytics, advertising, or tracking.
- Malware detection or claims that a file is safe to execute.
- Password recovery, encryption bypass, or examination of files without the
  owner's authorization.
- Silent modification, in-place rewriting, or automatic sharing.
- Support for every file format before a smaller set is tested thoroughly.

The first reviewed plan must choose a narrow format set and define evidence,
resource, privacy, accessibility, and round-trip integrity requirements before
implementation begins.
