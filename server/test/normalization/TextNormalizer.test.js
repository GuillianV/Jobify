import test from "node:test";
import assert from "node:assert/strict";
import { TextNormalizer } from "../../src/normalization/TextNormalizer.js";

const MISSING_VALUE_CASES = [null, undefined];

/**
 * Assert that absent descriptions normalize to null.
 * @returns {void}
 */
function assertMissingValues() {
  for (const value of MISSING_VALUE_CASES) {
    assert.equal(TextNormalizer.htmlToPlainText(value), null);
  }
}

test("htmlToPlainText preserves absent, empty and plain-text values", () => {
  assertMissingValues();
  assert.equal(TextNormalizer.htmlToPlainText(""), "");
  assert.equal(TextNormalizer.htmlToPlainText("Développeur Node.js"), "Développeur Node.js");
  assert.equal(TextNormalizer.htmlToPlainText("ligne 1\n  ligne 2"), "ligne 1\n  ligne 2");
});

test("htmlToPlainText rejects values outside its contract", () => {
  assert.throws(() => {
    TextNormalizer.htmlToPlainText(1);
  }, TypeError);
});

test("htmlToPlainText preserves legitimate comparison operators", () => {
  const description = "expérience < 2 ans et score > 80";
  assert.equal(TextNormalizer.htmlToPlainText(description), description);
});

test("htmlToPlainText preserves technical syntax and intentional indentation", () => {
  const descriptions = [
    "Types : List<String>\n  indentation volontaire",
    "Promise<Result>\n    valeur",
    "<custom-element>\n  contenu",
    "Valeur <T> et > limite",
  ];
  for (const description of descriptions) {
    assert.equal(TextNormalizer.htmlToPlainText(description), description);
  }
});

test("htmlToPlainText removes inline tags without adding spaces", () => {
  assert.equal(TextNormalizer.htmlToPlainText("<b>Node</b>.<b>js</b>"), "Node.js");
  assert.equal(
    TextNormalizer.htmlToPlainText("<strong>Java</strong>/<em>Spring</em>"),
    "Java/Spring",
  );
  assert.equal(
    TextNormalizer.htmlToPlainText("<span class=\"skill\">React</span>"),
    "React",
  );
  assert.equal(
    TextNormalizer.htmlToPlainText("<a href=\"https://example.com\" title=\"Offre\">Postuler</a>"),
    "Postuler",
  );
});

test("htmlToPlainText keeps block content readable", () => {
  assert.equal(
    TextNormalizer.htmlToPlainText("<h2>Poste</h2><p>Premier</p><div>Second<br>Suite</div>"),
    "Poste\n\nPremier\n\nSecond\nSuite",
  );
  assert.equal(
    TextNormalizer.htmlToPlainText("<ul><li><b>Node.js</b></li><li>React</li></ul>"),
    "- Node.js\n- React",
  );
});

test("htmlToPlainText decodes named and numeric entities", () => {
  const encoded = "R&amp;D&nbsp;: &eacute;quipe &laquo;A&raquo; &rsquo; &ndash; &mdash; &bull; &hellip;";
  assert.equal(TextNormalizer.htmlToPlainText(encoded), "R&D : équipe «A» ’ – — • …");
  assert.equal(
    TextNormalizer.htmlToPlainText("score &lt; 5 et &gt; 2 &quot;ok&quot; &apos;x&apos; &#233; &#xE9; &#x10348;"),
    "score < 5 et > 2 \"ok\" 'x' é é \u{10348}",
  );
  assert.equal(
    TextNormalizer.htmlToPlainText("&unknown; &#x110000; &#xD800;"),
    "&unknown; &#x110000; &#xD800;",
  );
});

test("htmlToPlainText removes scripts, styles and comments with their contents", () => {
  const value = "Avant<script type=\"text/javascript\">alert('x')\nmore()</script>"
    + "<style>.secret { display: block; }</style><!-- caché -->Après";
  assert.equal(TextNormalizer.htmlToPlainText(value), "AvantAprès");
  assert.equal(
    TextNormalizer.htmlToPlainText("Avant&lt;SCRIPT&gt;alert(1)&lt;/SCRIPT&gt;Après"),
    "AvantAprès",
  );
});

test("htmlToPlainText handles malformed tags conservatively", () => {
  assert.equal(TextNormalizer.htmlToPlainText("<b>Node"), "Node");
  assert.equal(TextNormalizer.htmlToPlainText("Texte <incomplet"), "Texte <incomplet");
  assert.equal(TextNormalizer.htmlToPlainText("Valeur <T> et > limite"), "Valeur <T> et > limite");
  assert.equal(TextNormalizer.htmlToPlainText("List<String>"), "List<String>");
  assert.equal(TextNormalizer.htmlToPlainText("Map<String, Object>"), "Map<String, Object>");
  assert.equal(TextNormalizer.htmlToPlainText("Promise<Result>"), "Promise<Result>");
  assert.equal(TextNormalizer.htmlToPlainText("<custom-element>visible</custom-element>"), "<custom-element>visible</custom-element>");
});

test("htmlToPlainText removes unclosed scripts and styles with remaining content", () => {
  assert.equal(TextNormalizer.htmlToPlainText("Avant<script>alert('x')"), "Avant");
  assert.equal(TextNormalizer.htmlToPlainText("Avant<style>.hidden { display: none; }"), "Avant");
});

test("htmlToPlainText decodes entities only once", () => {
  assert.equal(
    TextNormalizer.htmlToPlainText("&amp;lt;b&amp;gt;Node&amp;lt;/b&amp;gt;"),
    "&lt;b&gt;Node&lt;/b&gt;",
  );
});
