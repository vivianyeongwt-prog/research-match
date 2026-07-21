/** Read a required server setting with a clear startup error instead of `undefined!`. */
export function requiredServerSetting(
  name: string,
  env: Record<string, string | undefined> = process.env
) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}
