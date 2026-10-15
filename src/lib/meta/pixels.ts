// Known Meta pixels per brand. Surfaced as one-click presets in the uploader
// and Settings so you don't have to remember/paste the IDs. adAccountId is the
// ad account the brand advertises from — the header switcher offers each
// pixel as "account · brand" and sets both in one click.
export interface KnownPixel {
  label: string;
  id: string;
  adAccountId?: string;
}

export const KNOWN_PIXELS: KnownPixel[] = [
  { label: "ApotekHunden", id: "1485774658810931", adAccountId: "act_261297039993717" },
  { label: "DogDivaCO", id: "3401593933335351", adAccountId: "act_2277004866371824" },
  { label: "LowTide", id: "1428308319260195", adAccountId: "act_2277004866371824" },
  { label: "PepDyne", id: "1118413380556546", adAccountId: "act_2277004866371824" },
];

/** Brand label for a pixel id, if it's one of the known pixels. */
export function pixelLabel(id?: string | null): string | undefined {
  if (!id) return undefined;
  return KNOWN_PIXELS.find((p) => p.id === id)?.label;
}
