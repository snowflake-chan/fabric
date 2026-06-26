// @ts-check
import tseslint from 'typescript-eslint';
/**
 * 基础规则
 * 数字代表规则的严格程度，0为关闭规则，1为警告（warn），2为错误（error）
 * - eslint规则：https://eslint.org/docs/latest/rules/
 * @type {Partial<import('eslint/rules').ESLintRules>}
 */
const baseRules = {
  // 禁止不必要的字符串连接
  'no-useless-concat': 2,

  // 偏好使用模板字符串
  'prefer-template': 1,

  // 禁止在catch块中使用与外部变量同名的变量
  'no-catch-shadow': 1,

  // 禁止在条件表达式中使用赋值语句
  'no-cond-assign': 1,

  // 禁止修改常量声明
  'no-const-assign': 2,

  // 禁止在对象字面量中使用重复的键名
  'no-dupe-keys': 2,

  // 禁止在函数参数中使用重复的参数名
  'no-dupe-args': 1,

  // 禁止使用eval()函数
  'no-eval': 1,

  // 禁止数字字面量中使用小数点，如 .5
  'no-floating-decimal': 1,

  // 禁止修改函数声明
  'no-func-assign': 2,

  // 禁止使用嵌套的三元表达式
  'no-nested-ternary': 1,

  // 禁止使用不必要的三元表达式
  'no-unneeded-ternary': 1,

  // 禁止在变量定义之前使用变量
  'no-use-before-define': 2,

  // 禁止在同一作用域内重新声明变量
  'no-redeclare': 2,

  // 禁止使用var声明变量
  'no-var': 2,

  // 要求立即执行函数表达式(IIFE)使用括号
  'wrap-iife': [2, 'inside'],

  // 启用严格模式
  strict: 2,

  // 要求使用严格等于操作符
  eqeqeq: 2,

  // 要求语句末尾使用分号
  semi: [1, 'always'],

  // 对void操作符的使用进行限制
  'no-void': [2, { allowAsStatement: true }],

  // 禁止使用多个空行
  'no-multiple-empty-lines': [1, { max: 6 }],

  // 关闭对console的限制
  'no-console': 0,

  // 关闭对重复类成员的限制
  'no-dupe-class-members': 0,

  // 关闭对函数参数重新赋值的限制
  'no-param-reassign': 0,

  // 关闭对每个文件中类数量的限制
  'max-classes-per-file': 0,

  // 关闭对特定语法的限制
  'no-restricted-syntax': 0,

  // 关闭对类方法是否使用this的检查
  'class-methods-use-this': 0,

  // 关闭对循环中使用await的限制
  'no-await-in-loop': 0,

  // 偏好解构赋值
  'prefer-destructuring': [
    2,
    { array: false, object: true },
    { enforceForRenamedProperties: false },
  ],
};

/**
 * TypeScript 规则
 * 数字代表规则的严格程度，0为关闭规则，1为警告（warn），2为错误（error）
 * - typescript-eslint规则：https://typescript-eslint.io/rules/
 * @type {Record<string, any>}
 */
export const typescriptRules = {
  // 警告未使用的变量，避免潜在的错误或代码冗余
  '@typescript-eslint/no-unused-vars': 1,

  // 强制类型导入的一致性，提高代码的可读性和维护性
  '@typescript-eslint/consistent-type-imports': 2,

  // 不限制使用 TypeScript 的特定注释，允许开发者使用特定的 TypeScript 功能
  '@typescript-eslint/ban-ts-comment': 0,

  // 不强制命名约定，允许开发者自由地命名变量和函数
  '@typescript-eslint/naming-convention': 0,

  // 不限制抛出字面量错误，允许开发者根据需要抛出错误
  '@typescript-eslint/no-throw-literal': 0,
};

/** 需要忽略的文件或目录 */
const ignoresArr = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.log/**',
  '**/types/**',
  '**/.vscode/**',
  '**/.husky/**',
  'dao3.config.json',
  '**/webpack.config.js',
  '**/tsconfig.json',
];

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...tseslint.configs.recommended.map((item) => {
    return { ignores: ignoresArr, ...item };
  }),
  {
    files: ['**/*.{ts,js,mjs,cjs,tsx,jsx}'],
    ignores: ignoresArr,
    rules: {
      ...baseRules,
      ...typescriptRules,
    },
  },
];
