export type TextKind = "han" | "letters" | "numbers";

/** Keep words, combining marks and numeric punctuation intact when aligning mixed scripts. */
export function textKinds(text: string): { character: string; kind: TextKind }[] {
  const classify = (character: string): TextKind | undefined => {
    if (/\p{Script=Han}/u.test(character)) return "han";
    if (/\p{Number}/u.test(character)) return "numbers";
    if (/\p{Letter}/u.test(character)) return "letters";
    return undefined;
  };
  const characters = Array.from(text);
  let kind: TextKind = characters.map(classify).find(value => value !== undefined) ?? "letters";
  return characters.map(character => {
    kind = classify(character) ?? kind;
    return { character, kind };
  });
}
