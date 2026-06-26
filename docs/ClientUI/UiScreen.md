<script setup>
import '/style.css'
</script>

# UI 屏幕

> UiScreen 是继承自 [UiNode](/ClientUI/UiNode) 类

- 屏幕是 GUI 下的最高级别容器（此级别仅有屏幕一个类别元素），用于承载其他 2D UI 元素（UI 元素均需要存在于某个屏幕之下），它将始终以设备屏幕画布为自身载体，自身无实质性内容
- 每个作品至少含有一个 screen（最后一个无法删除），至多可以有 1000（超出新增无响应）

## 属性

#### <font id="API" />visible<font id="Type">: boolean</font>{#visible}

> 默认值：true

屏幕是否可见。

#### <font id="API" />zIndex<font id="Type">: number</font>{#zIndex}

> 默认值：1

屏幕层级，层级越高的屏幕会显示在顶部，遮盖住层级较低的屏幕。

## 静态方法

#### <font id="API" />create()<font id="Type">: UiScreen</font>{#create}

创建一个新的 Ui 屏幕 实例。

**返回值**

| **类型** | **说明**               |
| -------- | ---------------------- |
| UiScreen | 新建 UiScreen 屏幕实例 |

#### <font id="API" />getAllScreen()<font id="Type">: UiScreen[]</font>{#getAllScreen}

获取当前所有存在的屏幕实例。

**返回值**

| **类型**   | **说明**                   |
| ---------- | -------------------------- |
| UiScreen[] | 所有 UiScreen 屏幕实例列表 |

::: details 点击查看示例代码
**根据名称获取指定屏幕对象**

```javascript
// 查找屏幕名称为 'screen-1' 的屏幕对象
const foundObject = UiScreen.getAllScreen().find(
  (obj) => obj.name === 'screen-1'
);

if (foundObject) {
  console.log('找到了对象:', foundObject);
} else {
  console.log('未找到对象');
}
```

---

**UI 元素挂载到指定屏幕上**

```javascript
// 创建一个 aScreen 屏幕
const aScreen = UiScreen.create();
aScreen.name = '屏幕名称';

// 创建文本元素，并挂载到 aScreen 屏幕上
const text = UiText.create();
text.parent = aScreen;
text.position.offset.copy({ x: 10, y: 20 });
text.textContent = '你好';
```

---

**UI 元素挂载到默认屏幕上**

```javascript
// ui所指向的是默认屏幕。因此不需要格外搜索。
// 创建文本元素，并挂载到 aScreen 屏幕上
const text = UiText.create();
text.parent = ui;
text.position.offset.copy({ x: 10, y: 20 });
text.textContent = '你好';
```

:::
