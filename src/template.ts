// A small, non-executable grammar. An odd number of backslashes escapes a placeholder.
export function templateParts(text: string) {
  const parts: { text: string; variable?: string }[] = [];
  const pattern = /(\\*)\{\{([^{}\r\n]+)\}\}/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (text[match.index! - 1] === '{' || text[match.index! + match[0].length] === '}') continue;
    parts.push({ text: text.slice(last, match.index) });
    const slashes = match[1],
      name = match[2].trim();
    if (slashes.length % 2) parts.push({ text: slashes.slice(1) + match[0].slice(slashes.length) });
    else if (name && name.length <= 80) {
      parts.push({ text: slashes });
      parts.push({ text: match[0].slice(slashes.length), variable: name });
    } else parts.push({ text: match[0] });
    last = match.index! + match[0].length;
  }
  parts.push({ text: text.slice(last) });
  return parts;
}
export const templateVariables = (text: string) => [
  ...new Set(templateParts(text).flatMap((p) => (p.variable ? [p.variable] : []))),
];
export function resolveTemplate(text: string, values: Record<string, string>) {
  return templateParts(text)
    .map((p) => (p.variable && Object.hasOwn(values, p.variable) ? values[p.variable] : p.text))
    .join('');
}
