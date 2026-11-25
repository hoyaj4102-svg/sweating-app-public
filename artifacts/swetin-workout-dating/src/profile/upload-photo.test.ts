import assert from "node:assert/strict";
import test from "node:test";
import { profilePhotoFileError, uploadProfilePhoto } from "./upload-photo.ts";

test("profile photo file check accepts jpeg and rejects other types and oversized files", () => {
  assert.equal(profilePhotoFileError(new File([new Uint8Array(8)], "a.jpg", { type: "image/jpeg" })), null);
  assert.equal(profilePhotoFileError(new File([new Uint8Array(8)], "a.gif", { type: "image/gif" })), "지원하는 사진 형식만 올릴 수 있습니다.");
  assert.match(
    profilePhotoFileError(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "a.png", { type: "image/png" })) ?? "",
    /용량/,
  );
});

test("profile photo upload posts the file and returns the storage reference", async () => {
  const previous = globalThis.fetch;
  const file = new File([Uint8Array.of(1, 2, 3)], "a.webp", { type: "image/webp" });
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "/api/profiles/me/photo");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("content-type"), "image/webp");
    assert.equal(init?.body, file);
    return Response.json({
      profile_photo_ref: "profile-photos/member/avatar.webp",
      profile_photo_url: "https://example.test/storage/v1/object/sign/profile-photos/member/avatar.webp?token=short",
    });
  };
  try {
    const uploaded = await uploadProfilePhoto(file);
    assert.equal(uploaded.profile_photo_ref, "profile-photos/member/avatar.webp");
    assert.match(uploaded.profile_photo_url, /token=short/);
  } finally {
    globalThis.fetch = previous;
  }
});
