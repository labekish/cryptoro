import fs from 'node:fs';

export function loadLegacyPage(filename: string) {
  const html = fs.readFileSync(filename, 'utf-8');

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const descriptionMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']\s*\/?\s*>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)]
    .map((m) => m[0])
    .join('\n');

  return {
    title: titleMatch?.[1]?.trim() ?? 'CRYPTORO',
    description: descriptionMatch?.[1]?.trim() ?? '',
    styles,
    body: bodyMatch?.[1] ?? ''
  };
}
