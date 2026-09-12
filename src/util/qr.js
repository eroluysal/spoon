import QRCode from 'qrcode';

/** PNG QR code for an LPA activation string, as delivered inside the ZIP. */
export const qrPng = (payload) =>
  QRCode.toBuffer(payload, { type: 'png', errorCorrectionLevel: 'M', margin: 2, scale: 6 });

/**
 * The same QR code as a `data:` URL, handy for embedding in an HTML preview.
 *
 * @param {string} payload LPA activation string.
 * @returns {Promise<string>} `data:image/png;base64,...`
 */
export const qrDataUrl = (payload) =>
  QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, scale: 6 });
