<script setup>
import '/style.css'
</script>

# 监听输入事件

```typescript
declare const input: InputSystem;
```

## 方法

#### <font id="API" />unlockPointer()<font id="Type"> : void</font> {#unlockPointer}

用后在游戏界面显示鼠标指针。

#### <font id="API" />lockPointer()<font id="Type"> : void</font> {#lockPointer}

调用后在游戏界面隐藏鼠标指针，由于浏览器限制，此操作可能会失败。

有兴趣可以查看[Pointer Lock 2.0](https://w3c.github.io/pointerlock/#dom-element-requestpointerlock)。

## 鼠标指针锁定监听事件

用于全局监听当玩家指针锁定状态变化或出错时产生的事件。

#### <font id="API" />pointerlockchange<font id="Type"> : [UiEvent](/ClientUI/UiEvent)‹{ isLocked }›</font> {#pointerlockchange}

当显示/隐藏鼠标指针时触发

**isLocked <font id="Type">: boolean</font>**

表示鼠标指针是否隐藏。

#### <font id="API" />pointerlockerror<font id="Type"> : [UiEvent](/ClientUI/UiEvent)‹undefined›</font> {#pointerlockerror}

当鼠标隐藏出错时触发，无事件对象

```javascript
//当显示/隐藏鼠标指针时触发
input.pointerLockEvents.add('pointerlockchange', ({ isLocked }) => {
  //...
});

//当鼠标隐藏出错时触发，无事件对象
input.pointerLockEvents.add('pointerlockerror', () => {
  //...
});
```

## 单元素点击监听事件

#### <font id="API" />pointerdown<font id="Type">: [UiEvent](/ClientUI/UiEvent)‹this›</font> {#pointerdown}

类似 Web 的 pointerdown 事件，会受到 `pointerEventBehavior` 的影响。

#### <font id="API" />pointerup<font id="Type">: [UiEvent](/ClientUI/UiEvent)‹this›</font> {#pointerup}

类似 Web 的 pointerup 事件，会受到 `pointerEventBehavior` 的影响。

```javascript
const play_btn = UiImage.create(); //创建一个元素或搜索一个元素均可。

//当监听到鼠标按下该图片元素时
play_btn.events.add('pointerdown', ({ target }) => {
  //...
});

//当监听到鼠标抬起该图片元素时
play_btn.events.add('pointerup', ({ target }) => {
  //...
});
```

## 全局点击监听事件

```javascript
// input为已定义的全局变量。

// 方式一：（推荐）
//当监听到鼠标按下任意元素时
input.uiEvents.add('pointerdown', ({ target }) => {
  //...
});

//当监听到鼠标抬起任意元素时
input.uiEvents.add('pointerup', ({ target }) => {
  //...
});

// 方式二：

//当监听到鼠标按下任意元素时
input.onPointerDown.sub(({ target }) => {
  //...
});
```
