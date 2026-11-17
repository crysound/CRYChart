import test, { type TestFn } from "node:test";

/** Explicit, reviewable links for APIs called through dynamic dispatch/DOM boundaries.
 * The checker still requires real assertions and a successful test result. */
export function apiTest(name: string, apis: readonly string[], run: TestFn) {
  if (!apis.length)
    throw new Error("An API scenario must identify its public entrypoints");
  return test(name, run);
}
