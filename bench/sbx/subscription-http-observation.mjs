import { subscriptionHttpControlFamily } from './subscription-metadata.mjs';

// Admission may stop at the first control. Inventory the names in the same response
// independently, without reading a header value or retaining a provider-supplied name.
export function observeSubscriptionHttpControls(headers) {
  if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) return ['invalid_headers'];
  const families = new Set();
  for (const name of Object.keys(headers)) {
    const family = subscriptionHttpControlFamily(name.toLowerCase());
    if (family !== undefined) families.add(family);
  }
  return [...families].sort();
}
