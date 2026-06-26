<script setup>
import '/style.css'
</script>

# UI 输入

> UiInput 是继承自 [UiText](/ClientUI/node/UiText) 类

![](/QQ20240923-102409.png)

- 输入框是特殊的可交互文本框，允许在用户聚焦时输入文本内容
- 输入框存在提示文本，用于在无内容时提示输入信息，提示文本可以配置内容及字体颜色，其余属性将与文本内容一致（对齐方式、文本换行等）

## 属性

#### <font id="API" />placeholder<font id="Type">: string</font>{#placeholder}

> 默认值：'Type something here'

输入框的未输入时文本提示内容。

#### <font id="API" /><font id="ReadOnly">只读</font>placeholderColor<font id="Type">: [Vec3](/ClientUI/maths/Vec3)</font>{#placeholderColor}

输入框显示的占位文本的颜色。

#### <font id="API" /><font id="ReadOnly">只读</font>placeholderOpacity<font id="Type">: number</font>{#placeholderOpacity}

> 默认值：1

输入框提示文本的不透明度。

#### <font id="API" /><font id="ReadOnly">只读</font>isFocus<font id="Type">: boolean</font>{#isFocus}

输入框是否聚焦。

## 静态方法

#### <font id="API" />create()<font id="Type">: UiInput</font>{#create}

创建并返回一个新的 Ui 输入，初始`parent`为空。

**返回值**

| **类型** | **说明**              |
| -------- | --------------------- |
| UiInput  | 新建 UiInput 元素实例 |

## 方法

#### <font id="API" />focus()<font id="Type">: void</font>{#focus}

使输入框聚焦。

#### <font id="API" />blur()<font id="Type">: string</font>{#blur}

使输入框失去焦点。

**返回值**

| **类型** | **说明**             |
| -------- | -------------------- |
| string   | 输入框当前的输入值。 |

## 单元素焦点变化监听事件

#### <font id="API" />focus<font id="Type">: [UiEvent](/ClientUI/UiEvent)‹UiInput›</font>

使输入框聚焦。

#### <font id="API" />blur<font id="Type">: [UiEvent](/ClientUI/UiEvent)‹UiInput›</font>

使输入框失去焦点。

```javascript
const inputDemo = UiInput.create(); // 静态方法，直接通过类上面的方法来使用。

//当监听到该输入框得到焦点时
inputDemo.events.add('focus', (uiInput) => {
  //xxx
});

//当监听到该输入框失去焦点时
inputDemo.events.add('blur', (uiInput) => {
  //xxx
});
```
