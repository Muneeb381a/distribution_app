/** Turn a chosen photo into a small square JPEG data URL (centre-cropped), small enough to store on the user. */
export async function pictureFromFile(file: File, size = 256, maxChars = 60_000): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a picture file');
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('This picture could not be read'); });
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  for (const q of [0.88, 0.78, 0.68, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length <= maxChars) return url;
  }
  throw new Error('This picture is too detailed, try another one');
}

/**
 * Shrinks a photo (a signed slip, say) so its longest side is at most `maxSide` and saves it as a JPEG data URL.
 * The quality drops until it fits `maxChars`, so a big phone photo of 5 MB ends up a few hundred KB.
 */
export async function photoFromFile(file: File, maxSide = 1600, maxChars = 1_800_000): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a picture');
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('This picture could not be read'); });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length <= maxChars) return url;
  }
  throw new Error('This picture is too detailed, try a smaller one');
}
