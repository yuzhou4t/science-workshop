import assert from "node:assert/strict";

import { semanticScholarBatch } from "./backfill-english-metadata-abstracts.mjs";

const articles = [
  {
    id: "matched",
    title: "A Strictly Matched Paper Title",
    url: "https://doi.org/10.1000/matched",
  },
  {
    id: "mismatch",
    title: "Expected Paper Title",
    url: "https://doi.org/10.1000/mismatch",
  },
  {
    id: "acknowledgements",
    title: "Paper with a Working Draft Abstract",
    url: "https://doi.org/10.1000/working-draft",
  },
];

let request;
const results = await semanticScholarBatch(articles, 1000, async (url, payload) => {
  request = { url, payload };
  return {
    ok: true,
    status: 200,
    data: [
      {
        title: "A Strictly Matched Paper Title",
        abstract: "A reliable abstract returned by the batch metadata endpoint.",
        openAccessPdf: { url: "https://example.org/paper.pdf" },
      },
      {
        title: "A Different Paper Title",
        abstract: "This abstract must not be accepted.",
      },
      {
        title: "Paper with a Working Draft Abstract",
        abstract: "This starts like an abstract. Department of Economics. Email: author@example.org. I thank seminar participants for useful comments and acknowledge research assistance.",
      },
    ],
  };
});

assert.match(request.url, /\/paper\/batch\?fields=/);
assert.deepEqual(request.payload, { ids: ["DOI:10.1000/matched", "DOI:10.1000/mismatch", "DOI:10.1000/working-draft"] });
assert.equal(results.get("matched").abstract, "A reliable abstract returned by the batch metadata endpoint.");
assert.equal(results.get("matched").open_access_pdf_url, "https://example.org/paper.pdf");
assert.equal(results.has("mismatch"), false);
assert.equal(results.has("acknowledgements"), false, "working-paper contact and acknowledgement text is not a clean article abstract");

console.log("English metadata batch backfill rules ok");
