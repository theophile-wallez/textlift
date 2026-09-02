/** esbuild loads a stylesheet of the shadow root as text, not as a page style. */
declare module "*.css" {
  const contents: string;
  export default contents;
}
