import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES,
  MEMORY_CAP,
  MESSAGES_PER_MINUTE,
  messageRejection,
  cosine,
  evictionCount,
  extractText,
  handoffTargets,
  parseMentions,
  parseRoute,
  shouldRemember,
  stripSpeakerPrefix
} from "../src/team.ts";

test("parseMentions finds ids and names, deduped, in order", () => {
  assert.deepEqual(parseMentions("@qa can you check? cc @Bao and @qa"), [
    "qa",
    "backend"
  ]);
  assert.deepEqual(parseMentions("email me at a@b.com"), []);
  assert.deepEqual(parseMentions("@nobody here"), []);
});

test("handoffTargets skips the author and the agent being answered", () => {
  assert.deepEqual(handoffTargets("@backend @qa thoughts?", "human"), ["backend", "qa"]);
  assert.deepEqual(handoffTargets("@backend I'll ask @devops", "backend"), ["devops"]);
  assert.deepEqual(handoffTargets("Done, @devops set up Mailgun", "backend", "devops"), []);
  assert.deepEqual(handoffTargets("@devops done; @qa please test", "backend", "devops"), ["qa"]);
});

test("messageRejection blocks while running and above the per-minute cap", () => {
  const now = 1_000_000;
  assert.equal(messageRejection([], now, false), null);
  assert.match(messageRejection([], now, true), /still replying/);
  const full = Array.from({ length: MESSAGES_PER_MINUTE }, (_, i) => now - i * 1000);
  assert.match(messageRejection(full, now, false), /Limit/);
  const old = full.map((t) => t - 60_000);
  assert.equal(messageRejection(old, now, false), null);
});

test("cosine handles identical, orthogonal and zero vectors", () => {
  assert.equal(cosine([1, 2], [1, 2]).toFixed(6), "1.000000");
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [1, 1]), 0);
});

test("shouldRemember keeps the most relevant role and drops the rest", () => {
  const base = { mentioned: false, isAuthor: false, assigned: false };
  assert.equal(shouldRemember({ ...base, relevance: 0.8, bestRelevance: 0.8 }), true);
  assert.equal(shouldRemember({ ...base, relevance: 0.78, bestRelevance: 0.8 }), true);
  assert.equal(shouldRemember({ ...base, relevance: 0.6, bestRelevance: 0.8 }), false);
  assert.equal(shouldRemember({ ...base, relevance: 0.1, bestRelevance: 0.8, mentioned: true }), true);
  assert.equal(shouldRemember({ ...base, relevance: 0.1, bestRelevance: 0.8, isAuthor: true }), true);
  assert.equal(shouldRemember({ ...base, relevance: 0.1, bestRelevance: 0.8, assigned: true }), true);
});

test("evictionCount enforces the memory cap", () => {
  assert.equal(evictionCount(MEMORY_CAP), 0);
  assert.equal(evictionCount(MEMORY_CAP + 3), 3);
  assert.equal(evictionCount(2, 5), 0);
});

test("parseRoute picks the first valid role id or falls back to lead", () => {
  assert.equal(parseRoute("frontend"), "frontend");
  assert.equal(parseRoute('{"agent": "devops"}'), "devops");
  assert.equal(parseRoute("I think QA should take it"), "qa");
  assert.equal(parseRoute("no idea"), "lead");
});

test("extractText reads native and OpenAI-style results", () => {
  assert.equal(extractText({ response: " hi " }), "hi");
  assert.equal(extractText({ choices: [{ message: { content: "yo" } }] }), "yo");
  assert.equal(extractText(null), "");
});

test("stripSpeakerPrefix removes a leading name label only", () => {
  const bao = ROLES.find((r) => r.id === "backend");
  assert.equal(stripSpeakerPrefix("Bao: Done.", bao), "Done.");
  assert.equal(stripSpeakerPrefix("**Bao (Backend Engineer):** Done.", bao), "Done.");
  assert.equal(stripSpeakerPrefix("Done, Bao: out.", bao), "Done, Bao: out.");
});
