import { describe, expect, test } from "vitest";
import { extractFirstImage, hasAudio, stripHtmlToSnippet } from "./media";

describe("extractFirstImage", () => {
    test("returns null when html has no img", () => {
        expect(extractFirstImage("<p>just text</p>")).toBeNull();
    });

    test("returns src + empty alt for <img src>", () => {
        expect(extractFirstImage('<p>hi <img src="foo.png"></p>')).toEqual({
            src: "foo.png",
            alt: "",
        });
    });

    test("preserves alt attribute when present", () => {
        expect(extractFirstImage('<img src="x.jpg" alt="diagram">')).toEqual({
            src: "x.jpg",
            alt: "diagram",
        });
    });

    test("returns the first <img> when multiple exist", () => {
        const html = '<img src="one.png"><p>x</p><img src="two.png">';
        expect(extractFirstImage(html)).toEqual({ src: "one.png", alt: "" });
    });

    test("decodes HTML entities in src", () => {
        const html = '<img src="a&amp;b.png">';
        expect(extractFirstImage(html)).toEqual({ src: "a&b.png", alt: "" });
    });

    test("ignores <img> without src", () => {
        expect(extractFirstImage('<img alt="no src">')).toBeNull();
    });

    test("rejects javascript: URIs", () => {
        expect(
            extractFirstImage('<img src="javascript:alert(1)">'),
        ).toBeNull();
    });
});

describe("hasAudio", () => {
    test("returns false for empty string", () => {
        expect(hasAudio("")).toBe(false);
    });

    test("returns false for plain text", () => {
        expect(hasAudio("no audio here")).toBe(false);
    });

    test("returns true when [sound:*] is present", () => {
        expect(hasAudio("before [sound:foo.mp3] after")).toBe(true);
    });

    test("returns true for unicode filenames", () => {
        expect(hasAudio("[sound:片仮名.mp3]")).toBe(true);
    });
});

describe("stripHtmlToSnippet", () => {
    test("returns plain text, collapses whitespace, handles <br> and <hr>", () => {
        const html = "<p>hello<br>world<hr>tail   end</p>";
        expect(stripHtmlToSnippet(html)).toBe("hello world · tail end");
    });

    test("caps at maxChars with ellipsis", () => {
        const html = "<p>abcdefghij</p>";
        expect(stripHtmlToSnippet(html, 5)).toBe("abcde…");
    });

    test("returns trimmed input when already plain text", () => {
        expect(stripHtmlToSnippet("  plain text  ")).toBe("plain text");
    });
});
