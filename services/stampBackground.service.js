const sharp = require('sharp');

// Un tampon photographié sur une feuille tient largement dans cette taille, et la borne
// évite de traiter inutilement des photos de 12 mégapixels.
const MAX_DIMENSION = 1400;

// Épaisseur de la couronne de bord servant à estimer la couleur du papier, en fraction
// de la plus petite dimension. Le tampon est au centre, le bord est donc du papier.
const BORDER_RATIO = 0.06;

/** Distance euclidienne entre deux couleurs RGB. */
const colorDistance = (r1, g1, b1, r2, g2, b2) => Math.sqrt(
  (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2,
);

const percentile = (sortedValues, ratio) => {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.round(ratio * (sortedValues.length - 1))));
  return sortedValues[index];
};

/**
 * Ajuste un plan c = a·x + b·y + d par moindres carrés sur les échantillons fournis.
 * Résout le système normal 3×3 par élimination de Gauss.
 */
const fitPlane = (samples, valueIndex) => {
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, sn = 0;
  let sxv = 0, syv = 0, sv = 0;

  for (const sample of samples) {
    const [x, y] = sample;
    const v = sample[valueIndex];
    sxx += x * x; sxy += x * y; sx += x;
    syy += y * y; sy += y; sn += 1;
    sxv += x * v; syv += y * v; sv += v;
  }

  const matrix = [
    [sxx, sxy, sx, sxv],
    [sxy, syy, sy, syv],
    [sx, sy, sn, sv],
  ];

  for (let col = 0; col < 3; col += 1) {
    let pivotRow = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivotRow][col])) pivotRow = row;
    }
    if (Math.abs(matrix[pivotRow][col]) < 1e-9) {
      // Système dégénéré (image d'un pixel de large, par exemple) : plan constant
      return { a: 0, b: 0, d: sn ? sv / sn : 0 };
    }
    [matrix[col], matrix[pivotRow]] = [matrix[pivotRow], matrix[col]];

    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = matrix[row][col] / matrix[col][col];
      for (let k = col; k < 4; k += 1) matrix[row][k] -= factor * matrix[col][k];
    }
  }

  return {
    a: matrix[0][3] / matrix[0][0],
    b: matrix[1][3] / matrix[1][1],
    d: matrix[2][3] / matrix[2][2],
  };
};

/**
 * Modélise le papier par un plan de couleur ajusté sur la couronne de bord de l'image.
 * Une couleur unique ne suffirait pas : une photo prise au téléphone est presque toujours
 * éclairée de biais, et le dégradé qui en résulte serait pris pour de l'encre du côté clair.
 */
const estimatePaperPlane = (pixels, width, height, channels) => {
  const border = Math.max(2, Math.round(Math.min(width, height) * BORDER_RATIO));
  const samples = [];

  // Un pixel sur deux suffit largement et divise par quatre le coût de l'ajustement
  for (let y = 0; y < height; y += 2) {
    const onHorizontalBand = y < border || y >= height - border;
    for (let x = 0; x < width; x += 2) {
      if (!onHorizontalBand && x >= border && x < width - border) continue;
      const offset = (y * width + x) * channels;
      samples.push([x, y, pixels[offset], pixels[offset + 1], pixels[offset + 2]]);
    }
  }

  return {
    r: fitPlane(samples, 2),
    g: fitPlane(samples, 3),
    b: fitPlane(samples, 4),
  };
};

const planeValueAt = (plane, x, y) => plane.a * x + plane.b * y + plane.d;

/**
 * Détoure un tampon photographié sur une feuille et renvoie un PNG à fond transparent.
 *
 * Le principe : la feuille occupe l'essentiel de l'image et forme une couleur dominante ;
 * l'encre s'en écarte nettement. On mesure l'écart de chaque pixel à la couleur du papier
 * et on en fait le canal alpha, avec une transition douce pour conserver les bords
 * anti-crénelés du tampon plutôt que de produire un contour en escalier.
 *
 * Les seuils sont dérivés de l'image elle-même : le bruit du papier fixe le plancher,
 * la densité de l'encre le plafond. Une photo sous-exposée ou un scan très propre sont
 * donc traités avec la même fonction.
 *
 * @param {Buffer} input image d'origine (JPEG, PNG, HEIC…)
 * @returns {Promise<{buffer: Buffer, width: number, height: number, inkRatio: number}>}
 */
const removeStampBackground = async (input) => {
  const prepared = sharp(input, { failOn: 'error' })
    .rotate() // respecte l'orientation EXIF des photos prises au téléphone
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb');

  const { data: pixels, info } = await prepared
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const paper = estimatePaperPlane(pixels, width, height, channels);

  // Écart de chaque pixel au papier attendu à sa position : cette distribution donne
  // le bruit de fond et la densité d'encre
  const pixelCount = width * height;
  const distances = new Float32Array(pixelCount);
  for (let y = 0; y < height; y += 1) {
    const paperR = planeValueAt(paper.r, 0, y);
    const paperG = planeValueAt(paper.g, 0, y);
    const paperB = planeValueAt(paper.b, 0, y);
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * channels;
      distances[index] = colorDistance(
        pixels[offset], pixels[offset + 1], pixels[offset + 2],
        paperR + paper.r.a * x, paperG + paper.g.a * x, paperB + paper.b.a * x,
      );
    }
  }

  const sorted = Float32Array.from(distances).sort();
  const noiseFloor = percentile(sorted, 0.6);   // le papier domine largement l'image
  const inkLevel = percentile(sorted, 0.995);   // l'encre la plus dense

  // Seuils : en dessous du plancher tout est transparent, au-dessus du plafond tout est opaque.
  // Les bornes minimales évitent de détourer du vide sur une feuille parfaitement uniforme.
  const low = Math.max(noiseFloor + 12, 18);
  const high = Math.max(low + 24, inkLevel * 0.55);

  const output = Buffer.alloc(pixelCount * 4);
  let inkPixels = 0;
  const clamp255 = (value) => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const source = index * channels;
      const target = index * 4;

      const alpha = Math.max(0, Math.min(1, (distances[index] - low) / (high - low)));
      if (alpha > 0.5) inkPixels += 1;

      if (alpha === 0) {
        output[target + 3] = 0;
        continue;
      }

      // Sur les bords anti-crénelés, le pixel photographié est déjà un mélange d'encre et de
      // papier. Le recomposer tel quel avec un alpha partiel remélangerait du papier une
      // seconde fois et donnerait un halo grisâtre. On retrouve donc la couleur d'encre pure
      // en annulant ce premier mélange (démultiplication), avec un plancher sur alpha pour
      // ne pas amplifier le bruit des pixels quasi transparents.
      const safeAlpha = Math.max(alpha, 0.25);
      const paperR = planeValueAt(paper.r, x, y);
      const paperG = planeValueAt(paper.g, x, y);
      const paperB = planeValueAt(paper.b, x, y);

      output[target] = clamp255(paperR + (pixels[source] - paperR) / safeAlpha);
      output[target + 1] = clamp255(paperG + (pixels[source + 1] - paperG) / safeAlpha);
      output[target + 2] = clamp255(paperB + (pixels[source + 2] - paperB) / safeAlpha);
      output[target + 3] = Math.round(alpha * 255);
    }
  }

  const buffer = await sharp(output, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { buffer, width, height, inkRatio: inkPixels / pixelCount };
};

module.exports = {
  removeStampBackground,
  estimatePaperPlane,
  MAX_DIMENSION,
};
