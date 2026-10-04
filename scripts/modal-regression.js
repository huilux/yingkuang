(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const root = document.querySelector('#root');
  const trigger = [...root.querySelectorAll('button')].find(button => button.textContent.trim() === '模板库');
  const key = (name, shiftKey = false) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));
  trigger.focus(); trigger.click();
  try {
    await t.waitFor(() => root.querySelector('.template-manager'), 'Template library did not open');
    const manager = root.querySelector('.template-manager');
    await t.waitFor(() => manager.contains(document.activeElement), 'Focus stayed outside template library');
    const focusable = [...manager.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary')].filter(element => element.getClientRects().length);
    focusable.at(-1).focus(); key('Tab');
    t.assert(manager.contains(document.activeElement), 'Tab escaped template library');
    const reset = manager.querySelector('button[aria-label^="重置"]');
    reset.focus(); reset.click();
    await t.waitFor(() => manager.querySelector('.template-confirm'), 'Confirmation missing');
    const confirmation = manager.querySelector('.template-confirm');
    await t.waitFor(() => confirmation.contains(document.activeElement), 'Focus did not enter nested confirmation');
    key('Escape');
    await t.waitFor(() => !manager.querySelector('.template-confirm'), 'Escape did not close confirmation');
    t.assert(root.contains(manager), 'Escape also closed parent dialog');
    await t.waitFor(() => document.activeElement === reset, 'Focus did not return to confirmation trigger');
    key('Escape');
    await t.waitFor(() => !root.querySelector('.template-manager'), 'Escape did not close template library');
    await t.waitFor(() => document.activeElement === trigger, 'Focus did not return to library trigger');
    t.assert(!root.inert, 'Editor remained inert after closing dialogs');
    return { focusEntered: true, tabContained: true, nestedEscape: true, focusRestored: true };
  } finally {
    root.querySelector('button[aria-label="关闭模板库"]')?.click();
  }
})();
