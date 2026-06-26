/**
 * TtyUI — FabricFS 终端界面（客户端）
 *
 * 浮动窗口式终端，支持关闭/显示切换。
 */

import find from '../../UiIndex';

interface TreeNode {
  name: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

interface LineEntry {
  text: string;
  color: Vec3;
}

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

function vec3ToHex(color: Vec3): string {
  const r = Math.round(color.r).toString(16).padStart(2, '0');
  const g = Math.round(color.g).toString(16).padStart(2, '0');
  const b = Math.round(color.b).toString(16).padStart(2, '0');
  return `${r}${g}${b}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const COLOR_PROMPT = Vec3.create({ r: 0, g: 220, b: 80 });
const COLOR_OUTPUT = Vec3.create({ r: 210, g: 210, b: 210 });
const COLOR_ERROR = Vec3.create({ r: 255, g: 80, b: 80 });
const COLOR_INFO = Vec3.create({ r: 60, g: 180, b: 255 });
const COLOR_DIM = Vec3.create({ r: 100, g: 100, b: 100 });

const W = 900; // 窗口宽度
const H = 560; // 窗口高度
const TITLE_H = 28;
const INPUT_H = 32;

export class TtyUI {
  private windowBg!: UiBox;
  private titleBar!: UiBox;
  private closeBtn!: UiText;
  private scrollBox!: UiScrollBox;
  private textDisplay!: UiText;
  private inputField!: UiInput;
  private pathLabel!: UiText;
  private inputBg!: UiBox;
  private lines: LineEntry[] = [];
  private cwd = '/';

  private readonly MAX_LINES = 500;
  private inputBusy = false;
  private _visible = true;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragWinX = 0;
  private dragWinY = 0;
  private dragging = false;

  constructor() {
    this.buildUI();
    this.setupDrag();
    this.setupClose();
    this.setupRemoteChannel();
    this.setupInput();
    this.appendLine('FabricFS TTY v0.1 — 输入 "help" 查看命令', COLOR_INFO);
    setTimeout(() => this.inputField.focus(), 200);
  }

  // ---- UI ----------------------------------------------------------------

  private buildUI(): void {
    // 窗口背景
    this.windowBg = UiBox.create();
    this.windowBg.parent = UiScreen.getAllScreen().find(
      (e) => e.name === 'screen'
    );
    this.windowBg.anchor.x = 0;
    this.windowBg.anchor.y = 0;
    setCoord2(this.windowBg.position, { x: 40, y: 40 }, { x: 0, y: 0 });
    setCoord2(this.windowBg.size, { x: W, y: H }, { x: 0, y: 0 });
    setColor(this.windowBg.backgroundColor, 12, 12, 12);
    this.windowBg.backgroundOpacity = 0.95;
    this.windowBg.zIndex = 999;

    // 窗口边框
    const border = UiBox.create();
    border.parent = this.windowBg;
    border.anchor.x = 0;
    border.anchor.y = 0;
    setCoord2(border.position, { x: 0, y: 0 }, { x: 0, y: 0 });
    setCoord2(border.size, { x: 0, y: 0 }, { x: 1, y: 1 });
    setColor(border.backgroundColor, 40, 40, 40);
    border.backgroundOpacity = 1;
    border.zIndex = -1;

    // 标题栏
    this.titleBar = UiBox.create();
    this.titleBar.parent = this.windowBg;
    this.titleBar.anchor.x = 0;
    this.titleBar.anchor.y = 0;
    setCoord2(this.titleBar.position, { x: 1, y: 1 }, { x: 0, y: 0 });
    setCoord2(this.titleBar.size, { x: -2, y: TITLE_H }, { x: 1, y: 0 });
    setColor(this.titleBar.backgroundColor, 30, 30, 30);
    this.titleBar.backgroundOpacity = 1;
    this.titleBar.zIndex = 1001;

    // 标题文字
    const titleText = UiText.create();
    titleText.parent = this.titleBar;
    titleText.anchor.x = 0;
    titleText.anchor.y = 0;
    setCoord2(titleText.position, { x: 8, y: 4 }, { x: 0, y: 0 });
    setCoord2(titleText.size, { x: -40, y: TITLE_H - 8 }, { x: 1, y: 0 });
    titleText.textContent = 'FabricFS Terminal';
    titleText.textFontFamily = UITextFontFamily.CodeNewRomanBold;
    titleText.textFontSize = 13;
    titleText.textXAlignment = 'Left';
    setColor(titleText.textColor, 150, 150, 150);
    titleText.pointerEventBehavior =
      PointerEventBehavior.DISABLE_AND_BLOCK_PASS_THROUGH;

    // 关闭按钮
    this.closeBtn = UiText.create();
    this.closeBtn.parent = this.titleBar;
    this.closeBtn.anchor.x = 0;
    this.closeBtn.anchor.y = 0;
    setCoord2(this.closeBtn.position, { x: W - 28, y: 2 }, { x: 0, y: 0 });
    setCoord2(this.closeBtn.size, { x: 24, y: 24 }, { x: 0, y: 0 });
    this.closeBtn.textContent = '✕';
    this.closeBtn.textFontFamily = UITextFontFamily.CodeNewRomanBold;
    this.closeBtn.textFontSize = 16;
    this.closeBtn.textXAlignment = 'Center';
    setColor(this.closeBtn.textColor, 180, 80, 80);
    this.closeBtn.pointerEventBehavior =
      PointerEventBehavior.DISABLE_AND_BLOCK_PASS_THROUGH;
    // 关闭功能用 click 事件模拟（blur 检测点击）

    const screen = find('screen');
    if (!screen) return;
    // 滚动输出区
    this.scrollBox = screen.uiScrollBox_scroller;
    this.scrollBox.parent = this.windowBg;
    this.scrollBox.anchor.x = 0;
    this.scrollBox.anchor.y = 0;

    setCoord2(
      this.scrollBox.position,
      { x: 1, y: TITLE_H + 1 },
      { x: 0, y: 0 }
    );
    setCoord2(
      this.scrollBox.size,
      { x: -2, y: -(TITLE_H + INPUT_H + 2) },
      { x: 1, y: 1 }
    );
    setColor(this.scrollBox.backgroundColor, 12, 12, 12);
    this.scrollBox.backgroundOpacity = 0;
    this.scrollBox.zIndex = 1000;
    this.scrollBox.pointerEventBehavior = PointerEventBehavior.ENABLE;

    // 富文本输出
    this.textDisplay = UiText.create();
    this.textDisplay.parent = this.scrollBox;
    this.textDisplay.richText = true;
    this.textDisplay.autoWordWrap = true;
    this.textDisplay.textXAlignment = 'Left';
    this.textDisplay.textYAlignment = 'Top';
    this.textDisplay.textFontFamily = UITextFontFamily.CodeNewRomanBold;
    this.textDisplay.textFontSize = 14;
    this.textDisplay.pointerEventBehavior =
      PointerEventBehavior.DISABLE_AND_BLOCK_PASS_THROUGH;
    this.textDisplay.anchor.x = 0;
    this.textDisplay.anchor.y = 0;
    this.textDisplay.autoResize = 'Y';
    setCoord2(this.textDisplay.position, { x: 8, y: 0 }, { x: 0, y: 0 });
    setCoord2(this.textDisplay.size, { x: -16, y: 0 }, { x: 1, y: 0 });
    setColor(this.textDisplay.textColor, 210, 210, 210);

    // 输入栏底条
    this.inputBg = UiBox.create();
    this.inputBg.parent = this.windowBg;
    this.inputBg.anchor.x = 0;
    this.inputBg.anchor.y = 0;
    this.inputBg.position.offset.x = 1;
    this.inputBg.position.offset.y = H - INPUT_H - 1;
    this.inputBg.position.scale.x = 0;
    this.inputBg.position.scale.y = 0;
    this.inputBg.size.offset.x = -2;
    this.inputBg.size.offset.y = INPUT_H;
    this.inputBg.size.scale.x = 1;
    this.inputBg.size.scale.y = 0;
    setColor(this.inputBg.backgroundColor, 24, 24, 24);
    this.inputBg.backgroundOpacity = 1;
    this.inputBg.zIndex = 1000;
    this.inputBg.pointerEventBehavior = PointerEventBehavior.BLOCK_PASS_THROUGH;

    // 分隔线
    const sep = UiBox.create();
    sep.parent = this.inputBg;
    sep.anchor.x = 0;
    sep.anchor.y = 0;
    setCoord2(sep.position, { x: 0, y: 0 }, { x: 0, y: 0 });
    setCoord2(sep.size, { x: 0, y: 1 }, { x: 1, y: 0 });
    setColor(sep.backgroundColor, 50, 50, 50);
    sep.backgroundOpacity = 1;

    // 路径提示
    this.pathLabel = UiText.create();
    this.pathLabel.parent = this.inputBg;
    this.pathLabel.anchor.x = 0;
    this.pathLabel.anchor.y = 0;
    setCoord2(this.pathLabel.position, { x: 6, y: 4 }, { x: 0, y: 0 });
    setCoord2(this.pathLabel.size, { x: 200, y: -8 }, { x: 0, y: 1 });
    this.pathLabel.textContent = '/$ ';
    setColor(this.pathLabel.textColor, 0, 220, 80);
    this.pathLabel.textFontFamily = UITextFontFamily.CodeNewRomanBold;
    this.pathLabel.textFontSize = 14;
    this.pathLabel.textXAlignment = 'Left';
    this.pathLabel.pointerEventBehavior =
      PointerEventBehavior.DISABLE_AND_BLOCK_PASS_THROUGH;

    // 输入框
    this.inputField = UiInput.create();
    this.inputField.parent = this.inputBg;
    this.inputField.anchor.x = 0;
    this.inputField.anchor.y = 0;
    setCoord2(this.inputField.position, { x: 206, y: 4 }, { x: 0, y: 0 });
    setCoord2(this.inputField.size, { x: -212, y: -8 }, { x: 1, y: 1 });
    this.inputField.placeholder = '输入命令...';
    setColor(this.inputField.textColor, 0, 220, 80);
    setColor(this.inputField.placeholderColor, 170, 170, 170);
    this.inputField.textFontFamily = UITextFontFamily.CodeNewRomanBold;
    this.inputField.textFontSize = 14;
    this.inputField.textXAlignment = 'Left';
    setColor(this.inputField.backgroundColor, 24, 24, 24);
    this.inputField.backgroundOpacity = 0;
  }

  // ---- 拖动 & 关闭 -------------------------------------------------------

  private setupDrag(): void {
    this.titleBar.events.on('pointerdown', (e) => {
      const me = e as unknown as { clientX: number; clientY: number };
      this.dragging = true;
      this.dragStartX = me.clientX;
      this.dragStartY = me.clientY;
      this.dragWinX = this.windowBg.position.offset.x;
      this.dragWinY = this.windowBg.position.offset.y;
    });

    // pointerup 可能跑到标题栏外面，全局 uiEvents 兜底
    const endDrag = (e: unknown) => {
      if (!this.dragging) return;
      const me = e as { clientX: number; clientY: number };
      const dx = me.clientX - this.dragStartX;
      const dy = me.clientY - this.dragStartY;
      this.windowBg.position.offset.x = this.dragWinX + dx;
      this.windowBg.position.offset.y = this.dragWinY + dy;
      this.dragging = false;
    };
    this.titleBar.events.on('pointerup', endDrag);
    input.uiEvents.on('pointerup', endDrag);
  }

  /** 设置关闭按钮（点击关闭区域触发） */
  private setupClose(): void {
    this.closeBtn.events.on('pointerdown', () => {
      this.setVisible(false);
    });
  }

  // ---- 富文本重建 ----------------------------------------------------------

  private rebuildText(): void {
    let content = '';
    for (let i = 0; i < this.lines.length; i++) {
      if (i > 0) content += '\n';
      const { text, color } = this.lines[i];
      const hex = vec3ToHex(color);
      content += `<font color="#${hex}">${escapeXml(text)}</font>`;
    }
    this.textDisplay.textContent = content;
    this.scrollBox.scrollPosition.y = 999999;
  }

  // ---- 输入处理 --------------------------------------------------------------

  private setupInput(): void {
    this.inputField.events.on('blur', () => {
      if (this.inputBusy) return;
      const text = this.inputField.textContent.trim();
      if (text) {
        this.inputField.textContent = '';
        this.executeCommand(text);
      }
    });
  }

  private executeCommand(cmd: string): void {
    this.inputBusy = true;

    if (cmd.trim() === 'clear') {
      this.lines = [];
      this.textDisplay.textContent = '';
      this.textDisplay.size.offset.y = 0;
      setTimeout(() => {
        this.inputField.focus();
        this.inputBusy = false;
      }, 100);
      return;
    }

    this.appendLine(`${this.cwd}$ ${cmd}`, COLOR_PROMPT);
    remoteChannel.sendServerEvent({ type: 'tty-cmd', cmd });
    setTimeout(() => {
      this.inputField.focus();
      this.inputBusy = false;
    }, 100);
  }

  // ---- 远程通信 --------------------------------------------------------------

  private setupRemoteChannel(): void {
    remoteChannel.onClientEvent((args: unknown) => {
      const msg = args as Record<string, unknown>;

      if (msg?.type === 'tty-stream') {
        const lines = String(msg.data).split('\n');
        for (const l of lines) this.appendLine(l, COLOR_OUTPUT);
        return;
      }

      if (msg?.type !== 'tty-result') return;

      if (typeof msg.cwd === 'string') {
        this.cwd = msg.cwd;
        this.pathLabel.textContent = `${this.cwd}$ `;
      }

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

  // ---- 结果渲染 --------------------------------------------------------------

  private printResult(data: unknown): void {
    if (data === null || data === undefined) return;
    if (typeof data === 'string') {
      for (const line of data.split('\n')) this.appendLine(line, COLOR_OUTPUT);
    } else if (Array.isArray(data)) {
      if (data.length === 0) {
        this.appendLine('(empty)', COLOR_DIM);
        return;
      }
      const first = data[0];
      if (first && typeof first === 'object' && 'isDir' in first) {
        this.appendLine(
          (data as { name: string; isDir: boolean }[])
            .map((e) => (e.isDir ? `${e.name}/` : e.name))
            .join('  '),
          COLOR_OUTPUT
        );
      } else if (first && typeof first === 'object' && 'children' in first) {
        this.printTreeLines(data as TreeNode[], '');
      } else if (typeof first === 'string') {
        for (const item of data) this.appendLine(String(item), COLOR_OUTPUT);
      } else {
        for (const item of data) {
          this.appendLine(
            typeof item === 'object' && item !== null
              ? JSON.stringify(item)
              : String(item),
            COLOR_OUTPUT
          );
        }
      }
    } else if (typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if ('type' in obj && typeof obj.type === 'string')
        this.printStatLines(obj);
      else if ('from' in obj && 'to' in obj)
        this.appendLine(`${String(obj.from)} → ${String(obj.to)}`, COLOR_INFO);
      else if ('path' in obj && 'text' in obj)
        this.appendLine(`→ written ${String(obj.path)}`, COLOR_INFO);
      else this.appendLine(JSON.stringify(obj, null, 2), COLOR_OUTPUT);
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
      this.appendLine(
        `${prefix}${isLast ? '└─ ' : '├─ '}${nodes[i].name}`,
        COLOR_OUTPUT
      );
      if (nodes[i].children)
        this.printTreeLines(
          nodes[i].children!,
          prefix + (isLast ? '   ' : '│  ')
        );
    }
  }

  // ---- 行管理 ----------------------------------------------------------------

  private appendLine(text: string, color: Vec3): void {
    this.lines.push({ text, color });
    if (this.lines.length > this.MAX_LINES)
      this.lines.splice(0, this.lines.length - this.MAX_LINES);
    this.rebuildText();
  }

  // ---- 公开方法 --------------------------------------------------------------

  setVisible(v: boolean): void {
    this._visible = v;
    this.windowBg.visible = v;
  }

  toggle(): void {
    this.setVisible(!this._visible);
  }

  destroy(): void {
    this.windowBg.parent = undefined;
  }
}
