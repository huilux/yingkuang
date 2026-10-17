import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, releaseAssets } from './beta-release.mjs';

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

test('macOS releases add only the two architecture-specific DMGs', () => {
  const base = releaseAssets('0.5.9-beta.3');
  const mac = releaseAssets('0.5.9-beta.3', true);
  assert.equal(base.length, 5);
  assert.equal(mac.length, 7);
  assert.deepEqual(mac.filter(name => !base.includes(name)), ['yingkuang_0.5.9-beta.3_macos-arm64.dmg', 'yingkuang_0.5.9-beta.3_macos-x64.dmg']);
});
