import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

// 本地 lint 复现审查方工具链（2026-10-22 上架整改）：
// ① obsidianmd 官方规则集（社区审查方实际跑的规则，configs.recommended 为 flat config 数组）
// ② typescript-eslint 类型感知模式（projectService）——不开会漏扫
//    no-unsafe-* / no-floating-promises / no-misused-promises 整批
export default tseslint.config(
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
