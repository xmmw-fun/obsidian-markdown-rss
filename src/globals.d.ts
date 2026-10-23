/** 允许 TS 导入 .md 文件为字符串（用户使用手册经 esbuild text loader 内嵌进产物）。 */
declare module '*.md' {
  const content: string;
  export default content;
}
