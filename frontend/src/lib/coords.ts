/**
 * Quoridor-style algebraic notation, scaled to any board size.
 * Files a,b,c… left-to-right; ranks size..1 bottom-to-top (White-side view).
 * Moves: "e2". Walls: "e4h" / "e4v" (slot at the cell's top-left groove).
 */
export function cellName(r: number, c: number, size: number): string {
  const file = String.fromCharCode(97 + c);
  return `${file}${size - r}`;
}

export function wallName(r: number, c: number, o: 'h' | 'v', size: number): string {
  return `${cellName(r, c, size)}${o}`;
}

export function actionName(
  a: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } },
  size: number,
): string {
  return a.type === 'move' ? cellName(a.to.r, a.to.c, size) : wallName(a.wall.r, a.wall.c, a.wall.orientation, size);
}

/** "1. e2 e7 2. e3 ..." single-line export. */
export function lineNotation(
  actions: ({ type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } })[],
  size: number,
): string {
  const parts: string[] = [];
  actions.forEach((a, i) => {
    if (i % 2 === 0) parts.push(`${Math.floor(i / 2) + 1}.`);
    parts.push(actionName(a, size));
  });
  return parts.join(' ');
}
