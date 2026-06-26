<script setup>
import '/style.css'
</script>

# C-图像映射中区域的坐标

```typescript
declare class Coord2 {
  //...
}
```

![](/Coord2.png)

## 属性

#### <font id="API" /><font id="ReadOnly">只读</font>offset<font id="Type">: [Vec2](/ClientUI/maths/Vec2)</font>{#offset}

元素的相对偏移量。

#### <font id="API" /><font id="ReadOnly">只读</font>scale<font id="Type">: [Vec2](/ClientUI/maths/Vec2)</font>{#scale}

元素的相对缩放量，每个坐标轴的范围为 0-1。

## 静态方法

#### <font id="API" />create(<font id="Type">val?:Coord2</font>)<font id="Type">: Coord2</font>{#create}

按创建并返回一个新的 Coord2，该 Coord2 初始 offset 和 scale 为空。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                 |
| -------- | -------- | ---------- | -------- | ------------------------ |
| val      |          |            | Coord2   | 规定图像映射中区域的坐标 |

**返回值**

| **类型** | **说明**                 |
| -------- | ------------------------ |
| Coord2   | 规定图像映射中区域的坐标 |
