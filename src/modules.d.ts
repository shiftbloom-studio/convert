// Text modules that Wrangler bundles (see "rules" in wrangler.jsonc).
declare module "*.html" {
  const text: string;
  export default text;
}
declare module "*.txt" {
  const text: string;
  export default text;
}
