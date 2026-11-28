// Ce que Plan apporte au reçu d'admission de Step (journal, §125) : le manifeste re-dérivé des trois sources, son
// approbation, et les deux revues indépendantes d'un Plan revu. Le reste (dossier, arbre, lanceur, spécimens) est
// vérifié par l'émetteur de `@architect-os/sandbox`.
import { parsePlanApproval } from '@architect-os/contracts';
import type { preparePlan } from './prepare.js';

type Draft = ReturnType<typeof preparePlan>;

/** Le Plan approuvé, dans la forme que l'émetteur atteste. */
export interface AdmissionPlan {
  readonly manifest: Draft['manifest'] & {
    readonly version: 1;
    readonly source_sha256: Draft['manifest']['source_sha256'] & { readonly reviewed_plan: string };
  };
  readonly approval_sha256: string;
  readonly define: { readonly sha256: string; readonly review: Review };
  readonly plan: {
    readonly sha256: string;
    readonly define_sha256: string;
    readonly raw_receipt_sha256: string;
    readonly review: Review;
  };
}
type Review = NonNullable<Draft['independent_reviews']>['define'];

/**
 * Le Plan que la décision approuve, s'il a été revu par deux acteurs indépendants ; lève `ADMIT_REVIEWED_PLAN_REQUIRED`
 * pour une proposition sans revue, `ADMIT_NOT_APPROVED` pour une décision illisible, autre ou malformée.
 */
export function approvedReviewedPlan(draft: Draft, readDecision: () => string): AdmissionPlan {
  const { manifest, approval_sha256, independent_reviews: reviews } = draft;
  if (!reviews) throw new Error('ADMIT_REVIEWED_PLAN_REQUIRED');
  // `preparePlan` sets the reviews and this digest from the same reviewed receipt: one is never without the other.
  const reviewed = manifest.source_sha256.reviewed_plan as string;
  let approved = false;
  try {
    approved = parsePlanApproval(JSON.parse(readDecision())).approval_sha256 === approval_sha256;
  } catch {
    // Absente, pas du JSON, ou pas une décision d'approbation.
  }
  if (!approved) throw new Error('ADMIT_NOT_APPROVED');
  const define = manifest.source_sha256.define;
  return {
    manifest: {
      ...manifest,
      version: 1,
      source_sha256: { ...manifest.source_sha256, reviewed_plan: reviewed },
    },
    approval_sha256,
    define: { sha256: define, review: reviews.define },
    plan: {
      sha256: manifest.source_sha256.proposal,
      define_sha256: define,
      raw_receipt_sha256: reviewed,
      review: reviews.plan,
    },
  };
}
