/**
 * Ce que le proxy d'authentification accepte dans le corps d'une requête au modèle. Une liste de domaines accorde des
 * capacités : par `api.anthropic.com`, une injection pourrait faire lire des données à un serveur tiers, côté serveur
 * (`mcp_servers`, outil `web_fetch`, image ou document par URL), hors de portée de la sandbox. Tout champ non listé est
 * refusé : un champ nouveau de l'API donne un refus visible, pas une capacité silencieuse.
 */
export interface RequestPolicy {
  /** Champs admis à la racine du corps. */
  readonly bodyFields: readonly string[];
  readonly maxBodyBytes: number;
}

const INLINE_SOURCES: ReadonlySet<unknown> = new Set(['base64', 'text', 'content']);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Le type d'une source qui ferait lire le modèle hors du corps, dans ces blocs et ceux qu'ils contiennent. */
function outsideSource(blocks: unknown): string | null {
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks) {
    if (!isObject(block)) continue;
    if (block['type'] === 'image' || block['type'] === 'document') {
      const source = block['source'];
      const type = isObject(source) ? source['type'] : undefined;
      if (!INLINE_SOURCES.has(type)) return String(type);
    }
    const nested = outsideSource(block['content']);
    if (nested !== null) return nested;
  }
  return null;
}

/** La raison du refus, ou null. La raison ne porte aucun contenu du corps hors un nom de champ ou un type. */
export function refusalOf(body: string, policy: RequestPolicy): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 'body is not JSON';
  }
  if (!isObject(parsed)) return 'body is not a JSON object';
  for (const field of Object.keys(parsed))
    if (!policy.bodyFields.includes(field)) return `field refused: ${field}`;
  const tools = parsed['tools'];
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      const type = isObject(tool) ? tool['type'] : undefined;
      if (type !== undefined && type !== 'custom') return `tool type refused: ${String(type)}`;
    }
  }
  // Un message est un bloc dont `content` porte des blocs : le même parcours couvre les deux.
  for (const blocks of [parsed['system'], parsed['messages']]) {
    const source = outsideSource(blocks);
    if (source !== null) return `source type refused: ${source}`;
  }
  return null;
}
