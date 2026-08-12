import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MessageView } = await jiti.import("./MessageView.tsx");
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { ClickableImage } = await jiti.import("./ImageLightbox.tsx");

test("user image blocks render as click-to-preview thumbnails", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image", data: "QUJD", mimeType: "image/png" },
      ],
    },
  }));

  assert.match(html, /<button[^>]*class="image-clickable"/);
  assert.match(html, /src="data:image\/png;base64,QUJD"/);
});

test("markdown images render as click-to-preview thumbnails", () => {
  const html = renderToStaticMarkup(React.createElement(MarkdownBody, null, "![diagram](https://example.com/a.png)"));

  assert.match(html, /<button[^>]*class="image-clickable"/);
  assert.match(html, /src="https:\/\/example.com\/a.png"/);
  assert.match(html, /alt="diagram"/);
});

test("custom message images render as click-to-preview thumbnails", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "custom",
      customType: "advisor",
      content: [{ type: "image", data: "QUJD", mimeType: "image/png" }],
    },
  }));

  assert.match(html, /<button[^>]*class="image-clickable"/);
  assert.match(html, /src="data:image\/png;base64,QUJD"/);
});

test("click-to-preview keeps image attributes and starts closed", () => {
  const html = renderToStaticMarkup(React.createElement(ClickableImage, {
    src: "data:image/gif;base64,R0lGOD",
    alt: "x",
    className: "markdown-inline-img",
    // Override the hard-coded loading="lazy" to prove rest props reach the img.
    loading: "eager",
  }));

  assert.match(html, /<button[^>]*class="image-clickable"/);
  assert.match(html, /src="data:image\/gif;base64,R0lGOD"/);
  assert.match(html, /alt="x"/);
  assert.match(html, /class="markdown-inline-img"/);
  assert.match(html, /loading="eager"/);
  // The trigger's accessible name carries the meaningful alt text.
  assert.match(html, /aria-label="Open image preview: x"/);
  assert.doesNotMatch(html, /image-lightbox-dialog/);
});

test("pure image links render the preview directly without an anchor wrapper", () => {
  const html = renderToStaticMarkup(React.createElement(MarkdownBody, null, "[![diagram](https://example.com/a.png)](https://example.com/page)"));

  // The preview supersedes the link: no anchor, no invalid <a><button> nesting.
  assert.doesNotMatch(html, /<a[^>]*>/);
  assert.match(html, /<button[^>]*class="image-clickable"/);
  assert.match(html, /src="https:\/\/example.com\/a.png"/);
});

test("mixed links keep the caption linked and render the image preview beside it", () => {
  const html = renderToStaticMarkup(React.createElement(MarkdownBody, null, "[open ![diagram](https://example.com/a.png)](https://example.com/page)"));

  // Caption stays a link; the image preview is NOT nested inside the anchor.
  assert.match(html, /<a[^>]*>open[^<]*<\/a><button[^>]*class="image-clickable"/);
  assert.doesNotMatch(html, /<button[^>]*class="image-clickable"[\s\S]*?<\/a>/);
  assert.match(html, /src="https:\/\/example.com\/a.png"/);
});

test("formatted image links unwrap the anchor and keep the formatting", () => {
  const html = renderToStaticMarkup(React.createElement(MarkdownBody, null, "[**![diagram](https://example.com/a.png)**](https://example.com/page)"));

  // Image-only link wrapped in formatting: no anchor; the button may live
  // inside <strong> (valid) but never inside <a>.
  assert.doesNotMatch(html, /<a[^>]*>/);
  assert.match(html, /<strong><button[^>]*class="image-clickable"/);
  assert.match(html, /src="https:\/\/example.com\/a.png"/);
});

test("formatted mixed links keep text formatted and linked, preview beside", () => {
  const html = renderToStaticMarkup(React.createElement(MarkdownBody, null, "[**open ![diagram](https://example.com/a.png)**](https://example.com/page)"));

  assert.match(html, /<a[^>]*><strong>open[^<]*<\/strong><\/a><button[^>]*class="image-clickable"/);
  assert.doesNotMatch(html, /<button[^>]*class="image-clickable"[\s\S]*?<\/a>/);
});

test("whitespace-only text around an image link still unwraps the anchor", () => {
  const html = renderToStaticMarkup(React.createElement(MarkdownBody, null, "[ ![diagram](https://example.com/a.png) ](https://example.com/page)"));

  // Surrounding spaces are not link content — the preview supersedes the link.
  assert.doesNotMatch(html, /<a[^>]*>/);
  assert.match(html, /<button[^>]*class="image-clickable"/);
});

test("missing image sources render nothing", () => {
  assert.equal(renderToStaticMarkup(React.createElement(ClickableImage, { src: "" })), "");
});
