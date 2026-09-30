import { describe, expect, it } from "vitest";
import {
  isMaxWidth,
  resolveSettings,
  rightsFieldError,
} from "../../src/pipeline/resolveSettings.js";
import type { PipelineRightsOptions } from "../../src/pipeline/types.js";

describe("rightsFieldError", () => {
  it.each<[keyof PipelineRightsOptions, string, string | undefined]>([
    ["creator", " Ada Lovelace ", undefined],
    ["copyright", "", "Expected rights.copyright to have a value"],
    ["credit", " \t", "Expected rights.credit to have a value"],
    ["rightsUrl", "https://example.com/licence", undefined],
    ["licensorUrl", " http://example.com/ ", undefined],
    [
      "rightsUrl",
      "example.com/licence",
      "Expected rights.rightsUrl to be an http: or https: URL, got example.com/licence",
    ],
    [
      "licensorUrl",
      "mailto:ada@example.com",
      "Expected rights.licensorUrl to be an http: or https: URL, got mailto:ada@example.com",
    ],
  ])("checks %s %j", (name, value, error) => {
    expect(rightsFieldError(name, value)).toBe(error);
  });

  it("gives the error resolveSettings throws", () => {
    expect(() =>
      resolveSettings({ rights: { rightsUrl: "example.com" } })
    ).toThrow(new RangeError(rightsFieldError("rightsUrl", "example.com")));
  });
});

describe("isMaxWidth", () => {
  it.each([
    [1, true],
    [1200, true],
    [0, false],
    [-1, false],
    [1.5, false],
    [Number.NaN, false],
    ["1200", false],
    [undefined, false],
  ])("says %j is %s", (value, expected) => {
    expect(isMaxWidth(value)).toBe(expected);
  });
});
