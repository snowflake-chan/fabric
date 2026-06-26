<script setup>
import '/style.css'
</script>

# C-二维向量

```typescript
declare class Vec2 {
  //...
}
```

## 属性

#### <font id="API" />x<font id="Type">: number</font> {#x}

> 默认值：0

Vec2的x坐标。

---

#### <font id="API" />y<font id="Type">: number</font> {#y}

> 默认值：0

Vec2的y坐标。

## 静态方法

#### <font id="API" />create(<font id="Type">val?:{x:number;y:number;} | Vec2</font>)<font id="Type">: Vec2</font> {#create}

创建并返回一个新的Vec2。如果提供了一个Vec2作为参数，新的Vec2的x和y将被设置为给定Vec2的x和y。如果没有提供参数，新的Vec2的x和y将被设置为0。

**输入参数**

| **参数** | **必填** | **默认值** | **类型**                         | **说明** |
| -------- | -------- | ---------- | -------------------------------- | -------- |
| val      |          |            | {x:number;y:number;} &#124; Vec2 | xy坐标   |

**返回值**

| **类型** | **说明**     |
| -------- | ------------ |
| Vec2     | 二维向量对象 |

## 方法

#### <font id="API" />copy(<font id="Type">val: Vec2</font>)<font id="Type">: Vec2</font> {#copy}

复制给定的Vec2的x和y到当前Vec2。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明** |
| -------- | -------- | ---------- | -------- | -------- |
| val      |          |            | Vec2     | 二维坐标 |

**返回值**

| **类型** | **说明**     |
| -------- | ------------ |
| Vec2     | 二维向量对象 |

```javascript
let vec1 = Vec2.create({ x: 1, y: 2 });
let vec2 = Vec2.create();
vec2.copy(vec1); // vec2的x和y现在都被设置为vec1的x和y
```
