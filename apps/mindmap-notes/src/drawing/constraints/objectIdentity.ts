/** Condition/recognition IDs are opaque and may contain ':'; drawing object
 * IDs reserve ':' for subobject references. Escape '%' too to avoid collisions.
 * Ordinary legacy UUIDs keep their existing generated object IDs. */
export function constraintObjectId(set:string,kind:'curve'|'round'|'body',source:string) {
  return `${set}-${kind}-${source.replace(/[%:]/g,c=>c==='%'?'%25':'%3A')}`;
}
