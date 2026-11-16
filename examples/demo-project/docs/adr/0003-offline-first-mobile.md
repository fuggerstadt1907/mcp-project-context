# 0003: Offline-first mobile bookings list

- Status: Proposed
- Date: 2026-09-21

## Context

Guides check bookings at meeting points with poor reception.

## Decision

Cache the bookings list locally in SQLite and sync when online. Writes are queued and replayed.

## Consequences

- Conflict handling needed when a booking changes on the server while offline.
- More test cases for the sync layer.
