# 12 Stable performance test

Labels: test, ci

## Goal

The NFR-7 test (AC27) fails only when search really gets slow, not when the machine is busy.

## Background

AC27 measures one `search_context` call on 500 generated files against a 300 ms limit. It failed
locally while another test suite loaded the CPU (551 ms) and once in CI on PR #24 (306 ms), and
passed on re-run both times. A failing AC27 also blocks a release, because `release.yml` runs
`pnpm check`. A real regression, such as a ReDoS pattern in `redact()`, costs seconds, not tens
of milliseconds.

## Scope

- Measure several `search_context` calls and assert on the median instead of a single call.
- Limit: 300 ms locally, 1 s in CI (`CI` environment variable set, as on GitHub Actions).
- The failure message names the median, the single timings and the limit that applied.
- Update NFR-7 and AC27 in `docs/requirements.md` and decision 85.

## Acceptance criteria

- [ ] AC27 asserts on the median of several calls, not on one call.
- [ ] With `CI` set the limit is 1 s, without it 300 ms; a test pins which limit applies.
- [ ] A search slowed down to the seconds range fails the test in CI as well.
- [ ] NFR-7, AC27 and decision 85 describe the new rule.
