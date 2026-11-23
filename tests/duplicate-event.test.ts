import { expect, it } from "vitest";
import { orderAdminEvents } from "../src/lib/domain";
import { designEvent } from "./e2e/redesign-fixtures";

it("orders by start time and inserts each new copy immediately above its source, including nested copies", () => {
  const source = { ...designEvent, id: "source", code: "original" };
  const first = {
    ...source,
    id: "copy",
    code: "original-copy",
    duplicated_from_id: source.id,
    created_at: "2026-11-20T01:00:00Z",
  };
  const second = {
    ...first,
    id: "copy2",
    code: "original-copy-2",
    created_at: "2026-11-20T02:00:00Z",
  };
  const nested = {
    ...first,
    id: "nested",
    code: "renamed-copy",
    duplicated_from_id: first.id,
    created_at: "2026-11-20T03:00:00Z",
  };
  const newer = {
    ...source,
    id: "newer",
    starts_at: "2100-01-01T00:00:00Z",
    created_at: "2020-01-01T00:00:00Z",
  };
  const older = { ...source, id: "older", starts_at: "2090-01-01T00:00:00Z" };
  const events = [second, source, older, nested, newer, first];
  expect(orderAdminEvents(events).map((event) => event.id)).toEqual([
    "newer",
    "nested",
    "copy",
    "copy2",
    "source",
    "older",
  ]);
  expect(events[0]).toBe(second);
  expect(
    orderAdminEvents([
      source,
      { ...first, starts_at: older.starts_at },
      older,
    ]).map((event) => event.id),
  ).toEqual(["source", "copy", "older"]);
});

it("keeps undated, orphaned and malformed parent cycles visible", () => {
  const a = {
    ...designEvent,
    id: "a",
    starts_at: null,
    duplicated_from_id: "b",
  };
  const b = { ...a, id: "b", duplicated_from_id: "a" };
  const c = { ...a, id: "c", duplicated_from_id: "deleted" };
  expect(new Set(orderAdminEvents([a, b, c]).map((event) => event.id))).toEqual(
    new Set(["a", "b", "c"]),
  );
});
