(async () => {
  const resource = performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/font-library.ts').name;
  const fonts = await import(resource);
  await fonts.ensureFontsLoaded(['Space Mono']); await document.fonts.ready;
  const { layoutWatermarkText } = await import('/src/watermark-text.ts');
  const cases = [];
  // Bundled Space Mono's hmtx advance for A and digits is 612 / 1000 em.
  // Hinted Canvas advances must not accumulate when runs alternate or grow long.
  for (const size of [8, 16, 32, 80]) for (const text of ['A1'.repeat(12), '123'.repeat(100)]) {
    const layout = layoutWatermarkText({ fontFamily: 'Space Mono', fontSize: size, fontWeight: 400 }, text);
    const expected = text.length * size * .612;
    if (Math.abs(layout.width - expected) > .02) throw Error(JSON.stringify({ size, length: text.length, expected, actual: layout.width }));
    cases.push({ size, length: text.length, error: Math.abs(layout.width - expected) });
  }
  return { unhintedAdvances: true, cases };
})();
