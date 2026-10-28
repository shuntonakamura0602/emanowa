export const FEATURED_WORLD_SLUG = "2027" as const;

export const BASIC_WOOD_DESIGN = {
  id: "basic_wood",
  name: "無料の標準絵馬",
  isFree: true,
} as const;

export type WorldState = "preview" | "open" | "archived";

export type WorldConfig = {
  slug: string;
  name: string;
  state: WorldState;
  postingEnabled: boolean;
  width: 1000;
  height: 1000;
  opensAt: string;
  closesAt: string;
  displayTimeZone: "Asia/Tokyo";
  initialCenter: { x: number; y: number };
  designIds: readonly [typeof BASIC_WOOD_DESIGN.id];
};

/**
 * Stage A's fixed development configuration. Stage B moves mutable world state
 * and posting availability into Postgres; callers must not treat this object as
 * production persistence.
 */
export const WORLD_2027 = {
  slug: FEATURED_WORLD_SLUG,
  name: "2027年のえまのわ",
  state: "preview",
  postingEnabled: true,
  width: 1000,
  height: 1000,
  opensAt: "2026-12-19T15:00:00.000Z",
  closesAt: "2027-12-31T15:00:00.000Z",
  displayTimeZone: "Asia/Tokyo",
  initialCenter: { x: 500, y: 500 },
  designIds: [BASIC_WOOD_DESIGN.id],
} as const satisfies WorldConfig;

const WORLDS_BY_SLUG: Readonly<Record<string, WorldConfig>> = {
  [WORLD_2027.slug]: WORLD_2027,
};

export function getWorldConfig(slug: string): WorldConfig | null {
  return WORLDS_BY_SLUG[slug] ?? null;
}

export function hasWorldConfig(slug: string): boolean {
  return getWorldConfig(slug) !== null;
}

export function listWorldConfigs(): readonly WorldConfig[] {
  return Object.values(WORLDS_BY_SLUG);
}
