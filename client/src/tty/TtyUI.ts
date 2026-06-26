/**
 * TtyUI — FabricFS 终端界面（客户端）
 *
 * 职责：
 *   基于 ClientUI 构建一个终端风格的 TTY 界面，
 *   通过 RemoteChannel 与服务端的 DebugShell 通信。
 *
 * 协议：
 *   客户端 → 服务端  { type: "tty-cmd", cmd: "..." }
 *   服务端 → 客户端  { type: "tty-result", result: ShellResult }
 *
 * 布局：
 *   UiScreen
 *     └─ UiBox (全屏黑底)
 *         ├─ UiScrollBox + UiText 行 (输出区, ~85% 高度)
 *         └─ UiBox + UiInput (底栏)
 *
 * 注意：
 *   Client API 将 anchor/position/size/color 声明为 readonly，
 *   需通过返回对象的可变属性（.x/.y/.r/.g/.b）修改，不可重新赋值。
 */

// ---- 类型 -------------------------------------------------------------------

interface TreeNode {
  name: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

// ---- 工具函数（绕过 readonly 声明）------------------------------------------

function setCoord2(
  target: { offset: Vec2; scale: Vec2 },
  offset: { x: number; y: number },
  scale: { x: number; y: number }
): void {
  target.offset.x = offset.x;
  target.offset.y = offset.y;
  target.scale.x = scale.x;
  target.scale.y = scale.y;
}

function setColor(
  target: { r: number; g: number; b: number },
  r: number,
  g: number,
  b: number
): void {
  target.r = r;
  target.g = g;
  target.b = b;
}

// ---- 终端颜色 ---------------------------------------------------------------

const COLOR_PROMPT = Vec3.create({ r: 0, g: 220, b: 80 });
const COLOR_OUTPUT = Vec3.create({ r: 210, g: 210, b: 210 });
const COLOR_ERROR = Vec3.create({ r: 255, g: 80, b: 80 });
const COLOR_INFO = Vec3.create({ r: 60, g: 180, b: 255 });
const COLOR_DIM = Vec3.create({ r: 100, g: 100, b: 100 });

// ---- TTY UI 类 --------------------------------------------------------------

export class TtyUI {
  private scrollBox!: UiScrollBox;
  private inputField!: UiInput;
  private bg!: UiBox;
  private inputBg!: UiBox;
  private lines: UiText[] = [];

  private readonly LINE_HEIGHT = 20;
  private readonly MAX_LINES = 500;
  private scrollBoxHeight = 0;

  constructor() {
    this.buildUI();
    this.setupRemoteChannel();
    this.setupInput();

    this.appendLine('FabricFS TTY v0.1 — 输入 "help" 查看命令', COLOR_INFO);

    setTimeout(() => this.inputField.focus(), 200);

    screen.events.on('resize', (e) => {
      this.scrollBoxHeight = e.screenHeight - 82;
      this.inputBg.position.offset.y = e.screenHeight - 32;
    });
  }

  // ---- UI 构建 ---------------------------------------------------------------

  private buildUI(): void {
    this.scrollBoxHeight = screenHeight - 82;

    // 全屏背景 — 直接挂 ui 下（ui 是引擎默认屏幕的根节点，确保在渲染树中）
    this.bg = UiBox.create();
    this.bg.parent = ui;
    this.bg.anchor.x = 0;
    this.bg.anchor.y = 0;
    setCoord2(this.bg.size, { x: 0, y: 0 }, { x: 1, y: 1 });
    setColor(this.bg.backgroundColor, 12, 12, 12);
    this.bg.backgroundOpacity = 0.95;
    this.bg.zIndex = 999;

    // 输出区滚动框（顶部留 50px 给 dock，底部留 32px 给 input）
    this.scrollBox = UiScrollBox.create();
    this.scrollBox.parent = this.bg;
    this.scrollBox.anchor.x = 0;
    this.scrollBox.anchor.y = 0;
    setCoord2(this.scrollBox.position, { x: 0, y: 0 }, { x: 0, y: 0 });
    setCoord2(this.scrollBox.size, { x: 0, y: -32 }, { x: 1, y: 1 });
    setColor(this.scrollBox.backgroundColor, 12, 12, 12);
    this.scrollBox.backgroundOpacity = 0;
    this.scrollBox.zIndex = 1000;
    this.scrollBox.pointerEventBehavior = PointerEventBehavior.ENABLE;

    // 输入栏底条（贴底）
    this.inputBg = UiBox.create();
    this.inputBg.parent = this.bg;
    this.inputBg.anchor.x = 0;
    this.inputBg.anchor.y = 0;
    this.inputBg.position.offset.x = 0;
    this.inputBg.position.offset.y = screenHeight - 32;
    this.inputBg.position.scale.x = 0;
    this.inputBg.position.scale.y = 0;
    this.inputBg.size.offset.x = 0;
    this.inputBg.size.offset.y = 32;
    this.inputBg.size.scale.x = 1;
    this.inputBg.size.scale.y = 0;
    setColor(this.inputBg.backgroundColor, 24, 24, 24);
    this.inputBg.backgroundOpacity = 1;
    this.inputBg.zIndex = 1000;
    this.inputBg.pointerEventBehavior = PointerEventBehavior.BLOCK_PASS_THROUGH;

    // 顶部分隔线
    const sep = UiBox.create();
    sep.parent = this.inputBg;
    sep.anchor.x = 0;
    sep.anchor.y = 0;
    setCoord2(sep.position, { x: 0, y: 0 }, { x: 0, y: 0 });
    setCoord2(sep.size, { x: 0, y: 1 }, { x: 1, y: 0 });
    setColor(sep.backgroundColor, 50, 50, 50);
    sep.backgroundOpacity = 1;

    // 输入框
    this.inputField = UiInput.create();
    this.inputField.parent = this.inputBg;
    this.inputField.anchor.x = 0;
    this.inputField.anchor.y = 0;
    setCoord2(this.inputField.position, { x: 6, y: 4 }, { x: 0, y: 0 });
    setCoord2(this.inputField.size, { x: -12, y: -8 }, { x: 1, y: 1 });
    this.inputField.placeholder = '输入命令...';
    setColor(this.inputField.textColor, 0, 220, 80);
    setColor(this.inputField.placeholderColor, 170, 170, 170);
    this.inputField.textFontFamily = UITextFontFamily.CodeNewRomanBold;
    this.inputField.textFontSize = 14;
    this.inputField.textXAlignment = 'Left';
    setColor(this.inputField.backgroundColor, 24, 24, 24);
    this.inputField.backgroundOpacity = 0;
  }

  // ---- 输入处理 --------------------------------------------------------------

  private setupInput(): void {
    // 方式1：轮询检测输入文本中的换行符（部分平台 Enter → \n）
    setInterval(() => {
      const text = this.inputField.textContent;
      if (text.includes('\n')) {
        const parts = text.split('\n');
        const cmd = parts[0].trim();
        this.inputField.textContent = parts.slice(1).join('\n');
        if (cmd) this.executeCommand(cmd);
      }
    }, 150);

    // 方式2：失焦时捕获（部分平台 Enter → blur）
    this.inputField.events.on('blur', () => {
      const text = this.inputField.textContent.trim();
      if (text) {
        this.inputField.textContent = '';
        this.executeCommand(text);
      }
    });
  }

  private executeCommand(cmd: string): void {
    this.appendLine(`$ ${cmd}`, COLOR_PROMPT);
    remoteChannel.sendServerEvent({ type: 'tty-cmd', cmd });
    setTimeout(() => this.inputField.focus(), 50);
  }

  // ---- 远程通信 --------------------------------------------------------------

  private setupRemoteChannel(): void {
    remoteChannel.onClientEvent((args: unknown) => {
      const msg = args as Record<string, unknown>;
      if (msg?.type !== 'tty-result') return;

      const result = msg.result as {
        ok: boolean;
        data?: unknown;
        error?: string;
      };

      if (result.ok) {
        this.printResult(result.data);
      } else {
        this.appendLine(`✗ ${result.error ?? 'unknown error'}`, COLOR_ERROR);
      }
    });
  }

  // ---- 结果渲染（匹配 Cli.ts 的输出格式）------------------------------------

  private printResult(data: unknown): void {
    if (data === null) return;

    if (typeof data === 'string') {
      for (const line of data.split('\n')) {
        this.appendLine(line, COLOR_OUTPUT);
      }
    } else if (Array.isArray(data)) {
      if (data.length === 0) {
        this.appendLine('(empty)', COLOR_DIM);
        return;
      }
      const first = data[0];
      if (first && typeof first === 'object' && 'isDir' in first) {
        // ls 结果：{ name, isDir }[] → "name/  name/  file"
        const line = (data as { name: string; isDir: boolean }[])
          .map((e) => (e.isDir ? `${e.name}/` : e.name))
          .join('  ');
        this.appendLine(line, COLOR_OUTPUT);
      } else if (first && typeof first === 'object' && 'children' in first) {
        // tree 结果：TreeNode[]
        this.printTreeLines(data as TreeNode[], '');
      } else if (typeof first === 'string') {
        // 普通字符串数组（help → 命令名列表）
        for (const item of data) {
          this.appendLine(String(item), COLOR_OUTPUT);
        }
      } else {
        // 其他对象数组
        for (const item of data) {
          if (typeof item === 'object' && item !== null) {
            this.appendLine(JSON.stringify(item), COLOR_OUTPUT);
          } else {
            this.appendLine(String(item), COLOR_OUTPUT);
          }
        }
      }
    } else if (typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if ('type' in obj && typeof obj.type === 'string') {
        // stat 结果
        this.printStatLines(obj);
      } else if ('from' in obj && 'to' in obj) {
        // mv / cd 结果
        this.appendLine(`${String(obj.from)} → ${String(obj.to)}`, COLOR_INFO);
      } else if ('path' in obj && 'text' in obj) {
        // echo > 结果
        this.appendLine(`→ written ${String(obj.path)}`, COLOR_INFO);
      } else {
        this.appendLine(JSON.stringify(obj, null, 2), COLOR_OUTPUT);
      }
    } else {
      this.appendLine(String(data), COLOR_OUTPUT);
    }
  }

  private printStatLines(st: Record<string, unknown>): void {
    const typeStr = st.type === 'dir' ? 'd' : '-';
    const mode = Number(st.mode) || 0;
    const modeStr =
      ((mode >> 6) & 7).toString(8) +
      ((mode >> 3) & 7).toString(8) +
      (mode & 7).toString(8);
    this.appendLine(
      `${typeStr}${modeStr}  ${String(st.nlinks ?? '?')}  ${String(st.uid ?? '?')}:${String(st.gid ?? '?')}`,
      COLOR_OUTPUT
    );
    this.appendLine(`  size: ${String(st.size ?? 0)}`, COLOR_OUTPUT);
    this.appendLine(
      `  atime: ${new Date(Number(st.atime) || 0).toISOString()}`,
      COLOR_DIM
    );
    this.appendLine(
      `  mtime: ${new Date(Number(st.mtime) || 0).toISOString()}`,
      COLOR_DIM
    );
    this.appendLine(
      `  ctime: ${new Date(Number(st.ctime) || 0).toISOString()}`,
      COLOR_DIM
    );
  }

  private printTreeLines(nodes: TreeNode[], prefix: string): void {
    for (let i = 0; i < nodes.length; i++) {
      const isLast = i === nodes.length - 1;
      const connector = isLast ? '└─ ' : '├─ ';
      this.appendLine(`${prefix}${connector}${nodes[i].name}`, COLOR_OUTPUT);
      if (nodes[i].children) {
        this.printTreeLines(
          nodes[i].children!,
          prefix + (isLast ? '   ' : '│  ')
        );
      }
    }
  }

  // ---- 行管理 ----------------------------------------------------------------

  private appendLine(text: string, color: Vec3): void {
    const idx = this.lines.length;
    const yPos = idx * this.LINE_HEIGHT;

    const line = UiText.create();
    line.parent = this.scrollBox;
    line.textContent = text;
    line.textFontFamily = UITextFontFamily.CodeNewRomanBold;
    line.textFontSize = 14;
    line.textXAlignment = 'Left';
    line.textYAlignment = 'Top';
    line.autoWordWrap = true;
    line.pointerEventBehavior =
      PointerEventBehavior.DISABLE_AND_BLOCK_PASS_THROUGH;

    // 颜色
    line.textColor.r = color.r;
    line.textColor.g = color.g;
    line.textColor.b = color.b;

    // 位置 & 尺寸（通过 .x/.y 绕过 readonly）
    line.anchor.x = 0;
    line.anchor.y = 0;
    setCoord2(line.position, { x: 8, y: yPos }, { x: 0, y: 0 });
    setCoord2(line.size, { x: -16, y: this.LINE_HEIGHT }, { x: 1, y: 0 });

    this.lines.push(line);

    // 裁剪过旧行
    if (this.lines.length > this.MAX_LINES) {
      const excess = this.lines.length - this.MAX_LINES;
      const removed = this.lines.splice(0, excess);
      for (const r of removed) {
        r.parent = undefined;
      }
      // 重算剩余行的 Y 位置
      for (let i = 0; i < this.lines.length; i++) {
        setCoord2(
          this.lines[i].position,
          { x: 8, y: i * this.LINE_HEIGHT },
          { x: 0, y: 0 }
        );
      }
    }

    // 自动滚到底部
    const totalContent = this.lines.length * this.LINE_HEIGHT;
    if (totalContent > this.scrollBoxHeight) {
      this.scrollBox.scrollPosition.y =
        totalContent - this.scrollBoxHeight + this.LINE_HEIGHT;
    }
  }

  // ---- 公开方法 --------------------------------------------------------------

  setVisible(v: boolean): void {
    this.bg.visible = v;
  }

  destroy(): void {
    this.bg.parent = undefined;
  }
}
