<script setup>
import '/style.css'
</script>

# UI 可渲染基类

> UiRenderable 是继承自 [UiNode](/ClientUI/UiNode) 类

## 属性

#### <font id="API" /><font id="ReadOnly">只读</font>anchor<font id="Type">: [Vec2](/ClientUI/maths/Vec2)</font> {#anchor}

节点的锚点，用于确定节点的位置。

每个坐标轴的范围为 0-1。

#### <font id="API" /><font id="ReadOnly">只读</font>position<font id="Type">: [Coord2](/ClientUI/maths/Coord2)</font> {#position}

节点的位置，相对于父节点的位置。

#### <font id="API" /><font id="ReadOnly">只读</font>backgroundColor<font id="Type">: [Vec3](/ClientUI/maths/Vec3)</font> {#backgroundColor}

节点的背景颜色。

#### <font id="API" />backgroundOpacity<font id="Type">: number</font>{#backgroundOpacity}

> 默认值：1

节点的背景透明度。

#### <font id="API" />rotation<font id="Type">: number</font>{#rotation}

> 默认值：0

节点的旋转角度。

控制 UI 元素的旋转角度，旋转参考点默认为元素外框的几何中心点，即默认旋转参考点为 (0.5, 0.5) 锚点位置（不受实际锚点变化影响）

角度取值范围：-179 到 180

#### <font id="API" /><font id="ReadOnly">只读</font>size<font id="Type">: [Coord2](/ClientUI/maths/Coord2)</font> {#size}

节点的尺寸。

#### <font id="API" />zIndex<font id="Type">: number</font> {#zIndex}

> 默认值：1

节点的层级，用于确定节点的渲染顺序。

#### <font id="API" />autoResize<font id="Type">: 'NONE' | 'X' | 'Y' | 'XY'</font> {#autoResize}

> 默认值：'NONE'

节点的自动调整尺寸的方式。

#### <font id="API" />visible<font id="Type">: boolean</font>{#visible}

> 默认值：true

节点的可见性。

#### <font id="API" />pointerEventBehavior<font id="Type">: [PointerEventBehavior](./UiRenderable#PointerEventBehavior)</font> {#pointerEventBehavior}

> 默认值：PointerEventBehavior.ENABLE

配置鼠标指针事件的响应方式，鼠标指针事件包括：

- pointerdown
- pointerup

## 枚举

#### <font id="API" />PointerEventBehavior{#PointerEventBehavior}

表示界面元素对鼠标指针按下事件的行为方式。

无论是哪种行为方式，鼠标指针事件在 UI 元素上触发时，都不会产生对应的玩家输入。

| **属性**                       | **说明**                                     |
| ------------------------------ | -------------------------------------------- |
| DISABLE_AND_BLOCK_PASS_THROUGH | 不响应，且不允许位于元素后方的其他元素响应。 |
| DISABLE                        | 不响应。                                     |
| BLOCK_PASS_THROUGH             | 不允许位于元素后方的其他元素响应。           |
| ENABLE                         | 正常响应。                                   |
