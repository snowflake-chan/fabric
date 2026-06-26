<script setup>
import '/style.css'
</script>

# UI 图片

> UiImage 是继承自 [UiRenderable](/ClientUI/UiRenderable) 类

![](/QQ20240923-102303.png)

## 属性

#### <font id="API" />image<font id="Type">: string</font> {#image}

> 默认值：''

图片元素的内容，应为图片的路径或者 URL。

#### <font id="API" />imageOpacity<font id="Type">: number</font>{#imageOpacity}

> 默认值：1

图片元素的透明度。

#### <font id="API" />imageDisplayMode<font id="Type">: [ImageDisplayMode](./UiImage#ImageDisplayMode)</font>{#imageDisplayMode}

> 默认值：ImageDisplayMode.Fill

图像显示模式的声明。

图片元素中的图片资源，不属于其子内容，所以只受到展示方式影响，不受裁剪&自适应作用

#### <font id="API" /><font id="ReadOnly">只读</font>complete<font id="Type">: boolean</font>{#complete}

图片是否加载完毕。

## 静态方法

#### <font id="API" />create()<font id="Type">: UiImage</font>{#create}

创建一个新的 Ui 图片 实例。初始`parent`为空。

**返回值**

| **类型** | **说明**              |
| -------- | --------------------- |
| UiImage  | 新建 UiImage 元素实例 |

## 枚举

#### <font id="API" />ImageDisplayMode{#ImageDisplayMode}

控制图像的显示方式

| **属性** | **说明**                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------ |
| Fill     | 铺满：（默认）适配元素外框长宽拉伸铺满展示，图片可能会变形                                             |
| Contain  | 等比铺满：等比缩放保证图片完整展示在外框内                                                             |
| Cover    | 等比截取：等比缩放图片使图片填满外框，超出部分将被裁剪（隐藏显示）                                     |
| None     | 无：按图片正常尺寸与外框中心对齐展示，不对图片进行任何缩放调整，但是超出元素框部分会被裁剪（隐藏显示） |

## 图片加载完毕事件

#### <font id="API" />load<font id="Type">: [UiEvent](/ClientUI/UiEvent)‹UiImage›</font>

图片加载完成后触发。

```javascript
const img = UiImage.create();
img.image = 'picture/cat.jpg';
img.imageDisplayMode = ImageDisplayMode.Contain;

img.events.add('load', (event) => {
  console.log('complete = ', event.target.complete);
});

img.parent = ui;
```
