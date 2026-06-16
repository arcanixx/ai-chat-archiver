export function repairFences(md: string): { text: string; fixed: boolean } {
  const lines = md.split('\n');
  let open = 0;
  for (const line of lines) {
    if (/^\s*```/.test(line)) open++;
  }
  if (open % 2 === 1) {
    return { text: md + "\n```\n", fixed: true };
  }
  return { text: md, fixed: false };
}
