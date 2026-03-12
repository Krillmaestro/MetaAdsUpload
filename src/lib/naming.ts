export function campaignName(params: {
  country?: string;
  product: string;
  type?: string;
  number?: number;
}) {
  const { country = "SE", product, type = "CT", number = 1 } = params;
  return `${country}_${product.toUpperCase()}_${type}_${number}`;
}

export function adsetName(params: {
  country?: string;
  product: string;
  audience: string;
  optimization?: string;
}) {
  const { country = "SE", product, audience, optimization = "Conv" } = params;
  return `${country}_${product}_${audience}_${optimization}`;
}

export function adName(params: {
  brand?: string;
  product: string;
  angle: string;
  hook?: string;
  format?: string;
}) {
  const { brand = "AH", product, angle, hook = "Hook1", format = "Reel" } = params;
  return `${brand}_${product}_${angle}_${hook}_${format}`;
}
