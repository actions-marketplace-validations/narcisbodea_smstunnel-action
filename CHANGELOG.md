# Changelog

All notable changes to `narcisbodea/smstunnel-action` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-01

### Added

- The **SMSTunnel SMS** action (`node24`): sends `message` to every number in `to`, one text each (at most 30), or a
  sign-in code with `code: true`; optional `device-id`, `default-country-code` and `server-url`.
- The `message-ids` output and a job summary table.
- The key and the numbers are masked in the log; the action prints only the last four digits of a number.
- One retry after a 429, as long as SMSTunnel asks (up to a minute); a 401 or 403 stops the other numbers.
