import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState, ErrorNotice, RowsSkeleton } from "./state-views";

test("loading skeletons have a screen-reader status while decorative bars stay hidden", () => {
  const html = renderToStaticMarkup(<RowsSkeleton rows={2} />);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /class="sr-only">Loading records<\/span>/);
  assert.match(html, /aria-hidden="true"/);
  assert.equal((html.match(/h-12 w-full/g) ?? []).length, 2);
});

test("blocked and empty states keep clear headings and a live alert", () => {
  const blockedHtml = renderToStaticMarkup(React.createElement(ErrorNotice, {
    error: { status: 403, data: { error: "Your role is not permitted to perform this action." } },
  }));
  assert.match(blockedHtml, /role="alert"/);
  assert.match(blockedHtml, /Your role cannot do this/);
  assert.match(blockedHtml, /Your role is not permitted to perform this action\./);

  const emptyHtml = renderToStaticMarkup(React.createElement(EmptyState, {
    title: "No saved buyer records",
    body: "Records appear after an owner saves a buyer.",
  }));
  assert.match(emptyHtml, /<h3[^>]*>No saved buyer records<\/h3>/);
  assert.match(emptyHtml, /Records appear after an owner saves a buyer\./);
});
