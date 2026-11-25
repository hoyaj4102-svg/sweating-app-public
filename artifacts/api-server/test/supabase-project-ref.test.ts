import test from "node:test";
import assert from "node:assert/strict";
import { supabaseProjectRef } from "../src/lib/supabase-project-ref.ts";

const REF = "abcdefghijklmnopqrst";

test("health ref is only the 20-character project label", () => {
  assert.equal(supabaseProjectRef(`https://${REF}.supabase.co`), REF);
  assert.equal(supabaseProjectRef(`https://${REF}.supabase.co/rest/v1`), REF);
  assert.equal(
    supabaseProjectRef(`https://user:service-role-secret@${REF}.supabase.co/?apikey=anon-secret`),
    REF,
  );
});

test("health ref is null for anything that is not a project host", () => {
  assert.equal(supabaseProjectRef(undefined), null);
  assert.equal(supabaseProjectRef(""), null);
  assert.equal(supabaseProjectRef("https://example.test"), null);
  assert.equal(supabaseProjectRef("https://preview.vercel.app"), null);
  assert.equal(supabaseProjectRef(`https://db.${REF}.supabase.co`), null);
  assert.equal(supabaseProjectRef("https://not-a-ref.supabase.co"), null);
  assert.equal(supabaseProjectRef(`postgres://postgres:secret@db.${REF}.supabase.co:5432/postgres`), null);
});
