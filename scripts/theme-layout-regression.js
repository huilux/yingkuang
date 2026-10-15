// Run last: remove the browser's demo fixture to inspect the empty workspace.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { themePreferenceKey } = await import('/src/theme.ts');
  const saved = localStorage.getItem(themePreferenceKey);
  const button = document.querySelector('button.theme-control');
  t.assert(button && !button.textContent.trim(), 'Icon-only theme button missing');
  const choose = async value => {
    for (let i = 0; i < 3 && document.documentElement.dataset.themePreference !== value; i++) {
      button.click(); await t.frame();
    }
    t.assert(document.documentElement.dataset.themePreference === value, 'Theme button did not reach requested preference');
    t.assert(button.getAttribute('aria-label').includes({system: '跟随系统', light: '浅色', dark: '深色'}[value]), 'Current theme not accessible');
  };
  const luminance = value => {
    const channels = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const contrast = (foreground, background) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  };
  const centered = () => {
    const viewport = document.querySelector('.canvas-viewport').getBoundingClientRect();
    const items = [...document.querySelector('.canvas-empty').children].map(x => x.getBoundingClientRect());
    for (const item of items) t.near(item.x + item.width / 2, viewport.x + viewport.width / 2, 'Empty-state item not horizontally centered', 1);
    t.near((items[0].top + items.at(-1).bottom) / 2, viewport.y + viewport.height / 2, 'Empty-state group not vertically centered', 1);
  };
  try {
    await choose('system');
    for (const preference of ['light', 'dark', 'system']) {
      button.click(); await t.frame();
      t.assert(document.documentElement.dataset.themePreference === preference, 'Theme cycle order is wrong');
    }
    const ctx = await t.context();
    const pixels = ctx.stage.toDataURL();
    const camera = { x: ctx.world.x(), y: ctx.world.y(), scale: ctx.world.scaleX() };
    for (const preference of ['light', 'dark']) {
      await choose(preference);
      t.assert(document.documentElement.dataset.theme === preference, 'Explicit theme not applied');
      t.assert(localStorage.getItem(themePreferenceKey) === preference, 'Theme preference not saved');
      t.assert(getComputedStyle(document.documentElement).colorScheme === preference, 'Native form color scheme not updated');
      t.assert(ctx.stage.toDataURL() === pixels, 'Theme changed the photo/frame rendering');
      t.near(ctx.world.x(), camera.x, 'Theme moved canvas X');
      t.near(ctx.world.y(), camera.y, 'Theme moved canvas Y');
      t.near(ctx.world.scaleX(), camera.scale, 'Theme changed canvas zoom');
    }
    // A blocked settings store must not prevent switching the current UI.
    const setItem = Storage.prototype.setItem;
    try {
      Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
      await choose('light');
      t.assert(document.documentElement.dataset.theme === 'light', 'Storage failure blocked theme switching');
    } finally { Storage.prototype.setItem = setItem; }
    await choose('system');
    t.assert(document.documentElement.dataset.theme === (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), 'System theme not resolved');
    [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '清空批次').click();
    await t.frame();
    [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '确认移除').click();
    await t.waitFor(() => document.querySelector('.canvas-empty'), 'Empty canvas missing');
    const ratios = {};
    for (const preference of ['light', 'dark']) {
      await choose(preference); centered();
      const background = getComputedStyle(document.querySelector('.canvas-viewport')).backgroundColor;
      for (const selector of ['.canvas-empty strong', '.canvas-empty p']) {
        const ratio = contrast(getComputedStyle(document.querySelector(selector)).color, background);
        t.assert(ratio >= 4.5, `${preference} empty-state contrast too low: ${ratio}`);
        ratios[`${preference}:${selector}`] = Number(ratio.toFixed(2));
      }
    }
    return { emptyStateCentered: true, explicitThemes: true, systemTheme: true, storageFailureFallback: true, photoAndCameraUnchanged: true, contrastRatios: ratios };
  } finally {
    await choose(saved === 'light' || saved === 'dark' ? saved : 'system');
    if (saved === null) localStorage.removeItem(themePreferenceKey);
  }
})()
