(function () {
  const TARGET_BYTES = 3.2 * 1024 * 1024;
  const MAX_DIMENSION = 1800;

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Could not process ${file.name}. Please use JPG, PNG, or WebP.`));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function prepareImageForUpload(file) {
    if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`);
    if (file.size <= TARGET_BYTES) return file;

    const img = await loadImage(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const outputType = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    let blob = null;
    for (const quality of [0.82, 0.7, 0.58, 0.46]) {
      blob = await canvasToBlob(canvas, outputType, quality);
      if (blob && blob.size <= TARGET_BYTES) break;
    }

    if (!blob || blob.size > TARGET_BYTES) {
      throw new Error(`${file.name} is still too large after optimization.`);
    }

    const extension = outputType === 'image/webp' ? '.webp' : '.jpg';
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}${extension}`, { type: outputType, lastModified: Date.now() });
  }

  window.prepareImageForUpload = prepareImageForUpload;
})();
