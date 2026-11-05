import { z } from 'zod';

/** An identifier of the registry (task, call): printable, bounded. */
export const IdSchema = z.string().regex(/^[\x21-\x7e]{1,200}$/);
