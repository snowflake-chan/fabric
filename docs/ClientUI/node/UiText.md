<script setup>
import '/style.css'
</script>

# UI 文本

> UiText 是继承自 [UiRenderable](/ClientUI/UiRenderable) 类

![](/QQ20240923-102346.png)

## 属性

#### <font id="API" />textContent<font id="Type">: string</font>{#textContent}

> 默认值：'Text'

文本元素的内容，支持转义字符与换行，会对自身元素的自适应大小产生影响。

换行后，所有受到元素大小影响的属性，均需以新的大小进行计算，包括且不限于：

- textXAlignment
- textYAlignment

#### <font id="API" />richText<font id="Type">: boolean</font>{#richText}

> 默认值：false

文本元素的内容是否支持`富文本`。支持的 xml 语法请看：[富文本](/ClientUI/RichText)

#### <font id="API" />textFontSize<font id="Type">: number</font>{#textFontSize}

> 默认值：14

节点显示的文本的字体大小。

#### <font id="API" /><font id="ReadOnly">只读</font>textColor<font id="Type">: [Vec3](/ClientUI/maths/Vec3)</font>{#textColor}

节点显示的文本的颜色。

#### <font id="API" />textXAlignment<font id="Type">: 'Center' | 'Left' | 'Right'</font>{#textXAlignment}

> 默认值：'Center'

节点显示的文本的水平对齐方式。

#### <font id="API" />textYAlignment<font id="Type">: 'Center' | 'Top' | 'Bottom'</font>{#textYAlignment}

> 默认值：'Center'

节点显示的文本的垂直对齐方式。

#### <font id="API" />autoWordWrap<font id="Type">: boolean</font>{#autoWordWrap}

> 默认值：false

是否开启自动换行。

#### <font id="API" />textLineHeight<font id="Type">: number</font>{#textLineHeight}

> 默认值：1.2

文本的行高。

#### <font id="API" /><font id="ReadOnly">只读</font>textStrokeColor<font id="Type">: [Vec3](/ClientUI/maths/Vec3)</font>{#textStrokeColor}

文本的描边颜色。

#### <font id="API" />textStrokeOpacity<font id="Type">: number</font>{#textStrokeOpacity}

> 默认值：1

文本描边的不透明度。

#### <font id="API" />textStrokeThickness<font id="Type">: number</font>{#textStrokeThickness}

> 默认值：0

文本描边的厚度。范围 0-25

描边粗细效果不影响元素“尺寸”，即不会影响自适应、布局计算、以及交互热区，但是会受到[UIScale](/ClientUI/maths/UiScale)的影响

#### <font id="API" />textFontFamily<font id="Type">: [UITextFontFamily](./UiText#UITextFontFamily)</font>{#textFontFamily}

> 默认值：UITextFontFamily.Default

文本使用的字体。

由官方提供的可免费商用字体。

## 静态方法

#### <font id="API" />create()<font id="Type">: UiText</font>{#create}

创建并返回一个新的 Ui 文本，初始`parent`为空。

**返回值**

| **类型** | **说明**             |
| -------- | -------------------- |
| UiText   | 新建 UiText 元素实例 |

## 枚举

#### <font id="API" />UITextFontFamily{#UITextFontFamily}

字体样式

| **属性**         | **说明**            |
| ---------------- | ------------------- |
| Default          | 默认字体            |
| BoldRound        | 粗圆体              |
| CodeNewRomanBold | Code New Roman Bold |
| ENSerif          | EN-Serif            |
