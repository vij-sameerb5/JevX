import { describe, expect, it } from "vitest";
import { isMultiWord, isWordLike, nameTokens, regexNaturalWords } from "./text.js";

describe("text heuristics", () => {
  it("tokenizes names", () => {
    expect(nameTokens("userMessage")).toEqual(["user", "message"]);
    expect(nameTokens("USER_INPUT")).toEqual(["user", "input"]);
    expect(nameTokens("ticketBody")).toEqual(["ticket", "body"]);
  });

  it("recognises natural words, rejects code-ish tokens", () => {
    for (const w of ["refund", "money back", "can't", "Hello"]) expect(isWordLike(w), w).toBe(true);
    for (const w of [".ts", "ADD_TODO", "getUser", "--verbose", "https://", "GET", "x", "btn-primary"])
      expect(isWordLike(w), w).toBe(false);
  });

  it("treats phrases with all-caps code tokens as DSL, not prose", () => {
    expect(isWordLike("graph TD")).toBe(false);
    expect(isMultiWord("graph LR")).toBe(false);
    expect(isMultiWord("talk to a human")).toBe(true);
  });

  it("detects multi-word phrases", () => {
    expect(isMultiWord("money back")).toBe(true);
    expect(isMultiWord("refund")).toBe(false);
  });

  it("reads natural words out of regexes", () => {
    expect(regexNaturalWords("\\b(urgent|asap|right now)\\b")).toEqual(["urgent", "asap", "right now"]);
    expect(regexNaturalWords("^[^@]+@[^@]+\\.[a-z]{2,}$")).toEqual([]);
    expect(regexNaturalWords("\\.(png|jpg)$")).toEqual([]);
    expect(regexNaturalWords("giphy.com\\/(?:clips|embed|gifs)\\/")).toEqual([]);
    expect(regexNaturalWords("(?:Parse|Lexical) error on line (\\d+)[.:]")).toEqual([]);
  });
});
