/** Le minuteur réel : lance `fire` après `ms`, sauf si la fonction rendue est appelée avant. */
export const timer = (fire: () => void, ms: number): (() => void) => {
  const handle = setTimeout(fire, ms);
  return () => clearTimeout(handle);
};
