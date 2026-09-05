import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./image-attachments.ts");
}

const image = { type: "image", mimeType: "image/png", data: "YWJj" };

function imageOfBytes(bytes) {
  const wholeTriplets = Math.floor(bytes / 3);
  const remainder = bytes % 3;
  const suffix = remainder === 1 ? "AA==" : remainder === 2 ? "AAA=" : "";
  return { type: "image", mimeType: "image/png", data: `${"AAAA".repeat(wholeTriplets)}${suffix}` };
}

test("calculates padded base64 byte lengths and rejects invalid data", async () => {
  const { getBase64DecodedByteLength } = await loadSubject();

  assert.equal(getBase64DecodedByteLength("YQ=="), 1);
  assert.equal(getBase64DecodedByteLength("YWI="), 2);
  assert.equal(getBase64DecodedByteLength("YWJj"), 3);
  assert.equal(getBase64DecodedByteLength("not base64!"), null);
});

test("rejects invalid, oversized, and too many image attachments", async () => {
  const { MAX_ATTACHED_IMAGE_BYTES, MAX_ATTACHED_IMAGES, validateAgentImages } = await loadSubject();
  const oversizedData = "AAAA".repeat(Math.ceil((MAX_ATTACHED_IMAGE_BYTES + 1) / 3));

  assert.equal(validateAgentImages([image]), null);
  assert.match(validateAgentImages([{ ...image, mimeType: "text/plain" }]), /valid base64 image/);
  assert.match(validateAgentImages([{ ...image, data: oversizedData }]), /5MB/);
  assert.match(validateAgentImages(Array.from({ length: MAX_ATTACHED_IMAGES + 1 }, () => image)), /at most/);
});

test("accepts several screenshots inside one aggregate request budget", async () => {
  const { MAX_TOTAL_ATTACHED_IMAGE_BYTES, validateAgentImages, validateOutgoingPrompt } = await loadSubject();
  const images = Array.from({ length: 4 }, () => imageOfBytes(MAX_TOTAL_ATTACHED_IMAGE_BYTES / 8));

  assert.equal(validateAgentImages(images), null);
  assert.equal(validateOutgoingPrompt("Compare these screenshots", images), null);
});

test("rejects images that fit individually but not together", async () => {
  const { MAX_ATTACHED_IMAGE_BYTES, validateAgentImages, validateOutgoingPrompt } = await loadSubject();
  const imageWithinSingleLimit = imageOfBytes(Math.floor(MAX_ATTACHED_IMAGE_BYTES * 0.6));
  const images = [imageWithinSingleLimit, imageWithinSingleLimit];

  assert.equal(validateAgentImages([imageWithinSingleLimit]), null);
  assert.match(validateAgentImages(images), /total 5MB or less/);
  assert.match(validateOutgoingPrompt("two large screenshots", images), /total 5MB or less/);
});

test("rejects a prompt whose complete JSON body exceeds the route budget", async () => {
  const { MAX_AGENT_COMMAND_REQUEST_BYTES, MAX_TOTAL_ATTACHED_IMAGE_BYTES, validateOutgoingPrompt } = await loadSubject();
  const images = [imageOfBytes(MAX_TOTAL_ATTACHED_IMAGE_BYTES)];

  assert.equal(validateOutgoingPrompt("x".repeat(1024), images), null);
  assert.match(validateOutgoingPrompt("x".repeat(MAX_AGENT_COMMAND_REQUEST_BYTES), images), /too large to send/);
  assert.match(validateOutgoingPrompt("x".repeat(MAX_AGENT_COMMAND_REQUEST_BYTES)), /too large to send/);
});
