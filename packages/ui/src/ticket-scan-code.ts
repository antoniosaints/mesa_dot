/** Fichas emitidas pelo sistema usam um token HMAC base64url de 43 caracteres. */
export function normalizeTicketScan(value: string) {
  return value.trim().replace(/^\](?:C[01]|Q[1-6])/, '');
}
export function isCompleteTicketScan(value: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(normalizeTicketScan(value));
}
export function cameraErrorMessage(error: unknown) {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (['NotAllowedError', 'PermissionDeniedError'].includes(name))
    return 'Acesso à câmera não autorizado. Permita o uso da câmera no navegador ou use o leitor físico.';
  if (['NotFoundError', 'DevicesNotFoundError'].includes(name))
    return 'Nenhuma câmera encontrada. Conecte uma câmera ou use o leitor físico.';
  if (['NotReadableError', 'TrackStartError'].includes(name))
    return 'Não foi possível abrir a câmera. Confira se ela está em uso por outro aplicativo.';
  return 'Não foi possível iniciar a câmera. Confira a permissão e tente novamente, ou use o leitor físico.';
}
