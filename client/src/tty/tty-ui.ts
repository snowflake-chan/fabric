/**
 * TtyUI — FabricFS 终端（纯流式）
 *
 * 服务端发什么就显示什么，不做行管理。
 */

import find from '../../UiIndex';
import { render } from './adapter';

interface TreeNode {
  name: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
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

const W = 900;
const H = 560;
const TITLE_H = 28;
const INPUT_H = 32;

export class TtyUI {
  private windowBg!: UiBox;
  private titleBar!: UiBox;
  private closeBtn!: UiText;
  private scrollBox!: UiScrollBox;
  private textDisplay!: UiText;
  private inputField!: UiInput;
  private lines: string[] = [];
  private readonly MAX_LINES = 500;
  private inputBusy = false;
  private _visible = true;
  private passwordMode = false;
  private passwordBuf = '';
  private noEcho = false;

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
    setTimeout(() => {
      this.inputField.focus();
      remoteChannel.sendServerEvent({ type: 'tty-cmd', cmd: 'login' });
    }, 200);
  }

  private buildUI(): void {
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

    const border = UiBox.create();
    border.parent = this.windowBg;
    border.anchor.x = 0;
    border.anchor.y = 0;
    setCoord2(border.position, { x: 0, y: 0 }, { x: 0, y: 0 });
    setCoord2(border.size, { x: 0, y: 0 }, { x: 1, y: 1 });
    setColor(border.backgroundColor, 40, 40, 40);
    border.backgroundOpacity = 1;
    border.zIndex = -1;

    this.titleBar = UiBox.create();
    this.titleBar.parent = this.windowBg;
    this.titleBar.anchor.x = 0;
    this.titleBar.anchor.y = 0;
    setCoord2(this.titleBar.position, { x: 1, y: 1 }, { x: 0, y: 0 });
    setCoord2(this.titleBar.size, { x: -2, y: TITLE_H }, { x: 1, y: 0 });
    setColor(this.titleBar.backgroundColor, 30, 30, 30);
    this.titleBar.backgroundOpacity = 1;
    this.titleBar.zIndex = 1001;

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

    this.scrollBox = find('screen')!.uiScrollBox_scroller;
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

    const textBox = UiBox.create();
    textBox.parent = this.scrollBox;
    textBox.anchor.x = 0;
    textBox.anchor.y = 0;
    setCoord2(textBox.position, { x: 0, y: 0 }, { x: 0, y: 0 });
    setCoord2(textBox.size, { x: 0, y: 0 }, { x: 1, y: 0 });
    textBox.autoResize = 'Y';
    textBox.backgroundOpacity = 0;

    this.textDisplay = UiText.create();
    this.textDisplay.parent = textBox;
    this.textDisplay.richText = true;
    this.textDisplay.autoWordWrap = true;
    this.textDisplay.textXAlignment = 'Left';
    this.textDisplay.textYAlignment = 'Top';
    this.textDisplay.autoResize = 'Y';
    this.textDisplay.textFontFamily = UITextFontFamily.CodeNewRomanBold;
    this.textDisplay.textFontSize = 14;
    this.textDisplay.pointerEventBehavior =
      PointerEventBehavior.DISABLE_AND_BLOCK_PASS_THROUGH;
    this.textDisplay.anchor.x = 0;
    this.textDisplay.anchor.y = 0;
    setCoord2(this.textDisplay.position, { x: 8, y: 0 }, { x: 0, y: 0 });
    setCoord2(this.textDisplay.size, { x: -16, y: 0 }, { x: 1, y: 0 });
    setColor(this.textDisplay.textColor, 210, 210, 210);

    this.inputField = UiInput.create();
    this.inputField.parent = this.windowBg;
    this.inputField.anchor.x = 0;
    this.inputField.anchor.y = 0;
    setCoord2(
      this.inputField.position,
      { x: 1, y: H - INPUT_H - 1 },
      { x: 0, y: 0 }
    );
    setCoord2(this.inputField.size, { x: -2, y: INPUT_H }, { x: 1, y: 0 });
    this.inputField.placeholder = '';
    setColor(this.inputField.textColor, 210, 210, 210);
    setColor(this.inputField.placeholderColor, 170, 170, 170);
    this.inputField.textFontFamily = UITextFontFamily.CodeNewRomanBold;
    this.inputField.textFontSize = 14;
    this.inputField.textXAlignment = 'Left';
    setColor(this.inputField.backgroundColor, 24, 24, 24);
    this.inputField.backgroundOpacity = 0;
    // 输入框在底部
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
    const endDrag = (e: unknown) => {
      if (!this.dragging) return;
      const me = e as { clientX: number; clientY: number };
      this.windowBg.position.offset.x =
        this.dragWinX + me.clientX - this.dragStartX;
      this.windowBg.position.offset.y =
        this.dragWinY + me.clientY - this.dragStartY;
      this.dragging = false;
    };
    this.titleBar.events.on('pointerup', endDrag);
  }

  private setupClose(): void {
    this.closeBtn.events.on('pointerdown', () => this.setVisible(false));
  }

  private escXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- 流式输出 -----------------------------------------------------------

  private rebuild(): void {
    const rich = this.lines
      .map((l) => {
        if (l.startsWith('<font ')) return l;
        return `<font color="#ccc">${this.escXml(l)}</font>`;
      })
      .join('\n');
    try {
      this.textDisplay.textContent = rich;
    } catch {
      // XML 格式错误时降级为纯文本
      this.textDisplay.textContent = `<font color="#ccc">${this.escXml(this.lines[this.lines.length - 1] || '')}</font>`;
    }
    this.scrollBox.scrollPosition.y = 999999;
  }

  /** 流式追加文本 */
  private stream(data: string): void {
    // 把 data 追加到最后一行（或新行）
    const last = this.lines.length - 1;
    const hasNewline = data.includes('\n');
    const parts = data.split('\n');

    if (this.lines.length === 0) {
      // 第一行
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] !== '' || i < parts.length - 1) this.lines.push(parts[i]);
      }
    } else {
      // 追加到最后一行
      this.lines[last] = (this.lines[last] || '') + parts[0];
      for (let i = 1; i < parts.length; i++) {
        this.lines.push(parts[i]);
      }
    }

    // 裁剪
    if (this.lines.length > this.MAX_LINES) {
      this.lines.splice(0, this.lines.length - this.MAX_LINES);
    }

    this.rebuild();
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
    if (this.passwordMode) {
      this.passwordMode = false;
      remoteChannel.sendServerEvent({
        type: 'tty-cmd',
        cmd: this.passwordBuf || cmd,
      });
      this.passwordBuf = '';
      setTimeout(() => {
        this.inputField.focus();
        this.inputBusy = false;
      }, 100);
      return;
    }
    if (!this.noEcho) this.stream(`${cmd}\n`);
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

      if (msg?.type === 'tty-clear') {
        this.lines = [];
        this.textDisplay.textContent = '';
        return;
      }

      if (msg?.type === 'tty-password') {
        this.passwordMode = true;
        this.passwordBuf = '';
        return;
      }

      if (msg?.type === 'tty-noecho') {
        this.noEcho = true;
        return;
      }
      if (msg?.type === 'tty-echo') {
        this.noEcho = false;
        return;
      }

      if (msg?.type === 'tty-stream') {
        const style = String(msg.style ?? 'output');
        this.stream(
          render(
            String(msg.data),
            style as 'output' | 'error' | 'prompt' | 'info' | 'dim'
          )
        );
        return;
      }

      if (msg?.type !== 'tty-result') return;
      const result = msg.result as { ok: boolean; error?: string } | undefined;
      if (result && !result.ok && result.error) {
        this.stream(render(`✗ ${result.error}\n`, 'error'));
      }
    });
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
