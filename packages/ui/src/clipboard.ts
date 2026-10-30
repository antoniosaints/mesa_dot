/** Keep copy actions usable on local HTTP installations as well as HTTPS. */
export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      /* Try the focused-page fallback. */
    }
  }
  const previous = document.activeElement as HTMLElement | null;
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('aria-hidden', 'true');
  Object.assign(field.style, { position: 'fixed', opacity: '0', width: '1px', height: '1px' });
  // Append inside the active dialog so its focus trap does not intercept the fallback.
  (previous?.closest('[role="dialog"]') ?? document.body).append(field);
  try {
    field.select();
    if (!document.execCommand('copy'))
      throw new Error('Não foi possível copiar. Selecione e copie os dados exibidos.');
  } finally {
    field.remove();
    previous?.focus();
  }
}
