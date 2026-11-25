const { test } = require("node:test");
const assert = require("node:assert/strict");

test("document kinds are recognized by name or type", async () => {
  const { documentKind } = await import("../lib/documents.ts");
  assert.equal(documentKind("notes.PDF", ""), "pdf");
  assert.equal(documentKind("x", "application/pdf"), "pdf");
  assert.equal(documentKind("brief.docx", ""), "word");
  assert.equal(documentKind("old.doc", ""), "old-word");
  assert.equal(documentKind("IMG_0001.HEIC", ""), "image");
  assert.equal(documentKind("a.txt", ""), "text");
  assert.equal(documentKind("show.md", ""), "text");
  assert.equal(documentKind("page.html", ""), "html");
  assert.equal(documentKind("thing.zip", "application/zip"), "unknown");
});

test("text files are read; unsupported ones get a plain reason", async () => {
  const { extractDocumentText } = await import("../lib/documents.ts");
  const ok = await extractDocumentText(new TextEncoder().encode("Fed meets Wednesday."), "n.txt", "text/plain");
  assert.deepEqual(ok, { text: "Fed meets Wednesday.", truncated: false });
  assert.match((await extractDocumentText(new Uint8Array([1]), "p.heic", "")).error, /Photos can't be read yet/);
  assert.match((await extractDocumentText(new Uint8Array([1]), "o.doc", "")).error, /older Word file/);
  assert.match((await extractDocumentText(new Uint8Array(0), "e.txt", "")).error, /empty/);
  assert.match((await extractDocumentText(new Uint8Array(5 * 1024 * 1024), "big.txt", "")).error, /too big/);
  assert.match((await extractDocumentText(new TextEncoder().encode("not a pdf"), "x.pdf", "")).error, /couldn't read/);
});

test("a real Word file is read", async () => {
  // Minimal .docx built in memory with the same zip library mammoth uses.
  const JSZip = require("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>GameStop up 12 percent.</w:t></w:r></w:p></w:body></w:document>');
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const { extractDocumentText } = await import("../lib/documents.ts");
  const out = await extractDocumentText(bytes, "brief.docx", "");
  assert.equal(out.text, "GameStop up 12 percent.");
});

test("HTML becomes readable text without scripts or tags", async () => {
  const { htmlToText } = await import("../lib/documents.ts");
  const html = "<html><head><style>p{}</style><script>alert(1)</script></head><body><nav>Menu</nav><h1>Big &amp; news</h1><p>Line one.</p><ul><li>a</li><li>b</li></ul>&#39;ok&#x27;</body></html>";
  assert.equal(htmlToText(html), "Big & news\nLine one.\n- a\n- b\n'ok'");
});

test("long text is capped and flagged", async () => {
  const { capText, MAX_SOURCE_CHARS } = await import("../lib/documents.ts");
  const out = capText("x".repeat(MAX_SOURCE_CHARS + 10));
  assert.equal(out.text.length, MAX_SOURCE_CHARS);
  assert.equal(out.truncated, true);
});

test("links to private networks are refused before any fetch", async () => {
  const { checkPublicUrl, isPrivateAddress } = await import("../lib/fetch-page.ts");
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);

  const resolveTo = (ips) => async () => ips;
  assert.match(await checkPublicUrl("ftp://x.test/a"), /Only web links/);
  assert.match(await checkPublicUrl("not a url"), /doesn't look like a web address/);
  assert.match(await checkPublicUrl("http://user:pw@x.test/"), /username or password/);
  assert.match(await checkPublicUrl("http://x.test:8080/"), /unusual port/);
  assert.match(await checkPublicUrl("http://127.0.0.1/"), /can't open/);
  assert.match(await checkPublicUrl("http://[::1]/"), /can't open/);
  assert.match(await checkPublicUrl("https://sneaky.test/", resolveTo(["93.184.216.34", "10.0.0.5"])), /can't open/);
  assert.match(await checkPublicUrl("https://gone.test/", async () => { throw new Error("ENOTFOUND"); }), /couldn't find that website/);
  const ok = await checkPublicUrl("https://news.test/story", resolveTo(["93.184.216.34"]));
  assert.equal(ok.href, "https://news.test/story");
});

test("a redirect to a private address is refused", async () => {
  const { fetchPageText } = await import("../lib/fetch-page.ts");
  const realFetch = global.fetch;
  global.fetch = async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
  try {
    const out = await fetchPageText("https://news.test/story", async () => ["93.184.216.34"]);
    assert.match(out.error, /can't open/);
  } finally {
    global.fetch = realFetch;
  }
});

test("a fetched article becomes source text with its title", async () => {
  const { fetchPageText } = await import("../lib/fetch-page.ts");
  const realFetch = global.fetch;
  global.fetch = async () =>
    new Response("<html><title>Fed holds rates</title><body><p>The Fed held rates.</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  try {
    const out = await fetchPageText("https://news.test/story", async () => ["93.184.216.34"]);
    assert.equal(out.title, "Fed holds rates");
    assert.match(out.text, /The Fed held rates\./);
  } finally {
    global.fetch = realFetch;
  }
});

test("generate errors are explained in plain words", async () => {
  const { friendlyGenerateError } = await import("../lib/errors.ts");
  assert.match(friendlyGenerateError(new Error("OpenRouter API key is not set — add it in Settings")).message, /add the AI key/);
  assert.match(friendlyGenerateError(new Error("OpenRouter request failed (402): no credit")).message, /out of credit/);
  assert.match(friendlyGenerateError(new Error("OpenRouter request failed (401): bad key sk-or-123")).message, /turned down/);
  const other = friendlyGenerateError(new Error("socket hang up sk-or-secret"));
  assert.match(other.message, /couldn't write this episode/);
  assert.ok(!other.message.includes("sk-or"));
});
