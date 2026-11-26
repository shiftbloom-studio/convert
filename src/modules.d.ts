// Non-code modules that Wrangler bundles (see "rules" in wrangler.jsonc).
declare module "*.html" {
  const text: string;
  export default text;
}
declare module "*.txt" {
  const text: string;
  export default text;
}
declare module "*.client.js" {
  const text: string;
  export default text;
}
declare module "*.png" {
  const data: ArrayBuffer;
  export default data;
}
