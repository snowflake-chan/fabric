<script setup>
import '/style.css'
</script>

# UI 父类

```typescript
/**
 * @deprecated 已不推荐使用该属性，请使用{@link UiScreen}获取屏幕对象。
 */
declare const ui: UiNode;
```

## 属性

#### <font id="API" />name<font id="Type">: string</font> {#name}

该节点的标识，可重复。

#### <font id="API" />parent<font id="Type">: UiNode | undefined</font> {#parent}

节点的父节点，非根节点的父节点为空时，该节点将不会被渲染。

> ℹ️ 若节点的父节点为空，且在脚本中无任何引用，则该节点可能会被浏览器当作垃圾回收掉哦。

#### <font id="API" /><font id="ReadOnly">只读</font>children<font id="Type">: ReadonlyArray‹UiNode›</font> {#children}

节点的子节点。如需要调整子节点结构，应修改子节点的`parent`属性。

#### <font id="API" /><font id="ReadOnly">只读</font>events<font id="Type">: [EventEmitter](/ClientUI/UiEvent)‹[UiNodeEvents](/ClientUI/UiRenderable#事件)›</font> {#events}

管理节点相关的事件。

#### <font id="API" />uiScale<font id="Type">: [UiScale](/ClientUI/maths/UiScale) | undefined</font> {#uiScale}

节点等比例缩放数据。

## 方法

#### <font id="API" />findChildByName(<font id="Type">name: string</font>)<font id="Type">: UiNode | undefined</font> {#findChildByName}

按名称查找子节点，返回对应子节点对象。（节点名称可在编辑模式下的属性面板中查看）

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**           |
| -------- | -------- | ---------- | -------- | ------------------ |
| name     | 是       |            | string   | 需要查找的节点名称 |

**返回值**

| **类型**                | **说明**                                                            |
| ----------------------- | ------------------------------------------------------------------- |
| UiNode &#124; undefined | 指定名称的节点的对象，若子节点中无对应 ID 的节点，则返回`undefined` |

#### <font id="API" />clone()<font id="Type">: this</font> {#clone}

克隆节点，包括其子节点。

**返回值**

| **类型** | **说明**               |
| -------- | ---------------------- |
| this     | 返回克隆出来的新节点。 |
