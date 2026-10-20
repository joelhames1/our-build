/**
 * A friendly approximation of the sun's path (good enough for pleasant lighting, not for solar
 * studies). Returns a unit direction toward the sun in three.js coordinates.
 */
export function sunDirection(hour: number, latitude: number, northDeg: number): { dir: [number, number, number]; elevation: number } {
  const dayLen = 14; // a long-ish summer day
  const sunrise = 12 - dayLen / 2;
  const t = Math.max(0, Math.min(1, (hour - sunrise) / dayLen));
  const maxElev = Math.min(80, 90 - Math.abs(latitude) + 18);
  const elevation = Math.max(4, maxElev * Math.sin(Math.PI * t));
  // Azimuth from north, clockwise: east at sunrise, south at noon (northern hemisphere), west at sunset.
  const az = 90 + 180 * t;
  const azPlan = ((az - northDeg) * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const px = Math.sin(azPlan) * Math.cos(el);
  const py = Math.cos(azPlan) * Math.cos(el);
  const pz = Math.sin(el);
  return { dir: [px, pz, -py], elevation };
}

/** Warm at the ends of the day, neutral at midday. */
export function sunColor(elevation: number): string {
  if (elevation < 10) return '#ffb37a';
  if (elevation < 22) return '#ffd2a1';
  return '#fff4e5';
}
