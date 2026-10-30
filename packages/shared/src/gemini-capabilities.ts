/** Documented GenerateContent image-output models. Listing an input-capable model is not proof of image output. */
const imageModels = new Set([
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image',
  'gemini-3-pro-image-preview',
  'gemini-nano-banana-2.1',
  'gemini-3.1-flash-lite-image',
]);
export const geminiSupportsImages = (model: unknown) => imageModels.has(String(model ?? ''));
