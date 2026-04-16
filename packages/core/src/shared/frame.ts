export function stripOptPrefix(name: string): string {
  return name.replace(/^[*~]/, '');
}
