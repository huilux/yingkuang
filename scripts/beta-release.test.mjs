import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft } from './beta-release.mjs';

test('beta uploads reject a published release, mismatched tag and stale commit', () => {
  const sha = 'a'.repeat(40);
  const draft = { isDraft: true, isPrerelease: true, tagName: 'v0.5.8-beta.1', targetCommitish: sha };
  assert.doesNotThrow(() => validateDraft(draft, '0.5.8-beta.1', draft.tagName, sha));
  for (const altered of [{ isDraft: false }, { isPrerelease: false }, { tagName: 'v0.5.7' }, { targetCommitish: 'b'.repeat(40) }]) {
    assert.throws(() => validateDraft({ ...draft, ...altered }, '0.5.8-beta.1', draft.tagName, sha));
  }
  assert.throws(() => validateDraft(draft, '0.5.8', draft.tagName, sha));
  assert.throws(() => validateDraft(draft, '0.5.8-beta.1', draft.tagName, 'main'));
});
