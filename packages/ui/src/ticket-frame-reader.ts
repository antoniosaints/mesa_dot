/** QR and Code 128 decoding shared by management and waiter cameras.
 * Does not depend on the browser's optional BarcodeDetector API. */
export async function createTicketFrameReader() {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }, { default: jsQR }] =
    await Promise.all([import('@zxing/browser'), import('@zxing/library'), import('jsqr')]);
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]]]);
  const reader = new BrowserMultiFormatReader(hints);
  return (canvas: HTMLCanvasElement, pixels: ImageData) => {
    const qr = jsQR(pixels.data, canvas.width, canvas.height, {
      inversionAttempts: 'attemptBoth',
    })?.data;
    if (qr) return qr;
    try {
      return reader.decodeFromCanvas(canvas).getText();
    } catch {
      return undefined; /* No barcode in this frame. */
    }
  };
}
