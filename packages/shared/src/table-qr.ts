/** Extract the opaque table code only; scanned URLs are never navigated or fetched. */
export function tableCodeFromQr(value: string) {
  const text = value.trim();
  const valid = (code: string | null): code is string =>
    Boolean(code && /^[A-Za-z0-9_-]{16,64}$/.test(code));
  if (valid(text)) return text;
  try {
    const url = new URL(text, 'https://mesa.invalid');
    const code = url.searchParams.get('table');
    if (['http:', 'https:'].includes(url.protocol) && valid(code)) return code;
  } catch {
    /* Fall through to the useful validation error. */
  }
  throw new Error('Leia o QR Code da mesa ou cole o link completo recebido do estabelecimento.');
}
